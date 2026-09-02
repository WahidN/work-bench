/*
 * An SF Symbol, exported to PNG by tools/export-ui-symbols.swift and used here as a
 * CSS mask so `background: currentColor` tints it.
 *
 * The mask is what makes this a real replacement rather than a compromise. An <img>
 * would give a fixed-colour glyph, and SwiftUI tints SF Symbols freely with
 * `foregroundStyle`, so a fixed colour would have meant hard-coding a different asset
 * per colour. With a mask the tint follows `color` exactly as it does in SwiftUI.
 */

export function Icon({
  name,
  size,
  color,
  style,
}: {
  name: string
  /** Point size, matching the `.font(.system(size:))` on the SwiftUI Image. */
  size: number
  color?: string
  style?: React.CSSProperties
}) {
  return (
    <span
      aria-hidden
      data-icon={name}
      style={{
        display: 'inline-block',
        flex: 'none',
        width: size,
        height: size,
        background: color ?? 'currentColor',
        maskImage: `url(/icons/${name}.png)`,
        maskSize: 'contain',
        maskPosition: 'center',
        maskRepeat: 'no-repeat',
        ...style,
      }}
    />
  )
}
