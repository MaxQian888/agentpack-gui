jest.mock("@/lib/tauri/commands")

import * as api from "@/lib/tauri/commands"
import { runSteps } from "./runner"
import type { Command, Paths, StepDescriptor } from "./types"

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

it("routes native provider writes to Agentpack's independent store", async () => {
  ;(api.ccWriteProvider as jest.Mock).mockClear()
  ;(api.providerWrite as jest.Mock).mockResolvedValue(["added Native"])
  const steps: StepDescriptor[] = [
    {
      kind: "ccProvider",
      id: "p-native",
      label: "p-native",
      op: "add",
      payload: {
        backend: "native",
        app: "opencode",
        settingsConfig: "{}",
        form: { name: "Native" },
      },
    },
  ]
  const reports = await runSteps(steps, { dryRun: false, paths })
  expect(api.providerWrite).toHaveBeenCalledWith(
    expect.objectContaining({ backend: "native", app: "opencode", op: "add" })
  )
  expect(api.ccWriteProvider).not.toHaveBeenCalled()
  expect(reports[0].output).toContain("added Native")
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

it("keeps an explicitly user-scope winget install in the current account", async () => {
  ;(api.runCommand as jest.Mock).mockResolvedValue(0)
  const steps: StepDescriptor[] = [
    {
      kind: "command",
      id: "c",
      label: "c",
      command: {
        file: "winget",
        args: ["install", "-e", "--id", "Microsoft.WindowsTerminal", "--scope", "user"],
      },
    },
  ]

  await runSteps(steps, { dryRun: false, paths })

  expect(api.runCommand).toHaveBeenCalledWith(
    steps[0].kind === "command" ? steps[0].command : undefined,
    expect.any(Function),
    expect.objectContaining({ elevated: false })
  )
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
  expect(api.createSkill).toHaveBeenCalledWith("web", ["claude"], "---\nname: web\n---\n", false)
  expect(reports[0].status).toBe("done")
})

describe("network auto-recovery", () => {
  const recovery = {
    proxyUrl: "http://127.0.0.1:7890",
    npmRegistry: "https://registry.npmmirror.com",
    pypiIndex: null,
  }
  const NET_ERROR = "npm ERR! network request to https://registry.npmjs.org/x failed, ETIMEDOUT"
  const npmStep: StepDescriptor = {
    kind: "command",
    id: "cli-claude-code",
    label: "Install Claude Code",
    command: { file: "npm", args: ["install", "-g", "@anthropic-ai/claude-code"] },
  }

  /** Fail every attempt whose env/args don't match `succeedOn`, succeed on that one. */
  const mockAttempts = (
    succeedOn: (cmd: Command, opts: { env?: Record<string, string> }) => boolean
  ) =>
    (api.runCommand as jest.Mock).mockImplementation(async (cmd, onLine, opts) => {
      if (succeedOn(cmd, opts ?? {})) return 0
      onLine(NET_ERROR)
      return 1
    })

  it("retries through a mirror and reports how it was rescued", async () => {
    mockAttempts((cmd) => cmd.args.includes("--registry=https://registry.npmmirror.com"))

    const reports = await runSteps([npmStep], { dryRun: false, paths, recovery })

    expect(reports[0].status).toBe("done")
    expect(reports[0].recovery).toEqual({
      remedyId: "npm-registry",
      label: "registry.npmmirror.com",
      persist: { kind: "npmRegistry", url: "https://registry.npmmirror.com" },
    })
    expect(reports[0].output.join("\n")).toContain("registry.npmmirror.com")
  })

  it("climbs to mirror+proxy when the mirror alone isn't enough", async () => {
    mockAttempts((_cmd, opts) => !!opts.env?.HTTPS_PROXY)

    const reports = await runSteps([npmStep], { dryRun: false, paths, recovery })

    expect(reports[0].status).toBe("done")
    expect(reports[0].recovery?.remedyId).toBe("npm-registry+proxy")
    // The proxy reached the child as a per-spawn variable, not a config write.
    const envs = (api.runCommand as jest.Mock).mock.calls.map(([, , o]) => o?.env)
    expect(envs.at(-1)).toMatchObject({ HTTPS_PROXY: "http://127.0.0.1:7890" })
  })

  it("never writes anything to the machine while recovering", async () => {
    mockAttempts((cmd) => cmd.args.includes("--registry=https://registry.npmmirror.com"))

    await runSteps([npmStep], { dryRun: false, paths, recovery })

    // The whole promise of a temporary downgrade: no npm config, no rc file, no
    // settings.json touched just to make an install work.
    expect(api.writeTextFile).not.toHaveBeenCalled()
    const commands = (api.runCommand as jest.Mock).mock.calls.map(([c]) => `${c.file} ${c.args[0]}`)
    expect(commands).not.toContain("npm config")
  })

  it("falls back to a different install route when every rewrite fails", async () => {
    ;(api.runCommand as jest.Mock).mockImplementation(async (cmd, onLine) => {
      if (cmd.file === "scoop") return 0
      onLine(NET_ERROR)
      return 1
    })
    const withFallback: StepDescriptor = {
      ...npmStep,
      fallbacks: [
        {
          kind: "command",
          id: "cli-claude-code-scoop",
          label: "Install via scoop",
          command: { file: "scoop", args: ["install", "claude"] },
        },
      ],
    }

    const reports = await runSteps([withFallback], { dryRun: false, paths, recovery })

    expect(reports[0].status).toBe("done")
    expect(reports[0].recovery?.remedyId).toBe("fallback:cli-claude-code-scoop")
    expect(reports[0].recovery?.label).toBe("Install via scoop")
  })

  it("stops after the attempt cap and reports the ORIGINAL error", async () => {
    ;(api.runCommand as jest.Mock).mockImplementation(async (_cmd, onLine) => {
      onLine(NET_ERROR)
      return 1
    })

    const reports = await runSteps([npmStep], { dryRun: false, paths, recovery })

    expect(reports[0].status).toBe("error")
    expect(reports[0].recovery).toBeUndefined()
    // First try + 3 rungs, and no more.
    expect((api.runCommand as jest.Mock).mock.calls).toHaveLength(4)
    // The user sees what actually broke, not the last rung's noise.
    expect(reports[0].error).toContain("npm install -g @anthropic-ai/claude-code")
  })

  it("does NOT retry a failure that isn't the network's fault", async () => {
    ;(api.runCommand as jest.Mock).mockImplementation(async (_cmd, onLine) => {
      onLine("npm ERR! code EBADENGINE Unsupported engine")
      return 1
    })

    const reports = await runSteps([npmStep], { dryRun: false, paths, recovery })

    expect(reports[0].status).toBe("error")
    expect((api.runCommand as jest.Mock).mock.calls).toHaveLength(1)
  })

  it("does NOT retry a permission failure, which no mirror can fix", async () => {
    ;(api.runCommand as jest.Mock).mockImplementation(async (_cmd, onLine) => {
      // Mentions "connection reset" too, but rights are the real problem.
      onLine("npm ERR! Error: EACCES: permission denied")
      onLine("connection reset by peer")
      return 1
    })

    const reports = await runSteps([npmStep], { dryRun: false, paths, recovery })

    expect(reports[0].status).toBe("error")
    expect((api.runCommand as jest.Mock).mock.calls).toHaveLength(1)
  })

  it("stays completely inert when no recovery context is supplied", async () => {
    ;(api.runCommand as jest.Mock).mockImplementation(async (_cmd, onLine) => {
      onLine(NET_ERROR)
      return 1
    })

    const reports = await runSteps([npmStep], { dryRun: false, paths })

    expect(reports[0].status).toBe("error")
    expect((api.runCommand as jest.Mock).mock.calls).toHaveLength(1)
  })

  it("does not try to route around a failed verify probe", async () => {
    ;(api.runCommand as jest.Mock).mockImplementation(async (_cmd, onLine) => {
      onLine(NET_ERROR)
      return 1
    })
    const verify: StepDescriptor = {
      kind: "command",
      id: "verify",
      label: "claude --version",
      verifyOnly: true,
      command: { file: "claude", args: ["--version"] },
    }

    const reports = await runSteps([verify], { dryRun: false, paths, recovery })

    expect(reports[0].status).toBe("warning")
    expect((api.runCommand as jest.Mock).mock.calls).toHaveLength(1)
  })

  it("stops climbing the ladder once the run is cancelled", async () => {
    const ctrl = new AbortController()
    ;(api.runCommand as jest.Mock).mockImplementation(async (_cmd, onLine) => {
      onLine(NET_ERROR)
      ctrl.abort()
      return 1
    })

    const reports = await runSteps([npmStep], {
      dryRun: false,
      paths,
      recovery,
      signal: ctrl.signal,
    })

    expect((api.runCommand as jest.Mock).mock.calls).toHaveLength(1)
    expect(reports[0].status).toBe("skipped")
  })

  it("leaves dry-run untouched — a preview never retries anything", async () => {
    const reports = await runSteps([npmStep], { dryRun: true, paths, recovery })
    expect(reports[0].status).toBe("done")
    expect(api.runCommand).not.toHaveBeenCalled()
  })
})

/**
 * `releaseInstall` is the most side-effect-dense branch in the runner — two
 * resolution paths, a throttled progress callback, a download and an installer
 * exec, with four distinct throw sites — and it is the only kind that can put
 * the wrong-architecture binary on the machine. It had no runner test at all.
 */
describe("releaseInstall", () => {
  const base = {
    kind: "releaseInstall",
    id: "r",
    label: "Claude",
    title: "Claude",
    os: "mac",
    arch: "arm64",
  } as const
  const github = (mirrorPrefix: string | null = null): StepDescriptor => ({
    ...base,
    source: { kind: "github", repo: "owner/tool", asset: { mac: { pattern: "\\.dmg$" } } },
    mirrorPrefix,
  })

  beforeEach(() => {
    ;(api.downloadReleaseAsset as jest.Mock).mockResolvedValue("/tmp/Tool.dmg")
    ;(api.installPackage as jest.Mock).mockResolvedValue(0)
  })

  it("resolves a GitHub release, downloads the matching asset and installs it", async () => {
    ;(api.githubLatestRelease as jest.Mock).mockResolvedValue({
      tag: "v1.2.3",
      assets: [
        { name: "Tool-linux.AppImage", url: "https://x/linux" },
        { name: "Tool-mac.dmg", url: "https://x/mac" },
      ],
    })
    const reports = await runSteps([github()], { dryRun: false, paths })
    expect(reports[0].status).toBe("done")
    // The asset is picked by pattern, not by position.
    expect(api.downloadReleaseAsset).toHaveBeenCalledWith(
      "https://x/mac",
      "Tool-mac.dmg",
      null,
      expect.any(Function)
    )
    expect(api.installPackage).toHaveBeenCalledWith("/tmp/Tool.dmg", expect.any(Function))
  })

  it("fails loudly when no asset matches this OS and arch", async () => {
    ;(api.githubLatestRelease as jest.Mock).mockResolvedValue({
      tag: "v1.2.3",
      assets: [{ name: "Tool-windows.exe", url: "https://x/win" }],
    })
    const reports = await runSteps([github()], { dryRun: false, paths })
    expect(reports[0].status).toBe("error")
    // Better a clear failure than silently installing something for another arch.
    expect(reports[0].error).toContain("arm64")
    expect(api.downloadReleaseAsset).not.toHaveBeenCalled()
  })

  it("reports a non-zero installer exit as a failure", async () => {
    ;(api.githubLatestRelease as jest.Mock).mockResolvedValue({
      tag: "v1",
      assets: [{ name: "Tool-mac.dmg", url: "https://x/mac" }],
    })
    ;(api.installPackage as jest.Mock).mockResolvedValue(1)
    const reports = await runSteps([github()], { dryRun: false, paths })
    expect(reports[0].status).toBe("error")
  })

  // A mirror prefix rewrites github.com only; prepending it to a vendor's own
  // host would point the download at somewhere that never had the file.
  it("drops the mirror prefix for a vendor manifest", async () => {
    ;(api.manifestLatestRelease as jest.Mock).mockResolvedValue({
      tag: "v9",
      assets: [{ name: "Tool.dmg", url: "https://vendor.example/Tool.dmg" }],
    })
    const step: StepDescriptor = {
      ...base,
      source: { kind: "manifest", manifest: { mac: "https://vendor.example/RELEASES.json" } },
      mirrorPrefix: "https://gh-proxy.com/",
    }
    const reports = await runSteps([step], { dryRun: false, paths })
    expect(reports[0].status).toBe("done")
    expect(api.downloadReleaseAsset).toHaveBeenCalledWith(
      "https://vendor.example/Tool.dmg",
      "Tool.dmg",
      null,
      expect.any(Function)
    )
  })

  it("keeps the mirror prefix for a GitHub download", async () => {
    ;(api.githubLatestRelease as jest.Mock).mockResolvedValue({
      tag: "v1",
      assets: [{ name: "Tool-mac.dmg", url: "https://github.com/x" }],
    })
    await runSteps([github("https://gh-proxy.com/")], { dryRun: false, paths })
    expect(api.githubLatestRelease).toHaveBeenCalledWith("owner/tool", "https://gh-proxy.com/")
    expect(api.downloadReleaseAsset).toHaveBeenCalledWith(
      "https://github.com/x",
      "Tool-mac.dmg",
      "https://gh-proxy.com/",
      expect.any(Function)
    )
  })

  it("fails when the manifest has no entry for this OS, without calling out", async () => {
    const step: StepDescriptor = {
      ...base,
      source: { kind: "manifest", manifest: { win: "https://vendor.example/RELEASES.json" } },
      mirrorPrefix: null,
    }
    const reports = await runSteps([step], { dryRun: false, paths })
    expect(reports[0].status).toBe("error")
    expect(api.manifestLatestRelease).not.toHaveBeenCalled()
  })

  it("logs download progress in coarse steps rather than every percent", async () => {
    ;(api.githubLatestRelease as jest.Mock).mockResolvedValue({
      tag: "v1",
      assets: [{ name: "Tool-mac.dmg", url: "https://x/mac" }],
    })
    ;(api.downloadReleaseAsset as jest.Mock).mockImplementation(
      async (_u: string, _n: string, _m: string | null, onProgress: (p: unknown) => void) => {
        for (let received = 0; received <= 100; received++) onProgress({ received, total: 100 })
        return "/tmp/Tool.dmg"
      }
    )
    const reports = await runSteps([github()], { dryRun: false, paths })
    const pctLines = reports[0].output.filter((l) => /%/.test(l))
    // 101 progress events, but only ~10 lines: throttled to every 10%.
    expect(pctLines.length).toBeGreaterThan(0)
    expect(pctLines.length).toBeLessThanOrEqual(11)
  })
})

/** The rollback safety net — also previously untested in the runner. */
describe("snapshot", () => {
  it("takes a backup and names the entry it created", async () => {
    ;(api.backupSnapshot as jest.Mock).mockResolvedValue({ id: "snap-1" })
    const step: StepDescriptor = { kind: "snapshot", id: "s", label: "s", reason: "before import" }
    const reports = await runSteps([step], { dryRun: false, paths })
    expect(reports[0].status).toBe("done")
    expect(api.backupSnapshot).toHaveBeenCalledWith("before import")
    expect(reports[0].output.join("\n")).toContain("snap-1")
  })

  it("takes no backup at all on a dry run", async () => {
    const step: StepDescriptor = { kind: "snapshot", id: "s", label: "s", reason: "before import" }
    const reports = await runSteps([step], { dryRun: true, paths })
    expect(reports[0].status).toBe("done")
    expect(api.backupSnapshot).not.toHaveBeenCalled()
  })

  it("records the snapshot as this step's restore point", async () => {
    ;(api.backupSnapshot as jest.Mock).mockResolvedValue({ id: "snap-1" })
    const step: StepDescriptor = { kind: "snapshot", id: "s", label: "s", reason: "before import" }
    const reports = await runSteps([step], { dryRun: false, paths })
    expect(reports[0].artifact).toBe("snap-1")
  })
})

describe("snapshotRestore", () => {
  const step: StepDescriptor = {
    kind: "snapshotRestore",
    id: "r",
    label: "r",
    snapshotId: "snap-1",
  }

  it("restores every file and reports the restore point it created", async () => {
    ;(api.backupRestore as jest.Mock).mockResolvedValue({
      restoredPaths: ["/h/.claude/settings.json", "/h/.codex/config.toml"],
      safetySnapshotId: "snap-safety",
    })
    const reports = await runSteps([step], { dryRun: false, paths })
    expect(reports[0].status).toBe("done")
    expect(api.backupRestore).toHaveBeenCalledWith("snap-1")
    const log = reports[0].output.join("\n")
    expect(log).toContain("/h/.claude/settings.json")
    expect(log).toContain("/h/.codex/config.toml")
    // The undo is itself undoable, and the step says which snapshot to use.
    expect(log).toContain("snap-safety")
    expect(reports[0].artifact).toBe("snap-safety")
  })

  it("writes nothing on a dry run, and says what it would overwrite", async () => {
    const reports = await runSteps([step], { dryRun: true, paths })
    expect(reports[0].status).toBe("done")
    expect(api.backupRestore).not.toHaveBeenCalled()
    expect(reports[0].output.join("\n")).toContain("snap-1")
  })

  it("fails loudly rather than silently when the restore is refused", async () => {
    // Rust refuses while cc-switch is running, to avoid corrupting the DB
    // underneath it. That must surface as a failed step, not a green row.
    ;(api.backupRestore as jest.Mock).mockRejectedValue(new Error("cc-switch is running"))
    const reports = await runSteps([step], { dryRun: false, paths })
    expect(reports[0].status).toBe("error")
    expect(reports[0].artifact).toBeUndefined()
  })
})

/**
 * `writtenNote` was a required field set at 27 call sites in plan.ts and read by
 * nobody — the runner logged the bare path instead, so a run said
 * "wrote /Users/x/.claude.json" where it could have said what that write did.
 */
describe("mergeFile logging", () => {
  it("logs what the write meant rather than the file it touched", async () => {
    ;(api.readTextFile as jest.Mock).mockResolvedValue("{}")
    ;(api.pathExists as jest.Mock).mockResolvedValue(true)
    const steps: StepDescriptor[] = [
      {
        kind: "mergeFile",
        id: "m",
        label: "m",
        path: "/h/.claude.json",
        merge: (e) => e,
        writtenNote: "Added Context7 to Claude Code",
      },
    ]
    const reports = await runSteps(steps, { dryRun: false, paths })
    expect(reports[0].output).toContain("Added Context7 to Claude Code")
    expect(reports[0].output.join("\n")).not.toContain("wrote /h/.claude.json")
  })

  // ccVisibleApps shares this branch but carries no note of its own.
  it("falls back to naming the file when a step has no note", async () => {
    ;(api.readTextFile as jest.Mock).mockResolvedValue("{}")
    ;(api.pathExists as jest.Mock).mockResolvedValue(true)
    const steps: StepDescriptor[] = [
      { kind: "ccVisibleApps", id: "v", label: "v", path: "/cfg.json", merge: (e) => e },
    ]
    const reports = await runSteps(steps, { dryRun: false, paths })
    expect(reports[0].output.join("\n")).toContain("/cfg.json")
  })
})

describe("cleanup", () => {
  const step: StepDescriptor = {
    kind: "cleanup",
    id: "cleanup-quarantine",
    label: "clear 1.9 GB",
    mode: "quarantine",
    specs: [{ id: "codex-chats", path: "/h/.codex/sessions", olderThanDays: 30 }],
    entries: [{ path: "/h/.codex/sessions", bytes: 1_932_735_283, files: 900 }],
  }

  it("reports the quarantine batch as the run's restore point", async () => {
    ;(api.cleanupApply as jest.Mock).mockResolvedValue({
      quarantineId: "trash-42",
      bytes: 1_932_735_283,
      removed: 900,
      errors: [],
    })
    const reports = await runSteps([step], { dryRun: false, paths })
    expect(reports[0].status).toBe("done")
    expect(api.cleanupApply).toHaveBeenCalledWith(step.specs, "quarantine")
    const log = reports[0].output.join("\n")
    expect(log).toContain("1.8 GB")
    expect(log).toContain("trash-42")
    // The batch IS the restore point, so the activity log records it exactly
    // like a config snapshot.
    expect(reports[0].artifact).toBe("trash-42")
  })

  it("never claims a restore point for a permanent delete", async () => {
    ;(api.cleanupApply as jest.Mock).mockResolvedValue({
      quarantineId: null,
      bytes: 1_024,
      removed: 3,
      errors: [],
    })
    const reports = await runSteps([{ ...step, mode: "delete" }], { dryRun: false, paths })
    expect(reports[0].status).toBe("done")
    expect(api.cleanupApply).toHaveBeenCalledWith(step.specs, "delete")
    expect(reports[0].artifact).toBeUndefined()
    expect(reports[0].output.join("\n")).toContain("1.0 KB")
  })

  /**
   * A locked file must not abandon the other twelve gigabytes — but a run where
   * every path was skipped must not read as a clean success either.
   */
  it("logs a partial skip as done, and a total one as a warning", async () => {
    ;(api.cleanupApply as jest.Mock).mockResolvedValue({
      quarantineId: "trash-43",
      bytes: 10,
      removed: 1,
      errors: ["/h/.codex/logs_2.sqlite: resource busy"],
    })
    const partial = await runSteps([step], { dryRun: false, paths })
    expect(partial[0].status).toBe("done")
    expect(partial[0].output.join("\n")).toContain("resource busy")

    ;(api.cleanupApply as jest.Mock).mockResolvedValue({
      quarantineId: null,
      bytes: 0,
      removed: 0,
      errors: ["/h/.codex/logs_2.sqlite: resource busy"],
    })
    const nothing = await runSteps([step], { dryRun: false, paths })
    expect(nothing[0].status).toBe("warning")
  })

  it("touches nothing on a dry run, and names every path with its size", async () => {
    const reports = await runSteps([step], { dryRun: true, paths })
    expect(reports[0].status).toBe("done")
    expect(api.cleanupApply).not.toHaveBeenCalled()
    const log = reports[0].output.join("\n")
    expect(log).toContain("/h/.codex/sessions")
    expect(log).toContain("1.8 GB")
    // The closing line has to say the space is not free yet, or quarantine's
    // first impression is a promise it doesn't keep.
    expect(log).toContain("recoverable until you empty the recycle area")
  })
})
