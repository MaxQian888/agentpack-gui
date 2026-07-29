import { parse } from "smol-toml"
import { parseSettingsConfig } from "./provider"
import { CODEX_PROVIDER_KEY } from "./sync"
import type { Provider, ProviderApp, ProviderForm } from "./types"

/**
 * Find relay config that already exists on disk but no provider row represents.
 *
 * Without this, anyone who configured an endpoint by hand — or with the relay
 * card agentpack used to ship — opens the provider list, sees it empty, and the
 * first switch silently overwrites what they had. Detecting it turns that into
 * an offer to adopt the config instead.
 *
 * Read-only and pure: it reports candidates, it never writes. The UI feeds a
 * candidate into the normal add-provider form so the user reviews it first.
 */

/** A live config that looks like a relay but isn't backed by a provider row. */
export interface UnmanagedProvider {
  /** Stable key for React lists and for de-duping repeated scans. */
  key: string
  app: ProviderApp
  /** Pre-filled add-provider form. */
  form: Partial<ProviderForm>
}

/**
 * Compare endpoints the way a user would: ignoring a trailing slash and case in
 * the host, so `https://api.x.ai/v1` and `https://API.x.ai/v1/` count as the
 * same provider rather than showing up as a spurious second candidate.
 */
function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase()
}

/** Endpoints already covered by a provider row, per app. */
function managedUrls(providers: Provider[]): Map<ProviderApp, Set<string>> {
  const out = new Map<ProviderApp, Set<string>>()
  for (const p of providers) {
    const { baseUrl } = parseSettingsConfig(p.app_type, p.settings_config)
    if (!baseUrl) continue
    const set = out.get(p.app_type) ?? new Set<string>()
    set.add(normalizeUrl(baseUrl))
    out.set(p.app_type, set)
  }
  return out
}

/** Fall back to the endpoint's host when there's no better name to offer. */
function nameFromUrl(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** The claude relay env keys, read straight out of a live settings.json. */
function claudeCandidate(settingsJson: string): UnmanagedProvider | null {
  if (!settingsJson.trim()) return null
  let data: unknown
  try {
    data = JSON.parse(settingsJson)
  } catch {
    return null
  }
  const env = (data as { env?: Record<string, unknown> })?.env
  if (!env || typeof env !== "object") return null
  const baseUrl = env["ANTHROPIC_BASE_URL"]
  if (typeof baseUrl !== "string" || !baseUrl.trim()) return null

  const apiKey = env["ANTHROPIC_API_KEY"]
  const authToken = env["ANTHROPIC_AUTH_TOKEN"]
  const model = env["ANTHROPIC_MODEL"]
  return {
    key: `claude:${normalizeUrl(baseUrl)}`,
    app: "claude",
    form: {
      name: nameFromUrl(baseUrl),
      app: "claude",
      baseUrl,
      token: typeof apiKey === "string" ? apiKey : typeof authToken === "string" ? authToken : "",
      claudeAuthKind: typeof apiKey === "string" ? "api_key" : "auth_token",
      ...(typeof model === "string" ? { model } : {}),
    },
  }
}

/**
 * Every `[model_providers.*]` table with a base URL, whatever it's called.
 * Deliberately not limited to the key agentpack writes: a config left by the
 * removed relay card uses `agentpack`, and a hand-rolled one can use any name —
 * all of them are things the user would lose track of otherwise.
 */
function codexCandidates(configToml: string): UnmanagedProvider[] {
  if (!configToml.trim()) return []
  let data: Record<string, unknown>
  try {
    data = parse(configToml) as Record<string, unknown>
  } catch {
    return []
  }
  const providers = data["model_providers"]
  if (!providers || typeof providers !== "object") return []

  const model = data["model"]
  const out: UnmanagedProvider[] = []
  for (const [key, raw] of Object.entries(providers as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue
    const entry = raw as Record<string, unknown>
    const baseUrl = entry["base_url"]
    if (typeof baseUrl !== "string" || !baseUrl.trim()) continue
    const token = entry["experimental_bearer_token"]
    const name = entry["name"]
    out.push({
      key: `codex:${normalizeUrl(baseUrl)}`,
      app: "codex",
      form: {
        // `custom` is the table name both agentpack and cc-switch write, so it
        // says nothing about the service — fall back to the host in that case.
        name:
          typeof name === "string" && name && name !== CODEX_PROVIDER_KEY
            ? name
            : key !== CODEX_PROVIDER_KEY && key !== "agentpack"
              ? key
              : nameFromUrl(baseUrl),
        app: "codex",
        baseUrl,
        token: typeof token === "string" ? token : "",
        claudeAuthKind: "auth_token",
        ...(typeof model === "string" ? { model } : {}),
      },
    })
  }
  return out
}

/** Every `provider.*` entry in opencode.json that declares a base URL. */
function opencodeCandidates(configJson: string): UnmanagedProvider[] {
  if (!configJson.trim()) return []
  let data: Record<string, unknown>
  try {
    data = JSON.parse(configJson) as Record<string, unknown>
  } catch {
    return []
  }
  const providers = data["provider"]
  if (!providers || typeof providers !== "object") return []

  const out: UnmanagedProvider[] = []
  for (const [key, raw] of Object.entries(providers as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue
    const entry = raw as { name?: unknown; options?: { baseURL?: unknown; apiKey?: unknown } }
    const baseUrl = entry.options?.baseURL
    if (typeof baseUrl !== "string" || !baseUrl.trim()) continue
    out.push({
      key: `opencode:${normalizeUrl(baseUrl)}`,
      app: "opencode",
      form: {
        name: typeof entry.name === "string" && entry.name ? entry.name : key,
        app: "opencode",
        baseUrl,
        token: typeof entry.options?.apiKey === "string" ? entry.options.apiKey : "",
        claudeAuthKind: "auth_token",
      },
    })
  }
  return out
}

/**
 * Relay config on disk that no provider row covers. Matching is by endpoint, so
 * a provider the user already added is never offered again — even when the live
 * config was written by cc-switch rather than agentpack.
 */
export function detectUnmanagedProviders(input: {
  claudeSettings: string
  codexConfig: string
  opencodeConfig?: string
  providers: Provider[]
}): UnmanagedProvider[] {
  const managed = managedUrls(input.providers)
  const claude = claudeCandidate(input.claudeSettings)
  const candidates = [
    ...(claude ? [claude] : []),
    ...codexCandidates(input.codexConfig),
    ...opencodeCandidates(input.opencodeConfig ?? ""),
  ]
  return candidates.filter((c) => !managed.get(c.app)?.has(normalizeUrl(c.form.baseUrl ?? "")))
}
