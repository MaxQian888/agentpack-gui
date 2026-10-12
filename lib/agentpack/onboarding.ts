import type { NetworkProbeResult } from "./network/probe"
import { isDefaultMirror, pickMirror } from "./network/probe"
import { mcpTargetsFor, type PresetSelection } from "./presets"
import type { ProxyConfig } from "./types"

/**
 * The first-run wizard's choices, and what they become.
 *
 * The wizard asks one real question — which agent — and everything else is
 * derived here, so the screen that shows the choice and the plan that runs from
 * it can't describe two different installs. Pure and browser-safe, like
 * `presets`, which it sits beside.
 */

/** Which agent(s) the newcomer wants. "both" installs Claude Code and Codex. */
export type AgentChoice = "claude-code" | "codex" | "both"

export const AGENT_CHOICES: readonly AgentChoice[] = ["claude-code", "codex", "both"]

/** Claude Code leads: it is the agent this app writes the most config into. */
export const DEFAULT_AGENT: AgentChoice = "claude-code"

/** The desktop app that bundles each agent. */
const DESKTOP_OF = { "claude-code": "claude-desktop", codex: "codex-app" } as const

/**
 * The MCP servers a first run sets up: the three that need no account. A
 * key-gated server (context7, github) installs cleanly and then never answers
 * without its key, and a key field is a question a newcomer can't answer — so
 * those wait for the Getting started checklist, after the agent works.
 */
export const CORE_MCPS = ["memory", "sequential-thinking", "fetch"] as const

/** Narrow a persisted value back to a choice; anything stale falls back. */
export function asAgentChoice(value: unknown): AgentChoice {
  return AGENT_CHOICES.find((c) => c === value) ?? DEFAULT_AGENT
}

/**
 * The exact selection a wizard answer installs. The CLI comes first and the
 * desktop app after it, so "both" with the desktop apps reads claude-code,
 * claude-desktop, codex, codex-app. Skills are left out on purpose: they are
 * per-stack, and the wizard no longer asks which stack.
 */
export function wizardSelection(agent: AgentChoice, desktop: boolean): PresetSelection {
  const agents = agent === "both" ? (["claude-code", "codex"] as const) : ([agent] as const)
  const clis = agents.flatMap((id) => (desktop ? [id, DESKTOP_OF[id]] : [id]))
  const targets = mcpTargetsFor(clis)
  return {
    clis,
    skills: [],
    mcps: CORE_MCPS.map((id) => ({ id, targets })),
  }
}

/**
 * Whether the wizard needs its own network step. Only a proxy earns one: it
 * routes traffic through a port on this machine, which is worth a look before
 * saying yes. A faster mirror is a single line in the review instead.
 *
 * An unmeasured probe asks for nothing — the wizard moves on rather than
 * waiting on a probe that may still be in flight.
 */
export function needsProxyStep(probe: NetworkProbeResult | null): boolean {
  return !!probe && !probe.directOk && !!probe.bestProxy
}

/** What the wizard adopts from the probe. Every field is absent when not suggested. */
export interface NetworkAdoption {
  /** A patch for the store's `setProxy`, which fills in the default targets. */
  proxy?: Partial<ProxyConfig>
  npmRegistry?: { url: string; label: string }
  ghMirrorPrefix?: { url: string; label: string }
}

/**
 * Turn the probe into the config the wizard stages, honouring the two
 * opt-outs: the proxy step's "keep the direct connection" and the review's
 * "use the official registry". "Suggest" mode, as before: a working default
 * is left alone rather than swapped for a mirror that merely benchmarks faster.
 */
export function networkAdoption(
  probe: NetworkProbeResult | null,
  opts: { proxy: boolean; mirrors: boolean }
): NetworkAdoption {
  if (!probe) return {}
  const out: NetworkAdoption = {}
  const proxy = probe.bestProxy
  if (opts.proxy && needsProxyStep(probe) && proxy) {
    const socks = proxy.url.startsWith("socks")
    out.proxy = {
      mode: "manual",
      httpUrl: socks ? undefined : proxy.url,
      httpsUrl: socks ? undefined : proxy.url,
      allUrl: socks ? proxy.url : undefined,
    }
  }
  if (opts.mirrors) {
    const npm = pickMirror(probe.npm, "suggest", isDefaultMirror)
    if (npm?.preset.url) out.npmRegistry = { url: npm.preset.url, label: npm.preset.label }
    const gh = pickMirror(probe.gh, "suggest", isDefaultMirror)
    if (gh?.preset.url) out.ghMirrorPrefix = { url: gh.preset.url, label: gh.preset.label }
  }
  return out
}
