import type { McpSpec } from "./merge/mcp"
import type { McpTarget } from "./types"

/**
 * The agentpack-owned "disabled" stash. Codex and OpenCode disable a server
 * in place via a native `enabled = false` flag, but Claude's user-scope
 * `~/.claude.json` has no per-server toggle (and there's no `claude mcp disable`
 * command). To offer a uniform enable/disable switch, disabling a Claude server
 * *removes* it from `~/.claude.json` and remembers its full spec here, so
 * enabling can write it back verbatim.
 *
 * Stored at `Paths.mcpDisabledStore`; read/written with the existing text-file
 * commands. Pure + defensive so the store is never a crash surface — a corrupt
 * file parses to an empty store rather than throwing.
 */

export interface DisabledEntry {
  spec: McpSpec
  /** The targets the server was disabled on (typically just `["claude"]`). */
  targets: McpTarget[]
  /** Epoch millis when it was stashed (provenance for the UI; optional). */
  disabledAt?: number
}

export type DisabledStore = Record<string, DisabledEntry>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Parse the stash file, tolerating empty / malformed input (→ empty store). */
export function parseDisabledStore(json: string): DisabledStore {
  if (!json.trim()) return {}
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    return {}
  }
  if (!isRecord(data)) return {}
  const out: DisabledStore = {}
  for (const [id, value] of Object.entries(data)) {
    if (!isRecord(value)) continue
    const spec = value["spec"]
    const targets = value["targets"]
    if (!isRecord(spec) || !Array.isArray(targets)) continue
    out[id] = {
      spec: spec as unknown as McpSpec,
      targets: targets.filter((t): t is McpTarget => typeof t === "string") as McpTarget[],
      ...(typeof value["disabledAt"] === "number" ? { disabledAt: value["disabledAt"] } : {}),
    }
  }
  return out
}

/** Serialize a store to stable, pretty JSON with a trailing newline. */
export function serializeDisabledStore(store: DisabledStore): string {
  return JSON.stringify(store, null, 2) + "\n"
}

/** Return a copy of `store` with `id` recorded (overwrites an existing entry). */
export function addDisabled(store: DisabledStore, id: string, entry: DisabledEntry): DisabledStore {
  return { ...store, [id]: entry }
}

/** Return a copy of `store` without `id` (no-op when absent). */
export function removeDisabled(store: DisabledStore, id: string): DisabledStore {
  if (!(id in store)) return store
  const next = { ...store }
  delete next[id]
  return next
}

/** Look up a stashed entry by id. */
export function getDisabled(store: DisabledStore, id: string): DisabledEntry | undefined {
  return store[id]
}

/** Whether `id` is currently stashed as disabled. */
export function isDisabled(store: DisabledStore, id: string): boolean {
  return id in store
}
