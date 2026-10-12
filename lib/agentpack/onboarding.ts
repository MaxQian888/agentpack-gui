import type { Messages } from "@/lib/i18n/types"
import type { NetworkProbeResult } from "./network/probe"
import { isDefaultMirror, pickMirror } from "./network/probe"
import { mcpTargetsFor, type PresetSelection } from "./presets"
import { providerStep, providerStepId, syncLiveConfigSteps } from "./plan"
import { buildSettingsConfig } from "./ccswitch/provider"
import { RECOMMENDED_PROVIDERS, type ProviderPreset } from "./ccswitch/preset"
import type { Provider, ProviderBackend, ProviderForm } from "./ccswitch/types"
import type { Paths, ProxyConfig, StepDescriptor } from "./types"

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

// ── Connecting an account ────────────────────────────────────────────────────

/** The provider app each wizard agent is configured through. */
export type ConnectApp = "claude" | "codex"

/** The agents a choice installs, as the apps their accounts belong to. */
export function appsFor(agent: AgentChoice): ConnectApp[] {
  return agent === "both" ? ["claude", "codex"] : agent === "codex" ? ["codex"] : ["claude"]
}

/**
 * How an agent reaches a model. `official` is the subscription the vendor's
 * own sign-in unlocks (Claude Pro/Max, ChatGPT), finished after the install;
 * `apiKey` is a key for the vendor's API; `relay` is a third-party endpoint.
 */
export type ConnectKind = "official" | "apiKey" | "relay"

export interface AgentConnection {
  kind: ConnectKind
  /** Relay only: a preset key from `relayPresets`, or `CUSTOM_RELAY`. */
  preset?: string
  baseUrl: string
  token: string
}

export const CUSTOM_RELAY = "custom"

export const OFFICIAL_CONNECTION: AgentConnection = { kind: "official", baseUrl: "", token: "" }

/**
 * Where a vendor API key is used. Claude's is the CLI's own default, so its
 * config carries no base URL — the URL here is only what the connection test
 * calls. Codex is different: its live sync writes `config.toml` and never
 * `auth.json`, so a key with no base URL would be stored and never applied.
 * Spelling out the official endpoint routes it through `config.toml`, where it
 * does take effect.
 */
const VENDOR_API: Record<ConnectApp, string> = {
  claude: "https://api.anthropic.com",
  codex: "https://api.openai.com/v1",
}

/**
 * The relay presets offered for an app: those that name an endpoint, all on
 * an equal footing, in catalog order. The endpoint-less "…-compatible" presets
 * are what `CUSTOM_RELAY` stands for here.
 */
export function relayPresets(app: ConnectApp): ProviderPreset[] {
  return RECOMMENDED_PROVIDERS.filter((p) => p.form.app === app && !!p.form.baseUrl)
}

/** Whether every field the connection needs is filled. The test result is not one of them. */
export function connectionComplete(c: AgentConnection): boolean {
  if (c.kind === "official") return true
  if (!c.token.trim()) return false
  return c.kind === "apiKey" || !!c.baseUrl.trim()
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/**
 * The provider row a connection becomes, or null for `official`, which writes
 * none: the vendor's sign-in stores its own credentials. The auth variable is
 * decided here rather than asked — an Anthropic key is `ANTHROPIC_API_KEY`, a
 * relay takes the bearer `ANTHROPIC_AUTH_TOKEN` (or what its preset says).
 */
export function connectionForm(app: ConnectApp, c: AgentConnection): ProviderForm | null {
  if (c.kind === "official") return null
  const token = c.token.trim()
  if (c.kind === "apiKey") {
    return app === "claude"
      ? { name: "Anthropic API", app, baseUrl: "", token, claudeAuthKind: "api_key" }
      : { name: "OpenAI API", app, baseUrl: VENDOR_API.codex, token, claudeAuthKind: "auth_token" }
  }
  const preset = relayPresets(app).find((p) => p.key === c.preset)
  const baseUrl = c.baseUrl.trim() || preset?.form.baseUrl || ""
  return {
    name: preset?.form.name ?? hostOf(baseUrl),
    app,
    baseUrl,
    token,
    claudeAuthKind: preset?.form.claudeAuthKind ?? "auth_token",
  }
}

/** What the connection test calls: the row's own endpoint, or the vendor API a key is for. */
export function probeFormFor(
  app: ConnectApp,
  c: AgentConnection
): Pick<ProviderForm, "app" | "baseUrl" | "token" | "claudeAuthKind"> | null {
  const form = connectionForm(app, c)
  if (!form) return null
  return { ...form, baseUrl: form.baseUrl || VENDOR_API[app] }
}

/**
 * The steps that make each connection the one its agent uses: add the row,
 * make it current, and sync the live config — staged in the same review as
 * the install, so there is one Apply for both.
 *
 * - A row identical to one already stored isn't added twice; it is made
 *   current if it isn't already, and left alone if it is.
 * - A new row becomes current by itself when its app has none. When it has
 *   one, the row is added under a known id (`newId`) so the same run can make
 *   it current — an id generated at write time couldn't be named here.
 * - Each live sync depends on the write before it: a failed save must not
 *   rewrite the agent's settings to point at a row that doesn't exist.
 */
export function providerSetupSteps(
  forms: readonly ProviderForm[],
  existing: readonly Provider[],
  paths: Paths,
  messages: Messages,
  backend: ProviderBackend,
  newId: () => string
): StepDescriptor[] {
  const steps: StepDescriptor[] = []
  for (const form of forms) {
    const settings = buildSettingsConfig(form)
    const same = existing.find((p) => p.app_type === form.app && p.settings_config === settings)
    if (same?.is_current) continue
    const id = same?.id ?? newId()
    const hasCurrent = existing.some((p) => p.app_type === form.app && p.is_current)
    let syncAfter: string
    if (!same) {
      const add = providerStep("add", form.app, form.name, form, id, messages, backend)
      steps.push(add)
      syncAfter = add.id
    }
    if (same || hasCurrent) {
      const current = providerStep(
        "setCurrent",
        form.app,
        form.name,
        undefined,
        id,
        messages,
        backend
      )
      steps.push(
        same ? current : { ...current, dependsOn: [providerStepId("add", form.app, backend)] }
      )
      syncAfter = current.id
    }
    const live: Provider = {
      id,
      app_type: form.app,
      name: form.name,
      settings_config: settings,
      is_current: true,
    }
    steps.push(...syncLiveConfigSteps(live, paths, messages, [syncAfter!]))
  }
  return steps
}

/**
 * The command each agent signs in with, as the user would type it. Shown as
 * the copy-paste fallback when no terminal can be opened; it must match the
 * table in `login.rs`, which is what actually runs.
 */
export const LOGIN_COMMAND: Record<ConnectApp, string> = { claude: "claude", codex: "codex login" }
