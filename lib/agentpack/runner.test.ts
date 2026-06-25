jest.mock("@/lib/tauri/commands")

import * as api from "@/lib/tauri/commands"
import { runSteps } from "./runner"
import type { Paths, StepDescriptor } from "./types"

const paths = {
  home: "/h",
  codexConfig: "/h/.codex/config.toml",
  claudeSkillsDir: "/h/.claude/skills",
  codexSkillsDir: "/h/.codex/skills",
} as Paths

it("dry-run produces preview output and calls no mutating command", async () => {
  const steps: StepDescriptor[] = [
    { kind: "command", id: "c", label: "c", command: { file: "npm", args: ["i"] } },
  ]
  const reports = await runSteps(steps, { dryRun: true, paths })
  expect(reports[0].status).toBe("done")
  expect(reports[0].output).toContain("would run: npm i")
  expect(api.runCommand).not.toHaveBeenCalled()
})

it("real command failure marks error but continues; verifyOnly swallows", async () => {
  ;(api.runCommand as jest.Mock).mockResolvedValue(1)
  const steps: StepDescriptor[] = [
    { kind: "command", id: "a", label: "a", command: { file: "x", args: [] } },
    { kind: "command", id: "b", label: "b", command: { file: "y", args: [] }, verifyOnly: true },
  ]
  const reports = await runSteps(steps, { dryRun: false, paths })
  expect(reports[0].status).toBe("error")
  expect(reports[1].status).toBe("done")
})

it("aborted signal skips remaining steps", async () => {
  const ctrl = new AbortController()
  ctrl.abort()
  const steps: StepDescriptor[] = [
    { kind: "command", id: "a", label: "a", command: { file: "x", args: [] } },
  ]
  const reports = await runSteps(steps, { dryRun: false, paths, signal: ctrl.signal })
  expect(reports[0].status).toBe("skipped")
})
