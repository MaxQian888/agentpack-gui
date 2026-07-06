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
