/*
 * A port of app/Workbench/MenuBarIconRenderer.swift to canvas.
 *
 * Every number here is copied from that file: an 18pt icon, a 10pt badge disc pinned
 * to the top-right corner, "9+" above nine, white bold 7pt text centred in the disc,
 * and the template flag set only when the count is zero.
 *
 * One coordinate gotcha worth writing down: AppKit's y axis points up, so the Swift
 * badge sits at `y: size.height - diameter`, which is the TOP of the icon. Canvas y
 * points down, so the same corner is `y: 0`.
 */

/** The size MenuBarIconRenderer draws at, in points. */
const SIZE = 18
/** Badge disc diameter in points, from the Swift renderer. */
const BADGE_DIAMETER = 10
/** Badge text size in points. */
const BADGE_FONT_SIZE = 7

/*
 * The measured value of `NSColor.systemRed`, which is what MenuBarIconRenderer fills
 * the badge with, resolved to sRGB in a process with no appearance set: rgb(255, 66, 69).
 *
 * Measured rather than looked up, and the first attempt here was the widely quoted
 * #FF3B30, which the pixel diff rejected. Note this is not the documented light value
 * #FF3B30 nor the dark one #FF453A, so quoting either would have been wrong.
 *
 * The deeper problem this constant cannot solve: `systemRed` is a *dynamic* colour that
 * resolves per appearance, so the Swift badge follows light and dark while a CSS or
 * canvas constant cannot. A real port would have to resolve it natively and hand it to
 * the frontend. Recorded in findings.md.
 */
const BADGE_RED = '#ff4245'

export type TrayIconBytes = {
  rgba: Uint8Array
  width: number
  height: number
  isTemplate: boolean
  /**
   * Measured width of the badge text in points, against the disc's 10.
   * Reported because canvas font metrics are not AppKit's: see findings.md.
   */
  badgeTextWidth: number
}

let baseIcon: HTMLImageElement | null = null

/** Loads the SF Symbol exported by tools/export-symbol.swift. */
async function loadBaseIcon(scale: number): Promise<HTMLImageElement> {
  if (baseIcon) return baseIcon
  const image = new Image()
  image.src = scale > 1 ? '/tray/tray-18@2x.png' : '/tray/tray-18.png'
  await image.decode()
  baseIcon = image
  return image
}

/**
 * Draws the icon for a badge count onto a canvas and returns its RGBA bytes.
 *
 * `scale` is the backing scale to rasterise at. The menu bar is drawn at the screen's
 * scale, so a 1x bitmap on a Retina display is visibly soft.
 */
export async function renderTrayIcon(
  badgeCount: number,
  scale = 2,
  canvas?: HTMLCanvasElement,
): Promise<TrayIconBytes> {
  // Every await happens before the canvas is touched, and the transform is set
  // absolutely rather than with save/scale/restore.
  //
  // Both details are load-bearing, and a browser screenshot is what found out why:
  // React StrictMode invokes the effect twice, two calls then shared one canvas
  // across the await, and each `context.scale(2, 2)` multiplied the one before it,
  // so the icon was drawn once at 4x and once at 2x, overlapping. It looked like a
  // rendering glitch and was really a concurrency bug.
  const icon = await loadBaseIcon(scale)

  const pixels = SIZE * scale
  const target = canvas ?? document.createElement('canvas')
  target.width = pixels
  target.height = pixels

  const context = target.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('no 2d canvas context')

  context.setTransform(scale, 0, 0, scale, 0, 0)
  context.clearRect(0, 0, SIZE, SIZE)
  context.drawImage(icon, 0, 0, SIZE, SIZE)

  let badgeTextWidth = 0

  if (badgeCount > 0) {
    const radius = BADGE_DIAMETER / 2
    const centreX = SIZE - radius
    const centreY = radius

    context.beginPath()
    context.arc(centreX, centreY, radius, 0, Math.PI * 2)
    context.fillStyle = BADGE_RED
    context.fill()

    const text = badgeCount > 9 ? '9+' : String(badgeCount)
    context.fillStyle = '#ffffff'
    context.font = `bold ${BADGE_FONT_SIZE}px -apple-system, BlinkMacSystemFont, sans-serif`
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    badgeTextWidth = context.measureText(text).width
    context.fillText(text, centreX, centreY)
  }

  context.setTransform(1, 0, 0, 1, 0, 0)

  const data = context.getImageData(0, 0, pixels, pixels).data
  return {
    rgba: new Uint8Array(data),
    width: pixels,
    height: pixels,
    // Matches the Swift comment: a template image is auto-tinted monochrome by the
    // system, which would erase the red badge. Only the idle icon can be a template.
    isTemplate: badgeCount === 0,
    badgeTextWidth,
  }
}
