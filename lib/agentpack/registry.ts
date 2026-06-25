import type { CliTool, McpServer, SkillDef } from "./types"

/**
 * Installable CLI tools.
 *
 * Cross-platform default for the agent CLIs is `npm i -g`, which works on every
 * OS that has Node. cc-switch is a Tauri desktop GUI, so it uses the platform's
 * app package manager.
 */
export const CLI_TOOLS: readonly CliTool[] = [
  {
    id: "claude-code",
    bin: "claude",
    npmPackage: "@anthropic-ai/claude-code",
    install: {
      win: { file: "npm", args: ["install", "-g", "@anthropic-ai/claude-code"] },
      mac: { file: "npm", args: ["install", "-g", "@anthropic-ai/claude-code"] },
      linux: { file: "npm", args: ["install", "-g", "@anthropic-ai/claude-code"] },
    },
    upgrade: {
      win: { file: "npm", args: ["install", "-g", "@anthropic-ai/claude-code@latest"] },
      mac: { file: "npm", args: ["install", "-g", "@anthropic-ai/claude-code@latest"] },
      linux: { file: "npm", args: ["install", "-g", "@anthropic-ai/claude-code@latest"] },
    },
  },
  {
    id: "codex",
    bin: "codex",
    npmPackage: "@openai/codex",
    install: {
      win: { file: "npm", args: ["install", "-g", "@openai/codex"] },
      mac: { file: "npm", args: ["install", "-g", "@openai/codex"] },
      linux: { file: "npm", args: ["install", "-g", "@openai/codex"] },
    },
    upgrade: {
      win: { file: "npm", args: ["install", "-g", "@openai/codex@latest"] },
      mac: { file: "npm", args: ["install", "-g", "@openai/codex@latest"] },
      linux: { file: "npm", args: ["install", "-g", "@openai/codex@latest"] },
    },
  },
  {
    id: "cc-switch",
    bin: "cc-switch",
    gui: true,
    install: {
      win: { file: "winget", args: ["install", "-e", "--id", "farion1231.CC-Switch"] },
      mac: { file: "brew", args: ["install", "--cask", "cc-switch"] },
      linux: null,
    },
    manualNote:
      "On Linux, download the .deb / .AppImage from https://github.com/farion1231/cc-switch/releases",
  },
]

/** Bundled domain skills (content lives in assets/skills/<id>/SKILL.md; display text in i18n catalog). */
export const SKILLS: readonly SkillDef[] = [
  { id: "cpp-cmake" },
  { id: "python" },
  { id: "android" },
  { id: "stm32-c" },
  { id: "rust" },
  { id: "web-frontend" },
]

/**
 * MCP server catalog. stdio servers run via `npx -y <package>`; http servers
 * point at a remote URL. `keyEnv` names the env var a required API key maps to.
 */
export const MCP_SERVERS: readonly McpServer[] = [
  {
    id: "supermemory",
    transport: "http",
    url: "https://mcp.supermemory.ai/mcp",
    keyEnv: "SUPERMEMORY_API_KEY",
  },
  {
    id: "memory",
    transport: "stdio",
    npmPackage: "@modelcontextprotocol/server-memory",
  },
  {
    id: "context7",
    transport: "stdio",
    npmPackage: "@upstash/context7-mcp",
    keyEnv: "CONTEXT7_API_KEY",
  },
  {
    id: "sequential-thinking",
    transport: "stdio",
    npmPackage: "@modelcontextprotocol/server-sequential-thinking",
  },
  {
    id: "fetch",
    transport: "stdio",
    npmPackage: "@modelcontextprotocol/server-fetch",
  },
  {
    id: "filesystem",
    transport: "stdio",
    npmPackage: "@modelcontextprotocol/server-filesystem",
    extraArgs: ["."],
  },
  {
    id: "exa",
    transport: "stdio",
    npmPackage: "exa-mcp-server",
    keyEnv: "EXA_API_KEY",
  },
  {
    id: "tavily",
    transport: "stdio",
    npmPackage: "tavily-mcp",
    keyEnv: "TAVILY_API_KEY",
  },
  {
    id: "brave-search",
    transport: "stdio",
    npmPackage: "@modelcontextprotocol/server-brave-search",
    keyEnv: "BRAVE_API_KEY",
  },
  {
    id: "github",
    transport: "stdio",
    npmPackage: "@modelcontextprotocol/server-github",
    keyEnv: "GITHUB_PERSONAL_ACCESS_TOKEN",
  },
  {
    id: "playwright",
    transport: "stdio",
    npmPackage: "@playwright/mcp",
  },
]

export function findCli(id: string): CliTool | undefined {
  return CLI_TOOLS.find((c) => c.id === id)
}

export function findSkill(id: string): SkillDef | undefined {
  return SKILLS.find((s) => s.id === id)
}

export function findMcp(id: string): McpServer | undefined {
  return MCP_SERVERS.find((m) => m.id === id)
}
