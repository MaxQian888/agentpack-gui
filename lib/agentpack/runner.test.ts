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
  ;(api.pathExists as jest.Mock).mockResolvedValue(false) // no prior backup yet
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

it("mergeFile keeps the original backup instead of overwriting it on a second write", async () => {
  ;(api.readTextFile as jest.Mock).mockResolvedValue("{}")
  ;(api.pathExists as jest.Mock).mockResolvedValue(true) // a backup already exists
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
  // The pre-existing .bak (the true original) must NOT be clobbered...
  expect(api.writeTextFile).not.toHaveBeenCalledWith(
    "/h/.codex/config.toml.agentpack.bak",
    expect.anything()
  )
  // ...but the merged content is still written to the target.
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

it("gives a winget-specific hint when winget itself isn't available", async () => {
  ;(api.runCommand as jest.Mock).mockRejectedValue(
    new Error("command not found: winget (os error 2)")
  )
  const step: StepDescriptor[] = [
    {
      kind: "command",
      id: "w",
      label: "w",
      command: { file: "winget", args: ["install", "-e", "--id", "OpenJS.NodeJS.LTS"] },
    },
  ]
  const reports = await runSteps(step, { dryRun: false, paths })
  expect(reports[0].status).toBe("error")
  expect(reports[0].output.join("\n")).toMatch(/App Installer/i)
})

it("a manual info note reports as a warning, not a green success", async () => {
  const steps: StepDescriptor[] = [
    { kind: "info", id: "i", label: "i", lines: ["install manually"], manual: true },
  ]
  const reports = await runSteps(steps, { dryRun: false, paths })
  expect(reports[0].status).toBe("warning")
})

it("appends an elevation hint when a requiresElevation command fails", async () => {
  ;(api.runCommand as jest.Mock).mockResolvedValue(1)
  const steps: StepDescriptor[] = [
    {
      kind: "command",
      id: "c",
      label: "c",
      command: { file: "winget", args: ["install", "-e", "--id", "OpenJS.NodeJS.LTS"] },
      requiresElevation: true,
    },
  ]
  const reports = await runSteps(steps, { dryRun: false, paths })
  expect(reports[0].status).toBe("error")
  expect(reports[0].output.join("\n")).toMatch(/administrator/i)
})

it("auto-elevates any winget install and warns about the UAC prompt", async () => {
  ;(api.runCommand as jest.Mock).mockResolvedValue(0)
  const steps: StepDescriptor[] = [
    {
      kind: "command",
      id: "c",
      label: "c",
      // No requiresElevation flag — a bare winget install must still elevate.
      command: { file: "winget", args: ["install", "-e", "--id", "farion1231.CC-Switch"] },
    },
  ]
  const reports = await runSteps(steps, { dryRun: false, paths })
  expect(reports[0].status).toBe("done")
  expect(api.runCommand).toHaveBeenCalledWith(
    steps[0].kind === "command" ? steps[0].command : undefined,
    expect.any(Function),
    expect.objectContaining({ elevated: true })
  )
  expect(reports[0].output.join("\n")).toMatch(/administrator permission/i)
})

it("treats winget 'already installed / up to date' as success, not an error", async () => {
  // 0x8A15002B — the package is already current; winget's non-zero code here is benign.
  ;(api.runCommand as jest.Mock).mockResolvedValue(-1978335189)
  const steps: StepDescriptor[] = [
    {
      kind: "command",
      id: "c",
      label: "c",
      command: { file: "winget", args: ["install", "-e", "--id", "farion1231.CC-Switch"] },
    },
  ]
  const reports = await runSteps(steps, { dryRun: false, paths })
  expect(reports[0].status).toBe("done")
  expect(reports[0].output.join("\n")).toMatch(/up to date/i)
})

it("warns (not errors) when a winget upgrade finds no winget-managed install", async () => {
  // 0x8A150014 — "No installed package found matching input criteria": the
  // runtime exists but was installed outside winget (nodejs.org / nvm on
  // Windows 10), so winget can't update it in place. That's a warning, not a
  // red failure — and it must not read as a "1 failed" in the summary.
  ;(api.runCommand as jest.Mock).mockResolvedValue(-1978335212)
  const steps: StepDescriptor[] = [
    {
      kind: "command",
      id: "c",
      label: "Update Node.js",
      command: { file: "winget", args: ["upgrade", "-e", "--id", "OpenJS.NodeJS.LTS"] },
    },
  ]
  const reports = await runSteps(steps, { dryRun: false, paths })
  expect(reports[0].status).toBe("warning")
  expect(reports[0].output.join("\n")).toMatch(/wasn't installed through winget/i)
})

it("still errors on the no-matching-package code for a winget INSTALL", async () => {
  // The graceful warning is scoped to `upgrade`; a failing install stays an error.
  ;(api.runCommand as jest.Mock).mockResolvedValue(-1978335212)
  const steps: StepDescriptor[] = [
    {
      kind: "command",
      id: "c",
      label: "Install Node.js",
      command: { file: "winget", args: ["install", "-e", "--id", "OpenJS.NodeJS.LTS"] },
    },
  ]
  const reports = await runSteps(steps, { dryRun: false, paths })
  expect(reports[0].status).toBe("error")
})

it("reports a dismissed UAC prompt as a clear cancellation, not a raw code", async () => {
  ;(api.runCommand as jest.Mock).mockResolvedValue(1223) // Windows ERROR_CANCELLED
  const steps: StepDescriptor[] = [
    {
      kind: "command",
      id: "c",
      label: "c",
      command: { file: "winget", args: ["install", "-e", "--id", "OpenJS.NodeJS.LTS"] },
    },
  ]
  const reports = await runSteps(steps, { dryRun: false, paths })
  expect(reports[0].status).toBe("error")
  expect(reports[0].error).toMatch(/declined|cancel/i)
  // The declined message stands on its own — no confusing "run it yourself" hint.
  expect(reports[0].output.join("\n")).not.toMatch(/open a terminal as administrator/i)
})

it("maps the timeout sentinel to a friendly 'timed out' error", async () => {
  ;(api as unknown as { TIMEOUT_ERR: string }).TIMEOUT_ERR = "agentpack:timeout"
  ;(api.runCommand as jest.Mock).mockRejectedValue(new Error("agentpack:timeout"))
  const steps: StepDescriptor[] = [
    { kind: "command", id: "c", label: "c", command: { file: "npm", args: ["i"] } },
  ]
  const reports = await runSteps(steps, { dryRun: false, paths })
  expect(reports[0].status).toBe("error")
  expect(reports[0].error).toMatch(/timed out/i)
  // the raw sentinel must not leak to the user
  expect(reports[0].error).not.toBe("agentpack:timeout")
})

it("shows a command killed by cancellation as skipped, not an error", async () => {
  const ctrl = new AbortController()
  // Simulate the user cancelling mid-command: abort, then the killed process rejects.
  ;(api.runCommand as jest.Mock).mockImplementation(async () => {
    ctrl.abort()
    throw new Error("killed")
  })
  const steps: StepDescriptor[] = [
    { kind: "command", id: "c", label: "c", command: { file: "npm", args: ["i"] } },
  ]
  const reports = await runSteps(steps, { dryRun: false, paths, signal: ctrl.signal })
  expect(reports[0].status).toBe("skipped")
  expect(reports[0].output.join("\n")).toContain("cancelled")
})

it("passes an opId and timeout so the command can be cancelled / time-limited", async () => {
  ;(api.runCommand as jest.Mock).mockResolvedValue(0)
  const steps: StepDescriptor[] = [
    { kind: "command", id: "c", label: "c", command: { file: "npm", args: ["i"] } },
  ]
  await runSteps(steps, { dryRun: false, paths })
  expect(api.runCommand).toHaveBeenCalledWith(
    expect.anything(),
    expect.any(Function),
    expect.objectContaining({ opId: expect.any(String), timeoutSecs: expect.any(Number) })
  )
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

it("skillCopy copies via installSkillFromDir and logs each dest", async () => {
  ;(api.installSkillFromDir as jest.Mock).mockResolvedValue(["/h/.codex/skills/caveman"])
  const steps: StepDescriptor[] = [
    {
      kind: "skillCopy",
      id: "s",
      label: "s",
      srcPath: "/h/.claude/skills/caveman",
      dirName: "caveman",
      targets: ["codex"],
      dests: ["/h/.codex/skills/caveman"],
    },
  ]
  const reports = await runSteps(steps, { dryRun: false, paths })
  expect(api.installSkillFromDir).toHaveBeenCalledWith("/h/.claude/skills/caveman", "caveman", [
    "codex",
  ])
  expect(reports[0].status).toBe("done")
  expect(reports[0].output.join("\n")).toContain("/h/.codex/skills/caveman")
})

it("skillRepoInstall installs the picked rel paths into the targets", async () => {
  ;(api.installRepoSkills as jest.Mock).mockResolvedValue(["/h/.claude/skills/web-design"])
  const steps: StepDescriptor[] = [
    {
      kind: "skillRepoInstall",
      id: "r",
      label: "r",
      scanId: "scan-1",
      skills: [{ relPath: "skills/web-design", dirName: "web-design" }],
      targets: ["claude"],
      dests: ["/h/.claude/skills/web-design"],
      repo: "owner/repo",
      ref: "HEAD",
    },
  ]
  const reports = await runSteps(steps, { dryRun: false, paths })
  expect(api.installRepoSkills).toHaveBeenCalledWith(
    "scan-1",
    ["skills/web-design"],
    ["claude"],
    "owner/repo",
    "HEAD"
  )
  expect(reports[0].output.join("\n")).toContain("/h/.claude/skills/web-design")
})

it("dry-run of the new skill kinds renders previews and calls no mutating command", async () => {
  const steps: StepDescriptor[] = [
    {
      kind: "skillCopy",
      id: "s",
      label: "s",
      srcPath: "/src",
      dirName: "x",
      targets: ["codex"],
      dests: ["/h/.codex/skills/x"],
    },
    {
      kind: "skillRepoInstall",
      id: "r",
      label: "r",
      scanId: "scan-1",
      skills: [{ relPath: "x", dirName: "x" }],
      targets: ["claude"],
      dests: ["/h/.claude/skills/x"],
      repo: "owner/repo",
      ref: "HEAD",
    },
  ]
  const reports = await runSteps(steps, { dryRun: true, paths })
  expect(api.installSkillFromDir).not.toHaveBeenCalled()
  expect(api.installRepoSkills).not.toHaveBeenCalled()
  expect(reports[0].output.join("\n")).toContain("would copy /src -> /h/.codex/skills/x")
  expect(reports[1].output.join("\n")).toContain("/h/.claude/skills/x")
})

it("skillUpdate re-syncs from the origin path into its targets", async () => {
  ;(api.updateSkill as jest.Mock).mockResolvedValue(["/h/.claude/skills/web"])
  const steps: StepDescriptor[] = [
    {
      kind: "skillUpdate",
      id: "u",
      label: "u",
      path: "/h/.claude/skills/web",
      dirName: "web",
      targets: ["claude"],
      dests: ["/h/.claude/skills/web"],
      mirrorPrefix: null,
    },
  ]
  const reports = await runSteps(steps, { dryRun: false, paths })
  expect(api.updateSkill).toHaveBeenCalledWith("/h/.claude/skills/web", ["claude"], null)
  expect(reports[0].status).toBe("done")
  expect(reports[0].output.join("\n")).toContain("/h/.claude/skills/web")
})

it("skillBackup copies the skill into the backup store", async () => {
  ;(api.backupSkill as jest.Mock).mockResolvedValue({
    id: "web-1",
    name: "web",
    dirName: "web",
    source: "claude",
    bytes: 10,
    createdAt: 1,
  })
  const steps: StepDescriptor[] = [
    { kind: "skillBackup", id: "b", label: "b", path: "/h/.claude/skills/web", dirName: "web" },
  ]
  const reports = await runSteps(steps, { dryRun: false, paths })
  expect(api.backupSkill).toHaveBeenCalledWith("/h/.claude/skills/web")
  expect(reports[0].status).toBe("done")
})

it("skillBackup failure skips a dependent remove step", async () => {
  ;(api.backupSkill as jest.Mock).mockRejectedValue(new Error("no space"))
  const steps: StepDescriptor[] = [
    { kind: "skillBackup", id: "b", label: "b", path: "/h/.claude/skills/web", dirName: "web" },
    {
      kind: "skillRemove",
      id: "rm",
      label: "rm",
      skillId: "web",
      targets: ["claude"],
      dests: ["/h/.claude/skills/web"],
      dependsOn: ["b"],
    },
  ]
  const reports = await runSteps(steps, { dryRun: false, paths })
  expect(reports[0].status).toBe("error")
  expect(reports[1].status).toBe("skipped")
  expect(api.removeDir).not.toHaveBeenCalled()
})

it("skillCreate writes the new skill into each target", async () => {
  ;(api.createSkill as jest.Mock).mockResolvedValue(["/h/.claude/skills/web"])
  const steps: StepDescriptor[] = [
    {
      kind: "skillCreate",
      id: "c",
      label: "c",
      name: "web",
      targets: ["claude"],
      content: "---\nname: web\n---\n",
      dests: ["/h/.claude/skills/web"],
    },
  ]
  const reports = await runSteps(steps, { dryRun: false, paths })
  expect(api.createSkill).toHaveBeenCalledWith("web", ["claude"], "---\nname: web\n---\n")
  expect(reports[0].status).toBe("done")
})
