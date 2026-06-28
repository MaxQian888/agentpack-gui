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

it("successful command logs the printable line and streams output", async () => {
  ;(api.runCommand as jest.Mock).mockImplementation(async (_cmd, onLine) => {
    onLine("hello")
    return 0
  })
  const updates: number[] = []
  const steps: StepDescriptor[] = [
    { kind: "command", id: "c", label: "c", command: { file: "echo", args: ["hi"] } },
  ]
  const reports = await runSteps(steps, {
    dryRun: false,
    paths,
    onUpdate: (_r, i) => updates.push(i),
  })
  expect(reports[0].status).toBe("done")
  expect(reports[0].output).toEqual(["$ echo hi", "hello"])
  expect(updates.length).toBeGreaterThan(0)
})

it("info step logs its lines without IPC", async () => {
  const steps: StepDescriptor[] = [
    { kind: "info", id: "i", label: "i", lines: ["note-a", "note-b"] },
  ]
  const reports = await runSteps(steps, { dryRun: false, paths })
  expect(reports[0].status).toBe("done")
  expect(reports[0].output).toEqual(["note-a", "note-b"])
})

it("mergeFile reads, transforms and writes the file (+ backs up existing content)", async () => {
  ;(api.readTextFile as jest.Mock).mockResolvedValue("{}")
  const steps: StepDescriptor[] = [
    {
      kind: "mergeFile",
      id: "m",
      label: "m",
      path: "/h/.codex/config.toml",
      merge: (e) => e + "!",
      writtenNote: "",
    },
  ]
  const reports = await runSteps(steps, { dryRun: false, paths })
  expect(reports[0].status).toBe("done")
  expect(api.writeTextFile).toHaveBeenCalledWith("/h/.codex/config.toml.agentpack.bak", "{}")
  expect(api.writeTextFile).toHaveBeenCalledWith("/h/.codex/config.toml", "{}!")
})

it("mergeFile skips the backup when the file is empty", async () => {
  ;(api.readTextFile as jest.Mock).mockResolvedValue("")
  const steps: StepDescriptor[] = [
    {
      kind: "mergeFile",
      id: "m",
      label: "m",
      path: "/h/.codex/config.toml",
      merge: () => "new",
      writtenNote: "",
    },
  ]
  await runSteps(steps, { dryRun: false, paths })
  expect(api.writeTextFile).not.toHaveBeenCalledWith(
    "/h/.codex/config.toml.agentpack.bak",
    expect.anything()
  )
  expect(api.writeTextFile).toHaveBeenCalledWith("/h/.codex/config.toml", "new")
})

it("fileRestore reads the backup and writes it back to the target path", async () => {
  ;(api.readTextFile as jest.Mock).mockResolvedValue("original")
  const steps: StepDescriptor[] = [
    {
      kind: "fileRestore",
      id: "r",
      label: "r",
      path: "/h/.codex/config.toml",
      backupPath: "/h/.codex/config.toml.agentpack.bak",
    },
  ]
  const reports = await runSteps(steps, { dryRun: false, paths })
  expect(api.readTextFile).toHaveBeenCalledWith("/h/.codex/config.toml.agentpack.bak")
  expect(api.writeTextFile).toHaveBeenCalledWith("/h/.codex/config.toml", "original")
  expect(reports[0].status).toBe("done")
})

it("ccVisibleApps reads + writes via the same merge path", async () => {
  ;(api.readTextFile as jest.Mock).mockResolvedValue("{}")
  const steps: StepDescriptor[] = [
    { kind: "ccVisibleApps", id: "v", label: "v", path: "/cfg.json", merge: () => "{merged}" },
  ]
  await runSteps(steps, { dryRun: false, paths })
  expect(api.writeTextFile).toHaveBeenCalledWith("/cfg.json", "{merged}")
})

it("skillInstall installs and logs each returned dest", async () => {
  ;(api.installSkill as jest.Mock).mockResolvedValue(["/h/.claude/skills/rust"])
  const steps: StepDescriptor[] = [
    { kind: "skillInstall", id: "s", label: "s", skillId: "rust", targets: ["claude"] },
  ]
  const reports = await runSteps(steps, { dryRun: false, paths })
  expect(api.installSkill).toHaveBeenCalledWith("rust", ["claude"])
  expect(reports[0].output.join("\n")).toContain("/h/.claude/skills/rust")
})

it("skillRemove deletes each dest", async () => {
  const steps: StepDescriptor[] = [
    {
      kind: "skillRemove",
      id: "s",
      label: "s",
      skillId: "rust",
      targets: ["claude"],
      dests: ["/h/.claude/skills/rust"],
    },
  ]
  await runSteps(steps, { dryRun: false, paths })
  expect(api.removeDir).toHaveBeenCalledWith("/h/.claude/skills/rust")
})

it("ccProvider forwards the payload and logs returned lines", async () => {
  ;(api.ccWriteProvider as jest.Mock).mockResolvedValue(["added Mine"])
  const steps: StepDescriptor[] = [
    {
      kind: "ccProvider",
      id: "p",
      label: "p",
      op: "add",
      payload: { app: "claude", settingsConfig: "{}", form: { name: "Mine" } },
    },
  ]
  const reports = await runSteps(steps, { dryRun: false, paths })
  expect(api.ccWriteProvider).toHaveBeenCalledWith(
    expect.objectContaining({ op: "add", dryRun: false, app: "claude" })
  )
  expect(reports[0].output).toContain("added Mine")
})

it("a non-verify command throwing is recorded as error", async () => {
  ;(api.runCommand as jest.Mock).mockRejectedValue("network down")
  const steps: StepDescriptor[] = [
    { kind: "command", id: "c", label: "c", command: { file: "x", args: [] } },
  ]
  const reports = await runSteps(steps, { dryRun: false, paths })
  expect(reports[0].status).toBe("error")
  expect(reports[0].error).toBe("network down")
})
