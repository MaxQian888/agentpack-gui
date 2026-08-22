/**
 * The pre-flight brief: what is about to happen to this machine, in sentences a
 * first-time user can act on, shown at the moment they are asked to approve it.
 *
 * The review panel already listed the steps. A step list is the right thing for
 * someone who knows what `claude mcp add context7` means, and it is the wrong
 * thing for someone who does not — the three questions a newcomer actually has
 * at that moment are "will this ask me for my password", "why is it installing
 * Node when I asked for Claude", and "is anything here going to fail". None of
 * those is answerable from a column of command labels.
 *
 * Three rules the shape enforces:
 *
 * 1. **It reads the steps, never the plan.** `buildSteps` is the one place that
 *    decides what a plan becomes — including whether Node is needed, whether an
 *    install is skipped because the tool is current, and whether a package's
 *    `engines.node` floor makes it impossible here. Re-deriving any of that from
 *    the plan would produce a brief that disagrees with the run it introduces,
 *    which is worse than no brief. The only thing read from outside the step
 *    list is the *plan's* pending API keys and the machine inventory, and both
 *    are facts the steps genuinely don't carry.
 * 2. **A blocker is not a veto.** A step that needs a human — no installer on
 *    this OS, a Node too old for one package — blocks *that item*, and the rest
 *    of the run is still worth doing. The brief says which item and why; it
 *    never disables Apply. Turning one impossible item into "you cannot install
 *    anything" is how a user with nine good steps ends up with none.
 * 3. **An unmeasured machine gets no claims about it.** The "already installed"
 *    count comes from the inventory, and an inventory that was never measured
 *    says nothing rather than zero — "nothing is installed yet" is exactly the
 *    wrong thing to tell someone whose scan simply hasn't landed.
 */

import type { Messages } from "@/lib/i18n/types"
import type { Plan, StepDescriptor } from "./types"
import {
  assetId,
  findAsset,
  findCatalogAsset,
  NETWORK_ASSET_ID,
  type MachineInventory,
} from "./inventory"
import { pendingKeyEnvs } from "./report"

/**
 * - `blocked` — this item cannot proceed here without a human.
 * - `warn` — it will run, but something won't work afterwards, or the machine
 *   will interrupt you partway through.
 * - `info` — worth knowing before you press the button. Nothing is wrong.
 */
export type PreflightTone = "blocked" | "warn" | "info"

/** Reading order, worst first — the same rule the diagnostics list follows. */
export const TONE_ORDER: readonly PreflightTone[] = ["blocked", "warn", "info"]

export interface PreflightNote {
  id: string
  tone: PreflightTone
  title: string
  /** The observed reason, when there is one. Never a guess. */
  detail?: string
}

export interface PreflightReport {
  /** The worst tone present. `ready` means there was nothing to say. */
  verdict: "ready" | PreflightTone
  /** How many steps Apply will actually run. */
  changeCount: number
  /**
   * How many of the plan's selections this machine already has, and will
   * therefore be left alone. Null when nothing has measured the machine — which
   * is a different statement from zero.
   */
  alreadyCount: number | null
  notes: PreflightNote[]
}

/** The step ids `buildSteps` gives the two runtime prerequisites. */
const PREREQ_STEP_IDS = ["runtime-node", "runtime-uv"] as const

export function preflight(
  t: Messages,
  steps: readonly StepDescriptor[],
  input: { plan?: Plan; inventory: MachineInventory }
): PreflightReport {
  const p = t.preflight
  const { plan, inventory } = input
  const notes: PreflightNote[] = []

  // 1. Items that cannot proceed on this machine. Each carries the reason the
  //    step itself recorded, so the brief and the log can't tell two stories.
  for (const step of steps) {
    if (step.kind !== "info" || !step.manual) continue
    notes.push({
      id: `blocked-${step.id}`,
      tone: "blocked",
      title: p.blockedTitle(step.label),
      detail: step.lines[0],
    })
  }

  // 2. Nothing downloaded, nothing installed. Only when a probe actually said
  //    so — an inventory with no network asset never looked.
  if (findAsset(inventory, NETWORK_ASSET_ID)?.health.status === "broken") {
    notes.push({ id: "offline", tone: "warn", title: p.offlineTitle, detail: p.offlineDetail })
  }

  // 3. The machine is going to interrupt them. A UAC dialog or a sudo prompt
  //    arriving unannounced mid-run is the single most alarming thing that
  //    happens during a first install, and it is knowable in advance.
  const elevated = steps.filter(hasElevation)
  if (elevated.length > 0) {
    notes.push({
      id: "elevation",
      tone: "warn",
      title: p.elevationTitle,
      detail: p.elevationDetail(elevated.length),
    })
  }

  // 4. A key-gated server installs cleanly and then silently does nothing. The
  //    completion screen already says so afterwards; saying it here is the
  //    difference between "fill this in" and "why doesn't it work".
  const pendingKeys = plan ? pendingKeyEnvs(plan) : []
  if (pendingKeys.length > 0) {
    notes.push({
      id: "keys",
      tone: "warn",
      title: p.keysTitle(pendingKeys.length),
      detail: p.keysDetail(pendingKeys.map((k) => nameOfMcp(t, k.id)).join(" · ")),
    })
  }

  // 5. Why there are steps here for things the user never picked. Node is the
  //    one that surprises people: they asked for the Claude desktop app and the
  //    panel lists a Node.js install, because the MCP servers are launched
  //    through npx.
  const prereqs = steps.filter((s) => (PREREQ_STEP_IDS as readonly string[]).includes(s.id))
  for (const step of prereqs) {
    // A manual prerequisite was already reported as a blocker above; listing it
    // twice would say both "we'll install it" and "you must install it".
    if (step.kind === "info" && step.manual) continue
    notes.push({
      id: `prereq-${step.id}`,
      tone: "info",
      title: p.prereqTitle(step.label),
      detail: step.id === "runtime-node" ? p.prereqNode : p.prereqUv,
    })
  }

  // 6. What is being left alone, so a short step list doesn't read as a plan
  //    that lost half of what was picked.
  const alreadyCount = plan && inventory.measured ? countAlready(plan, inventory) : null
  if (alreadyCount) {
    notes.push({ id: "already", tone: "info", title: p.alreadyTitle(alreadyCount) })
  }

  return {
    verdict: TONE_ORDER.find((tone) => notes.some((n) => n.tone === tone)) ?? "ready",
    changeCount: steps.length,
    alreadyCount,
    notes: sortNotes(notes),
  }
}

/**
 * Worst first, stable within a tone. Stability matters more here than in a
 * to-do list: this panel is read once, under mild pressure, immediately before
 * the user commits — rows that reorder between renders get re-read from the top.
 */
export function sortNotes(notes: readonly PreflightNote[]): PreflightNote[] {
  return [...notes].sort((a, b) => TONE_ORDER.indexOf(a.tone) - TONE_ORDER.indexOf(b.tone))
}

/** Whether running this step will make the OS ask for an administrator. */
function hasElevation(step: StepDescriptor): boolean {
  return "requiresElevation" in step && step.requiresElevation === true
}

/**
 * A server's catalog title. Falls back to the raw id rather than to nothing —
 * `pendingKeyEnvs` only yields servers the registry knows, so this only covers
 * a registry entry that has no i18n title, which `registry.test.ts` forbids.
 */
function nameOfMcp(t: Messages, id: string): string {
  return t.catalog.mcp[id]?.title ?? id
}

/**
 * How many of the plan's selections this machine already has.
 *
 * Counts a capability only where it was actually asked for — a skill with no
 * targets is not a selection, and counting it would inflate "already there"
 * with rows the user unticked.
 */
function countAlready(plan: Plan, inventory: MachineInventory): number {
  let n = 0
  for (const id of plan.clis) if (findCatalogAsset(inventory, id)) n += 1
  for (const m of plan.mcps) {
    if (m.targets.length > 0 && findAsset(inventory, assetId("mcp", m.id))) n += 1
  }
  for (const s of plan.skills) {
    if (s.targets.length > 0 && findAsset(inventory, assetId("skill", s.id))) n += 1
  }
  return n
}
