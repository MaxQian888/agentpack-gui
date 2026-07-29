import { parse, stringify } from "smol-toml"
import { CODEX_PROVIDER_KEY } from "./sync"
import type { Provider, ProviderApp } from "./types"

/**
 * Move a set of providers between machines (or share a team's gateway setup) as
 * one JSON file.
 *
 * Tokens are opt-in, and leaving them out **redacts the stored config in place**
 * rather than rebuilding it from the form fields: a provider may carry
 * hand-written keys the form doesn't model (custom headers, query params), and
 * a rebuild would quietly drop exactly the parts someone went out of their way
 * to configure.
 */

export const BUNDLE_VERSION = 1 as const

export interface BundleEntry {
  app: ProviderApp
  name: string
  settingsConfig: string
  websiteUrl?: string
  notes?: string
}

export interface ProviderBundle {
  version: typeof BUNDLE_VERSION
  providers: BundleEntry[]
}

/** Replace every credential in a stored config with an empty value. */
export function redactSettingsConfig(app: ProviderApp, settingsConfig: string): string {
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(settingsConfig) as Record<string, unknown>
  } catch {
    // Unparseable configs can't be redacted safely, so they're dropped entirely
    // rather than shipped with an unknown payload.
    return "{}"
  }
  if (!raw || typeof raw !== "object") return "{}"

  if (app === "claude") {
    const env = { ...((raw["env"] as Record<string, unknown>) ?? {}) }
    for (const k of ["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY"]) if (k in env) env[k] = ""
    return JSON.stringify({ ...raw, env })
  }

  if (app === "opencode") {
    const options = { ...((raw["options"] as Record<string, unknown>) ?? {}) }
    if ("apiKey" in options) options["apiKey"] = ""
    return JSON.stringify(Object.keys(options).length ? { ...raw, options } : raw)
  }

  // codex carries the token twice: `auth` for cc-switch, and the bearer token
  // inside the config TOML for agentpack. Both have to go.
  const auth = { ...((raw["auth"] as Record<string, unknown>) ?? {}) }
  if ("OPENAI_API_KEY" in auth) auth["OPENAI_API_KEY"] = ""
  const out: Record<string, unknown> = { ...raw, auth }
  const configStr = raw["config"]
  if (typeof configStr === "string" && configStr.trim()) {
    try {
      const cfg = parse(configStr) as Record<string, unknown>
      const providers = cfg["model_providers"] as Record<string, unknown> | undefined
      const managed = providers?.[CODEX_PROVIDER_KEY] as Record<string, unknown> | undefined
      if (managed && "experimental_bearer_token" in managed) {
        managed["experimental_bearer_token"] = ""
        out["config"] = stringify(cfg)
      }
    } catch {
      // A config TOML we can't parse might hide a token, so drop it rather than
      // export something we haven't inspected.
      out["config"] = ""
    }
  }
  return JSON.stringify(out)
}

export function exportProviders(providers: Provider[], opts: { includeTokens: boolean }): string {
  const bundle: ProviderBundle = {
    version: BUNDLE_VERSION,
    providers: providers.map((p) => ({
      app: p.app_type,
      name: p.name,
      settingsConfig: opts.includeTokens
        ? p.settings_config
        : redactSettingsConfig(p.app_type, p.settings_config),
      ...(p.website_url ? { websiteUrl: p.website_url } : {}),
      ...(p.notes ? { notes: p.notes } : {}),
    })),
  }
  return JSON.stringify(bundle, null, 2) + "\n"
}

const APPS: readonly ProviderApp[] = ["claude", "codex", "opencode"]

/**
 * Read a bundle. Defensive throughout — an import is the one place a file from
 * another machine reaches this code — so entries with an unknown app or a
 * missing name are skipped rather than failing the whole file.
 */
export function parseProviderBundle(json: string): BundleEntry[] {
  let data: Record<string, unknown>
  try {
    data = JSON.parse(json) as Record<string, unknown>
  } catch {
    return []
  }
  const raw = Array.isArray(data?.["providers"]) ? (data["providers"] as unknown[]) : []
  const out: BundleEntry[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const rec = item as Record<string, unknown>
    const app = rec["app"]
    if (typeof app !== "string" || !APPS.includes(app as ProviderApp)) continue
    if (typeof rec["name"] !== "string" || !rec["name"].trim()) continue
    if (typeof rec["settingsConfig"] !== "string") continue
    out.push({
      app: app as ProviderApp,
      name: rec["name"],
      settingsConfig: rec["settingsConfig"],
      ...(typeof rec["websiteUrl"] === "string" ? { websiteUrl: rec["websiteUrl"] } : {}),
      ...(typeof rec["notes"] === "string" ? { notes: rec["notes"] } : {}),
    })
  }
  return out
}

export interface ImportPlan {
  /** Entries with no existing row for that (app, name). */
  fresh: BundleEntry[]
  /** Entries that would replace an existing row. */
  conflicts: { entry: BundleEntry; existing: Provider }[]
}

/**
 * Map key for a provider's identity.
 *
 * `\0` separates the halves because it is the one byte neither can contain, so
 * `("claude", "a b")` and `("claude a", "b")` can never collide. Written as an
 * escape and never as a literal — a raw NUL in the source makes the whole file
 * read as binary to git, grep and review tooling.
 */
function providerKey(app: ProviderApp, name: string): string {
  return `${app}\0${name}`
}

/** Split a bundle against what's already in the DB, keyed by (app, name). */
export function planImport(entries: BundleEntry[], existing: Provider[]): ImportPlan {
  const byKey = new Map(existing.map((p) => [providerKey(p.app_type, p.name), p]))
  const plan: ImportPlan = { fresh: [], conflicts: [] }
  for (const entry of entries) {
    const match = byKey.get(providerKey(entry.app, entry.name))
    if (match) plan.conflicts.push({ entry, existing: match })
    else plan.fresh.push(entry)
  }
  return plan
}
