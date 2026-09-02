/*
 * The colours both diff renderers use.
 *
 * The app has two of them, `DiffView.swift` and `PrFileSectionView`, and DiffView.swift
 * says why they have to name the same three tokens: "The app has two diff renderers, so
 * they have to name the same colours or removed lines end up in two different reds." In
 * Swift that agreement is `Theme.Status.approved` appearing in both files. Here it is
 * this module, so the shared names are a thing that exists rather than a convention.
 *
 * The tints are deliberately not shared. DiffView uses 12% and PrFileSectionView 10%, and
 * that difference is copied from the Swift rather than reconciled: reconciling it would
 * be a redesign, and a port that quietly improves things makes its own bugs impossible to
 * find.
 */

export const DIFF_ADDITION = 'var(--wb-status-approved)'
export const DIFF_DELETION = 'var(--wb-status-changes-requested)'
export const DIFF_CONTEXT = 'var(--wb-n400)'

/** `Color.opacity(fraction)` on a token, which CSS cannot express on a var directly. */
export function tint(color: string, percent: number): string {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`
}
