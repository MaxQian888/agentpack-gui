/**
 * The app's information architecture: five task domains over the twelve
 * destinations that already exist.
 *
 * The twelve `SectionKey`s are unchanged and remain the internal target of every
 * navigation — the guided tour, the dashboard's "open MCP" links, the command
 * palette and the diagnostics list all still address a section directly. What
 * changes is what the user is asked to hold in their head: five domains named
 * after what someone is trying to *do*, instead of twelve siblings named after
 * what the app happens to contain.
 *
 * Pure and browser-safe: keys, order and the mapping only. Labels come from the
 * i18n catalog and icons from the components, so this file stays free of both.
 */

export type SectionKey =
  | "dashboard"
  | "history"
  | "presets"
  | "environment"
  | "clis"
  | "skills"
  | "mcp"
  | "network"
  | "ccswitch"
  | "ccconnect"
  | "config"
  | "about"

export type WorkspaceKey = "overview" | "install" | "capabilities" | "usage" | "settings"

export interface WorkspaceDefinition {
  key: WorkspaceKey
  /**
   * The sections this workspace owns, in tab order. The first is where the
   * workspace lands when it is opened from the rail.
   */
  sections: readonly SectionKey[]
}

/**
 * Rail order, top to bottom. It follows the arc of the core path — diagnose,
 * then fix, then extend, then look at what it cost — with settings last because
 * it is the only domain that isn't part of that arc.
 */
export const WORKSPACES: readonly WorkspaceDefinition[] = [
  { key: "overview", sections: ["dashboard"] },
  { key: "install", sections: ["presets", "environment", "clis", "network"] },
  { key: "capabilities", sections: ["skills", "mcp", "ccswitch", "ccconnect"] },
  { key: "usage", sections: ["history"] },
  { key: "settings", sections: ["config", "about"] },
]

/** Every section key, in rail order. The tour and the palette both walk this. */
export const SECTION_KEYS: readonly SectionKey[] = WORKSPACES.flatMap((w) => w.sections)

const OWNER = new Map<SectionKey, WorkspaceKey>(
  WORKSPACES.flatMap((w) => w.sections.map((s) => [s, w.key] as const))
)

/**
 * Which workspace a section belongs to. Total by construction — every key in
 * the union appears in exactly one workspace, which `workspaces.test.ts`
 * asserts — so a missing entry is a type-level bug, not a runtime branch. The
 * fallback keeps a hand-built key (e.g. from a stale persisted value) landing
 * somewhere real rather than blanking the rail.
 */
export function workspaceOf(section: SectionKey): WorkspaceKey {
  return OWNER.get(section) ?? "overview"
}

export function definitionOf(workspace: WorkspaceKey): WorkspaceDefinition {
  return WORKSPACES.find((w) => w.key === workspace) ?? WORKSPACES[0]
}

export function sectionsOf(workspace: WorkspaceKey): readonly SectionKey[] {
  return definitionOf(workspace).sections
}

/** Where the rail lands when this workspace is opened. */
export function landingSection(workspace: WorkspaceKey): SectionKey {
  return definitionOf(workspace).sections[0]
}

/**
 * Whether to draw a sub-tab strip. A workspace with a single section has
 * nothing to switch between — Overview and Usage each carry their own internal
 * tabs, and a one-tab strip above them would read as a broken control.
 */
export function hasTabs(workspace: WorkspaceKey): boolean {
  return sectionsOf(workspace).length > 1
}
