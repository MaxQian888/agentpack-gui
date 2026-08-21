/**
 * The interface-scale vocabulary, kept out of `lib/tauri/settings.ts` on
 * purpose: that file is the Tauri store bridge, and every test that mocks it —
 * the shell's four suites among them — would otherwise lose this narrowing
 * helper along with the writer they meant to stub. This is pure and
 * browser-safe, like the rest of `lib/agentpack/`.
 *
 * The values are percentages of the browser's default root font size. Because
 * every length in the app is a rem, the root size is the whole interface scale;
 * the actual sizes live in `tokens.css` as `--hm-root-*` and are selected by the
 * `data-ui-scale` attribute `useAppearance` writes onto <html>.
 */
export const UI_SCALES = [90, 100, 110, 125] as const

export type UiScale = (typeof UI_SCALES)[number]

/** The default, and what an unrecognised persisted value falls back to. */
export const DEFAULT_UI_SCALE: UiScale = 100

/**
 * Narrow an arbitrary persisted value to a scale the stylesheet implements. A
 * settings file edited by hand (or imported from a later release) must not put
 * an unknown size on the document root.
 */
export function normalizeUiScale(value: unknown): UiScale {
  return UI_SCALES.find((scale) => scale === value) ?? DEFAULT_UI_SCALE
}
