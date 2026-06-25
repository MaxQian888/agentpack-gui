import type { VisibleApps } from "./types"

/**
 * cc-switch keys for visibleApps. claude + codex are what agentpack keeps on by
 * default; the rest (gemini/opencode/openclaw/hermes/claudeDesktop) are hidden.
 */
export const VISIBLE_APP_KEYS: readonly (keyof VisibleApps)[] = [
  "claude",
  "claudeDesktop",
  "codex",
  "gemini",
  "opencode",
  "openclaw",
  "hermes",
]

/** Default: only Claude Code + Codex visible. */
export const DEFAULT_VISIBLE_APPS: VisibleApps = {
  claude: true,
  claudeDesktop: false,
  codex: true,
  gemini: false,
  opencode: false,
  openclaw: false,
  hermes: false,
}

/**
 * Read the current visibleApps from a settings.json text. cc-switch treats a
 * missing key as "shown", so an absent key defaults to true here.
 */
export function readVisibleApps(existingJson: string): VisibleApps {
  let data: Record<string, unknown> = {}
  try {
    if (existingJson.trim()) data = JSON.parse(existingJson) as Record<string, unknown>
  } catch {
    // Corrupt / unparsable settings.json → fall back to "all shown".
  }
  const va = (data["visibleApps"] as Partial<Record<keyof VisibleApps, unknown>>) ?? {}
  const out = {} as VisibleApps
  for (const k of VISIBLE_APP_KEYS) {
    out[k] = k in va ? Boolean(va[k]) : true
  }
  return out
}

/**
 * Merge a visibleApps map into settings.json text, preserving every other
 * field. Pure — mirrors network.ts `mergeClaudeSettings`.
 */
export function mergeVisibleApps(existingJson: string, visible: VisibleApps): string {
  const data = (existingJson.trim() ? JSON.parse(existingJson) : {}) as Record<string, unknown>
  const current = (data["visibleApps"] as Record<string, unknown>) ?? {}
  data["visibleApps"] = { ...current, ...visible }
  return JSON.stringify(data, null, 2) + "\n"
}
