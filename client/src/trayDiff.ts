/*
 * Pixel-diffs the canvas tray icon against the SwiftUI app's real output.
 *
 * The reference PNGs in public/tray/reference were produced by compiling the production
 * `MenuBarIconRenderer.swift` and calling it, not by transcribing it, which is what makes
 * this a comparison rather than a tautology.
 *
 * That renderer is gone: the SwiftUI app was removed once this client reached parity. The
 * PNGs stay, because they are the recorded output of the thing this has to match, and a
 * baseline does not stop being a baseline when its source is retired. Regenerating them
 * would mean checking out the commit before the removal and rebuilding
 * `tools/render-swift-icons`, which went with it.
 *
 * This exists because the menu bar cannot be photographed on this machine, so the usual
 * "screenshot both and look" is unavailable. A pixel diff is stronger anyway.
 */

import { renderTrayIcon } from './trayBadge'

export type IconDiff = {
  count: number
  /** Pixels whose colour differs by more than the tolerance, out of 324. */
  differing: number
  /** Largest single-channel difference found, 0-255. */
  maxChannelDelta: number
  /** Mean absolute channel difference across every pixel. */
  meanChannelDelta: number
  /** Alpha-only mismatches, which is where a shape difference would show up. */
  alphaMismatches: number
  /**
   * Differing pixels outside the 10x10 badge corner. This separates "the badge text
   * rasterises differently" from "the glyph is in the wrong place", which are very
   * different findings.
   */
  differingOutsideBadge: number
}

async function loadReference(count: number): Promise<Uint8ClampedArray> {
  const image = new Image()
  image.src = `/tray/reference/tray-swift-${count}.png`
  await image.decode()

  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  context.drawImage(image, 0, 0)
  return context.getImageData(0, 0, canvas.width, canvas.height).data
}

/**
 * Compares at 1x, because that is the only size the Swift renderer produces: it draws
 * into an 18x18 NSImage, so its bitmap is 18x18 pixels even on a Retina menu bar.
 */
export async function diffIcon(count: number): Promise<IconDiff> {
  const reference = await loadReference(count)
  const mine = await renderTrayIcon(count, 1)

  if (reference.length !== mine.rgba.length) {
    throw new Error(`size mismatch: reference ${reference.length}, canvas ${mine.rgba.length}`)
  }

  let differing = 0
  let maxChannelDelta = 0
  let totalDelta = 0
  let alphaMismatches = 0
  let differingOutsideBadge = 0

  // The badge occupies the top-right 10x10 of the 18x18 icon.
  const width = 18
  const badgeLeft = width - 10
  const badgeBottom = 10

  for (let i = 0; i < reference.length; i += 4) {
    const pixel = i / 4
    const x = pixel % width
    const y = Math.floor(pixel / width)
    const inBadge = x >= badgeLeft && y < badgeBottom

    let worst = 0
    for (let channel = 0; channel < 4; channel += 1) {
      const delta = Math.abs(reference[i + channel] - mine.rgba[i + channel])
      totalDelta += delta
      if (delta > worst) worst = delta
      if (channel === 3 && delta > 8) alphaMismatches += 1
    }
    if (worst > 8) {
      differing += 1
      if (!inBadge) differingOutsideBadge += 1
    }
    if (worst > maxChannelDelta) maxChannelDelta = worst
  }

  return {
    count,
    differing,
    maxChannelDelta,
    meanChannelDelta: totalDelta / reference.length,
    alphaMismatches,
    differingOutsideBadge,
  }
}

export function formatDiffs(diffs: IconDiff[]): string {
  const lines = diffs.map(
    (d) =>
      `count ${String(d.count).padStart(2)}: differing=${d.differing}/324 ` +
      `outsideBadge=${d.differingOutsideBadge} ` +
      `maxDelta=${d.maxChannelDelta} meanDelta=${d.meanChannelDelta.toFixed(2)} ` +
      `alphaMismatch=${d.alphaMismatches}`,
  )
  return ['TRAY DIFF vs Swift MenuBarIconRenderer at 18x18', ...lines].join('\n')
}
