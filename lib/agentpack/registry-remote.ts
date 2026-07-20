import type { McpSpec } from "./merge/mcp"

/**
 * Mapping from the official MCP registry (`registry.modelcontextprotocol.io`,
 * `GET /v0/servers`) onto agentpack's normalized `McpSpec`. Pure + defensive: a
 * malformed entry yields an `unsupported` candidate rather than throwing, so the
 * on-demand catalog search never crashes on a bad upstream record.
 *
 * The registry is richer than our opinionated 18-server catalog (multiple
 * packages/remotes/versions per server, npm/pypi/oci runtimes), so this module
 * picks the single best installable shape and, per the env-reference-first
 * decision, routes `isSecret` env vars to `envRefs` instead of inlining them.
 */

// --- Registry response shapes (subset we consume) ---------------------------

export interface RegistryEnvVar {
  name?: string
  description?: string
  isRequired?: boolean
  isSecret?: boolean
  default?: string
}

export interface RegistryArgument {
  type?: string // "positional" | "named"
  value?: string
  name?: string
}

export interface RegistryPackage {
  registryType?: string // "npm" | "pypi" | "oci" | …
  identifier?: string
  version?: string
  runtimeHint?: string // "npx" | "uvx" | …
  transport?: { type?: string }
  runtimeArguments?: RegistryArgument[]
  packageArguments?: RegistryArgument[]
  environmentVariables?: RegistryEnvVar[]
}

export interface RegistryRemote {
  type?: string // "streamable-http" | "sse"
  url?: string
  headers?: Array<{ name?: string; value?: string; isSecret?: boolean }>
}

export interface RegistryServer {
  name: string
  description?: string
  title?: string
  version?: string
  repository?: { url?: string }
  packages?: RegistryPackage[]
  remotes?: RegistryRemote[]
}

/** One list item as the API wraps it: `{ server, _meta }`. */
export interface RegistryListItem {
  server: RegistryServer
  _meta?: Record<string, { isLatest?: boolean; status?: string }>
}

/** The `GET /v0/servers` envelope. */
export interface RegistryListResponse {
  servers?: RegistryListItem[]
  metadata?: { nextCursor?: string; count?: number }
}

// --- Mapped candidate -------------------------------------------------------

/** An env var the install form must surface (a reference for secrets, a value otherwise). */
export interface RegistryEnvInput {
  name: string
  description?: string
  required: boolean
  secret: boolean
  default?: string
}

/** A registry server mapped to an installable candidate for the UI. */
export interface RegistryCandidate {
  /** Short slug id (`/^[a-z0-9-]+$/`) derived from the reverse-DNS name. */
  id: string
  /** Full registry name, e.g. `io.github.owner/repo`. */
  name: string
  title: string
  description: string
  docsUrl?: string
  version?: string
  /** The best installable spec, or undefined when nothing installable was found. */
  spec?: McpSpec
  /** Env vars the form should collect / confirm. */
  envInputs: RegistryEnvInput[]
  /** Reason the server can't be installed as-is (e.g. `"oci"`, `"none"`). */
  unsupported?: string
}

const RUNTIME_RANK: Record<string, number> = { npm: 0, pypi: 1 }
const DEFAULT_RUNTIME: Record<string, string> = { npm: "npx", pypi: "uvx" }
const GENERIC_SEGMENTS = new Set(["mcp", "server", "mcp-server", "server-mcp", ""])

/** Slugify to the custom-form id charset (`[a-z0-9-]`), collapsing separators. */
function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

/**
 * Derive a short id from a reverse-DNS registry name (`io.github.owner/repo`,
 * `ac.inference.sh/mcp`). Prefers the last path segment; when that's generic
 * (`mcp`/`server`), falls back to the last DNS label of the namespace so ids
 * stay distinct.
 */
export function deriveRegistryId(name: string): string {
  const [namespace, ...rest] = name.split("/")
  const tail = rest.join("-")
  const tailSlug = slugify(tail)
  if (tailSlug && !GENERIC_SEGMENTS.has(tailSlug)) return tailSlug
  const nsLabels = namespace.split(".")
  const nsTail = slugify(nsLabels[nsLabels.length - 1] ?? "")
  const combined = [nsTail, tailSlug].filter((s) => s && !GENERIC_SEGMENTS.has(s)).join("-")
  return combined || slugify(name) || "mcp-server"
}

/** Flatten `runtimeArguments` / `packageArguments` to positional-ish string args. */
function argValues(args: RegistryArgument[] | undefined): string[] {
  if (!Array.isArray(args)) return []
  const out: string[] = []
  for (const a of args) {
    if (a && typeof a.name === "string" && a.name) out.push(a.name)
    if (a && typeof a.value === "string" && a.value) out.push(a.value)
  }
  return out
}

/** Split registry env vars into a spec's `env`/`envRefs` plus the form inputs. */
function envFromRegistry(vars: RegistryEnvVar[] | undefined): {
  env: Record<string, string>
  envRefs: Record<string, string>
  inputs: RegistryEnvInput[]
} {
  const env: Record<string, string> = {}
  const envRefs: Record<string, string> = {}
  const inputs: RegistryEnvInput[] = []
  for (const v of vars ?? []) {
    if (!v || typeof v.name !== "string" || !v.name) continue
    const secret = v.isSecret === true
    const required = v.isRequired === true
    inputs.push({
      name: v.name,
      description: v.description,
      required,
      secret,
      default: typeof v.default === "string" ? v.default : undefined,
    })
    // Secrets default to referencing a same-named host env var (never inlined).
    if (secret) envRefs[v.name] = v.name
    else if (typeof v.default === "string") env[v.name] = v.default
  }
  return { env, envRefs, inputs }
}

/** Pick the best installable package: usable stdio runtime, npm before pypi. */
function pickPackage(packages: RegistryPackage[] | undefined): RegistryPackage | undefined {
  const usable = (packages ?? []).filter(
    (p) => p && typeof p.identifier === "string" && (p.registryType ?? "") in RUNTIME_RANK
  )
  usable.sort((a, b) => RUNTIME_RANK[a.registryType ?? ""] - RUNTIME_RANK[b.registryType ?? ""])
  return usable[0]
}

/** Pick the best remote: streamable-http before the deprecated sse. */
function pickRemote(remotes: RegistryRemote[] | undefined): RegistryRemote | undefined {
  const usable = (remotes ?? []).filter((r) => r && typeof r.url === "string" && r.url)
  usable.sort((a, b) => (a.type === "sse" ? 1 : 0) - (b.type === "sse" ? 1 : 0))
  return usable[0]
}

/**
 * Map one registry server to an installable candidate. Prefers a stdio package
 * (npm→npx, pypi→uvx); falls back to a remote (streamable-http/sse). Marks the
 * candidate `unsupported` when only an OCI/container package exists or nothing
 * installable is present (`spec` is then undefined).
 */
export function mapRegistryServer(server: RegistryServer): RegistryCandidate {
  const name = typeof server?.name === "string" ? server.name : "unknown"
  const base = {
    id: deriveRegistryId(name),
    name,
    title: server?.title || name.split("/").pop() || name,
    description: server?.description ?? "",
    docsUrl: server?.repository?.url,
    version: server?.version,
  }

  const pkg = pickPackage(server?.packages)
  if (pkg) {
    const runtime = pkg.runtimeHint || DEFAULT_RUNTIME[pkg.registryType ?? ""] || "npx"
    const identifier =
      pkg.version && !pkg.identifier!.includes("@", 1)
        ? `${pkg.identifier}@${pkg.version}`
        : pkg.identifier!
    const { env, envRefs, inputs } = envFromRegistry(pkg.environmentVariables)
    const args = [
      ...argValues(pkg.runtimeArguments),
      identifier,
      ...argValues(pkg.packageArguments),
    ]
    const spec: McpSpec = {
      transport: "stdio",
      command: runtime,
      args,
      env,
      ...(Object.keys(envRefs).length ? { envRefs } : {}),
    }
    return { ...base, spec, envInputs: inputs }
  }

  const remote = pickRemote(server?.remotes)
  if (remote) {
    const transport = remote.type === "sse" ? "sse" : "http"
    const headers: Record<string, string> = {}
    for (const h of remote.headers ?? []) {
      if (h?.name && typeof h.value === "string" && !h.isSecret) headers[h.name] = h.value
    }
    const spec: McpSpec =
      transport === "sse"
        ? { transport: "sse", url: remote.url!, headers }
        : { transport: "http", url: remote.url!, headers }
    return { ...base, spec, envInputs: [] }
  }

  // Only an OCI/container package, or nothing installable.
  const hasOci = (server?.packages ?? []).some((p) => p?.registryType === "oci")
  return { ...base, envInputs: [], unsupported: hasOci ? "oci" : "none" }
}

/**
 * Map a `GET /v0/servers` response into candidates, dropping empty rows and
 * de-duplicating by registry name (the list can carry several versions of the
 * same server; the first — newest — wins).
 */
export function mapRegistryResponse(res: RegistryListResponse): {
  candidates: RegistryCandidate[]
  nextCursor?: string
} {
  const seen = new Set<string>()
  const candidates: RegistryCandidate[] = []
  for (const item of res?.servers ?? []) {
    const server = item?.server
    if (!server || typeof server.name !== "string" || seen.has(server.name)) continue
    seen.add(server.name)
    candidates.push(mapRegistryServer(server))
  }
  return { candidates, nextCursor: res?.metadata?.nextCursor || undefined }
}
