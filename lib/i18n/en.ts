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
      "New here? agentpack installs and sets up your AI coding tools in one click. Pick a bundle below and press Install — nothing is changed until you confirm.",
    language: "Language",
    hint: "↑↓ switch language · enter to start",
    // First-run wizard (GUI). Plain-language walkthrough of what gets set up.
    whatTitle: "What it sets up for you",
    whatClis: "AI coding assistants (Claude Code, Codex) you chat with in your terminal.",
    whatMcp: "MCP servers — plugins that give the AI extra powers: web access, memory, GitHub…",
    whatSkills: "Engineering skills — ready-made playbooks the AI follows for common tasks.",
    whatCcswitch: "cc-switch — keep several API providers/keys and switch with one click.",
    presetLabel: "Pick a starting bundle",
    presetHint: "Not sure? Recommended is a good default. You can fine-tune everything later.",
    previewLabel: "Preview first (dry-run)",
    previewHint: "See exactly what would happen — without changing anything.",
    later: "Maybe later",
    install: "Install now",
    installPreview: "Preview plan",
    reopen: "Show welcome guide",
  },

  /** Guided product tour — a spotlight walkthrough that visits each part of the app. */
  tour: {
    title: "Guided tour",
    start: "Take a tour",
    skip: "Skip",
    back: "Back",
    next: "Next",
    done: "Done",
    progress: (i: number, n: number) => `${i} / ${n}`,
    steps: {
      nav: {
        title: "Everything lives here",
        body: "The left sidebar groups every feature — jump to any part of agentpack from here.",
      },
      dashboard: {
        title: "Dashboard",
        body: "See what's installed and configured at a glance, and remove anything you don't want.",
      },
      presets: {
        title: "Presets",
        body: "New here? Pick a bundle and it pre-fills a sensible set of tools in one tap.",
      },
      clis: {
        title: "CLIs",
        body: "Install or upgrade the AI assistants you run in a terminal — Claude Code, Codex, cc-switch.",
      },
      skills: {
        title: "Skills",
        body: "Add reusable playbooks that teach the AI how to do common engineering tasks well.",
      },
      mcp: {
        title: "MCP servers",
        body: "Give the AI extra powers with plugins — web access, memory, GitHub and more.",
      },
      network: {
        title: "Network",
        body: "Point the CLIs at a custom API relay and an npm mirror — handy behind a proxy.",
      },
      ccswitch: {
        title: "cc-switch",
        body: "Keep several API providers/keys and switch the active one with a click.",
      },
      preview: {
        title: "Preview first",
        body: "Turn this on to see exactly what a run would do — without changing anything.",
      },
      run: {
        title: "Install in one click",
        body: "Once your plan looks right, run it here. Already-installed items are skipped automatically.",
      },
    } as Record<string, { title: string; body: string }>,
  },

  /** Dashboard "quick start" card — a lingering guide for anyone who skipped the wizard. */
  quickStart: {
    title: "Quick start",
    intro: "New to agentpack? The guide sets up your AI coding tools in a few clicks.",
    stepPick: "Pick a bundle",
    stepPreview: "Preview (optional)",
    stepInstall: "Install in one click",
    openGuide: "Open the guide",
    dismiss: "Don't show again",
  },

  /**
   * Quick-install dialog — the one-page selection surface opened from the header
   * "Run ▾" menu. Pick a bundle or tick exactly what to install without visiting
   * each section.
   */
  installDialog: {
    title: "Quick install",
    subtitle: "Pick a bundle, or tick exactly what to install — no page-hopping.",
    presetLabel: "Start from a bundle",
    custom: "Custom",
    clis: "CLIs",
    skills: "Skills",
    mcp: "MCP servers",
    none: "Nothing selected yet. Pick a bundle above, or tick items below.",
    selected: (n: number) => `${n} selected`,
    install: "Install now",
    installPreview: "Preview plan",
  },

  /**
   * Plain-language, one-line explanations of jargon, surfaced as ⓘ tooltips next
   * to section titles so a newcomer isn't stopped by an acronym.
   */
  help: {
    dryRun:
      "Dry-run: agentpack only shows what it would do — no files or installs are touched. Turn it off to actually apply.",
    preset:
      "A preset pre-selects a sensible bundle. Start with Recommended; change anything afterward.",
    cli: "CLIs are the AI assistants you run in a terminal (Claude Code, Codex). Installing one adds its command.",
    runtime:
      "Runtimes like Node.js and Python are the engines the CLIs and some MCP servers need to run.",
    skills:
      "Skills are reusable instruction packs that teach the AI how to do specific engineering tasks well.",
    mcp: "MCP servers are plugins that extend the AI with new abilities — web access, memory, GitHub, and more.",
    network:
      "Point the CLIs at a custom API relay/endpoint and an npm mirror — handy behind a proxy or a slow network.",
    ccswitch:
      "cc-switch stores multiple API providers/keys and lets you switch the active one with a click.",
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
    subtitle:
      "The agent CLIs need Node.js (with npm). Bun is an optional faster runtime; Python and uv power Python-based MCP servers and tooling.",
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
    subtitle:
      "Plugins that extend the AI. Add any to Claude Code or Codex — installed ones can be removed here.",
    keySuffix: " (key)",
    installed: "✔ installed",
    notInstalled: "○ not installed",
    // Management UI (GUI): search, filters, per-card actions, custom servers.
    searchPlaceholder: "Search MCP servers…",
    filterAll: "All",
    filterInstalled: "Installed",
    filterNotInstalled: "Not installed",
    filterNeedsKey: "Needs key",
    needsKeyBadge: "key",
    docs: "Docs",
    addNow: "Add now",
    removeNow: "Remove now",
    noResults: "No MCP servers match your search.",
    summary: (installed: number, total: number) => `${installed} / ${total} installed`,
    customTitle: "Custom & user-added",
    customHint: "Servers found in your config that aren't in the catalog.",
    /** Category header labels, keyed by McpCategory. */
    categories: {
      memory: "Memory & knowledge",
      search: "Search & docs",
      web: "Web & browser",
      dev: "Developer tools",
      reasoning: "Reasoning",
    } as Record<string, string>,
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
    warnings: "Could not verify (a freshly installed CLI may need an app restart):",
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
    unknownMethod: (id: string) => `Unknown install method in config: ${id}`,
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
      python: {
        title: "Python",
        description: "Python 3 — needed by Python-based MCP servers, scripts and tooling.",
      },
      uv: {
        title: "uv",
        description: "Fast Python package & project manager — runs Python MCP servers via uvx.",
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
    /** Install-method labels, keyed by the method id in the registry. */
    methods: {
      npm: { title: "npm", description: "Install globally with npm (needs Node.js)." },
      pnpm: { title: "pnpm", description: "Install globally with pnpm." },
      bun: { title: "bun", description: "Install globally with Bun." },
      native: {
        title: "Official installer",
        description: "Standalone installer script — no Node.js required.",
      },
      winget: {
        title: "winget",
        description: "Windows Package Manager (may require administrator).",
      },
      scoop: { title: "Scoop", description: "User-scope install, no administrator needed." },
      brew: { title: "Homebrew", description: "macOS package manager." },
      fnm: { title: "fnm", description: "Fast Node manager (user scope)." },
      default: { title: "Default", description: "Recommended install method." },
    } as Record<string, { title: string; description: string }>,
  },

  /** Step labels & output lines surfaced from core (plan.ts). */
  steps: {
    npmRegistry: (url: string) => `Set npm registry → ${url}`,
    installRuntime: (title: string) => `Install ${title}`,
    updateRuntime: (title: string) => `Update ${title}`,
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
    snapshot: "Back up cc-switch DB and live configs",
    syncClaude: "Sync provider → Claude Code settings.json",
    syncCodex: "Sync provider → Codex config.toml",
    syncCodexAuth: "Sync provider → Codex auth.json",
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
    snapshot: (id: string) => `backed up → ${id}`,
    wouldSnapshot: "would back up cc-switch DB and live configs",
    skippedDependency: (label: string) => `skipped — required step "${label}" failed`,
    skippedCancelled: "skipped — run cancelled",
    notOnPathHint: (file: string) =>
      `"${file}" is not on PATH — install it first, or restart agentpack if it was just installed.`,
    npmMissingHint:
      "npm is missing — install Node.js (Runtime environment section), restart agentpack, then retry.",
    wingetMissingHint:
      'winget isn\'t available — update "App Installer" from the Microsoft Store (Windows 10+), or install this tool manually.',
    requestingElevation:
      "Requesting administrator permission — approve the Windows (UAC) prompt to continue.",
    elevationDeclined: "Administrator permission was declined — the operation was cancelled.",
    alreadyCurrent: "Already installed and up to date — nothing to do.",
    elevationHint: (cmd: string) =>
      `The install didn't complete. If it's a permissions issue, open a terminal as administrator and run it yourself:  ${cmd}`,
    timedOut: (mins: number) =>
      `timed out after ${mins} min and was stopped — check your network or run the command manually, then retry.`,
  },

  /** Main menu + shared menu navigation. */
  menu: {
    title: "Main menu",
    hint: "↑↓ move · enter select · esc back",
    returnHint: "Press enter to return to the menu.",
    dashboard: "Environment dashboard",
    history: "Chat history",
    presets: "Quick setup (preset)",
    environment: "Runtime environment",
    skills: "Engineering skills",
    ccswitch: "cc-switch management",
    clis: "Install / upgrade CLIs",
    mcp: "MCP servers",
    network: "Network / mirrors",
    saveConfig: "Save current setup as config",
    about: "About & updates",
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
    noDb: "cc-switch database not found. Initialize it below, then return here.",
    initDb: "Initialize database",
    initDbHint:
      "cc-switch stores providers in a SQLite database it creates on first launch. Click to launch cc-switch once so agentpack can manage providers.",
    initializing: "Launching cc-switch and waiting for its database…",
    initTimeout:
      "Timed out waiting for the database. Make sure cc-switch finished launching, then refresh.",
    dbReady: "Database ready. Close cc-switch before editing providers here.",
    refresh: "Refresh",
    checking: "Checking cc-switch…",
    loading: "Loading…",
    runningTitle: "cc-switch is running",
    runningHint:
      "Close cc-switch before editing providers here — changes are blocked while it's open. Then click Refresh.",
    deleteConfirm:
      "Delete this provider from cc-switch? A snapshot is taken first, but this removes it.",
    setCurrentConfirm:
      "Set as current and overwrite the live config (Claude settings.json / Codex config.toml)? A snapshot is taken first.",
    restoreFailed: "Restore failed. See the logs for details.",
    initLaunchFailed: "Couldn't launch cc-switch. Make sure it's installed, then try again.",
    loadFailed: "Couldn't read the cc-switch state. Click Refresh to retry.",
    empty: "No providers yet.",
    addProvider: "+ Add provider",
    addRecommended: (label: string) => `★ Add recommended: ${label}`,
    current: "current",
    rowActionEdit: "Edit",
    rowActionDelete: "Delete",
    rowActionSetCurrent: "Set as current",
    rowActionBack: "Back",
    setCurrentNote:
      "Setting a provider as current also syncs its env into the live config (Claude settings.json / Codex config.toml).",
    syncCurrent: "Sync current to live config",
    syncHint:
      "Write each app's current provider into ~/.claude/settings.json and ~/.codex/config.toml.",
    syncNoCurrent: "No current provider to sync.",
    backupsTitle: "Backups & restore",
    backupsHint: "Every provider change and sync snapshots the DB and live configs here.",
    noBackups: "No backups yet.",
    restore: "Restore",
    restoreConfirm: "Restore this backup? Current DB and live configs are snapshotted first.",
    restored: "Restored from backup.",
    backupFiles: (n: number) => `${n} file${n === 1 ? "" : "s"}`,
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
    quickInstall: "Quick install",
    customize: "Customize…",
    addToPlan: "Add to plan",
    loadConfig: "Load config",
    saveConfigBtn: "Save config",
    cancel: "Cancel",
    close: "Close",
    retry: "Retry failed",
    proceed: "Proceed",
    upgrade: "Upgrade",
    update: "Update",
    reinstall: "Reinstall",
    installNow: "Install now",
    uninstallNow: "Uninstall now",
    installMethod: "Install method",
    apply: "Apply",
    add: "Add",
    edit: "Edit",
    delete: "Delete",
    setCurrent: "Set current",
    save: "Save",
    emptyPlan: "Your plan is empty. Select CLIs, skills, MCP servers or network options first.",
    nothingToDo: "Everything in your plan is already installed and up to date — nothing to do.",
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
    overviewTools: "Tools",
    overviewMcp: "MCP",
    overviewSkills: "Skills",
    overviewProviders: "Providers",
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

  /** Chat-history reader + usage statistics across Claude Code, Codex, OpenCode. */
  history: {
    title: "Chat history",
    subtitle: "Read past sessions and token usage across Claude Code, Codex and OpenCode.",
    notTauri: "Run the desktop app to read your local chat history.",
    loading: "Reading your chat history…",
    refresh: "Rescan",
    tabSessions: "Sessions",
    tabUsage: "Usage",
    searchPlaceholder: "Search sessions, projects, models…",
    sourceAll: "All",
    sortRecent: "Recent",
    sortTokens: "Tokens",
    sortMessages: "Messages",
    sortLabel: "Sort",
    empty: "No sessions found.",
    emptyHint: "Once you chat with a CLI, its sessions show up here.",
    emptyFiltered: "No sessions match your filters.",
    scanError: (source: string, message: string) => `Couldn't read ${source}: ${message}`,
    /** Session sources — display names. */
    sources: {
      claude: "Claude Code",
      codex: "Codex",
      opencode: "OpenCode",
    } as Record<string, string>,
    messages: (n: number) => `${n} msg`,
    tokensLabel: "tokens",
    project: "Project",
    model: "Model",
    noModel: "unknown model",
    branch: (b: string) => `on ${b}`,
    open: "Open transcript",
    close: "Close",
    copy: "Copy",
    copied: "Copied",
    // Transcript roles + part labels.
    roleUser: "You",
    roleAssistant: "Assistant",
    roleSystem: "System",
    roleTool: "Tool",
    thinking: "Thinking",
    toolCall: (name: string) => `Tool · ${name}`,
    toolResult: "Result",
    toolError: "Error",
    webSearch: "Web search",
    patch: "File change",
    image: "Image",
    loadFailed: "Couldn't load this transcript.",
    transcriptEmpty: "This session has no renderable messages.",
    turns: (n: number) => `${n} turn${n === 1 ? "" : "s"}`,
    // Usage dashboard.
    usageEmpty: "No usage data yet.",
    statSessions: "Sessions",
    statMessages: "Messages",
    statTokens: "Total tokens",
    statInput: "Input",
    statOutput: "Output",
    statCache: "Cache read",
    statReasoning: "Reasoning",
    statCost: "Cost",
    statAvgTokens: "Avg tokens / session",
    statAvgCost: "Avg cost / session",
    costNote:
      "Cost is exact for OpenCode; for Claude Code and Codex it's estimated from current per-model pricing (2026-07). Rates change — treat estimates as approximate.",
    estBadge: "est.",
    costEstimatedSub: (v: string) => `incl. ${v} estimated`,
    ratePerMillion: (input: string, output: string) => `${input} / ${output} per 1M`,
    chartByDay: "Tokens by day",
    chartCostByDay: "Cost by day",
    chartBySource: "Tokens by tool",
    chartByModel: "Tokens by model",
    chartByHour: "Activity by hour",
    chartByHourSub: "Sessions started, by local hour of day",
    tableProjects: "Top projects",
    colTool: "Tool",
    colModel: "Model",
    colProject: "Project",
    colSessions: "Sessions",
    colTokens: "Tokens",
    colCost: "Cost",
    inputOutput: (input: string, output: string) => `${input} in · ${output} out`,
  },

  /** About & self-update section (app version, check/download/install). */
  about: {
    title: "About & updates",
    subtitle: "App version and in-app updates.",
    currentVersion: (v: string) => `Version ${v}`,
    versionUnknown: "Run the desktop app to see the version and check for updates.",
    checkNow: "Check for updates",
    checking: "Checking…",
    upToDate: "You're on the latest version.",
    updateAvailable: (v: string) => `Update available: ${v}`,
    releaseNotes: "Release notes",
    downloading: "Downloading…",
    installAndRestart: "Install & restart",
    installing: "Installing…",
    skipVersion: "Skip this version",
    viewOnGitHub: "View on GitHub",
    checkFailed: "Update check failed. Please try again later.",
    autoCheckLabel: "Check for updates on startup",
    lastChecked: (when: string) => `Last checked: ${when}`,
    never: "never",
    configFolders: "Config folders",
    openClaudeFolder: "Open Claude folder",
    openCodexFolder: "Open Codex folder",
    notifyTitle: "Update available",
    notifyBody: (v: string) => `agentpack ${v} is ready to install.`,
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
