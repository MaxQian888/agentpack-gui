jest.mock("@/lib/tauri/commands")

import * as api from "@/lib/tauri/commands"
import { runSteps } from "./runner"
import type { Paths, StepDescriptor } from "./types"

const paths = {
  home: "/h",
  codexConfig: "/h/.codex/config.toml",
  codexAuth: "/h/.codex/auth.json",
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

it("real command failure marks error but continues; verifyOnly warns", async () => {
  ;(api.runCommand as jest.Mock).mockResolvedValue(1)
  const steps: StepDescriptor[] = [
    { kind: "command", id: "a", label: "a", command: { file: "x", args: [] } },
    { kind: "command", id: "b", label: "b", command: { file: "y", args: [] }, verifyOnly: true },
  ]
  const reports = await runSteps(steps, { dryRun: false, paths })
  expect(reports[0].status).toBe("error")
  // A failed verify no longer reads as a green success — it's a warning.
  expect(reports[1].status).toBe("warning")
})

it("aborted signal skips remaining steps", async () => {
  const ctrl = new AbortController()
  ctrl.abort()
  const steps: StepDescriptor[] = [
    { kind: "command", id: "a", label: "a", command: { file: "x", args: [] } },
  ]
  const reports = await runSteps(steps, { dryRun: false, paths, signal: ctrl.signal })
  expect(reports[0].status).toBe("skipped")
  // The step log says why it was skipped instead of showing an empty entry.
  expect(reports[0].output.join("\n")).toContain("cancelled")
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

it("skips dependents (transitively) when a required step fails", async () => {
  ;(api.runCommand as jest.Mock).mockResolvedValue(1)
  const steps: StepDescriptor[] = [
    { kind: "command", id: "a", label: "Install Node.js", command: { file: "winget", args: [] } },
    {
      kind: "command",
      id: "b",
      label: "b",
      command: { file: "npm", args: [] },
      dependsOn: ["a"],
    },
    {
      kind: "command",
      id: "c",
      label: "c",
      command: { file: "claude", args: [] },
      dependsOn: ["b"],
    },
  ]
  const reports = await runSteps(steps, { dryRun: false, paths })
  expect(reports[0].status).toBe("error")
  expect(reports[1].status).toBe("skipped")
  expect(reports[1].output.join("\n")).toContain("Install Node.js")
  expect(reports[2].status).toBe("skipped")
  // Only the failing step actually ran.
  expect(api.runCommand).toHaveBeenCalledTimes(1)
})

it("dependsOn is ignored in dry-run (nothing can fail)", async () => {
  const steps: StepDescriptor[] = [
    { kind: "command", id: "a", label: "a", command: { file: "x", args: [] } },
    { kind: "command", id: "b", label: "b", command: { file: "y", args: [] }, dependsOn: ["a"] },
  ]
  const reports = await runSteps(steps, { dryRun: true, paths })
  expect(reports.map((r) => r.status)).toEqual(["done", "done"])
})

it("appends an actionable hint when the binary cannot be spawned", async () => {
  ;(api.runCommand as jest.Mock).mockRejectedValue(new Error("command not found: npm (os error 2)"))
  const npmStep: StepDescriptor[] = [
    { kind: "command", id: "n", label: "n", command: { file: "npm", args: ["i"] } },
  ]
  const npmReports = await runSteps(npmStep, { dryRun: false, paths })
  expect(npmReports[0].output.join("\n")).toMatch(/Node\.js/)
  ;(api.runCommand as jest.Mock).mockRejectedValue(
    new Error("command not found: claude (os error 2)")
  )
  const cliStep: StepDescriptor[] = [
    { kind: "command", id: "c", label: "c", command: { file: "claude", args: [] } },
  ]
  const cliReports = await runSteps(cliStep, { dryRun: false, paths })
  expect(cliReports[0].output.join("\n")).toMatch(/"claude" is not on PATH/)
})

it("records the step duration once it finishes", async () => {
  ;(api.runCommand as jest.Mock).mockResolvedValue(0)
  const steps: StepDescriptor[] = [
    { kind: "command", id: "c", label: "c", command: { file: "echo", args: [] } },
  ]
  const reports = await runSteps(steps, { dryRun: false, paths })
  expect(typeof reports[0].durationMs).toBe("number")
  expect(reports[0].durationMs!).toBeGreaterThanOrEqual(0)
})
