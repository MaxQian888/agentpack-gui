import { parse, stringify } from "smol-toml"

/**
 * The schema-driven config editor's engine.
 *
 * A config file is edited as raw text — that text is the single source of truth
 * and is what gets written back — while the form is a *projection* over the
 * text's parsed document. Every form edit round-trips through
 * `parse → setConfigValue → serialize`, so keys the schema has never heard of
 * survive untouched. That inversion (text owns, form projects) is what lets one
 * editor serve hand-written config files without owning their schema.
 *
 * This module holds only the format-agnostic half: the field vocabulary, the
 * dotted-path get/set, and the guards that decide when a scalar widget is safe
 * to point at a value. Which keys a given file actually has lives in
 * `./files.ts` (the agent CLIs) and in `../ccconnect.ts` (cc-connect).
 */

/** A parsed config document — a plain object tree, unknown keys preserved. */
export type ConfigDoc = Record<string, unknown>

/**
 * The widget vocabulary. Deliberately small: every type here maps to exactly one
 * control and one JSON/TOML value shape, which is what makes `isPathEditable`
 * able to prove a write is lossless. Anything richer (maps of objects, unions,
 * array tables) is edited in the raw tab instead of growing this list.
 */
export type FieldType = "string" | "number" | "boolean" | "select" | "string-list" | "string-map"

/** One editable scalar field in the visual editor. */
export interface ConfigField {
  /**
   * Dotted path into the doc, e.g. ["management", "port"]. A `PROVIDER_TOKEN`
   * segment is resolved at edit time to the sibling `provider` value, so
   * `["speech", PROVIDER_TOKEN, "api_key"]` targets cc-connect's nested
   * `[speech.<provider>]` credential table.
   */
  path: string[]
  /** i18n label key. Unique across every file, so the catalog stays one flat map. */
  key: string
  type: FieldType
  /** Choices for `select`. An empty-string entry renders as an explicit "(unset)". */
  options?: string[]
  /**
   * Path of a table whose KEYS become additional select options — how Codex's
   * `model_provider` offers exactly the providers declared in `[model_providers]`
   * rather than a list we'd have to keep in sync with the user's own file.
   */
  optionsFrom?: string[]
  /** Placeholder / example text shown in the empty input. */
  placeholder?: string
}

/** One form group of the visual editor (mirrors a file's own sectioning). */
export interface ConfigSection {
  key: string
  fields: ConfigField[]
}

/**
 * Text ⇄ document adapter. Having the form engine depend on this rather than on
 * a parser directly is what lets a single set of renderers drive both Claude's
 * JSON and Codex's TOML.
 */
export interface ConfigFormat {
  lang: "json" | "toml"
  /** Null on a syntax error or a non-object root; blank text is an empty doc. */
  parse(text: string): ConfigDoc | null
  serialize(doc: ConfigDoc): string
}

function isPlainObject(v: unknown): v is ConfigDoc {
  return !!v && typeof v === "object" && !Array.isArray(v)
}

export const jsonFormat: ConfigFormat = {
  lang: "json",
  parse(text) {
    // A missing file reads as "" and must open as an empty doc, not as an error —
    // otherwise creating a config from the form is impossible.
    if (!text.trim()) return {}
    try {
      const doc: unknown = JSON.parse(text)
      // A top-level array parses fine but has nowhere to hang named keys, so the
      // form can't project over it. Raw editing still works.
      return isPlainObject(doc) ? doc : null
    } catch {
      return null
    }
  },
  serialize(doc) {
    return JSON.stringify(doc, null, 2) + "\n"
  },
}

export const tomlFormat: ConfigFormat = {
  lang: "toml",
  parse(text) {
    try {
      const doc = parse(text)
      return isPlainObject(doc) ? doc : null
    } catch {
      return null
    }
  },
  // NOTE: smol-toml's stringify drops comments and normalizes key order. That
  // loss only happens on a *form* edit; a file the user never touched is written
  // back byte-for-byte because the editor keeps the raw text, not the doc.
  serialize(doc) {
    return stringify(doc)
  },
}

/** Placeholder path segment resolved to the section's current `provider` value. */
export const PROVIDER_TOKEN = "$provider"

/** Whether a field targets a `[section.<provider>]` credential table. */
export function isProviderScoped(field: ConfigField): boolean {
  return field.path.includes(PROVIDER_TOKEN)
}

/**
 * Resolve a field path, substituting each `PROVIDER_TOKEN` with the current
 * `provider` value of its enclosing section. Returns null when the provider
 * isn't chosen yet (so a credential field has nowhere to write).
 */
export function resolveFieldPath(doc: ConfigDoc, path: string[]): string[] | null {
  const out: string[] = []
  for (let i = 0; i < path.length; i++) {
    if (path[i] === PROVIDER_TOKEN) {
      const provider = getConfigValue(doc, [...path.slice(0, i), "provider"])
      if (typeof provider !== "string" || provider === "") return null
      out.push(provider)
    } else {
      out.push(path[i])
    }
  }
  return out
}

/** Read a dotted-path value out of a doc (undefined when any segment is absent). */
export function getConfigValue(doc: ConfigDoc, path: string[]): unknown {
  let cur: unknown = doc
  for (const seg of path) {
    if (!cur || typeof cur !== "object") return undefined
    cur = (cur as Record<string, unknown>)[seg]
  }
  return cur
}

/**
 * Return a new doc with `path` set to `value` (an empty value deletes the key,
 * and intermediate tables are created / pruned as needed). Non-destructive so
 * React state updates stay referentially honest.
 */
export function setConfigValue(doc: ConfigDoc, path: string[], value: unknown): ConfigDoc {
  const next: ConfigDoc = { ...doc }
  let cur = next
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i]
    const child = cur[seg]
    cur[seg] = isPlainObject(child) ? { ...child } : {}
    cur = cur[seg] as ConfigDoc
  }
  const last = path[path.length - 1]
  // An emptied map counts as absent too, so clearing the last row of an `env`
  // block removes the block instead of leaving an `env = {}` husk behind.
  const empty =
    value === undefined ||
    value === "" ||
    (Array.isArray(value) && value.length === 0) ||
    (isPlainObject(value) && Object.keys(value).length === 0)
  if (empty) delete cur[last]
  else cur[last] = value
  // Prune tables the delete emptied so the file doesn't accumulate `[x]` husks.
  for (let i = path.length - 2; i >= 0; i--) {
    const parent = path.slice(0, i).reduce<ConfigDoc>((acc, seg) => acc[seg] as ConfigDoc, next)
    const table = parent[path[i]]
    if (isPlainObject(table) && Object.keys(table).length === 0) {
      delete parent[path[i]]
    }
  }
  return next
}

/**
 * The choices a select should offer: its declared options, plus the keys of its
 * `optionsFrom` table, plus **whatever is currently on disk**.
 *
 * That last source matters. These enums come from other projects' docs and drift
 * between releases; without it, a value our list doesn't know renders as
 * "(unset)" — the UI lies about the file, and the next edit to any sibling field
 * re-serializes a doc the user believes says something else. Keeping the real
 * value as an option makes the form honest about a file it doesn't fully model.
 */
export function fieldOptions(doc: ConfigDoc, field: ConfigField, current: unknown): string[] {
  const out = [...(field.options ?? [])]
  if (field.optionsFrom) {
    const table = getConfigValue(doc, field.optionsFrom)
    if (isPlainObject(table)) out.push(...Object.keys(table))
  }
  if (typeof current === "string" && current !== "") out.push(current)
  // Declared order is meaningful (docs list enums best-first), so dedupe without
  // sorting and only hoist "" — the explicit (unset) entry — to the front.
  const uniq = [...new Set(out)]
  return uniq.includes("") ? ["", ...uniq.filter((o) => o !== "")] : uniq
}

/** Whether a widget of `type` can represent `value` without losing information. */
function leafFits(value: unknown, type: FieldType): boolean {
  // Absent is always safe: there is nothing to overwrite.
  if (value === undefined) return true
  switch (type) {
    case "boolean":
      return typeof value === "boolean"
    case "number":
      return typeof value === "number"
    case "string-list":
      return Array.isArray(value) && value.every((v) => typeof v === "string")
    case "string-map":
      return isPlainObject(value) && Object.values(value).every((v) => typeof v === "string")
    default:
      return typeof value === "string"
  }
}

/**
 * Whether a scalar widget may write to `path` without destroying data.
 *
 * Config files in this space lean hard on union types, and a form that ignores
 * that silently flattens them: Claude's `statusLine` is *either* a template
 * string or a `{type, command}` table, Codex's `approval_policy` is an enum or a
 * `{granular = …}` table, OpenCode's `permission.bash` is an action or a
 * pattern→action map. Two guards catch all of them —
 *
 *  - an ANCESTOR holding a non-table means the path can't be descended
 *    (`statusLine: "${model}"` blocks `statusLine.command`), and
 *  - a LEAF holding a shape this widget can't express means writing would
 *    replace it wholesale.
 *
 * A locked field is disabled with a hint rather than hidden — the raw tab is the
 * escape hatch, and the user should be able to see the field exists.
 */
export function isPathEditable(doc: ConfigDoc, path: string[], type: FieldType): boolean {
  let cur: unknown = doc
  for (const seg of path.slice(0, -1)) {
    if (!isPlainObject(cur)) return false
    const child = cur[seg]
    // An absent ancestor is fine — setConfigValue creates the tables it needs.
    if (child === undefined) return true
    cur = child
  }
  if (!isPlainObject(cur)) return false
  return leafFits(cur[path[path.length - 1]], type)
}
