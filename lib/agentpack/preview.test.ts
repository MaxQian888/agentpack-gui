import { previewLines, commandToString } from "./preview"
import type { Paths, StepDescriptor } from "./types"

const paths = {
  home: "/h",
  claudeSkillsDir: "/h/.claude/skills",
  codexSkillsDir: "/h/.codex/skills",
} as Paths

it("command preview shows would run", () => {
  const s: StepDescriptor = {
    kind: "command",
    id: "x",
    label: "x",
    command: { file: "npm", args: ["i", "-g", "x"] },
  }
  expect(previewLines(s, paths)).toContain("would run: npm i -g x")
})

it("mergeFile preview shows would write path", () => {
  const s: StepDescriptor = {
    kind: "mergeFile",
    id: "x",
    label: "x",
    path: "/h/.codex/config.toml",
    merge: (e) => e,
    writtenNote: "",
  }
  expect(previewLines(s, paths)).toEqual(["would write /h/.codex/config.toml"])
})

it("quoting wraps args with spaces", () => {
  expect(
    commandToString({ file: "claude", args: ["--header", "Authorization: Bearer k"] })
  ).toContain('"Authorization: Bearer k"')
})

it("info preview returns the lines verbatim", () => {
  const s: StepDescriptor = { kind: "info", id: "i", label: "i", lines: ["a", "b"] }
  expect(previewLines(s, paths)).toEqual(["a", "b"])
})

it("ccVisibleApps preview shows would write", () => {
  const s: StepDescriptor = {
    kind: "ccVisibleApps",
    id: "v",
    label: "v",
    path: "/cfg.json",
    merge: (e) => e,
  }
  expect(previewLines(s, paths)).toEqual(["would write /cfg.json"])
})

it("skillInstall preview maps each target to its skills dir", () => {
  const s: StepDescriptor = {
    kind: "skillInstall",
    id: "s",
    label: "s",
    skillId: "rust",
    targets: ["claude", "codex"],
  }
  const lines = previewLines(s, paths)
  expect(lines).toHaveLength(2)
  expect(lines[0]).toContain("/h/.claude/skills/rust")
  expect(lines[1]).toContain("/h/.codex/skills/rust")
})

it("skillRemove preview lists each dest", () => {
  const s: StepDescriptor = {
    kind: "skillRemove",
    id: "s",
    label: "s",
    skillId: "rust",
    targets: ["claude"],
    dests: ["/h/.claude/skills/rust"],
  }
  expect(previewLines(s, paths)).toEqual(["would delete /h/.claude/skills/rust"])
})

it("ccProvider preview names the op and app", () => {
  const s: StepDescriptor = {
    kind: "ccProvider",
    id: "p",
    label: "p",
    op: "add",
    payload: { app: "claude" },
  }
  expect(previewLines(s, paths)).toEqual(["would run: add provider (claude)"])
})

it("ccProvider preview tolerates a missing app", () => {
  const s: StepDescriptor = {
    kind: "ccProvider",
    id: "p",
    label: "p",
    op: "delete",
    payload: {},
  }
  expect(previewLines(s, paths)).toEqual(["would run: delete provider ()"])
})

it("fileRestore preview shows would restore from backup", () => {
  const s: StepDescriptor = {
    kind: "fileRestore",
    id: "r",
    label: "r",
    path: "/h/.codex/config.toml",
    backupPath: "/h/.codex/config.toml.agentpack.bak",
  }
  expect(previewLines(s, paths)).toEqual([
    "would restore /h/.codex/config.toml.agentpack.bak -> /h/.codex/config.toml",
  ])
})
