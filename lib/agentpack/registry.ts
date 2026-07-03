import type { CliTool, McpServer, Runtime, SkillDef } from "./types"

/**
 * Language runtimes the agent CLIs depend on. Node (with npm) is the base
 * runtime every npm-installed CLI needs; Bun is an optional faster alternative.
 * Python (+ uv) powers Python-based MCP servers and tooling.
 *
 * Install strategy: Node/Python use the OS app manager (winget/brew); Bun and
 * uv use their official installers on every OS (PowerShell on Windows,
 * `curl … | sh` on macOS/Linux). `null` => no automated path.
 */
export const RUNTIMES: readonly Runtime[] = [
  {
    id: "node",
    bin: "node",
    install: {
      win: {
        file: "winget",
        args: [
          "install",
          "-e",
          "--id",
          "OpenJS.NodeJS.LTS",
          // Non-interactive: skip winget's first-run source/package agreement
          // prompts (a Y/N on stdin the windowless GUI child can't answer).
          "--accept-source-agreements",
          "--accept-package-agreements",
          "--disable-interactivity",
        ],
      },
      mac: { file: "brew", args: ["install", "node"] },
      linux: null,
    },
    manualNote:
      "On Linux, install Node.js via your package manager or nvm — see https://nodejs.org/en/download",
  },
  {
    id: "bun",
    bin: "bun",
    install: {
      // PowerShell installer; the script string is quoted (it contains spaces),
      // so the `|` stays inside quotes and cmd /c does not treat it as a pipe.
      win: { file: "powershell", args: ["-c", "irm bun.sh/install.ps1 | iex"] },
      mac: { file: "bash", args: ["-c", "curl -fsSL https://bun.sh/install | bash"] },
      linux: { file: "bash", args: ["-c", "curl -fsSL https://bun.sh/install | bash"] },
    },
    manualNote: "See https://bun.sh for manual installation instructions.",
  },
  {
    id: "python",
    bin: "python",
    // macOS/Linux usually expose only `python3`.
    altBin: "python3",
    install: {
      win: {
        file: "winget",
        args: [
          "install",
          "-e",
          "--id",
          "Python.Python.3.13",
          "--accept-source-agreements",
          "--accept-package-agreements",
          "--disable-interactivity",
        ],
      },
      mac: { file: "brew", args: ["install", "python"] },
      linux: null,
    },
    manualNote:
      "On Linux, install Python 3 via your package manager (apt/dnf/pacman) — see https://www.python.org/downloads/",
  },
  {
    id: "uv",
    bin: "uv",
    install: {
      win: { file: "powershell", args: ["-c", "irm https://astral.sh/uv/install.ps1 | iex"] },
      mac: { file: "bash", args: ["-c", "curl -LsSf https://astral.sh/uv/install.sh | sh"] },
      linux: { file: "bash", args: ["-c", "curl -LsSf https://astral.sh/uv/install.sh | sh"] },
    },
    manualNote: "See https://docs.astral.sh/uv/getting-started/installation/ for manual install.",
  },
]

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
    uninstall: {
      win: { file: "npm", args: ["uninstall", "-g", "@anthropic-ai/claude-code"] },
      mac: { file: "npm", args: ["uninstall", "-g", "@anthropic-ai/claude-code"] },
      linux: { file: "npm", args: ["uninstall", "-g", "@anthropic-ai/claude-code"] },
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
    uninstall: {
      win: { file: "npm", args: ["uninstall", "-g", "@openai/codex"] },
      mac: { file: "npm", args: ["uninstall", "-g", "@openai/codex"] },
      linux: { file: "npm", args: ["uninstall", "-g", "@openai/codex"] },
    },
  },
  {
    id: "cc-switch",
    bin: "cc-switch",
    gui: true,
    install: {
      win: {
        file: "winget",
        args: [
          "install",
          "-e",
          "--id",
          "farion1231.CC-Switch",
          "--accept-source-agreements",
          "--accept-package-agreements",
          "--disable-interactivity",
        ],
      },
      mac: { file: "brew", args: ["install", "--cask", "cc-switch"] },
      linux: null,
    },
    uninstall: {
      win: {
        file: "winget",
        args: [
          "uninstall",
          "-e",
          "--id",
          "farion1231.CC-Switch",
          "--accept-source-agreements",
          "--disable-interactivity",
        ],
      },
      mac: { file: "brew", args: ["uninstall", "--cask", "cc-switch"] },
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

export function findRuntime(id: string): Runtime | undefined {
  return RUNTIMES.find((r) => r.id === id)
}

export function findSkill(id: string): SkillDef | undefined {
  return SKILLS.find((s) => s.id === id)
}

export function findMcp(id: string): McpServer | undefined {
  return MCP_SERVERS.find((m) => m.id === id)
}
