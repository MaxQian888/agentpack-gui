import type { ProviderForm } from "./types"

/**
 * "Test connection" for a provider, as a pure request description plus a pure
 * response reader. The Rust side only performs the GET (`net::http_get`).
 *
 * It targets the model-list endpoint rather than a real completion: that one
 * request proves all three things that actually go wrong — the endpoint is
 * reachable, the base URL's path is right, and the token is accepted — while
 * costing no tokens. A TCP probe would report a green light for a wrong token
 * or a base URL missing its `/v1`, which is worse than no check at all.
 */

export interface ProbeRequest {
  url: string
  headers: Record<string, string>
}

export interface ProbeOutcome {
  ok: boolean
  status?: number
  latencyMs?: number
  /** Model ids the endpoint advertised, when it returned a list. */
  models: string[]
  /** Machine-readable reason when `ok` is false. */
  reason?: "unauthorized" | "not-found" | "http-error" | "unreachable"
}

/** Anthropic requires this header on every request; relays echo the same API. */
const ANTHROPIC_VERSION = "2023-06-01"

/**
 * Join the base URL with the model-list path. Codex base URLs already carry the
 * `/v1` segment (`https://x/v1`) while Claude's are the bare root, so appending
 * blindly yields either `/v1/v1/models` or a 404 depending on the app.
 */
export function modelsUrl(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, "")
  return /\/v\d+$/.test(base) ? `${base}/models` : `${base}/v1/models`
}

/**
 * The request that checks a provider. Auth headers mirror exactly what the CLI
 * itself sends, so a token that passes here passes in real use:
 * `ANTHROPIC_API_KEY` travels as `x-api-key`, everything else as a bearer token.
 */
export function probeRequest(
  form: Pick<ProviderForm, "app" | "baseUrl" | "token" | "claudeAuthKind">
): ProbeRequest | null {
  if (!form.baseUrl.trim()) return null
  const headers: Record<string, string> = { Accept: "application/json" }
  if (form.app === "claude") {
    headers["anthropic-version"] = ANTHROPIC_VERSION
    if (form.token) {
      if (form.claudeAuthKind === "api_key") headers["x-api-key"] = form.token
      else headers["Authorization"] = `Bearer ${form.token}`
    }
  } else if (form.token) {
    // Codex and OpenCode both drive OpenAI-compatible endpoints.
    headers["Authorization"] = `Bearer ${form.token}`
  }
  return { url: modelsUrl(form.baseUrl), headers }
}

/** Model ids out of either shape the two APIs return (`data[]` / `models[]`). */
function readModels(body: string): string[] {
  let raw: unknown
  try {
    raw = JSON.parse(body)
  } catch {
    return []
  }
  const list =
    (raw as { data?: unknown; models?: unknown })?.data ?? (raw as { models?: unknown })?.models
  if (!Array.isArray(list)) return []
  return list
    .map((m) => (typeof m === "string" ? m : ((m as { id?: unknown })?.id as string | undefined)))
    .filter((id): id is string => typeof id === "string" && id.length > 0)
}

/** Turn a raw HTTP result into the verdict the form shows. */
export function readProbe(result: {
  status?: number | null
  latencyMs?: number | null
  body?: string
  error?: string | null
}): ProbeOutcome {
  const latencyMs = result.latencyMs ?? undefined
  if (result.status == null) return { ok: false, models: [], reason: "unreachable" }
  if (result.status === 401 || result.status === 403) {
    return { ok: false, status: result.status, latencyMs, models: [], reason: "unauthorized" }
  }
  // A relay that answers but has no /models route still proves reachability and
  // auth; only an outright 404 points at a wrong base URL.
  if (result.status === 404) {
    return { ok: false, status: result.status, latencyMs, models: [], reason: "not-found" }
  }
  if (result.status >= 400) {
    return { ok: false, status: result.status, latencyMs, models: [], reason: "http-error" }
  }
  return { ok: true, status: result.status, latencyMs, models: readModels(result.body ?? "") }
}
