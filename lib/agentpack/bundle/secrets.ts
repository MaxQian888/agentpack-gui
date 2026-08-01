import { parse, stringify } from "smol-toml"

/**
 * Credential handling for the config files a backup bundle carries verbatim.
 *
 * The plan and the provider list have known shapes, so those are redacted field
 * by field (`redactPlan`, `redactSettingsConfig`). These files don't: they belong
 * to other projects, accept arbitrary vendor keys, and are routinely hand-edited.
 * A named denylist would miss `mcpServers.x.headers.Authorization`, a custom
 * `[mcp_servers.y.env] COMPANY_KEY`, or someone's own `env.MY_TOKEN` — so the
 * rule here is a key-name walk that fails closed instead.
 */

/** Config files a bundle can carry. Keys are `Paths` field names, so `paths[key]` resolves. */
export type BundleFileKey =
  "claudeSettings" | "claudeConfig" | "codexConfig" | "opencodeConfig" | "ccConnectConfig"

export const BUNDLE_FILE_KEYS: readonly BundleFileKey[] = [
  "claudeSettings",
  "claudeConfig",
  "codexConfig",
  "opencodeConfig",
  "ccConnectConfig",
]

export const FILE_FORMAT: Record<BundleFileKey, "json" | "toml"> = {
  claudeSettings: "json",
  claudeConfig: "json",
  codexConfig: "toml",
  opencodeConfig: "json",
  ccConnectConfig: "toml",
}

/**
 * Key names whose string values are treated as credentials. Deliberately broad:
 * a false positive costs a blanked field the import side puts back from the
 * local machine, while a false negative ships someone's key to a chat window.
 */
const SECRET_KEY = /(token|secret|password|passphrase|api[_-]?key|apikey|credential|cookie|auth)/i

type Doc = Record<string, unknown>

function isPlainObject(v: unknown): v is Doc {
  return !!v && typeof v === "object" && !Array.isArray(v)
}

/** Parse a config file by its format; null when it doesn't parse or isn't an object. */
export function parseDoc(key: BundleFileKey, text: string): Doc | null {
  try {
    const doc = FILE_FORMAT[key] === "toml" ? parse(text) : JSON.parse(text)
    return isPlainObject(doc) ? doc : null
  } catch {
    return null
  }
}

function serializeDoc(key: BundleFileKey, doc: Doc): string {
  return FILE_FORMAT[key] === "toml" ? stringify(doc) : JSON.stringify(doc, null, 2) + "\n"
}

/**
 * Blank every string under a secret-looking key. Once inside such a subtree
 * everything below it is blanked too — `credentials.user` is no less sensitive
 * than `credentials.password`, and over-blanking is recoverable (the import side
 * restores the local value) while under-blanking is not.
 */
function redactNode(node: unknown, inSecret: boolean): unknown {
  if (typeof node === "string") return inSecret ? "" : node
  if (Array.isArray(node)) return node.map((v) => redactNode(v, inSecret))
  if (isPlainObject(node)) {
    const out: Doc = {}
    for (const [k, v] of Object.entries(node)) {
      out[k] = redactNode(v, inSecret || SECRET_KEY.test(k))
    }
    return out
  }
  return node
}

/**
 * A redacted copy of a config file's text, or null when it can't be parsed.
 *
 * Null means "leave this file out of the bundle entirely" — bytes we haven't
 * been able to inspect can't be shown to be free of credentials, and shipping
 * them on the assumption they are is exactly the mistake this module exists to
 * prevent. Same reasoning as `redactSettingsConfig`'s `return "{}"`.
 */
export function redactFileText(key: BundleFileKey, text: string): string | null {
  const doc = parseDoc(key, text)
  if (!doc) return null
  return serializeDoc(key, redactNode(doc, false) as Doc)
}

/** Walk `incoming`, substituting the local machine's value wherever a secret was blanked. */
function restoreNode(
  incoming: unknown,
  local: unknown,
  inSecret: boolean,
  state: { hit: boolean }
): unknown {
  if (typeof incoming === "string") {
    // Only a blanked secret is refilled. A non-empty incoming value is a
    // deliberate choice by whoever exported with secrets included.
    if (inSecret && incoming === "" && typeof local === "string" && local !== "") {
      state.hit = true
      return local
    }
    return incoming
  }
  if (Array.isArray(incoming)) {
    const localArr = Array.isArray(local) ? local : []
    return incoming.map((v, i) => restoreNode(v, localArr[i], inSecret, state))
  }
  if (isPlainObject(incoming)) {
    const localObj = isPlainObject(local) ? local : {}
    const out: Doc = {}
    for (const [k, v] of Object.entries(incoming)) {
      out[k] = restoreNode(v, localObj[k], inSecret || SECRET_KEY.test(k), state)
    }
    return out
  }
  return incoming
}

/**
 * Re-attach this machine's credentials wherever the bundle shipped a blank.
 *
 * Without this, "import config files" would be a button that wipes your working
 * `ANTHROPIC_AUTH_TOKEN` in exchange for a teammate's permissions layout. With
 * it, the structural half of a config travels and the credential half stays put.
 *
 * Throws when `local` is non-empty and unparseable: we cannot tell which of its
 * bytes were credentials, so silently writing blanks over them would destroy a
 * working setup. Failing the step is louder and the runner has already written
 * `.agentpack.bak` by then.
 */
export function restoreBlankedSecrets(key: BundleFileKey, incoming: string, local: string): string {
  const incomingDoc = parseDoc(key, incoming)
  // Nothing to merge into — write what the bundle carried, unchanged.
  if (!incomingDoc || !local.trim()) return incoming
  const localDoc = parseDoc(key, local)
  if (!localDoc) {
    throw new Error(`${key}: the existing file could not be parsed, so its secrets can't be kept`)
  }
  const state = { hit: false }
  const merged = restoreNode(incomingDoc, localDoc, false, state)
  // Re-serializing costs the incoming file its comments and key order, so only
  // pay that when a value actually had to be put back.
  return state.hit ? serializeDoc(key, merged as Doc) : incoming
}

/**
 * `~/.claude.json` narrowed to its `mcpServers` subtree.
 *
 * The rest is machine-local session state — `oauthAccount`, `userID`, and a
 * per-project prompt history that routinely runs to megabytes. None of it has
 * any meaning on another machine, and some of it is nobody else's business.
 * Returns null when there are no servers, so the key is simply omitted.
 */
export function pickClaudeConfigSubset(text: string): string | null {
  const doc = parseDoc("claudeConfig", text)
  const servers = doc?.["mcpServers"]
  if (!isPlainObject(servers) || Object.keys(servers).length === 0) return null
  return JSON.stringify({ mcpServers: servers }, null, 2) + "\n"
}
