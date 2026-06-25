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
