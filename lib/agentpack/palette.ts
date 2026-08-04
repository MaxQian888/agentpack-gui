/**
 * The ⌘K command palette's contents, as data.
 *
 * What it indexes is a privacy decision, not a feature decision: destinations
 * and app actions, and nothing else. Chat transcripts, config file bodies and
 * MCP API keys are all in memory a few modules away, and a palette that
 * searched them would quietly turn "find the network page" into a way to read
 * someone's keys off their own screen. If that ever becomes worth doing, it
 * needs its own opt-in — not a widened `keywords` array.
 *
 * Pure and browser-safe: builds items and filters them. Running one is the
 * component's job.
 */

import type { Messages } from "@/lib/i18n/types"
import {
  landingSection,
  workspaceOf,
  WORKSPACES,
  type SectionKey,
  type WorkspaceKey,
} from "./workspaces"

export type PaletteAction =
  | { kind: "navigate"; workspace: WorkspaceKey; section: SectionKey }
  | { kind: "quickConfig" }
  | { kind: "rescan" }
  | { kind: "review" }
  | { kind: "toggleTheme" }
  | { kind: "onboarding" }
  | { kind: "updates" }

export interface PaletteItem {
  id: string
  group: "go" | "action"
  label: string
  /** Secondary line, and also matched against — it's how "cost" finds Usage. */
  hint?: string
  action: PaletteAction
}

export interface PaletteContext {
  /**
   * How many changes are staged but not yet applied. Zero hides the review
   * command outright rather than offering an action that would open an empty
   * panel.
   */
  pendingChanges: number
}

const WORKSPACE_LABEL: Record<WorkspaceKey, (m: Messages) => string> = {
  overview: (m) => m.workspaces.overview,
  install: (m) => m.workspaces.install,
  capabilities: (m) => m.workspaces.capabilities,
  account: (m) => m.workspaces.account,
  management: (m) => m.workspaces.management,
  usage: (m) => m.workspaces.usage,
  settings: (m) => m.workspaces.settings,
}

const WORKSPACE_HINT: Record<WorkspaceKey, (m: Messages) => string> = {
  overview: (m) => m.workspaces.overviewHint,
  install: (m) => m.workspaces.installHint,
  capabilities: (m) => m.workspaces.capabilitiesHint,
  account: (m) => m.workspaces.accountHint,
  management: (m) => m.workspaces.managementHint,
  usage: (m) => m.workspaces.usageHint,
  settings: (m) => m.workspaces.settingsHint,
}

const SECTION_LABEL: Record<SectionKey, (m: Messages) => string> = {
  dashboard: (m) => m.menu.dashboard,
  history: (m) => m.menu.history,
  "management-overview": (m) => m.management.tabs.overview,
  accounts: (m) => m.management.tabs.accounts,
  quota: (m) => m.management.tabs.quota,
  analytics: (m) => m.management.tabs.analytics,
  audit: (m) => m.management.tabs.audit,
  "my-account": (m) => m.personal.tabs.account,
  "my-balance": (m) => m.personal.tabs.balance,
  "my-usage": (m) => m.personal.tabs.usage,
  "my-models": (m) => m.personal.tabs.models,
  "my-security": (m) => m.personal.tabs.security,
  presets: (m) => m.menu.presets,
  environment: (m) => m.menu.environment,
  clis: (m) => m.menu.clis,
  skills: (m) => m.menu.skills,
  mcp: (m) => m.menu.mcp,
  network: (m) => m.menu.network,
  cleanup: (m) => m.menu.cleanup,
  ccswitch: (m) => m.menu.ccswitch,
  ccconnect: (m) => m.menu.ccconnect,
  config: (m) => m.menu.saveConfig,
  about: (m) => m.menu.about,
}

/**
 * Every destination and action, in the order they should appear.
 *
 * Both the five workspaces and the twelve sections are listed. That is
 * deliberate duplication: someone who has learned the new IA types "Install",
 * and someone who has used the app for six months types "MCP" — both have to
 * work, or the restructure costs the experienced user their muscle memory.
 */
export function buildPalette(t: Messages, ctx: PaletteContext): PaletteItem[] {
  const items: PaletteItem[] = []

  for (const w of WORKSPACES) {
    items.push({
      id: `go:${w.key}`,
      group: "go",
      label: WORKSPACE_LABEL[w.key](t),
      hint: WORKSPACE_HINT[w.key](t),
      action: { kind: "navigate", workspace: w.key, section: landingSection(w.key) },
    })
    // A workspace with one section is that section — listing both would put the
    // same destination on screen twice under two names.
    if (w.sections.length < 2) continue
    for (const s of w.sections) {
      items.push({
        id: `go:section:${s}`,
        group: "go",
        label: SECTION_LABEL[s](t),
        hint: WORKSPACE_LABEL[w.key](t),
        action: { kind: "navigate", workspace: w.key, section: s },
      })
    }
  }

  items.push({
    id: "action:quick-config",
    group: "action",
    label: t.palette.quickConfig,
    action: { kind: "quickConfig" },
  })
  items.push({
    id: "action:rescan",
    group: "action",
    label: t.palette.rescan,
    action: { kind: "rescan" },
  })
  if (ctx.pendingChanges > 0) {
    items.push({
      id: "action:review",
      group: "action",
      label: t.palette.reviewCount(ctx.pendingChanges),
      action: { kind: "review" },
    })
  }
  items.push({
    id: "action:theme",
    group: "action",
    label: t.palette.toggleTheme,
    action: { kind: "toggleTheme" },
  })
  items.push({
    id: "action:onboarding",
    group: "action",
    label: t.palette.onboarding,
    action: { kind: "onboarding" },
  })
  items.push({
    id: "action:updates",
    group: "action",
    label: t.palette.updates,
    action: { kind: "updates" },
  })

  return items
}

/** Fold a query for comparison: trimmed, lowercased, whitespace collapsed. */
function fold(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ")
}

/**
 * Substring match over the label and hint, every whitespace-separated term
 * required.
 *
 * Deliberately not fuzzy. A fuzzy matcher over a list this small mostly
 * produces confident-looking wrong answers — "cc" matching "Check for app
 * updates" — and Enter on the wrong row here navigates somewhere unexpected or
 * reopens the setup guide. Order is preserved so the list never reshuffles
 * under the cursor between keystrokes.
 */
export function filterPalette(items: PaletteItem[], query: string): PaletteItem[] {
  const q = fold(query)
  if (!q) return items
  const terms = q.split(" ")
  return items.filter((item) => {
    const hay = fold(`${item.label} ${item.hint ?? ""}`)
    return terms.every((term) => hay.includes(term))
  })
}

/** Where a `navigate` action lands, for callers that only have the section. */
export function navigateTo(section: SectionKey): Extract<PaletteAction, { kind: "navigate" }> {
  return { kind: "navigate", workspace: workspaceOf(section), section }
}
