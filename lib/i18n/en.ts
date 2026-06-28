/**
 * English message catalog — the SOURCE OF TRUTH for the message shape.
 *
 * `type Messages = typeof en` (see types.ts) is derived from this object, so
 * every other locale (zh-CN) must structurally match it. Plain strings are
 * static text; functions carry interpolation with explicitly typed params so
 * the derived type pins each placeholder.
 */
export const en = {
  /** Product name — not translated. */
  brand: "agentpack",

  header: {
    tagline: "Installer for Claude Code · Codex · skills · MCP · cc-switch",
    dryRunBadge: "  [dry-run]",
  },

  nav: {
    hint: "↑↓ move · space toggle · enter confirm",
    back: "esc back",
    continue: "Press enter to continue…",
    proceed: "Proceed? ",
    leaveBlank: "Press enter to leave blank / skip.",
  },

  welcome: {
    title: "Welcome to agentpack",
    intro:
      "This wizard installs and configures Claude Code, Codex, domain skills, MCP servers and cc-switch — in one pass.",
    language: "Language",
    hint: "↑↓ switch language · enter to start",
  },

  presetsScreen: {
    title: "Choose a preset",
    subtitle: "A preset pre-fills your selections; you can still adjust each step.",
  },

  presets: {
    custom: { title: "Custom", description: "Choose everything manually." },
    minimal: { title: "Minimal", description: "Claude Code + local memory MCP." },
    recommended: {
      title: "Recommended",
      description: "Claude Code, Codex, cc-switch + core MCP servers.",
    },
    everything: {
      title: "Everything",
      description: "All CLIs, skills and MCP servers.",
    },
  } as Record<string, { title: string; description: string }>,

  progress: (index: number, total: number) => `Step ${index}/${total}`,

  envcheck: {
    title: (osLabel: string) => `Environment check (${osLabel})`,
    detecting: "Detecting installed tools…",
    installed: "✔ installed",
    notFound: "○ not found",
    latest: "latest",
  },

  tools: {
    title: "Which CLIs do you want to install?",
    subtitle: "Already-installed tools are unchecked by default.",
    upgradeNote: "Tick an already-installed tool to upgrade it to the latest version.",
    installedSuffix: "  (installed)",
  },

  environment: {
    title: "Runtime environment",
    subtitle: "The agent CLIs need Node.js (with npm). Bun is an optional faster runtime.",
    detecting: "Detecting installed runtimes…",
    installHint: "Missing a runtime? Install it directly — detection re-runs after each install.",
    noInstaller: "No automated installer on this OS — see the note below.",
  },

  skills: {
    title: "Select domain skills to install",
    installsTo: (targets: string) => `Installs to: ${targets}`,
  },

  mcp: {
    title: "Select MCP servers to add",
    subtitle: "Servers needing an API key will prompt next (skippable).",
    keySuffix: " (key)",
  },

  mcpKeys: {
    title: (index: number, total: number) => `API keys (${index}/${total})`,
    hint: "Paste the key and press enter, or press enter to skip (placeholder kept).",
  },

  network: {
    titleOptional: "Network configuration (optional)",
    title: "Network configuration",
    ask: "Configure a custom API relay endpoint and an npm mirror? (You can also manage providers later with cc-switch.)",
    configureNow: "Configure now? ",
    baseUrlLabel: "API base URL / relay endpoint:",
    tokenLabel: "API token (for the relay):",
    registryLabel: "npm registry mirror URL:",
  },

  review: {
    title: "Review plan",
    dryRunSuffix: " (dry-run — nothing will be changed)",
    installClis: "Install CLIs:",
    skills: "Skills:",
    mcpServers: "MCP servers:",
    network: "Network:",
    none: "  (none)",
    keySet: " · key set",
    placeholder: " · placeholder",
    baseUrl: (v: string) => `base URL: ${v}`,
    apiToken: "API token: ••••••",
    npmRegistry: (v: string) => `npm registry: ${v}`,
  },

  summary: {
    dryRunComplete: "Dry-run complete",
    setupComplete: "Setup complete",
    counts: (ok: number, failed: number) => ` — ${ok} ok${failed ? `, ${failed} failed` : ""}`,
    failedSteps: "Failed steps:",
    pendingKeys: "Set these env vars to activate skipped MCP keys:",
    nextSteps: "Next steps:",
    nextRunPrefix: "  • run ",
    nextRunClaudeSuffix: " to start Claude Code",
    nextRunCodexSuffix: " to start Codex",
    savedConfig: (path: string) => `Saved config to ${path}`,
    retryHint: "press r to retry failed steps",
    exit: "Press enter to exit.",
  },

  verify: {
    claudeVersion: "Verify Claude Code (claude --version)",
    claudeMcp: "Verify MCP servers (claude mcp list)",
    codexVersion: "Verify Codex (codex --version)",
  },

  errors: {
    invalidJson: "Invalid config JSON.",
    unknownOs: (os: string) => `Unknown OS in config: ${os}`,
    unknownCli: (id: string) => `Unknown CLI id in config: ${id}`,
    unknownSkill: (id: string) => `Unknown skill id in config: ${id}`,
    unknownMcp: (id: string) => `Unknown MCP id in config: ${id}`,
    configReadFailed: (path: string) => `Could not read config file: ${path}`,
    needYes: "Pass --yes to execute, or --dry-run to preview.",
  },

  headless: {
    previewIntro: "Plan from config:",
    running: (label: string) => `… ${label}`,
  },

  /**
   * Display text for the registry catalog, keyed by id. The registry itself
   * holds only ids + behavior; all human-facing names/descriptions live here so
   * they can be translated.
   */
  catalog: {
    cli: {
      "claude-code": {
        title: "Claude Code",
        description: "Anthropic's terminal coding agent (@anthropic-ai/claude-code).",
      },
      codex: {
        title: "OpenAI Codex",
        description: "OpenAI's terminal coding agent (@openai/codex).",
      },
      "cc-switch": {
        title: "cc-switch",
        description: "Desktop GUI to manage/switch API providers for Claude Code & Codex.",
      },
    } as Record<string, { title: string; description: string }>,
    runtime: {
      node: {
        title: "Node.js",
        description: "JavaScript runtime + npm — required to install and run the agent CLIs.",
      },
      bun: {
        title: "Bun",
        description: "Fast all-in-one JavaScript runtime & package manager (optional).",
      },
    } as Record<string, { title: string; description: string }>,
    skills: {
      "cpp-cmake": {
        title: "C++ / CMake engineering",
        description: "CMake presets, targets, toolchains, vcpkg, out-of-source builds.",
      },
      python: {
        title: "Python engineering",
        description: "uv, venv, pyproject, ruff, pytest, packaging.",
      },
      android: {
        title: "Android engineering",
        description: "Gradle Kotlin DSL, SDK/NDK, adb, build variants, signing.",
      },
      "stm32-c": {
        title: "STM32 firmware (C)",
        description: "arm-none-eabi + CMake, HAL/LL, OpenOCD flashing, NVIC/registers.",
      },
      rust: {
        title: "Rust engineering",
        description: "cargo, workspaces, clippy, rustfmt, async/tokio, testing.",
      },
      "web-frontend": {
        title: "Web frontend (React/TS)",
        description: "React, TypeScript, Vite, Tailwind, testing, accessibility.",
      },
    } as Record<string, { title: string; description: string }>,
    mcp: {
      supermemory: {
        title: "Supermemory",
        purpose: "Persistent cross-session memory (hosted).",
      },
      memory: {
        title: "Memory (official knowledge graph)",
        purpose: "Local knowledge-graph memory, no API key.",
      },
      context7: {
        title: "Context7",
        purpose: "Up-to-date, version-specific library docs.",
      },
      "sequential-thinking": {
        title: "Sequential Thinking",
        purpose: "Structured step-by-step reasoning tool.",
      },
      fetch: { title: "Fetch", purpose: "Fetch & extract web page content." },
      filesystem: {
        title: "Filesystem",
        purpose: "Read/write files within allowed directories.",
      },
      exa: { title: "Exa Search", purpose: "Semantic / neural web search." },
      tavily: { title: "Tavily", purpose: "Web search with citations & crawling." },
      "brave-search": {
        title: "Brave Search",
        purpose: "Privacy-focused web search.",
      },
      github: {
        title: "GitHub",
        purpose: "Issues, PRs, code search, repo management.",
      },
      playwright: {
        title: "Playwright",
        purpose: "Browser automation & DOM inspection.",
      },
    } as Record<string, { title: string; purpose: string }>,
  },

  /** Step labels & output lines surfaced from core (plan.ts). */
  steps: {
    npmRegistry: (url: string) => `Set npm registry → ${url}`,
    installRuntime: (title: string) => `Install ${title}`,
    installCli: (title: string) => `Install ${title}`,
    upgradeCli: (title: string) => `Upgrade ${title}`,
    noInstaller: (title: string) => `No automated installer for ${title} on this OS.`,
    manualInstall: "manual install required",
    saveConfig: (path: string) => `Save config → ${path}`,
    savedConfigTo: (path: string) => `saved replayable config to ${path}`,
    installSkill: (title: string, targets: string) => `Install skill "${title}" → ${targets}`,
    uninstallSkill: (title: string, targets: string) => `Uninstall skill "${title}" ← ${targets}`,
    ccVisibleApps: "Apply cc-switch visible apps",
    ccProviderAdd: (name: string) => `Add cc-switch provider "${name}"`,
    ccProviderUpdate: (name: string) => `Update cc-switch provider "${name}"`,
    ccProviderDelete: (name: string) => `Delete cc-switch provider "${name}"`,
    ccProviderSetCurrent: (name: string) => `Set cc-switch provider "${name}" as current`,
    addMcpClaude: (title: string) => `Add MCP "${title}" → Claude Code`,
    addMcpCodex: (title: string) => `Add MCP "${title}" → Codex`,
    codexMcpWritten: (id: string) => `mcp_servers.${id} written to config.toml`,
    configureClaudeRelay: "Configure Claude Code API endpoint",
    configureCodexRelay: "Configure Codex API endpoint",
    claudeSettingsUpdated: "updated ~/.claude/settings.json env",
    codexProviderUpdated: "updated ~/.codex/config.toml model_providers",
    removeMcpClaude: (title: string) => `Remove MCP "${title}" ← Claude Code`,
    removeMcpCodex: (title: string) => `Remove MCP "${title}" ← Codex`,
    removeRelayClaude: "Remove Claude Code API endpoint",
    removeRelayCodex: "Remove Codex API endpoint",
    uninstallCli: (title: string) => `Uninstall ${title}`,
    noUninstaller: (title: string) => `No automated uninstaller for ${title} on this OS.`,
    restoreFile: (path: string) => `Restore ${path} from backup`,
  },

  /** Low-level execution / file output lines from exec/skills/configfiles. */
  coreOutput: {
    wouldRun: (cmd: string) => `would run: ${cmd}`,
    commandNotFound: (file: string) => `command not found: ${file}`,
    exitedWithCode: (code: number) => `exited with code ${code}`,
    copy: (src: string, dest: string) => `copy ${src} -> ${dest}`,
    wouldCopy: (src: string, dest: string) => `would copy ${src} -> ${dest}`,
    write: (path: string) => `write ${path}`,
    wouldWrite: (path: string) => `would write ${path}`,
    delete: (path: string) => `delete ${path}`,
    wouldDelete: (path: string) => `would delete ${path}`,
    backup: (path: string) => `backup → ${path}`,
    restore: (src: string, dest: string) => `restore ${src} -> ${dest}`,
    wouldRestore: (src: string, dest: string) => `would restore ${src} -> ${dest}`,
  },

  /** Main menu + shared menu navigation. */
  menu: {
    title: "Main menu",
    hint: "↑↓ move · enter select · esc back",
    returnHint: "Press enter to return to the menu.",
    dashboard: "Environment dashboard",
    presets: "Quick setup (preset)",
    environment: "Runtime environment",
    skills: "Engineering skills",
    ccswitch: "cc-switch management",
    clis: "Install / upgrade CLIs",
    mcp: "MCP servers",
    network: "Network / mirrors",
    saveConfig: "Save current setup as config",
    exit: "Exit",
    progress: (done: number, total: number, secs: number) => `${done}/${total} done · ${secs}s`,
    cancelHint: "Press ESC again to cancel remaining steps.",
    cancelled: (n: number) => `Cancelled — ${n} step(s) skipped.`,
    retryHint: "Press r to retry failed step(s) · enter to return.",
    allDone: "All steps finished.",
    finishedWithErrors: "Finished with errors.",
  },

  /** Skill install/uninstall screens. */
  skillsManage: {
    categoryTitle: "Engineering skills",
    categorySubtitle: "Pick an area, then install or remove its skills.",
    listTitle: (area: string) => `${area} — skills`,
    installed: "✔ installed",
    notInstalled: "○ not installed",
    toggleHint: "enter: install / uninstall · esc back",
    targets: (targets: string) => `Targets: ${targets}`,
    actionInstall: "Install",
    actionUninstall: "Uninstall",
  },

  /** cc-switch management screens. */
  ccswitch: {
    menuTitle: "cc-switch management",
    install: "Install / check cc-switch",
    visibleApps: "Visible apps (show only Claude & Codex)",
    providers: "Provider management",
    detected: "✔ cc-switch detected",
    notDetected: "○ cc-switch not detected",
    visibleTitle: "Apps shown in cc-switch",
    visibleHint: "space toggle · enter apply · esc back",
    appLabels: {
      claude: "Claude Code",
      claudeDesktop: "Claude Desktop",
      codex: "Codex",
      gemini: "Gemini CLI",
      opencode: "OpenCode",
      openclaw: "OpenClaw",
      hermes: "Hermes",
    } as Record<string, string>,
    providersTitle: "cc-switch providers",
    runtimeWarning: (current: string, min: string) =>
      `Provider management needs Node ≥ ${min} (node:sqlite); current Node is ${current}. Upgrade Node, or use the standalone binary.`,
    noDb: "cc-switch database not found. Launch cc-switch once, then return here.",
    empty: "No providers yet.",
    addProvider: "+ Add provider",
    addRecommended: (label: string) => `★ Add recommended: ${label}`,
    current: "current",
    rowActionEdit: "Edit",
    rowActionDelete: "Delete",
    rowActionSetCurrent: "Set as current",
    rowActionBack: "Back",
    setCurrentNote:
      "Note: this only flips the cc-switch DB flag — open cc-switch to sync it to the live config.",
    formAddTitle: "Add provider",
    formEditTitle: "Edit provider",
    fieldName: "Name:",
    fieldApp: "Which app?",
    fieldBaseUrl: "Base URL:",
    fieldToken: "API key / token:",
    fieldAuthKind: "Claude auth variable",
    authTokenLabel: "ANTHROPIC_AUTH_TOKEN (relays)",
    apiKeyLabel: "ANTHROPIC_API_KEY (official)",
    fieldModel: "Model (optional):",
    fieldNotes: "Notes (optional):",
    fieldWebsite: "Website (optional):",
  },

  /** GUI shell strings (header controls, dialogs) — GUI-only, not in the TUI. */
  shell: {
    toggleTheme: "Toggle theme",
    light: "Light",
    dark: "Dark",
    system: "System",
    language: "Language",
    preview: "Preview (dry-run)",
    osOverride: "OS",
    osAuto: "Auto",
    run: "Run plan",
    runReview: "Review plan",
    addToPlan: "Add to plan",
    loadConfig: "Load config",
    saveConfigBtn: "Save config",
    cancel: "Cancel",
    close: "Close",
    retry: "Retry failed",
    proceed: "Proceed",
    upgrade: "Upgrade",
    installNow: "Install now",
    uninstallNow: "Uninstall now",
    apply: "Apply",
    add: "Add",
    edit: "Edit",
    delete: "Delete",
    setCurrent: "Set current",
    save: "Save",
    emptyPlan: "Your plan is empty. Select CLIs, skills, MCP servers or network options first.",
    notInTauri: "Run the desktop app (pnpm tauri dev) to execute installs.",
    configSaved: (path: string) => `Saved config to ${path}`,
    configLoaded: "Config loaded into your plan.",
  },

  /** Environment health dashboard (real installed state scanned from disk). */
  dashboard: {
    title: "Environment dashboard",
    subtitle: "Your real installed state, scanned from disk.",
    refresh: "Rescan",
    scanning: "Scanning your environment…",
    notTauri: "Run the desktop app to scan your real environment.",
    sectionClis: "CLIs & runtimes",
    sectionSkills: "Installed skills",
    sectionMcp: "MCP servers",
    sectionRelay: "API endpoint (relay)",
    sectionCcswitch: "cc-switch providers",
    sectionHealth: "Config files",
    updateAvailable: (version: string) => `update → ${version}`,
    custom: "custom",
    none: "Nothing detected here yet.",
    relayConfigured: "Configured",
    relayNone: "Not configured",
    relayBaseUrl: (v: string) => `base URL: ${v}`,
    relayToken: "token set",
    configOk: "valid",
    configInvalid: "unparsable",
    configMissing: "absent",
    hasBackup: "backup available",
    remove: "Remove",
    uninstall: "Uninstall",
    restore: "Restore backup",
    fileClaudeSettings: "Claude settings.json",
    fileCodexConfig: "Codex config.toml",
  },

  /** Multi-profile management (save / switch named setups). */
  profiles: {
    title: "Profiles",
    subtitle: "Save and switch between named setups.",
    saveAs: "Save current as profile",
    namePlaceholder: "Profile name",
    apply: "Apply",
    rename: "Rename",
    delete: "Delete",
    current: "current",
    empty: "No profiles saved yet.",
    applied: (name: string) => `Applied profile "${name}"`,
    saved: (name: string) => `Saved profile "${name}"`,
    deleted: (name: string) => `Deleted profile "${name}"`,
    nameRequired: "Enter a profile name.",
  },
}
