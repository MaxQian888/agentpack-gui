import type { Plan, StepDescriptor, Paths } from "./types"

it("type shapes are usable", () => {
  const p: Plan = { os: "mac", clis: [], skills: [], mcps: [], mcpKeys: {}, network: {} }
  const s: StepDescriptor = {
    kind: "command",
    id: "x",
    label: "x",
    command: { file: "npm", args: [] },
  }
  const paths: Pick<Paths, "os"> = { os: "mac" }
  expect(p.os).toBe("mac")
  expect(s.kind).toBe("command")
  expect(paths.os).toBe("mac")
})
