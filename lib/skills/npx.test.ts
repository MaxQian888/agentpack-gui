import { npxSkillsAddCommand } from "./npx"

describe("npxSkillsAddCommand", () => {
  it("builds a global, non-interactive add with mapped agent names", () => {
    expect(npxSkillsAddCommand("vercel-labs/skills", ["claude", "codex"])).toEqual({
      file: "npx",
      args: ["-y", "skills", "add", "vercel-labs/skills", "-g", "-y", "-a", "claude-code", "codex"],
    })
  })

  it("maps opencode and drops the shared agents dir from the flag", () => {
    expect(npxSkillsAddCommand("o/r", ["opencode", "agents"]).args).toEqual([
      "-y",
      "skills",
      "add",
      "o/r",
      "-g",
      "-y",
      "-a",
      "opencode",
    ])
  })

  it("omits -a entirely when no target maps to a CLI agent", () => {
    expect(npxSkillsAddCommand("o/r", ["agents"]).args).toEqual([
      "-y",
      "skills",
      "add",
      "o/r",
      "-g",
      "-y",
    ])
  })
})
