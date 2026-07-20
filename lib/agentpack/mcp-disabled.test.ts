import {
  addDisabled,
  getDisabled,
  isDisabled,
  parseDisabledStore,
  removeDisabled,
  serializeDisabledStore,
  type DisabledStore,
} from "./mcp-disabled"
import type { McpSpec } from "./merge/mcp"

const spec: McpSpec = { transport: "stdio", command: "npx", args: ["-y", "srv"], env: {} }

it("round-trips a stashed entry through serialize/parse", () => {
  const store = addDisabled({}, "srv", { spec, targets: ["claude"], disabledAt: 123 })
  const parsed = parseDisabledStore(serializeDisabledStore(store))
  expect(parsed).toEqual({ srv: { spec, targets: ["claude"], disabledAt: 123 } })
  expect(getDisabled(parsed, "srv")?.spec).toEqual(spec)
  expect(isDisabled(parsed, "srv")).toBe(true)
})

it("add overwrites, remove drops, both return copies", () => {
  const one = addDisabled({}, "a", { spec, targets: ["claude"] })
  const two = addDisabled(one, "b", { spec, targets: ["codex"] })
  expect(Object.keys(two)).toEqual(["a", "b"])
  expect(one).not.toBe(two) // immutably copied

  const gone = removeDisabled(two, "a")
  expect(Object.keys(gone)).toEqual(["b"])
  expect(removeDisabled(two, "missing")).toBe(two) // no-op returns same ref
})

it("parse tolerates empty, malformed, and partial entries", () => {
  expect(parseDisabledStore("")).toEqual({})
  expect(parseDisabledStore("{not json")).toEqual({})
  expect(parseDisabledStore("[]")).toEqual({})
  // Entries missing spec or targets are skipped, not fatal.
  const partial: DisabledStore = parseDisabledStore(
    JSON.stringify({ ok: { spec, targets: ["claude"] }, bad1: { spec }, bad2: { targets: [] } })
  )
  expect(Object.keys(partial)).toEqual(["ok"])
})
