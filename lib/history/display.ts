import type { HistorySource } from "./types"

/**
 * Brand-ish accent per source, chosen to read on both light and dark themes.
 * Shared by source badges, the "by tool" donut and model bar coloring so a
 * tool's color is consistent everywhere.
 */
export const SOURCE_COLORS: Record<HistorySource, string> = {
  claude: "#d97757",
  codex: "#10a37f",
  opencode: "#8b5cf6",
  pi: "#6366f1",
}

/** Best-effort mapping of a model id to the CLI it most likely belongs to. */
export function modelToSource(model: string): HistorySource {
  const m = model.toLowerCase()
  if (m.includes("claude")) return "claude"
  if (m.includes("gpt") || m.includes("codex") || /\bo[13]\b/.test(m)) return "codex"
  return "opencode"
}

/** Consistent bar/legend color for a model, derived from its inferred source. */
export function modelColor(model: string): string {
  return SOURCE_COLORS[modelToSource(model)]
}

/**
 * Colors for the generic chart series (as opposed to {@link SOURCE_COLORS},
 * which encodes a CLI's identity). One table for every usage panel — three
 * files each minting their own palette is how a dashboard ends up with two
 * different blues.
 *
 * Literal hex, picked to read on both themes, for the same reason
 * `SOURCE_COLORS` is: these are consumed as SVG presentation attributes
 * (`fill`, `stroke`, `stopColor`), where `var(--chart-N)` is not reliably
 * substituted across the engines Tauri ships on — WebKit on macOS/Linux,
 * Chromium on Windows. A token that silently fails to resolve renders an
 * uncolored chart, so the value is inlined and theme-neutral instead.
 */
export const CHART_SERIES = {
  input: "#3b82f6",
  output: "#10b981",
  hour: "#6366f1",
  cost: "#f59e0b",
  histogram: "#8b5cf6",
} as const
