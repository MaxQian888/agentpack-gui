/**
 * Per-skill config merges, keyed by skill NAME (frontmatter `name`, falling back
 * to the dir name):
 *
 * - Claude Code: `skillOverrides` in `~/.claude/settings.json` —
 *   `"on" | "name-only" | "user-invocable-only" | "off"`, evaluated at session
 *   start. `"on"` is the default, so setting it deletes the key to keep the
 *   user's settings.json minimal.
 * - OpenCode: `permission.skill.<name>` in `~/.config/opencode/opencode.json` —
 *   `"allow" | "ask" | "deny"`, `"allow"` being the default (same key-deletion
 *   rule). Wildcard keys a user wrote by hand are preserved verbatim.
 *
 * Unlike the network merges these THROW on malformed JSON: silently rebuilding a
 * corrupt settings file from `{}` would discard everything else in it. The
 * runner surfaces the throw as a failed step and writes nothing.
 */

export type ClaudeSkillVisibility = "on" | "name-only" | "user-invocable-only" | "off"
export type OpencodeSkillPermission = "allow" | "ask" | "deny"

function parseObject(json: string, label: string): Record<string, unknown> {
  if (!json.trim()) return {}
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    throw new Error(`${label} is not valid JSON; fix it before changing skill config`)
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error(`${label} is not a JSON object; fix it before changing skill config`)
  }
  return data as Record<string, unknown>
}

function stringMap(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === "string") out[k] = v
  }
  return out
}

/**
 * Set (or clear, with `null`/`"on"`) a skill's visibility in a Claude Code
 * settings.json text. All unrelated keys are preserved.
 */
export function mergeClaudeSkillOverride(
  existingJson: string,
  name: string,
  visibility: ClaudeSkillVisibility | null
): string {
  const data = parseObject(existingJson, "Claude settings.json")
  const overrides = { ...stringMap(data["skillOverrides"]) }
  if (visibility === null || visibility === "on") {
    delete overrides[name]
  } else {
    overrides[name] = visibility
  }
  if (Object.keys(overrides).length > 0) {
    data["skillOverrides"] = overrides
  } else {
    delete data["skillOverrides"]
  }
  return JSON.stringify(data, null, 2) + "\n"
}

/** Read `skillOverrides` defensively — never throws, unknown shapes yield {}. */
export function parseClaudeSkillOverrides(json: string): Record<string, string> {
  try {
    return stringMap((JSON.parse(json) as Record<string, unknown>)["skillOverrides"])
  } catch {
    return {}
  }
}

/**
 * Set (or clear, with `null`/`"allow"`) a skill's permission in an
 * opencode.json text. Prunes empty `permission.skill` / `permission` objects on
 * clear so the file stays as the user wrote it.
 */
export function mergeOpencodeSkillPermission(
  existingJson: string,
  name: string,
  permission: OpencodeSkillPermission | null
): string {
  const data = parseObject(existingJson, "opencode.json")
  const permissionObj =
    typeof data["permission"] === "object" &&
    data["permission"] !== null &&
    !Array.isArray(data["permission"])
      ? { ...(data["permission"] as Record<string, unknown>) }
      : {}
  const skill = { ...stringMap(permissionObj["skill"]) }
  if (permission === null || permission === "allow") {
    delete skill[name]
  } else {
    skill[name] = permission
  }
  if (Object.keys(skill).length > 0) {
    permissionObj["skill"] = skill
  } else {
    delete permissionObj["skill"]
  }
  if (Object.keys(permissionObj).length > 0) {
    data["permission"] = permissionObj
  } else {
    delete data["permission"]
  }
  return JSON.stringify(data, null, 2) + "\n"
}

/** Read `permission.skill` defensively — never throws. */
export function parseOpencodeSkillPermissions(json: string): Record<string, string> {
  try {
    const data = JSON.parse(json) as Record<string, unknown>
    const permission = data["permission"] as Record<string, unknown> | undefined
    return stringMap(permission?.["skill"])
  } catch {
    return {}
  }
}
