import { CLI_KINDS } from "./types"
import type {
  CliInstallManager,
  CliKind,
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

/** The same value under every OS key, for tools that install identically everywhere. */
function everyOs<T>(make: () => T): Record<OS, T> {
  return { win: make(), mac: make(), linux: make() }
}

/**
 * The whole lifecycle of a CLI published as a global npm package: install,
 * the three package-manager channels, the `@latest` upgrade and the uninstall,
 * on all three platforms.
 *
 * Every npm-based agent here installs the same way on every OS, so writing the
 * twelve commands out per tool was pure repetition — and a place for a typo to
 * hide, since a package name that differs between install and uninstall leaves
 * the old copy on PATH. One name in, one consistent set out.
 */
function npmCli(pkg: string): Pick<CliTool, "install" | "methods" | "upgrade" | "uninstall"> {
  return {
    install: everyOs(() => ({ file: "npm", args: ["install", "-g", pkg] })),
    methods: everyOs(() => pmMethods(pkg)),
    upgrade: everyOs(() => ({ file: "npm", args: ["install", "-g", `${pkg}@latest`] })),
    uninstall: everyOs(() => ({ file: "npm", args: ["uninstall", "-g", pkg] })),
  }
}

/**
 * The package-manager channels plus the vendor's own install script, which is
 * the only route on a machine with no Node at all. `native` is deliberately
 * last: it is the fallback, not the recommendation, and `routeOf` treats it as a
 * different network route so a failed npm install can retry through it.
 */
function pmAndNativeMethods(
  pkg: string,
  native: Record<OS, Command>
): Partial<Record<OS, InstallMethod[]>> {
  return {
    win: [...pmMethods(pkg), { id: "native", command: native.win }],
    mac: [...pmMethods(pkg), { id: "native", command: native.mac }],
    linux: [...pmMethods(pkg), { id: "native", command: native.linux }],
  }
}

/**
 * A vendor's own installer scripts: `curl … | <shell>` on macOS/Linux, `irm … |
 * iex` on Windows. `shell` follows the script's own shebang — piping a
 * `#!/usr/bin/env sh` script into bash mostly works, but "mostly" is not a
 * property to rely on for the only install route a tool has.
 */
function scriptInstall(
  shUrl: string,
  ps1Url: string,
  shell: "bash" | "sh" = "bash"
): Record<OS, Command> {
  // The whole pipeline is one quoted argument (it contains spaces), so the `|`
  // stays inside the string and `cmd /c` does not treat it as a shell pipe.
  const posix: Command = { file: "bash", args: ["-c", `curl -fsSL ${shUrl} | ${shell}`] }
  return {
    win: { file: "powershell", args: ["-c", `irm ${ps1Url} | iex`] },
    mac: posix,
    linux: posix,
  }
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
    id: "windows-terminal",
    platforms: ["win"],
    bin: "wt",
    // `wt --version` opens a window instead of reporting a version. GUI mode
    // makes detection use PATH + Get-AppxPackage without executing Terminal.
    gui: true,
    appBundles: [{ name: "Microsoft.WindowsTerminal" }],
    install: {
      win: {
        file: "winget",
        args: [
          "install",
          "-e",
          "--id",
          "Microsoft.WindowsTerminal",
          "--scope",
          "user",
          "--accept-source-agreements",
          "--accept-package-agreements",
          "--disable-interactivity",
        ],
      },
      mac: null,
      linux: null,
    },
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
              "Microsoft.WindowsTerminal",
              "--scope",
              "user",
              "--accept-source-agreements",
              "--accept-package-agreements",
              "--disable-interactivity",
            ],
          },
        },
        {
          id: "store",
          command: {
            file: "powershell",
            args: [
              "-NoProfile",
              "-Command",
              "Start-Process 'ms-windows-store://pdp/?ProductId=9N0DX20HK701'",
            ],
          },
        },
      ],
    },
    upgrade: {
      win: {
        file: "winget",
        args: [
          "upgrade",
          "-e",
          "--id",
          "Microsoft.WindowsTerminal",
          "--scope",
          "user",
          "--accept-source-agreements",
          "--accept-package-agreements",
          "--disable-interactivity",
        ],
      },
    },
    downloadUrl: "https://learn.microsoft.com/windows/terminal/install",
  },
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
    downloadUrl: "https://nodejs.org/en/download",
    manualNote:
      "On Linux, install Node.js via your package manager or nvm — see https://nodejs.org/en/download",
  },
  {
    id: "bun",
    bin: "bun",
    install: {
      // PowerShell installer; the script string is quoted (it contains spaces),
      // so the `|` stays inside quotes and cmd /c does not treat it as a pipe.
      win: { file: "powershell", args: ["-c", "irm bun.com/install.ps1 | iex"] },
      mac: { file: "bash", args: ["-c", "curl -fsSL https://bun.com/install | bash"] },
      linux: { file: "bash", args: ["-c", "curl -fsSL https://bun.com/install | bash"] },
    },
    // Bun self-updates in place, no package manager needed.
    upgrade: {
      win: { file: "bun", args: ["upgrade"] },
      mac: { file: "bun", args: ["upgrade"] },
      linux: { file: "bun", args: ["upgrade"] },
    },
    manualNote: "See https://bun.com for manual installation instructions.",
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
          "Python.Python.3.14",
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
          // Match the installed Python by FAMILY, not the pinned install minor:
          // winget publishes each minor as its own package (Python.Python.3.15),
          // so `-e --id Python.Python.3.14` would refuse to update a 3.15 install
          // ("no installed package found"). A substring `--id Python.Python.3`
          // (no `-e`) targets whatever 3.x is installed. This same id drives the
          // ownership check (runtimePkgManager reads it), so a winget-installed
          // 3.15 is correctly recognized as updatable instead of unmanaged.
          "--id",
          "Python.Python.3",
          "--accept-source-agreements",
          "--accept-package-agreements",
          "--disable-interactivity",
        ],
      },
      mac: { file: "brew", args: ["upgrade", "python"] },
    },
    downloadUrl: "https://www.python.org/downloads/",
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
    kind: "agent",
    bin: "claude",
    npmPackage: "@anthropic-ai/claude-code",
    // package.json engines: { node: ">=22.0.0" }
    minNodeMajor: 22,
    ...npmCli("@anthropic-ai/claude-code"),
    // Package-manager choice (npm default) plus Anthropic's official native
    // installer as a fallback for machines without Node. Native URLs are the
    // documented ones at code.claude.com/docs/en/setup.
    methods: pmAndNativeMethods(
      "@anthropic-ai/claude-code",
      scriptInstall("https://claude.ai/install.sh", "https://claude.ai/install.ps1")
    ),
  },
  // ── Desktop apps ───────────────────────────────────────────────────────────
  //
  // These sit ALONGSIDE the CLIs above rather than replacing them. The desktop
  // app bundles its own copy of the agent — no Node, no CLI, no terminal — and
  // reads the same `~/.claude` / `~/.codex` config, so skills and MCP servers
  // written for the CLI already apply to it.
  {
    id: "claude-desktop",
    kind: "agent",
    // Nothing lands on PATH; `appBundles` is what detection actually uses.
    bin: "claude-desktop",
    gui: true,
    appBundles: [{ name: "Claude" }],
    install: {
      // winget ships with Windows 10+, so unlike brew this needs no prerequisite.
      win: {
        file: "winget",
        args: [
          "install",
          "-e",
          "--id",
          "Anthropic.Claude",
          "--accept-source-agreements",
          "--accept-package-agreements",
          "--disable-interactivity",
        ],
      },
      // Homebrew is the fallback, NOT the default — see `release` below. A user
      // who needs an app installed for them is unlikely to already have brew,
      // and bootstrapping brew costs more than the app it would install.
      mac: { file: "brew", args: ["install", "--cask", "claude"] },
      linux: null,
    },
    uninstall: {
      win: {
        file: "winget",
        args: [
          "uninstall",
          "-e",
          "--id",
          "Anthropic.Claude",
          "--accept-source-agreements",
          "--disable-interactivity",
        ],
      },
      mac: { file: "brew", args: ["uninstall", "--cask", "claude"] },
    },
    // Anthropic publish a Squirrel manifest naming the current build, and it is
    // plainly reachable. Their *documented* download links are not: every one of
    // them answers 403 to a non-browser client, so they can't be used here.
    release: {
      kind: "manifest",
      manifest: { mac: "https://downloads.claude.ai/releases/darwin/universal/RELEASES.json" },
    },
    manualNote:
      "On Linux, Claude Desktop is in beta — see https://code.claude.com/docs/en/desktop-linux",
  },
  {
    id: "codex-app",
    kind: "agent",
    bin: "codex-app",
    gui: true,
    // OpenAI merged the Codex app into the ChatGPT desktop app in July 2026:
    // Codex is now a view inside it, the standalone `codex-app` cask is
    // deprecated ("discontinued upstream", disabled 2027-07-12) in favour of
    // `chatgpt`, and a machine that took the update has `ChatGPT.app` where
    // `Codex.app` used to be. Detection looked only for `Codex.app`, so on an
    // up-to-date Mac the app it was standing in front of read as not installed.
    //
    // Both names, then — but the ChatGPT one only counts when the bundle really
    // carries Codex. A ChatGPT install from before the merge is a chat client
    // with no agent in it, and reporting THAT as the Codex app would take the
    // install button away from the person who most needs it. Two markers because
    // a vendor moves payloads around between releases; either one identifies it.
    appBundles: [
      {
        name: "ChatGPT",
        requires: ["Contents/Resources/codex", "Contents/Frameworks/Codex Framework.framework"],
      },
      // Machines that haven't taken the update still carry the standalone app.
      { name: "Codex" },
    ],
    install: {
      // No winget package exists for the APP — `OpenAI.Codex` there is the CLI,
      // and the merged desktop app ships through the Microsoft Store. Nothing to
      // automate on Windows, so the plan surfaces a manual note.
      win: null,
      mac: { file: "brew", args: ["install", "--cask", "chatgpt"] },
      linux: null,
    },
    uninstall: {
      mac: { file: "brew", args: ["uninstall", "--cask", "chatgpt"] },
    },
    // No manifest endpoint to resolve (probed: 404), so brew is the only
    // automated route and there is no proxy-resilient fallback below it.
    manualNote:
      "Codex now ships inside the ChatGPT desktop app — download it from https://chatgpt.com/download",
  },
  {
    id: "codex",
    kind: "agent",
    bin: "codex",
    npmPackage: "@openai/codex",
    ...npmCli("@openai/codex"),
    // Package-manager choice (npm default) plus OpenAI's official native
    // installer (chatgpt.com/codex/install.*) for machines without Node. Spelled
    // out rather than built from `scriptInstall`: the Windows script needs an
    // explicit execution policy, and the POSIX one is piped into `sh`.
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
  },
  {
    id: "opencode",
    kind: "agent",
    bin: "opencode",
    npmPackage: "opencode-ai",
    ...npmCli("opencode-ai"),
  },
  // ── Other terminal agents ──────────────────────────────────────────────────
  //
  // Every entry below is a live, vendor-published agent (checked against its
  // publisher, and re-checked weekly by `pnpm audit:catalog`). agentpack
  // installs, upgrades and removes them; it does NOT write skills or MCP servers
  // into them — the three above are the ones whose config surfaces this app
  // knows how to write, which is exactly what `McpTarget` names.
  {
    id: "gemini-cli",
    kind: "agent",
    bin: "gemini",
    npmPackage: "@google/gemini-cli",
    // package.json engines: { node: ">=20" }
    minNodeMajor: 20,
    ...npmCli("@google/gemini-cli"),
  },
  {
    id: "qwen-code",
    kind: "agent",
    bin: "qwen",
    npmPackage: "@qwen-code/qwen-code",
    // package.json engines: { node: ">=22.0.0" }
    minNodeMajor: 22,
    ...npmCli("@qwen-code/qwen-code"),
  },
  {
    id: "copilot-cli",
    kind: "agent",
    bin: "copilot",
    npmPackage: "@github/copilot",
    // No `engines` field is published, so npm won't refuse the install on an old
    // Node and there is no floor to check — leaving `minNodeMajor` unset keeps
    // the plan from blocking an install npm would have allowed.
    ...npmCli("@github/copilot"),
  },
  {
    id: "crush",
    kind: "agent",
    bin: "crush",
    npmPackage: "@charmland/crush",
    ...npmCli("@charmland/crush"),
  },
  {
    id: "amp",
    kind: "agent",
    bin: "amp",
    // `@sourcegraph/amp` is the OLD name and now only re-points at this one —
    // installing it would pin a stub. See ampcode.com/news/npm-package-changes.
    npmPackage: "@ampcode/cli",
    ...npmCli("@ampcode/cli"),
    methods: pmAndNativeMethods(
      "@ampcode/cli",
      scriptInstall("https://ampcode.com/install.sh", "https://ampcode.com/install.ps1")
    ),
  },
  {
    id: "cline",
    kind: "agent",
    bin: "cline",
    npmPackage: "cline",
    ...npmCli("cline"),
  },
  {
    id: "auggie",
    kind: "agent",
    bin: "auggie",
    npmPackage: "@augmentcode/auggie",
    // package.json engines: { node: ">=20.0.0" }
    minNodeMajor: 20,
    ...npmCli("@augmentcode/auggie"),
  },
  {
    id: "droid",
    kind: "agent",
    bin: "droid",
    // Ships as a downloaded binary, not an npm package: the installer script is
    // the only route, and re-running it upgrades in place (so no `upgrade` entry
    // is needed — `upgradeCommandFor` falls back to `install`). With no
    // `npmPackage` there's no published version to compare against either, so
    // the UI shows no Upgrade badge for it.
    install: scriptInstall(
      "https://app.factory.ai/cli",
      "https://app.factory.ai/cli/windows",
      "sh"
    ),
    manualNote: "See https://docs.factory.ai/cli for manual installation instructions.",
  },
  {
    id: "cursor-cli",
    kind: "agent",
    // The installer symlinks both `agent` and `cursor-agent`; probe the specific
    // one, since a bare `agent` on PATH could be anything.
    bin: "cursor-agent",
    install: {
      // Anysphere publish a bash installer only — cursor.com/install.ps1 serves
      // the marketing page, not a script, so there is nothing to automate here.
      win: null,
      mac: { file: "bash", args: ["-c", "curl https://cursor.com/install -fsS | bash"] },
      linux: { file: "bash", args: ["-c", "curl https://cursor.com/install -fsS | bash"] },
    },
    manualNote:
      "On Windows, install the Cursor CLI from within WSL — see https://cursor.com/docs/cli/installation",
  },
  {
    id: "cc-switch",
    kind: "companion",
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
    // cc-switch is a Tauri app, so its releases carry the standard bundle set.
    // This is the ONLY automated path on Linux, and the last rung of the recovery
    // ladder on Windows/macOS — winget's downloader ignores `HTTPS_PROXY`
    // entirely, so on a proxied network fetching the installer ourselves is the
    // only thing that can work.
    release: {
      kind: "github",
      repo: "farion1231/cc-switch",
      asset: {
        // NSIS `-setup.exe` first; `.msi` is matched too since Tauri can bundle
        // either and which one a release ships has changed before.
        win: { pattern: "\\.(?:exe|msi)$", arch: { x64: "x64.*\\.(?:exe|msi)$" } },
        mac: {
          pattern: "\\.dmg$",
          arch: { arm64: "(?:aarch64|arm64).*\\.dmg$", x64: "(?:x64|x86_64|intel).*\\.dmg$" },
        },
        // AppImage before .deb: it needs no root and works on every distro,
        // whereas a .deb install requires pkexec and an apt-based system.
        linux: {
          pattern: "\\.AppImage$",
          arch: { x64: "(?:amd64|x86_64).*\\.AppImage$", arm64: "(?:aarch64|arm64).*\\.AppImage$" },
        },
      },
    },
    manualNote:
      "On Linux, download the .deb / .AppImage from https://github.com/farion1231/cc-switch/releases",
  },
  // npm-only on purpose: upgrade routing (`cliManagers`) only distinguishes
  // npm vs native, so offering brew here would leave a shadowing npm copy on
  // upgrade. brew / binary installs stay a user-managed path.
  {
    id: "cc-connect",
    kind: "companion",
    bin: "cc-connect",
    npmPackage: "cc-connect",
    ...npmCli("cc-connect"),
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
    // Published to PyPI only — `@modelcontextprotocol/server-fetch` has never
    // existed on npm (404), so this must run through uvx, not npx.
    id: "fetch",
    transport: "stdio",
    category: "web",
    runtime: "uvx",
    npmPackage: "mcp-server-fetch",
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
    // The npm `@modelcontextprotocol/server-github` package is deprecated
    // ("Package no longer supported"). GitHub now ships a hosted remote server.
    id: "github",
    transport: "http",
    category: "dev",
    url: "https://api.githubcopilot.com/mcp/",
    keyEnv: "GITHUB_PERSONAL_ACCESS_TOKEN",
    docsUrl: "https://github.com/github/github-mcp-server",
  },
  {
    id: "playwright",
    transport: "stdio",
    category: "web",
    npmPackage: "@playwright/mcp",
    docsUrl: "https://github.com/microsoft/playwright-mcp",
  },
  {
    id: "everything",
    transport: "stdio",
    category: "dev",
    npmPackage: "@modelcontextprotocol/server-everything",
    docsUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/everything",
  },
  {
    id: "firecrawl",
    transport: "stdio",
    category: "web",
    npmPackage: "firecrawl-mcp",
    keyEnv: "FIRECRAWL_API_KEY",
    docsUrl: "https://github.com/mendableai/firecrawl-mcp-server",
  },
  {
    id: "airtable",
    transport: "stdio",
    category: "dev",
    npmPackage: "airtable-mcp-server",
    keyEnv: "AIRTABLE_API_KEY",
    docsUrl: "https://github.com/domdomegg/airtable-mcp-server",
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
 * The network route an install method takes. Two methods sharing a route fail
 * together, so only a route change is worth retrying after a network failure.
 */
function routeOf(methodId: string): string {
  // npm, pnpm and bun all pull the same package from the same registry.
  if (["npm", "pnpm", "bun", "default"].includes(methodId)) return "npm-registry"
  return methodId // native (vendor script), winget, scoop — each its own host
}

/**
 * Install methods that reach the package by a genuinely DIFFERENT route than
 * `chosenId` — the only ones worth trying after a network failure.
 *
 * Falling back from npm to pnpm would hit the same registry that just timed out,
 * and on most machines pnpm isn't even installed, so it would fail twice as
 * slowly for nothing. Falling back from npm to the vendor's own install script
 * (a different host entirely), or from winget to scoop, actually can work.
 */
export function fallbackMethodsFor(
  tool: Pick<CliTool, "install" | "methods">,
  os: OS,
  chosenId: string | undefined
): InstallMethod[] {
  const chosenRoute = routeOf(chosenId ?? "default")
  return installMethodsFor(tool, os).filter((m) => routeOf(m.id) !== chosenRoute)
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

/**
 * The OS-package-manager identity (manager + package id) a runtime's in-place
 * UPDATE goes through, or undefined when it doesn't use one — bun/uv self-update,
 * or no update path on this OS. Derived from the upgrade command so it stays in
 * sync with the actual update path. Only a winget/brew-managed install can be
 * updated or reinstalled in place, so this drives the ownership check that
 * decides whether to offer those actions or a download link instead.
 */
export function runtimePkgManager(
  rt: Runtime,
  os: OS
): { manager: "winget" | "brew"; id: string } | undefined {
  const cmd = rt.upgrade?.[os]
  if (!cmd) return undefined
  if (cmd.file === "winget") {
    const i = cmd.args.indexOf("--id")
    const id = i >= 0 ? cmd.args[i + 1] : undefined
    return id ? { manager: "winget", id } : undefined
  }
  if (cmd.file === "brew") {
    // `brew upgrade <formula>` — the first non-flag arg after the subcommand.
    const id = cmd.args.slice(1).find((a) => !a.startsWith("-"))
    return id ? { manager: "brew", id } : undefined
  }
  return undefined
}

/**
 * The catalog split into its display groups, in `CLI_KINDS` order and keeping
 * registry order inside each. A kind with nothing in it is dropped rather than
 * rendered as an empty heading, so the lists stay honest as the catalog changes.
 */
export function clisByKind(): { kind: CliKind; tools: CliTool[] }[] {
  return CLI_KINDS.map((kind) => ({
    kind,
    tools: CLI_TOOLS.filter((c) => c.kind === kind),
  })).filter((g) => g.tools.length > 0)
}

export function findCli(id: string): CliTool | undefined {
  return CLI_TOOLS.find((c) => c.id === id)
}

export function findRuntime(id: string): Runtime | undefined {
  return RUNTIMES.find((r) => r.id === id)
}

/** Environment dependencies relevant to this OS, in catalog display order. */
export function runtimesForOS(os: OS): Runtime[] {
  return RUNTIMES.filter((runtime) => !runtime.platforms || runtime.platforms.includes(os))
}

export function findSkill(id: string): SkillDef | undefined {
  return SKILLS.find((s) => s.id === id)
}

export function findMcp(id: string): McpServer | undefined {
  return MCP_SERVERS.find((m) => m.id === id)
}
