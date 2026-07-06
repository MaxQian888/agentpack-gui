import type {
  CliInstallManager,
  CliTool,
  Command,
  InstallMethod,
  McpCategory,
  McpServer,
  OS,
  Runtime,
  SkillDef,
} from "./types"

/**
 * The three package-manager install methods for an npm-published global CLI.
 * npm is the cross-platform default; pnpm/bun are npm-compatible alternatives
 * for users who prefer them (the same published package, different installer).
 */
function pmMethods(pkg: string): InstallMethod[] {
  return [
    { id: "npm", command: { file: "npm", args: ["install", "-g", pkg] } },
    { id: "pnpm", command: { file: "pnpm", args: ["add", "-g", pkg] } },
    { id: "bun", command: { file: "bun", args: ["add", "-g", pkg] } },
  ]
}

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
    // winget installs Node machine-wide and needs admin (UAC); scoop is a
    // user-scope alternative that never triggers elevation. Offer both so a
    // non-admin user isn't stuck when winget's install is declined/blocked.
    methods: {
      win: [
        {
          id: "winget",
          command: {
            file: "winget",
            args: [
              "install",
              "-e",
              "--id",
              "OpenJS.NodeJS.LTS",
              "--accept-source-agreements",
              "--accept-package-agreements",
              "--disable-interactivity",
            ],
          },
          requiresElevation: true,
        },
        { id: "scoop", command: { file: "scoop", args: ["install", "nodejs-lts"] } },
      ],
    },
    // In-place update for an installed Node: winget/brew upgrade the same package
    // the install step used. The runner auto-elevates any `winget upgrade`.
    upgrade: {
      win: {
        file: "winget",
        args: [
          "upgrade",
          "-e",
          "--id",
          "OpenJS.NodeJS.LTS",
          "--accept-source-agreements",
          "--accept-package-agreements",
          "--disable-interactivity",
        ],
      },
      mac: { file: "brew", args: ["upgrade", "node"] },
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
    // Bun self-updates in place, no package manager needed.
    upgrade: {
      win: { file: "bun", args: ["upgrade"] },
      mac: { file: "bun", args: ["upgrade"] },
      linux: { file: "bun", args: ["upgrade"] },
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
    upgrade: {
      win: {
        file: "winget",
        args: [
          "upgrade",
          "-e",
          "--id",
          "Python.Python.3.13",
          "--accept-source-agreements",
          "--accept-package-agreements",
          "--disable-interactivity",
        ],
      },
      mac: { file: "brew", args: ["upgrade", "python"] },
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
    // uv ships its own updater regardless of how it was installed.
    upgrade: {
      win: { file: "uv", args: ["self", "update"] },
      mac: { file: "uv", args: ["self", "update"] },
      linux: { file: "uv", args: ["self", "update"] },
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
    // Package-manager choice (npm default) plus Anthropic's official native
    // installer as a fallback for machines without Node. Native URLs are the
    // documented ones at code.claude.com/docs/en/setup.
    methods: {
      win: [
        ...pmMethods("@anthropic-ai/claude-code"),
        {
          id: "native",
          command: { file: "powershell", args: ["-c", "irm https://claude.ai/install.ps1 | iex"] },
        },
      ],
      mac: [
        ...pmMethods("@anthropic-ai/claude-code"),
        {
          id: "native",
          command: { file: "bash", args: ["-c", "curl -fsSL https://claude.ai/install.sh | bash"] },
        },
      ],
      linux: [
        ...pmMethods("@anthropic-ai/claude-code"),
        {
          id: "native",
          command: { file: "bash", args: ["-c", "curl -fsSL https://claude.ai/install.sh | bash"] },
        },
      ],
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
    // Package-manager choice (npm default) plus OpenAI's official native
    // installer (chatgpt.com/codex/install.*) for machines without Node.
    methods: {
      win: [
        ...pmMethods("@openai/codex"),
        {
          id: "native",
          command: {
            file: "powershell",
            args: [
              "-ExecutionPolicy",
              "ByPass",
              "-c",
              "irm https://chatgpt.com/codex/install.ps1 | iex",
            ],
          },
        },
      ],
      mac: [
        ...pmMethods("@openai/codex"),
        {
          id: "native",
          command: {
            file: "bash",
            args: ["-c", "curl -fsSL https://chatgpt.com/codex/install.sh | sh"],
          },
        },
      ],
      linux: [
        ...pmMethods("@openai/codex"),
        {
          id: "native",
          command: {
            file: "bash",
            args: ["-c", "curl -fsSL https://chatgpt.com/codex/install.sh | sh"],
          },
        },
      ],
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
 * The order categories are shown in the MCP management UI. Every `McpCategory`
 * must appear here (the section iterates this list); a server whose category is
 * missing would silently never render, so keep this in sync with the type.
 */
export const MCP_CATEGORY_ORDER: readonly McpCategory[] = [
  "memory",
  "search",
  "web",
  "dev",
  "reasoning",
]

/**
 * MCP server catalog. stdio servers run via `npx -y <package>`; http servers
 * point at a remote URL. `keyEnv` names the env var a required API key maps to.
 * `category` buckets the server in the management UI; `docsUrl` links its docs.
 */
export const MCP_SERVERS: readonly McpServer[] = [
  {
    id: "supermemory",
    transport: "http",
    category: "memory",
    url: "https://mcp.supermemory.ai/mcp",
    keyEnv: "SUPERMEMORY_API_KEY",
    docsUrl: "https://supermemory.ai",
  },
  {
    id: "memory",
    transport: "stdio",
    category: "memory",
    npmPackage: "@modelcontextprotocol/server-memory",
    docsUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/memory",
  },
  {
    id: "context7",
    transport: "stdio",
    category: "search",
    npmPackage: "@upstash/context7-mcp",
    keyEnv: "CONTEXT7_API_KEY",
    docsUrl: "https://github.com/upstash/context7",
  },
  {
    id: "sequential-thinking",
    transport: "stdio",
    category: "reasoning",
    npmPackage: "@modelcontextprotocol/server-sequential-thinking",
    docsUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking",
  },
  {
    id: "fetch",
    transport: "stdio",
    category: "web",
    npmPackage: "@modelcontextprotocol/server-fetch",
    docsUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/fetch",
  },
  {
    id: "filesystem",
    transport: "stdio",
    category: "dev",
    npmPackage: "@modelcontextprotocol/server-filesystem",
    extraArgs: ["."],
    docsUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
  },
  {
    id: "exa",
    transport: "stdio",
    category: "search",
    npmPackage: "exa-mcp-server",
    keyEnv: "EXA_API_KEY",
    docsUrl: "https://github.com/exa-labs/exa-mcp-server",
  },
  {
    id: "tavily",
    transport: "stdio",
    category: "search",
    npmPackage: "tavily-mcp",
    keyEnv: "TAVILY_API_KEY",
    docsUrl: "https://github.com/tavily-ai/tavily-mcp",
  },
  {
    id: "brave-search",
    transport: "stdio",
    category: "search",
    npmPackage: "@modelcontextprotocol/server-brave-search",
    keyEnv: "BRAVE_API_KEY",
    docsUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search",
  },
  {
    id: "github",
    transport: "stdio",
    category: "dev",
    npmPackage: "@modelcontextprotocol/server-github",
    keyEnv: "GITHUB_PERSONAL_ACCESS_TOKEN",
    docsUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/github",
  },
  {
    id: "playwright",
    transport: "stdio",
    category: "web",
    npmPackage: "@playwright/mcp",
    docsUrl: "https://github.com/microsoft/playwright-mcp",
  },
]

/**
 * The install methods available for a tool on the given OS, most-recommended
 * first. Uses the tool's explicit `methods[os]` when present; otherwise wraps
 * its single `install[os]` command as one "default" method (so tools that only
 * have one way to install keep working). Empty when there's no automated path.
 */
export function installMethodsFor(
  tool: Pick<CliTool, "install" | "methods">,
  os: OS
): InstallMethod[] {
  const explicit = tool.methods?.[os]
  if (explicit && explicit.length > 0) return explicit
  const cmd = tool.install[os]
  return cmd ? [{ id: "default", command: cmd }] : []
}

/**
 * The command to UPGRADE an already-installed CLI, matched to how it was
 * installed so no duplicate binary is left behind:
 *  - `native` (installed by the native script) → re-run that script, which
 *    installs the latest version in place.
 *  - `npm` / unknown → the npm `@latest` upgrade (or the plain install as a
 *    last resort). Unknown defaults here so a not-yet-detected CLI keeps the
 *    safe, pre-existing npm behavior.
 * Returns undefined when the tool has no automated path on this OS.
 */
export function upgradeCommandFor(
  tool: CliTool,
  os: OS,
  manager: CliInstallManager | undefined
): Command | undefined {
  if (manager === "native") {
    const native = tool.methods?.[os]?.find((m) => m.id === "native")
    if (native) return native.command
  }
  return tool.upgrade?.[os] ?? tool.install[os] ?? undefined
}

/**
 * The in-place UPDATE command for an already-installed runtime on this OS, or
 * undefined when there's no automated update path (the UI hides the action).
 */
export function runtimeUpgradeCommandFor(rt: Runtime, os: OS): Command | undefined {
  return rt.upgrade?.[os]
}

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
