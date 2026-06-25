import { buildClaudeMcpCommand, buildCodexMcpEntry, mergeCodexMcp } from "./mcp"
import { mergeClaudeSettings, mergeCodexProvider } from "./network"
import { findMcp } from "../registry"

it("http MCP adds bearer header for Claude", () => {
  const cmd = buildClaudeMcpCommand(findMcp("supermemory")!, "k")
  expect(cmd.args).toEqual(expect.arrayContaining(["--transport", "http"]))
  expect(cmd.args.join(" ")).toContain("Authorization: Bearer k")
})

it("codex stdio entry embeds env key", () => {
  const e = buildCodexMcpEntry(findMcp("context7")!, "abc") as Record<string, unknown>
  expect(e.command).toBe("npx")
  expect(e.env).toEqual({ CONTEXT7_API_KEY: "abc" })
})

it("mergeCodexMcp is idempotent per id", () => {
  let toml = mergeCodexMcp("", "context7", { command: "npx", args: [] })
  toml = mergeCodexMcp(toml, "context7", { command: "npx", args: ["x"] })
  expect((toml.match(/context7/g) ?? []).length).toBe(1)
})

it("mergeClaudeSettings sets env block", () => {
  const out = mergeClaudeSettings("", { apiBaseUrl: "https://r", apiToken: "t" })
  expect(JSON.parse(out).env.ANTHROPIC_BASE_URL).toBe("https://r")
  expect(JSON.parse(out).env.ANTHROPIC_AUTH_TOKEN).toBe("t")
})

it("mergeCodexProvider sets agentpack relay and references env key", () => {
  const out = mergeCodexProvider("", { apiBaseUrl: "https://r" })
  expect(out).toContain("agentpack")
  expect(out).toContain("AGENTPACK_API_KEY")
  expect(out).not.toContain("token")
})
