/**
 * Pure presentation helpers for the skill detail view: context-cost estimate and
 * frontmatter classification. Kept out of the component so they're unit-testable
 * under the coverage gate.
 */

/** Rough token estimate for text (~4 chars/token, the usual heuristic). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export interface SkillCost {
  /** UTF-8 byte length of the SKILL.md. */
  bytes: number
  /** Line count (0 for empty). */
  lines: number
  /** Approximate token cost of loading the skill. */
  tokens: number
}

/**
 * UTF-8 byte length without `TextEncoder` (absent in some jsdom environments),
 * so the same code works in the browser and under test.
 */
function utf8ByteLength(text: string): number {
  let bytes = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff) {
      // High surrogate: a 4-byte astral character; consume its low surrogate.
      bytes += 4
      i++
    } else bytes += 3
  }
  return bytes
}

export function skillCost(text: string): SkillCost {
  return {
    bytes: utf8ByteLength(text),
    lines: text ? text.split(/\r?\n/).length : 0,
    tokens: estimateTokens(text),
  }
}

/**
 * Frontmatter fields surfaced as first-class, labelled rows in the detail view
 * (in display order). Any other attr still shows under a collapsible "all
 * fields" list, so nothing is hidden.
 */
export const HIGHLIGHT_FIELDS = [
  "when_to_use",
  "argument-hint",
  "model",
  "effort",
  "paths",
] as const

/** Split a `allowed-tools`/`disallowed-tools` value into individual tool chips. */
export function toolList(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Who may invoke the skill, derived from the two invocation-control fields. */
export interface Invocation {
  /** Claude can load it automatically (false when disable-model-invocation). */
  model: boolean
  /** The user can type `/name` (false when user-invocable: false). */
  user: boolean
}

export function invocation(attrs: Record<string, string>): Invocation {
  const isTrue = (v: string | undefined) => v?.trim().toLowerCase() === "true"
  const isFalse = (v: string | undefined) => v?.trim().toLowerCase() === "false"
  return {
    model: !isTrue(attrs["disable-model-invocation"]),
    user: !isFalse(attrs["user-invocable"]),
  }
}
