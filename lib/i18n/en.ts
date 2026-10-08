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

  welcome: {
    title: "Welcome to agentpack",
    // Subtitle of step 1, which asks window-or-terminal — so it must not promise
    // a bundle picker that only appears on step 2.
    intro:
      "New here? agentpack installs and sets up your AI coding tools for you. First, how do you want to use them? Nothing is changed until you confirm.",
    continue: "Continue",
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
    install: "Review and install",
    reopen: "Show welcome guide",
    // Step 2/3 subtitles. The network step comes before installing on purpose:
    // finding out the network is blocked beats watching six steps go red.
    networkIntro: "A quick look at your network, so the install doesn't fail halfway.",
    installIntro:
      "Here's what you picked. Next you'll see the exact changes it needs, and nothing runs until you approve them there.",
    // Final step: the list of what the chosen bundle installs, plus the keys the
    // key-gated servers need — asked here because a server without its key
    // installs cleanly and then never works.
    summaryClis: "Assistants",
    summarySkills: "Skills",
    summaryMcp: "MCP servers",
    summaryNothing: "This bundle installs nothing on its own.",
    summaryInstalled: "already installed",
    summaryWritesTo: (targets: string) => `Configured for: ${targets}`,
    // Skills are opt-in per stack: bundling all six would hand a Rust developer
    // an Android playbook, so the wizard asks instead of guessing.
    skillsHint: "Optional — pick the ones matching what you build. You can add more later.",
    keysTitle: "API keys",
    keysHint: "Optional — you can add these later in the MCP section. Blank is fine.",
    // Step 1 asks how they intend to use it, because that decides what
    // "install Claude" means: the app, the terminal command, or both.
    surfaceLabel: "How do you want to use it?",
    surfaceHint: "You can add the other one later — nothing here is final.",
    surfaceGui: "In a window",
    surfaceGuiHint: "Installs the desktop apps. No terminal to open.",
    surfaceCli: "In the terminal",
    surfaceCliHint: "Installs the command-line versions you run by typing `claude`.",
    surfaceBoth: "Both",
    surfaceBothHint: "Set up the apps and the terminal commands together.",
    recommendedTag: "Recommended",
    bundleIntro: "Now pick what to set up. You can change any of it afterwards.",
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
        title: "Seven focused workspaces",
        body: "The rail separates your own account from administrator operations, alongside machine health, installation, capabilities, usage, and settings.",
      },
      dashboard: {
        title: "Dashboard",
        body: "See what's installed and configured at a glance, and what needs attention — each finding links to the page that fixes it.",
      },
      history: {
        title: "Chat history",
        body: "Read back every past session across Claude Code, Codex, OpenCode and Pi, and see exactly what your tokens cost.",
      },
      "management-overview": {
        title: "Accounts & quota overview",
        body: "Inspect instance health, direct account relationships, quota risk and open alerts without merging partial data.",
      },
      accounts: {
        title: "Account center",
        body: "Manage the complete master and direct-child lifecycle, with previews and audit reasons for sensitive changes.",
      },
      quota: {
        title: "Quota center",
        body: "Transfer, batch, reverse and adjust quota through the server ledger, then configure automated policies.",
      },
      analytics: {
        title: "Usage insights",
        body: "Compare authoritative billing logs with clearly labelled local CLI estimates and export the selected scope.",
      },
      audit: {
        title: "Audit & alerts",
        body: "Trace immutable before-and-after events, manage alert rules and acknowledge delivery outcomes.",
      },
      "my-account": {
        title: "My account",
        body: "Sign in to a personal more-token package and manage only your own profile and account state.",
      },
      "my-balance": {
        title: "My balance",
        body: "Review your available balance and personal ledger without exposing administrator controls.",
      },
      "my-usage": {
        title: "My usage",
        body: "Inspect the authoritative billing records associated with your own account and selected period.",
      },
      "my-models": {
        title: "Model marketplace",
        body: "Browse the models, billing modes, groups, and endpoint types currently available to your account.",
      },
      "my-security": {
        title: "My security",
        body: "Change your password, review paired desktop sessions, revoke access, or request account closure.",
      },
      presets: {
        title: "Presets",
        body: "New here? Pick a bundle and it pre-fills a sensible set of tools in one tap.",
      },
      environment: {
        title: "Environment",
        body: "Terminal, Node, Python, Bun and uv — the tools the assistants need. agentpack installs any that are missing.",
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
      pi: {
        title: "Pi",
        body: "Manage Pi packages, project resources, session branches, and provider authentication safely.",
      },
      network: {
        title: "Network",
        body: "Detect and apply a proxy, or pick faster mirrors for npm, pip and friends.",
      },
      cleanup: {
        title: "Clean up",
        body: "The CLIs keep every transcript, cache and log forever. See what they're holding, and clear what you don't need — recoverably.",
      },
      ccswitch: {
        title: "cc-switch",
        body: "Keep several API providers/keys and switch the active one with a click.",
      },
      ccconnect: {
        title: "cc-connect",
        body: "Drive your local coding agents from a chat app — Feishu, Slack, Telegram — so you can work away from your desk.",
      },
      preferences: {
        title: "Preferences",
        body: "Theme, language, interface scale and the screen agentpack opens on — all in one place.",
      },
      config: {
        title: "Profiles & backup",
        body: "Save your setup as a profile, or export the whole machine so you can rebuild it somewhere else.",
      },
      recovery: {
        title: "Recovery points",
        body: "Every way back this app has left behind — config snapshots, skill backups and quarantined cleanups — with a warning when one is older than the file it would overwrite.",
      },
      about: {
        title: "About & updates",
        body: "Which build you're running, and how to get the next one.",
      },
      command: {
        title: "One way to anywhere",
        body: "Press ⌘K (Ctrl+K on Windows and Linux) to jump to any task area, or to run an app action without hunting for it.",
      },
      review: {
        title: "Nothing is written until you say so",
        body: "Whatever you pick collects at the bottom of the window. Reviewing it shows the exact steps — preview them, then apply.",
      },
    } as Record<string, { title: string; body: string }>,
  },

  /** Dashboard "quick start" card — a lingering guide for anyone who skipped the wizard. */
  quickStart: {
    title: "Quick start",
    intro: "New to agentpack? The guide sets up your AI coding tools in a few clicks.",
    stepPick: "Pick a bundle",
    stepPreview: "Review the steps",
    stepInstall: "Apply, with a way back",
    openGuide: "Open the guide",
    dismiss: "Don't show again",
    networkBlocked: "Your network can't reach the internet directly — set that up first →",
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
    /** Which agents the ticked skills / MCP servers get configured for. */
    writesTo: (agents: string) => `Set up for ${agents}`,
    install: "Install now",
    installPreview: "Preview plan",
    /** The selection summary column (folded into the change tray when narrow). */
    summary: "Your selection",
    summaryEmpty: "Nothing yet.",
    alreadyInstalled: "already installed",
  },

  /**
   * Pi management. The section is a capability workbench like Skills and MCP:
   * one scope control, one status band, four destinations in the aside. This
   * vocabulary is grouped the way the screen is, so a copy change and the
   * surface it lands on stay next to each other.
   */
  pi: {
    title: "Pi management",
    subtitle:
      "Read the Pi settings a scope loads, turn a package's resources on or off, and check how Pi signs in.",

    // Frame: the chrome shared with every other capability workspace.
    refresh: "Rescan",
    notTauri: "Pi management is only available in the desktop app.",
    notInstalled:
      "Pi is not installed. Install it from CLIs before managing packages or authentication.",
    installPi: "Open CLIs",
    loading: "Reading Pi settings…",
    summaryLabel: "Pi summary",
    actionsLabel: "Pi management views",
    detailPanel: "Pi management details",

    // The four destinations in the aside.
    tabPackages: "Packages",
    tabBrowse: "Find packages",
    tabAuth: "Authentication",
    tabSessions: "Session folders",
    packagesActionHint: "What this scope loads, and which resources of each package are on.",
    browseActionHint: "Search npm, or install from a source you name.",
    authActionHint: "Which providers Pi can reach, and how it signs in.",
    sessionsActionHint: "Extra folders scanned for Pi transcripts.",

    // The status band, which restates nothing the scope bar already says.
    statScope: "Scope",
    statPackages: "Packages",
    statResources: "Resources on",
    statTrust: "Trust",
    statPending: "Waiting for the first read of your Pi settings",
    statFailed: "The last read of these Pi settings failed",
    statTarget: (path: string) => `Changes write to ${path}`,

    // The scope bar: which settings file this whole page is about.
    scope: "Scope",
    scopeLabel: "Settings scope",
    globalScope: "Global",
    projectScope: "Project",
    projectFolder: "Project folder",
    chooseFolder: "Choose folder…",
    projectNeeded: "Choose a project folder to read the Pi settings inside it.",
    projectFolderMissing: (path: string) =>
      `Folder not found: ${path}. Check the path, or use Choose folder…`,
    installNeedsReading:
      "Installs in Project scope wait until the project's Pi settings have been read. Rescan, or choose another folder.",
    scanFailed: (reason: string) =>
      `Couldn't read the Pi settings for this scope: ${reason}. Rescan to try again.`,
    trust: "Project trust",
    /** Pi's own trust vocabulary. An unknown state falls through verbatim. */
    trustStates: {
      trusted: "Trusted",
      untrusted: "Untrusted",
      ask: "Asks first",
    } as Record<string, string>,
    trustUnapproved:
      "Pi has not recorded this project as trusted. Approving a change here passes --approve for that one command.",

    // The packages inventory.
    packagesListLabel: "Configured Pi packages",
    kindFilter: "Filter by resource",
    filterAll: "All",
    searchPlaceholder: "Search packages…",
    filtersLabel: "Filters",
    filtersReset: "Clear filters",
    sortLabel: "Sort by",
    sortName: "Name",
    sortResources: "Most resources",
    showInherited: "Include inherited packages",
    resourceHint:
      "Press a resource to turn it on or off for that package. Open a package to narrow it to single files.",
    noProjectChosen: "Nothing to list until a project folder is chosen.",
    noPackages: "No Pi packages are configured in this scope.",
    noMatches: "No packages match your filter.",
    findPackages: "Find packages",
    updateAll: "Update all",
    allPackages: "all packages",
    actions: "Actions",
    openPackage: (name: string) => `Open ${name}`,
    install: "Install",
    remove: "Remove",
    update: "Update",
    changePin: "Change version / ref",
    changePinTitle: (name: string) => `Change the version or ref of ${name}`,
    changePinHint: "Give the full source, including the version or git ref you want.",
    changePinApply: "Stage the change",
    pinned: "pinned",
    inherited: "inherited",
    overridden: "overridden",
    installedState: "installed",
    missing: "folder missing",
    missingHint: "Pi lists this package but its folder is gone. Update or reinstall it.",
    overriddenResourceHint:
      "This global package is overridden in the project. Change the project package instead.",
    resourcesOff: "all resources off",

    // The package detail dialog, where per-file overrides live.
    detailTitle: (name: string) => `${name} resources`,
    detailIntro: "Turn a whole resource kind on or off, or narrow it to single files.",
    detailSource: "Source",
    detailPath: "Installed at",
    detailVersion: "Version",
    detailNoPaths: "Pi declares no files for this resource.",
    detailGlobOnly: "Pattern, not a file. Pi can only switch exact paths.",
    detailKindOff: "This kind is off. Turn it on to switch single files.",
    close: "Close",

    // Find packages: install from a named source, or search npm.
    addSourceTitle: "Install from a source",
    addSource: "npm name, git: URL, or local path",
    addSourceHint: "For example my-pi-package, git:github.com/owner/repo, or ./local/folder",
    sourceUnsafe: "Remove the credentials or query string from this source before installing.",
    browse: "Search npm",
    search: "Search",
    searching: "Searching npm…",
    gallery: "Package gallery",
    published: "Published",
    resultsLabel: "npm search results",
    noResults: "No verified pi-package results.",
    searchPrompt: "Search npm for packages that declare Pi resources.",
    alreadyInstalled: "already installed",
    communityWarning: "Community content, not reviewed by AgentPack.",
    communityBody:
      "A Pi package runs with your full user permissions. Install only what you would run by hand.",

    // Authentication.
    authHint:
      "Status checks use --no-refresh. Credentials and environment values never leave the Rust boundary.",
    refreshAuth: "Refresh authentication",
    providersLabel: "Pi providers",
    provider: "Provider",
    status: "Status",
    authType: "Auth type",
    source: "Source",
    expires: "Expires",
    expiresAt: (when: string) => `Expires ${when}`,
    noProviders: "Pi reports no providers yet. Log in, then refresh.",
    authReading: "Reading Pi authentication…",
    authReadFailed: (reason: string) =>
      `Couldn't read Pi's authentication status: ${reason}. Retry, or log in with Pi first.`,
    retry: "Retry",
    login: "Log in with Pi",
    logout: "Log out with Pi",
    interactiveHint: (command: string) =>
      `A terminal will open Pi. Run ${command}, and authentication stays inside Pi's official flow.`,
    copied: (command: string) => `${command} copied to the clipboard.`,
    typeCommand: (command: string) => `Type ${command} in the Pi terminal.`,
    launchFailed: (reason: string) =>
      `Couldn't open a terminal for Pi: ${reason}. Run pi in a terminal yourself.`,
    unknown: "Unknown",

    // Session folders.
    sessionFolders: "Additional session folders",
    sessionFoldersHint: "Scanned before Pi's environment, settings, and default session folders.",
    sessionFoldersLabel: "Additional Pi session folders",
    addSessionFolder: "Add session folder…",
    noSessionFolders: "No extra folders. Pi's own session folders are always scanned.",

    // The permission gate every package command passes through.
    permissionTitle: "Allow this Pi package to run with your system permissions?",
    permissionBody: (source: string, path: string) =>
      `${source} can execute code with your full user permissions and access files, network, processes, and environment variables. Pi trust is not a sandbox. Target: ${path}`,
    permissionScope: (scope: string) => `Scope: ${scope}`,
    cancel: "Cancel",
    approve: "Approve and review command",

    // Step labels, activity titles and machine errors.
    packageActivity: "Manage Pi package",
    packageAction: (action: string, source: string) =>
      `${({ install: "Install", remove: "Remove", update: "Update", updateAll: "Update" } as Record<string, string>)[action] ?? action} ${source}`,
    resourceAction: (enabled: boolean, kind: string, source: string, cleared = 0) =>
      `${enabled ? "Enable" : "Disable"} ${kind} from ${source}${
        cleared > 0
          ? ` — clears ${cleared === 1 ? "1 file filter" : `${cleared} file filters`} set on it`
          : ""
      }`,
    resourceChanged: "Settings changed outside AgentPack. Refresh before retrying.",
    errors: {
      PI_PACKAGE_SOURCE_UNSAFE:
        "Package URLs cannot contain credentials or query tokens. Use SSH configuration or a credential helper.",
      PI_PROJECT_APPROVAL_REQUIRED: "Approve the project before changing its Pi packages.",
      PI_SETTINGS_INVALID_JSON: "Pi settings contain invalid JSON. Fix them before continuing.",
      PI_SETTINGS_EXPECTED_OBJECT: "Pi settings must contain a JSON object.",
      PI_DELTA_RESOURCE_PATH_REQUIRED: "No installed resource paths are available to override.",
      PI_RESOURCE_EXACT_PATH_REQUIRED: "Only exact resource paths can be enabled or disabled.",
      PI_SETTINGS_CHANGED: "Pi settings changed after review. Refresh before retrying.",
    } as Record<string, string>,
    resources: {
      extensions: "Extensions",
      skills: "Skills",
      prompts: "Prompts",
      themes: "Themes",
    } as Record<string, string>,
    authStatuses: {
      ready: "Ready",
      valid: "Valid",
      configured: "Configured",
      expired: "Expired",
      missing: "Missing",
      not_ready: "Not ready",
      invalid: "Invalid",
    } as Record<string, string>,
    authSources: {
      authFile: "Auth file",
      builtin: "Built in",
      settings: "Settings",
      environment: "Environment",
    } as Record<string, string>,
    authTypes: {
      oauth: "OAuth",
      api_key: "API key",
      environment: "Environment variable",
    } as Record<string, string>,
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
      "Environment tools include the terminal and runtimes the CLIs and MCP servers need to run.",
    skills:
      "Skills are reusable instruction packs that teach the AI how to do specific engineering tasks well.",
    mcp: "MCP servers are plugins that extend the AI with new abilities — web access, memory, GitHub, and more.",
    pi: "Pi packages bundle extensions, skills, prompts and themes into one install. A package runs with your own permissions, so the app asks before every one.",
    network:
      "Set up a proxy (detected automatically) and mirrors — everything the CLIs need on a restricted or slow network. API relay endpoints live under Accounts & relays.",
    ccswitch:
      "Manage official accounts and relay providers for Claude Code, Codex, and OpenCode. Use Agentpack's independent store or share CC Switch's database.",
    ccconnect:
      "cc-connect bridges your local coding agents to chat apps (Feishu, Slack, Telegram…) so you can drive them from anywhere.",
    history:
      "Every chat you have with a CLI is saved on your own machine. agentpack reads those files — it never uploads them — and adds up what the tokens cost.",
  },

  /**
   * Quick setup, read top to bottom: one decision, one optional detour, one
   * destination. The old four-tile metric strip is gone — it restated the
   * selection panel and the change tray, so the same three numbers appeared
   * three times on one screen.
   */
  presetsScreen: {
    title: "Choose a preset",
    subtitle: "A preset pre-fills your selections; you can still adjust each step.",
    actionsLabel: "Selected items",
    catalogPanel: "Preset and component selection",
    /** Step 01 — the only decision someone new has to make. */
    stepPick: "Start from a preset",
    stepPickHint: "One click stages everything. Most people want Recommended.",
    /** Marks the default row, so it can't just repeat the word "Recommended". */
    startHereTag: "Start here",
    /** The mono readout on each row: what that preset stages, in numbers. */
    presetCounts: (clis: number, skills: number, mcps: number) =>
      [
        `${clis} ${clis === 1 ? "CLI" : "CLIs"}`,
        skills > 0 ? `${skills} ${skills === 1 ? "skill" : "skills"}` : null,
        `${mcps} MCP ${mcps === 1 ? "server" : "servers"}`,
      ]
        .filter(Boolean)
        .join(" · "),
    presetCountsCustom: "Nothing pre-selected",
    /** Step 02 — the three checklists, folded away until they are asked for. */
    stepTune: "Fine-tune",
    stepTuneTag: "Optional",
    stepTuneHint: (clis: number, skills: number, mcps: number) =>
      `Tick items yourself — ${clis} CLIs, ${skills} skills and ${mcps} MCP servers in the catalog.`,
    tuneShow: "Customise",
    tuneHide: "Hide",
    /** Step 03 — states what the change tray does before it is pressed. */
    stepReview: "Review and install",
    stepReviewHint:
      "agentpack lists every command and file first. Nothing is written until you approve it.",
    reviewAction: (n: number) => `Review ${n} changes`,
    selectedCount: (n: number) => `${n} items staged`,
    emptyHint: "Pick a preset above to stage an install.",
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
    summaryLabel: "CLI status summary",
    actionsLabel: "CLI selection guidance",
    catalogPanel: "CLI catalog",
    overviewTitle: "How installing works",
    overviewHint: "Selections are staged in the change tray and reviewed before installation.",
    metricCatalog: "Catalog",
    metricInstalled: "Installed",
    metricSelected: "Selected",
    metricUpdates: "Updates",
    metricPending: "Waiting for desktop detection",
    upgradeNote: "Tick an already-installed tool to upgrade it to the latest version.",
    installedSuffix: "  (installed)",
    notTauri:
      "Install status can't be checked here — run the desktop app to see what's already on your machine and to install anything.",
    /** Headings for the two halves of the catalog (see `CliKind`). */
    kinds: {
      agent: "Coding agents",
      companion: "Companions",
    } as Record<string, string>,
    kindNotes: {
      agent: "The agents themselves — pick as many as you use.",
      companion: "Tools that manage or connect the agents above.",
    } as Record<string, string>,
  },

  environment: {
    title: "Environment",
    subtitle:
      "Check the terminal and runtimes your agent tools depend on, then install anything missing.",
    summaryLabel: "Environment status summary",
    actionsLabel: "Environment detection controls",
    catalogPanel: "Environment catalog",
    detectionTitle: "Detection and installation",
    metricCatalog: "Tools",
    metricInstalled: "Installed",
    metricMissing: "Missing",
    metricPending: "Waiting for desktop detection",
    detecting: "Detecting installed environment tools…",
    notTauri: "Environment detection needs the desktop app — here the versions below stay blank.",
    installHint: "Missing a tool? Install it directly — detection re-runs after each install.",
    noInstaller: "No automated installer on this OS — see the note below.",
    recheck: "Re-detect",
    windowsBuildRequired: (build: number) =>
      `Requires Windows 10 2004 or later (build ${build}+). Update Windows before installing.`,
    notManaged: (manager: string) =>
      `Not installed via ${manager}, so it can't be updated or reinstalled here — download the latest version from the official site instead.`,
  },

  /**
   * Environment cleanup.
   *
   * `impact` is the load-bearing string in this block. A row that says only
   * "Chat records · 1.9 GB" is a number next to a checkbox; the user needs to
   * know that ticking it also empties the Chat history section. Every `impact`
   * below answers "what do I lose", never "what is this".
   */
  cleanup: {
    title: "Clean up",
    subtitle:
      "The agent CLIs keep every transcript, cache and log forever. Clear what you don't need — nothing here can touch your credentials, config or installed skills.",
    summaryLabel: "Cleanup status summary",
    actionsLabel: "Cleanup recovery",
    targetsPanel: "Cleanup targets",
    trashPanel: "Cleanup trash",
    metricReclaimable: "Reclaimable",
    metricTargets: "Targets",
    metricSelected: "Selected",
    metricTrash: "In trash",
    metricPending: "Waiting for disk scan",
    metricUnavailable: "Available in the desktop app",
    metricReadFailed: (reason: string) => `Recycle-area read failed: ${reason}`,
    notTauri: "Cleaning needs the desktop app — in the browser there is no machine to scan.",
    scan: "Rescan",
    scanning: "Measuring what's on disk…",
    scanFailed: (reason: string) => `Disk scan failed: ${reason}. Rescan to try again.`,
    empty: "Nothing to clean — no caches or records found for the tools on this machine.",
    emptyHint: "Install Claude Code, Codex or OpenCode and their data will show up here.",
    reclaimable: (size: string) => `${size} can be cleared`,
    selectedSummary: (size: string, files: number) => `${size} selected · ${files} file(s)`,
    nothingSelected: "Pick what to clear",
    clean: "Clean selected…",
    /** Selects, never cleans — the name says so, because Clean is a separate step. */
    quickClean: "Select caches",
    quickCleanHint:
      "Adds only the safe, regenerated items to your selection — nothing you wrote. Nothing is removed until you review it.",
    quickCleanNone: "No regenerated caches were found, so there is nothing safe to select at once.",
    selectAll: "Select all",
    clearSelection: "Clear",
    degraded: "Part of this couldn't be read, so the size is a minimum.",
    running: (name: string) => `${name} is running — close it first, or files it holds open stay.`,
    spanning: (from: string, to: string) => `${from} – ${to}`,
    fileCount: (n: number) => `${n} file(s)`,
    pathsLabel: "Paths",

    apps: {
      claude: "Claude Code",
      codex: "Codex",
      opencode: "OpenCode",
      copilot: "Copilot CLI",
      cursor: "Cursor CLI",
      "cc-switch": "cc-switch",
      agentpack: "agentpack",
    } as Record<string, string>,

    categories: {
      cache: "Caches",
      logs: "Logs & telemetry",
      artifacts: "Generated files",
      backups: "Old backups",
      state: "Working state",
      chats: "Chat records",
      hooks: "Hooks",
    } as Record<string, string>,

    risks: {
      safe: "Regenerated",
      review: "Your data",
      behavioural: "Changes behaviour",
    } as Record<string, string>,

    riskHints: {
      safe: "Rebuilt automatically the next time the tool runs.",
      review: "Real content. Recoverable from the recycle area until you empty it.",
      behavioural: "Changes how the agent behaves, not just what it stores.",
    } as Record<string, string>,

    /** Per-target copy. Keys match `CLEANUP_TARGETS` / `CLEANUP_CONFIG_TARGETS`. */
    targets: {
      "claude-chats": {
        title: "Chat transcripts",
        impact:
          "Every past Claude Code session, including sub-agent runs. They also disappear from the Chat history section and from its usage totals.",
      },
      "claude-prompt-history": {
        title: "Prompt history",
        impact: "The list ↑ recalls in the Claude Code prompt.",
      },
      "claude-plans": {
        title: "Saved plans",
        impact: "Plan documents written during plan mode.",
      },
      "claude-tasks": {
        title: "Task & session state",
        impact:
          "Todo lists and per-session scratch state. A session you resume later starts without its todos.",
      },
      "claude-file-history": {
        title: "File edit history",
        impact:
          "Copies of files kept so an edit can be undone. Undo stops reaching past this point.",
      },
      "claude-shell-snapshots": {
        title: "Shell snapshots",
        impact: "A copy of your shell environment per session. Re-created on the next run.",
      },
      "claude-cache": {
        title: "Plugin & lookup caches",
        impact: "Downloaded plugin payloads and lookup caches. Re-fetched on demand.",
      },
      "claude-mcp-logs": {
        title: "MCP server logs",
        impact: "Per-project logs from MCP servers, in the OS cache directory.",
      },
      "claude-telemetry": {
        title: "Unsent telemetry",
        impact: "Analytics events that failed to upload and are queued forever.",
      },
      "claude-config-backups": {
        title: "Rotated config backups",
        impact:
          "Old copies of ~/.claude.json. The live file is never touched — only its dated backups.",
      },
      "claude-hooks": {
        title: "Hooks in settings.json",
        impact:
          "The hook commands Claude Code runs around each tool call, in settings.json. The rest of your settings stay, and the file is backed up first.",
      },
      "claude-project-history": {
        title: "Per-project prompt history",
        impact:
          "The prompt log ~/.claude.json keeps for every project you have ever opened. Projects and their settings stay; only the typed history is emptied.",
      },
      "codex-chats": {
        title: "Chat transcripts",
        impact:
          "Every past Codex thread. They also disappear from the Chat history section and from its usage totals.",
      },
      "codex-archived-chats": {
        title: "Archived threads",
        impact: "Threads you archived rather than deleted.",
      },
      "codex-prompt-history": {
        title: "Prompt & voice history",
        impact: "Typed prompt history and voice transcription records.",
      },
      "codex-logs": {
        title: "Log database",
        impact:
          "Codex's log database and its write-ahead files. Often the single largest thing it keeps. Close Codex first.",
      },
      "codex-shell-snapshots": {
        title: "Shell snapshots",
        impact: "A copy of your shell environment per thread. Re-created on the next run.",
      },
      "codex-generated": {
        title: "Images & attachments",
        impact:
          "Images, visualisations and attachments produced during threads. Anything you want to keep, copy out first.",
      },
      "codex-cache": {
        title: "Model & plugin caches",
        impact: "Model lists, app directory and plugin download caches. Re-fetched on demand.",
      },
      "codex-temp": {
        title: "Temp & interrupted writes",
        impact: "Scratch directories and half-written state files left behind by crashes.",
      },
      "codex-hooks-file": {
        title: "hooks.json",
        impact:
          "hooks.json — the commands Codex runs around tool calls. Removing it turns every hook off.",
      },
      "opencode-chats": {
        title: "Chat database",
        impact:
          "OpenCode stores every session in one database. Clearing it removes all of them, and empties OpenCode from the Chat history section. Close OpenCode first.",
      },
      "opencode-cache": {
        title: "Caches & logs",
        impact: "Re-created on the next run.",
      },
      "copilot-logs": {
        title: "Session logs",
        impact: "One log file per Copilot CLI process, kept indefinitely.",
      },
      "cursor-hooks": {
        title: "hooks.json",
        impact:
          "The commands Cursor CLI runs around tool calls. Removing the file turns every hook off.",
      },
      "agentpack-activity": {
        title: "agentpack activity log",
        impact: "The record of what this app changed on this machine, and when.",
      },
      "agentpack-history-cache": {
        title: "Chat history cache",
        impact:
          "agentpack's parsed copy of your transcripts. Clearing it costs one slow rescan, never any data.",
      },
      "cc-switch-backups": {
        title: "cc-switch snapshots",
        impact:
          "Config restore points taken before each provider switch. Clearing them removes those undo points.",
      },
    } as Record<string, { title: string; impact: string }>,

    age: {
      label: "Keep the last",
      all: "Everything",
      days: (n: number) => `${n} days`,
      note: "Applies to dated records only — caches and databases are all-or-nothing.",
    },

    mode: {
      label: "How to remove",
      quarantine: "Move to the recycle area",
      quarantineHint: "Instant, and undoable until you empty it. Disk space comes back on empty.",
      delete: "Delete permanently",
      deleteHint: "Frees the space now. Cannot be undone.",
    },

    /**
     * The recycle area. Named for what it is rather than "trash": it is not the
     * OS trash, emptying it is a separate deliberate act, and it holds the only
     * copy of whatever was cleared.
     */
    trash: {
      title: "Recycle area",
      subtitle:
        "Cleared items wait here until you put them back or empty it. They still take up disk space until then.",
      empty: "Nothing here.",
      loading: "Reading the recycle area…",
      unavailable: "The recycle area is only available in the desktop app.",
      loadFailed: (reason: string) => `Could not read the recycle area: ${reason}. Try again.`,
      unknownError: "Unknown system error",
      retry: "Try again",
      holding: (size: string, batches: number) => `${size} across ${batches} batch(es)`,
      restore: "Put back",
      restoreAll: "Put everything back",
      purge: "Empty",
      purgeAll: "Empty everything",
      purgeConfirmTitle: "Empty the recycle area?",
      purgeBatchConfirmTitle: "Empty this batch?",
      purgeConfirmBody: (size: string) =>
        `${size} will be deleted permanently. This is the only copy — it cannot be undone.`,
      batch: (items: number, size: string) => `${items} item(s) · ${size}`,
      restored: (count: number) => `Put back ${count} item(s).`,
      restoreSkipped: (count: number) =>
        `${count} item(s) stayed here — the tool has written to those paths again since.`,
      purged: (size: string) => `Emptied — ${size} freed.`,
    },
  },

  skills: {
    title: "Select domain skills to install",
    installsTo: (targets: string) => `Installs to: ${targets}`,
  },

  mcp: {
    title: "MCP servers",
    subtitle:
      "Plugins that extend the AI — add any to Claude Code, Codex or OpenCode, wire up custom servers, and manage everything already on disk.",
    keySuffix: " (key)",
    installed: "✔ installed",
    notInstalled: "○ not installed",
    // Management UI (GUI): search, filters, per-card actions, custom servers.
    searchPlaceholder: "Search MCP servers…",
    filterAll: "All",
    filterInstalled: "Installed",
    filterNotInstalled: "Not installed",
    filterNeedsKey: "Needs key",
    filterTarget: "Target",
    /** Why the Target select is disabled — it narrows the two presence chips only. */
    filterTargetHint: "Pick Installed or Not installed first — the target narrows those two.",
    filterAnyTarget: "Any target",
    filterTransport: "Transport",
    filterAnyTransport: "Any transport",
    filterAuth: "Authentication",
    filterAnyAuth: "Any authentication",
    filterNoKey: "No key required",
    /** The one button the three refinement selects fold into. */
    filtersLabel: "Filters",
    filtersReset: "Clear filters",
    sortLabel: "Sort by",
    needsKeyBadge: "key",
    docs: "Docs",
    addNow: "Add now",
    removeNow: "Remove now",
    noResults: "No MCP servers match your search.",
    summary: (installed: number, total: number) => `${installed} / ${total} installed`,
    customTitle: "Custom & user-added",
    // Online registry search
    registryTitle: "Registry (online)",
    registryHint: "Search the official MCP registry — type at least 2 characters.",
    registrySearching: "Searching the registry…",
    registryEmpty: "No registry servers match.",
    registryError: "Couldn't reach the registry. Showing the featured catalog only.",
    registryLoadMore: "Load more",
    registryRetry: "Retry",
    registryMoreError: "Couldn't load more results from the registry.",
    registryAdd: "Add…",
    registryUnsupportedOci: "Container-only (Docker) — not installable here",
    registryAddTitle: (name: string) => `Add "${name}" from the registry`,
    customHint: "Servers found in your config that aren't in the catalog.",
    /** Category header labels, keyed by McpCategory. */
    categories: {
      memory: "Memory & knowledge",
      search: "Search & docs",
      web: "Web & browser",
      dev: "Developer tools",
      reasoning: "Reasoning",
    } as Record<string, string>,
    // --- Redesigned tabbed manager (v2) -----------------------------------
    refresh: "Rescan",
    notTauri: "MCP management is only available in the desktop app.",
    loading: "Scanning MCP config…",
    tabCatalog: "Catalog",
    tabInstalled: "Installed",
    tabAdd: "Add custom",
    statTotal: "Catalog",
    statInstalled: "Installed",
    statNeedsKey: "Needs key",
    /** Why the per-target counts read "—" before the first scan lands. */
    statPending: "Waiting for the first scan of your config files",
    summaryLabel: "MCP summary",
    actionsLabel: "MCP management views",
    catalogPanel: "MCP catalog",
    installedPanel: "Configured MCP servers",
    installedListLabel: "Configured MCP servers",
    /** Said once above the list, so no row has to explain its own chips. */
    catalogHint:
      "Each row lists the agents it can be added to. Click one to add the server there; click it again to remove it.",
    keyAdd: (envVar: string) => `Add API key (${envVar})`,
    // A key typed here used to reach only the *next* add. For a server that is
    // already installed — the case the completion screen's to-do sends people
    // here for — this is the write that puts it into the agents' config.
    keyApply: (n: number) => `Write key to ${n} installed agent${n === 1 ? "" : "s"}`,
    keyApplyTitle: (server: string) => `Set the API key for ${server}`,
    keyPending: "Used when you add this server to an agent.",
    installedActionHint: "The servers already configured across your agents.",
    catalogActionHint: "Browse the built-in catalog and add a server to any agent.",
    matrixActionHint: "Compare Claude Code, Codex, and OpenCode side by side.",
    addActionHint: "Create a stdio, HTTP, or SSE server, or import JSON and commands.",
    detailPanel: "MCP management details",
    /** Per-target display labels, keyed by McpTarget. */
    targets: {
      claude: "Claude Code",
      codex: "Codex",
      opencode: "OpenCode",
    } as Record<string, string>,
    addToTarget: (target: string) => `Add to ${target}`,
    removeFromTarget: (target: string) => `Remove from ${target}`,
    claudeMissing: "Install Claude Code first",
    keyPlaceholder: "API key (optional — set the env var later if blank)",
    showKey: "Show key",
    hideKey: "Hide key",
    installedOn: "Installed on",
    // Installed tab
    empty: "No MCP servers configured yet. Add one from the built-in catalog.",
    emptyBrowse: "Browse the catalog",
    emptyFiltered: "No servers match your filter.",
    sortName: "Name",
    sortTargets: "Most targets",
    actions: "Actions",
    view: "View config",
    edit: "Edit",
    remove: "Remove",
    customBadge: "custom",
    bundledBadge: "catalog",
    removeConfirmTitle: (name: string) => `Remove "${name}"?`,
    removeConfirmBody: (targets: string) =>
      `This deletes the server from ${targets}. You can add it back later.`,
    cancel: "Cancel",
    confirmRemove: "Remove",
    // Add-custom / edit form
    addTitle: "Add a custom MCP server",
    addHint: "Point any agent at a local command or a remote URL.",
    editTitle: (name: string) => `Edit "${name}"`,
    fieldId: "Server id",
    fieldIdHint: "Unique lowercase id, e.g. my-server.",
    fieldTransport: "Transport",
    transportStdio: "Local (stdio)",
    transportHttp: "Remote (HTTP)",
    transportSse: "Remote (SSE)",
    fieldCommand: "Command",
    fieldCommandHint: "e.g. npx, uvx, python, or an absolute path.",
    fieldArgs: "Arguments (one per line)",
    fieldEnv: "Environment variables",
    fieldUrl: "Server URL",
    fieldToken: "Bearer token",
    fieldTokenHint: "Sent as an Authorization header to Claude / OpenCode.",
    fieldTokenEnvVar: "Token env var (Codex)",
    fieldTokenEnvVarHint: "Codex reads the token from this env var rather than storing it.",
    fieldExtraHeaders: "Other headers",
    fieldExtraHeadersHint:
      "Sent with every request by Claude Code and OpenCode. Codex stores no headers.",
    headerNamePlaceholder: "Header-Name",
    addHeader: "Add header",
    removeRow: "Remove row",
    envKeyPlaceholder: "NAME",
    envValuePlaceholder: "value",
    envRefPlaceholder: "HOST_VAR",
    envRefLabel: "ref",
    envRefOn: "References a host env var (never written to disk)",
    envRefOff: "Stores a literal value",
    addRow: "Add row",
    selectTargets: "Install into",
    addServer: "Add server",
    saveChanges: "Save changes",
    errIdRequired: "Enter a server id.",
    errIdFormat: "Use lowercase letters, digits and dashes only.",
    errIdReserved: "That id is a built-in catalog server — use the Catalog tab.",
    errIdExists: "A server with that id is already configured.",
    errCommandRequired: "Enter a command.",
    errUrlRequired: "Enter a server URL.",
    errTargetRequired: "Select at least one agent.",
    errCodexTokenEnv: "Codex needs a token env-var name when a bearer token is set.",
    errAuthorizationTwice: "Set either the bearer token or an Authorization header, not both.",
    capCodexNoSse: "Codex only supports streamable-HTTP, not standalone SSE.",
    // Detail dialog
    detailConfigTitle: "Configuration by agent",
    detailNotConfigured: "Not configured on any agent yet.",
    detailPresence: "Configured on",
    detailRaw: "Raw config",
    detailReading: "Reading config…",
    detailUnreadable:
      "Listed in this agent's config, but its entry couldn't be parsed — open the file to check it.",
    copy: "Copy",
    copied: "Copied",
    fieldHeaders: "Headers",
    fieldBearerEnv: "Bearer token env var",
    category: "Category",
    // Health check / test
    test: "Test",
    testAll: "Test all",
    testing: "Testing…",
    healthOk: "OK",
    healthFail: "Failed",
    healthUnknown: "Not tested",
    healthCmdOk: (cmd: string) => `${cmd} found on PATH`,
    healthCmdMissing: (cmd: string) => `${cmd} not found on PATH`,
    healthHttpOk: (ms: number) => `Reachable · ${ms} ms`,
    healthHttpReachable: "Reachable",
    healthHttpUnreachable: "Endpoint unreachable",
    healthBadUrl: "Invalid server URL",
    // Deep test (real MCP handshake) + export
    deepTest: "Deep test",
    deepTesting: "Running MCP handshake…",
    probeOk: (info: string) => `Speaks MCP · ${info}`,
    probeUnauthorized: "Reachable, but unauthorized — check the key",
    probeUnreachable: "Unreachable",
    probeNotMcp: "Reachable, but not an MCP server",
    probeTimeout: "Timed out",
    probeSpawnFailed: "Couldn't start the server",
    probeHttp: (code: string) => `HTTP ${code}`,
    probeFailed: (msg: string) => `Couldn't run the handshake: ${msg}`,
    exportShareable: "Export (shareable, secrets redacted)",
    // Import from paste
    importCardTitle: "Import from JSON or a command",
    importCardHint:
      "Paste an mcpServers block, a single server object, or a claude mcp add … line.",
    importOpen: "Paste & import",
    importDialogTitle: "Import MCP servers",
    importPlaceholder: 'Paste JSON or a "claude mcp add …" command…',
    importParseError: "Couldn't parse — paste valid JSON or a claude mcp add … command.",
    importUnsupported: "No MCP servers found in that input.",
    importFound: (n: number) => `${n} server${n === 1 ? "" : "s"} to import`,
    importButton: (n: number) => `Import ${n}`,
    importSelectTargets: "Import into",
    importCollision: "already configured — importing overwrites it",
    /** An SSE server in the paste, with Codex ticked: Codex has no SSE transport. */
    importSkipsCodex: "SSE · not written to Codex",
    // Overview matrix
    tabMatrix: "Overview",
    matrixHint: "Which servers are configured on which CLI. Click a cell to add or remove.",
    matrixServer: "Server",
    copyToTarget: (target: string) => `Copy to ${target}`,
    copyReading: "Reading this server's config…",
    copyNoSpec:
      "Couldn't read this server's entry from any agent's config, so there is nothing to copy.",
  },

  mcpKeys: {
    title: (index: number, total: number) => `API keys (${index}/${total})`,
    hint: "Paste the key and press enter, or press enter to skip (placeholder kept).",
  },

  network: {
    titleOptional: "Network configuration (optional)",
    title: "Network configuration",
    ask: "Configure a proxy and an npm mirror? (API endpoints are managed in the providers section.)",
    summaryLabel: "Network status summary",
    actionsLabel: "Network discovery",
    proxyPanel: "Proxy configuration",
    mirrorsPanel: "Package and download mirrors",
    metricCandidates: "Detected proxies",
    metricReachable: "Reachable mirrors",
    metricScan: "Scan status",
    scanReady: "Measured",
    scanPending: "Not measured",
    scanFailed: "Scan failed",
    scanError: (reason: string) => `Network scan failed: ${reason}. Run the scan again to retry.`,
    configureNow: "Configure now? ",
    registryLabel: "npm registry mirror URL:",
    desktopOnly: "Proxy detection needs the desktop app.",

    discovery: {
      title: "Detected proxies",
      subtitle: "Looks in env vars, OS settings, npm/git config and the usual local ports.",
      scan: "Scan again",
      scanning: "Scanning…",
      empty:
        "No proxy found on this machine. If you have one, choose Manual under Proxy and enter it.",
      /** No reading at all — distinct from `empty`, which is a scan that found nothing. */
      unmeasured: "Not scanned yet, so nothing here is measured. Scan again to look for a proxy.",
      failed: "The last scan didn't finish, so nothing here is measured. Scan again to retry.",
      use: "Use",
      test: "Test",
      pacNote: (url: string) =>
        `Your system uses an automatic configuration script (${url}). agentpack can't evaluate it — enter the proxy address it hands out manually.`,
      source: {
        env: "Environment",
        system: "System",
        npm: "npm",
        git: "git",
        port: "Local app",
      } as Record<string, string>,
    },

    proxy: {
      title: "Proxy",
      subtitle: "Where your agent CLIs, npm and git send their traffic.",
      active: "Active",
      inactive: "Off",
      mode: {
        off: "Off",
        system: "Follow system",
        manual: "Manual",
      } as Record<string, string>,
      modeHint: {
        off: "Nothing is written, and existing proxy settings are left as they are.",
        system:
          "Adopts what this machine already advertises. The values are still written out, because the CLIs don't read the OS proxy panel themselves.",
        manual: "Use exactly the addresses you enter below.",
      } as Record<string, string>,
      httpLabel: "HTTP proxy",
      httpsLabel: "HTTPS proxy",
      httpsHint: "Leave one empty to reuse the other.",
      allLabel: "SOCKS proxy (ALL_PROXY)",
      allHint: "Used by npm, git and curl. Claude Code does not support SOCKS.",
      noProxyLabel: "Bypass list (NO_PROXY)",
      noProxyHint: "Comma- or space-separated hosts. Use * to bypass everything.",
      socksWarning:
        "Only a SOCKS proxy is set, and Claude Code can't use one — add an HTTP proxy address, or drop Claude Code from the targets below.",
      advanced: "Authentication & TLS",
      username: "Proxy username",
      password: "Proxy password",
      passwordHint:
        "Written into the proxy URL wherever it is applied (that's how proxy auth works), and never included in an exported config file.",
      caCert: "Extra CA certificate (NODE_EXTRA_CA_CERTS)",
      caCertHint: "For a TLS-inspecting corporate proxy that signs traffic with its own root.",
      insecure: "Skip TLS certificate verification",
      insecureHint:
        "Sets NODE_TLS_REJECT_UNAUTHORIZED=0. Unsafe — only as a last resort, and prefer the CA certificate above.",
      clientCert: "Client certificate (mTLS)",
      clientKey: "Client private key (mTLS)",
      clientKeyPassphrase: "Private key passphrase",
      targets: "Write the proxy into",
      target: {
        claude: "Claude Code settings",
        npm: "npm config",
        git: "git config",
        shell: "Shell profile",
      } as Record<string, string>,
      targetHint: {
        claude: "~/.claude/settings.json → env",
        npm: "proxy · https-proxy · noproxy",
        git: "http.proxy · https.proxy",
        shell: "The only way Codex and OpenCode see it",
      } as Record<string, string>,
      apply: "Apply proxy",
      clear: "Clear proxy",
      needsUrl: "Enter a proxy address first.",
      /** Off leaves an applied proxy in place, so Clear has to stay reachable. */
      stillApplied:
        "A proxy applied earlier is still saved, and Off leaves it wherever it was written. Clear proxy removes it.",
      notTauri:
        "Applying, clearing and testing a proxy need the desktop app — in the browser there is no machine to write to.",
      testTitle: "Connectivity test",
      testTargetLabel: "Test against",
      testRun: "Run test",
      testing: "Testing…",
      testDirect: "No proxy (direct)",
      testOk: (status: number, ms: number) => `Reachable — HTTP ${status} in ${ms} ms`,
      testFail: (reason: string) => `Failed — ${reason}`,
      reason: {
        ok: "ok",
        "proxy-auth": "the proxy demands credentials (HTTP 407)",
        "proxy-refused": "the proxy refused the connection",
        unreachable: "could not connect",
        dns: "the host name could not be resolved",
        timeout: "timed out",
        "bad-proxy-url": "that proxy address can't be parsed",
        tls: "the TLS handshake failed",
        failed: "the request failed",
      } as Record<string, string>,
    },

    mirrors: {
      title: "Mirrors",
      subtitle: "Package and download sources, for when the defaults are slow or blocked.",
      npmLabel: "npm registry",
      ghLabel: "GitHub download mirror",
      ghHint:
        "Prefix put in front of GitHub downloads when installing skills from a repository. Applies immediately.",
      pypiLabel: "PyPI index (uv / pip)",
      brewLabel: "Homebrew",
      autoHint:
        "Used automatically to retry an install that failed on the network — applied for that command only, never saved to your machine.",
    },

    /** Measured results from the background network probe. */
    probe: {
      title: "Network check",
      running: "Checking your network…",
      recheck: "Check again",
      unreachable: "unreachable",
      directOk: "Direct connection works — no proxy needed.",
      directBlocked:
        "Direct connection failed. agentpack will route installs through what it found.",
      proxyFound: (host: string, ms: number) => `Found a working proxy: ${host} (${ms}ms)`,
      noProxyFound: "No working proxy found on this machine.",
      fastestMirror: (kind: string, label: string) => `Fastest ${kind}: ${label}`,
      // PyPI and Homebrew are env vars agentpack only injects into a failed
      // step's retry, so Adopt cannot apply them. Say so beside them rather than
      // listing four mirrors under a button that applies two.
      retryOnly: "used automatically if an install fails",
      adopt: "Use these settings",
      adopted: "Applied.",
      skip: "Skip for now",
      nothingToDo: "Your network looks fine — nothing to change.",
    },
  },

  review: {
    title: "Review plan",
    dryRunSuffix: " (dry-run — nothing will be changed)",
    /** The two explicit exits from the review gate. */
    heading: "Review changes",
    stepCount: (n: number) => `${n} step${n === 1 ? "" : "s"} will run on this machine.`,
    previewOnly: "Preview only",
    previewing: "Previewing…",
    previewDone: "Previewed — nothing was written. Apply when you're ready.",
    apply: "Apply changes",
    applying: "Applying…",
    discard: "Discard",
    /** Each step's state as a word — the icon beside it is colour and shape only. */
    status: {
      pending: "waiting",
      running: "running",
      done: "done",
      error: "failed",
      skipped: "skipped",
      warning: "needs attention",
    },
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

  /** The end of a run: verdict, one next action, and what still needs a human. */
  completion: {
    done: "All set",
    partial: "Finished, with some problems",
    // A run the user stopped, and a run that finished but had something to say.
    // Neither is "All set", which is what they used to be reported as.
    cancelled: "Stopped before it finished",
    withWarnings: "Done, with a couple of notes",
    counts: (ok: number, warned: number, failed: number) =>
      [
        `${ok} done`,
        warned ? `${warned} needing attention` : "",
        failed ? `${failed} could not be completed` : "",
      ]
        .filter(Boolean)
        .join(" · "),
    openApp: (name: string) => `Open ${name}`,
    cliHint: "Open your terminal and run:",
    copied: "Copied",
    todoTitle: "Still to do",
    todoKey: (env: string) =>
      `Add your ${env} key under Capabilities → MCP servers — the server is installed but can't run without it.`,
    todoOpenMcp: "Open MCP servers",
    todoSignIn: "Sign in to Claude when it opens. The Code tab needs a paid plan.",
    todoWindowsGit: "Install Git — Claude needs it to work with local folders on Windows.",
    todoCcSwitchGateway:
      "Keep cc-switch running while you use Claude, and restart Claude after switching provider.",
    details: "Show the full log",
  },

  verify: {
    claudeVersion: "Verify Claude Code (claude --version)",
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
    notABundle: "That file isn't an agentpack backup or config.",
    bundleTooNew: (v: string) =>
      `This backup was written by a newer agentpack (format ${v}). Update the app to import it.`,
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
      "claude-desktop": {
        title: "Claude Desktop",
        description:
          "Claude Code in a window — no terminal and no Node.js needed. Shares your ~/.claude setup, so skills and plugins apply to both.",
      },
      "codex-app": {
        title: "Codex app",
        description:
          "Codex in a window instead of the terminal — now part of the ChatGPT desktop app. Shares your ~/.codex setup, so plugins apply to both.",
      },
      codex: {
        title: "OpenAI Codex",
        description: "OpenAI's terminal coding agent (@openai/codex).",
      },
      "cc-switch": {
        title: "cc-switch",
        description: "Desktop GUI to manage/switch API providers for Claude Code & Codex.",
      },
      "cc-connect": {
        title: "cc-connect",
        description: "Bridge local coding agents to Feishu, Slack, Telegram & more (cc-connect).",
      },
      opencode: {
        title: "OpenCode",
        description: "Open-source terminal coding agent (opencode-ai).",
      },
      pi: {
        title: "Pi",
        description: "Extensible terminal coding agent (@earendil-works/pi-coding-agent).",
      },
      "gemini-cli": {
        title: "Gemini CLI",
        description: "Google's open-source terminal agent, powered by Gemini (@google/gemini-cli).",
      },
      "qwen-code": {
        title: "Qwen Code",
        description: "Alibaba's terminal coding agent for the Qwen models (@qwen-code/qwen-code).",
      },
      "copilot-cli": {
        title: "GitHub Copilot CLI",
        description: "GitHub's Copilot coding agent in your terminal (@github/copilot).",
      },
      crush: {
        title: "Crush",
        description: "Charm's terminal coding agent — bring your own model (@charmland/crush).",
      },
      amp: {
        title: "Amp",
        description: "Sourcegraph's terminal coding agent (@ampcode/cli).",
      },
      cline: {
        title: "Cline",
        description: "The open-source Cline agent, as a terminal CLI (cline).",
      },
      auggie: {
        title: "Auggie",
        description:
          "Augment Code's terminal agent, built around a codebase index (@augmentcode/auggie).",
      },
      droid: {
        title: "Droid",
        description: "Factory's terminal coding agent. Installs a native binary — no Node needed.",
      },
      "cursor-cli": {
        title: "Cursor CLI",
        description:
          "Cursor's agent outside the editor. Installs a native binary — no Node needed.",
      },
    } as Record<string, { title: string; description: string }>,
    runtime: {
      "windows-terminal": {
        title: "Windows Terminal",
        description: "Microsoft's modern terminal app — available on Windows 10 2004 and later.",
      },
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
      github: {
        title: "GitHub",
        purpose: "Issues, PRs, code search, repo management (hosted remote server).",
      },
      playwright: {
        title: "Playwright",
        purpose: "Browser automation & DOM inspection.",
      },
      everything: {
        title: "Everything (reference)",
        purpose: "Reference server exercising every MCP feature — handy for testing.",
      },
      firecrawl: {
        title: "Firecrawl",
        purpose: "Crawl & scrape websites into clean markdown.",
      },
      airtable: {
        title: "Airtable",
        purpose: "Read & write Airtable bases and records.",
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
      store: {
        title: "Microsoft Store",
        description: "Open the product page, finish installation, then re-detect.",
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
    // Alternative routes, only run when the primary one failed on the network.
    installCliVia: (title: string, method: string) => `Install ${title} via ${method}`,
    installRuntimeVia: (title: string, method: string) => `Install ${title} via ${method}`,
    installFromRelease: (title: string) => `Install ${title} from its GitHub release`,
    noInstaller: (title: string) => `No automated installer for ${title} on this OS.`,
    manualInstall: "manual install required",
    nodeTooOld: (title: string, need: number | string, found: string) =>
      `${title} requires Node.js ${need} or newer, but Node ${found} is installed.`,
    nodeTooOldFix: (need: number | string) =>
      `Update Node.js to ${need}+ in the Environment section, or install this CLI with its native installer instead (CLIs section → install method).`,
    saveConfig: (path: string) => `Save config → ${path}`,
    savedConfigTo: (path: string) => `saved replayable config to ${path}`,
    installSkill: (title: string, targets: string) => `Install skill "${title}" → ${targets}`,
    uninstallSkill: (title: string, targets: string) => `Uninstall skill "${title}" ← ${targets}`,
    copySkill: (title: string, targets: string) => `Copy skill "${title}" → ${targets}`,
    installRepoSkills: (count: number, targets: string) =>
      `Install ${count} skill${count === 1 ? "" : "s"} from repo → ${targets}`,
    updateSkill: (name: string, targets: string) => `Update skill "${name}" → ${targets}`,
    backupSkill: (name: string) => `Back up skill "${name}" before delete`,
    createSkill: (name: string, targets: string) => `Create skill "${name}" → ${targets}`,
    editSkill: (name: string) => `Save edits to skill "${name}"`,
    skillMdWritten: "updated SKILL.md",
    skillVisibility: (name: string, value: string) =>
      `Set skill "${name}" visibility → ${value} (Claude Code)`,
    skillPermission: (name: string, value: string) =>
      `Set skill "${name}" permission → ${value} (OpenCode)`,
    claudeSkillOverridesWritten: "updated ~/.claude/settings.json skillOverrides",
    opencodeConfigWritten: "updated ~/.config/opencode/opencode.json",
    ccVisibleApps: "Apply cc-switch visible apps",
    ccProviderAdd: (name: string) => `Add cc-switch provider "${name}"`,
    ccProviderUpdate: (name: string) => `Update cc-switch provider "${name}"`,
    ccProviderDelete: (name: string) => `Delete cc-switch provider "${name}"`,
    ccProviderSetCurrent: (name: string) => `Set cc-switch provider "${name}" as current`,
    addMcpClaude: (title: string) => `Add MCP "${title}" → Claude Code`,
    addMcpCodex: (title: string) => `Add MCP "${title}" → Codex`,
    addMcpOpencode: (title: string) => `Add MCP "${title}" → OpenCode`,
    codexMcpWritten: (id: string) => `mcp_servers.${id} written to config.toml`,
    claudeMcpWritten: (id: string) => `mcpServers.${id} written to .claude.json`,
    opencodeMcpWritten: (id: string) => `mcp.${id} written to opencode.json`,
    proxyClaude: (url: string) => `Point Claude Code at the proxy → ${url}`,
    proxyNpmSet: (key: string, value: string) => `Set npm ${key} → ${value}`,
    proxyGitSet: (key: string, value: string) => `Set git ${key} → ${value}`,
    proxyWinSet: (key: string, value: string) => `Set ${key} for your account → ${value}`,
    proxyShell: (path: string) => `Add the proxy exports → ${path}`,
    proxyShellWritten: (path: string) => `updated ${path}`,
    proxyNote: "What still needs your attention",
    proxyRestartNote:
      "Open a new terminal (or reload your shell) so Codex, OpenCode and other tools pick the proxy up.",
    proxyShellNote:
      "Codex and OpenCode read the proxy from your shell environment only — add these lines to your shell profile, or turn on the “Shell profile” target above:",
    proxyClearClaude: "Remove the proxy from Claude Code settings",
    proxyClearNpm: (key: string) => `Clear npm ${key}`,
    proxyClearGit: (key: string) => `Clear git ${key}`,
    proxyClearWin: (key: string) => `Clear ${key} for your account`,
    proxyClearShell: (path: string) => `Remove the proxy exports ← ${path}`,
    claudeSettingsUpdated: "updated ~/.claude/settings.json env",
    codexProviderUpdated: "updated ~/.codex/config.toml model_providers",
    removeMcpClaude: (title: string) => `Remove MCP "${title}" ← Claude Code`,
    removeMcpCodex: (title: string) => `Remove MCP "${title}" ← Codex`,
    removeMcpOpencode: (title: string) => `Remove MCP "${title}" ← OpenCode`,
    disableMcp: (title: string) => `Disable MCP "${title}"`,
    enableMcp: (title: string) => `Enable MCP "${title}"`,
    mcpStashed: (id: string) => `${id} remembered in mcp-disabled.json`,
    mcpUnstashed: (id: string) => `${id} cleared from mcp-disabled.json`,
    uninstallCli: (title: string) => `Uninstall ${title}`,
    noUninstaller: (title: string) => `No automated uninstaller for ${title} on this OS.`,
    restoreFile: (path: string) => `Restore ${path} from backup`,
    snapshot: "Back up cc-switch DB and live configs",
    snapshotRestore: (id: string) => `Restore everything from backup ${id}`,
    bundleFile: (path: string) => `Restore ${path} from the backup`,
    bundleFileWritten: (path: string) => `restored ${path}`,
    syncClaude: "Sync provider → Claude Code settings.json",
    syncCodex: "Sync provider → Codex config.toml",
    syncOpencode: "Sync provider → OpenCode opencode.json",
    opencodeProviderUpdated: "OpenCode provider updated",
    cleanupQuarantine: (size: string) => `Clear ${size} to the recycle area`,
    cleanupDelete: (size: string) => `Permanently delete ${size}`,
    cleanupConfig: (title: string) => `Clear ${title}`,
    cleanupConfigWritten: (title: string, path: string) => `cleared ${title} from ${path}`,
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
    restored: (path: string) => `restored ${path}`,
    restorePoint: (id: string) => `restore point for this restore → ${id}`,
    wouldSnapshot: "would back up cc-switch DB and live configs",
    wouldRestoreSnapshot: (id: string) =>
      `would restore every file from backup ${id}, snapshotting the current state first`,
    wouldCcProvider: {
      add: (app: string) => `would add a provider to ${app}`,
      update: (app: string) => `would update a provider in ${app}`,
      delete: (app: string) => `would remove a provider from ${app}`,
      setCurrent: (app: string) => `would switch ${app} to another provider`,
    },
    wouldBackupSkill: (path: string) => `would back up ${path}`,
    wouldQuarantine: (path: string, size: string, files: number) =>
      `would move ${path} to the recycle area — ${size}, ${files} file(s)`,
    wouldDeleteSized: (path: string, size: string, files: number) =>
      `would permanently delete ${path} — ${size}, ${files} file(s)`,
    wouldQuarantineTotal: (size: string) =>
      `${size} in total, recoverable until you empty the recycle area`,
    wouldDeleteTotal: (size: string) => `${size} in total, freed immediately and not recoverable`,
    cleanupQuarantined: (size: string, count: number) =>
      `moved ${count} item(s), ${size}, to the recycle area`,
    cleanupDeleted: (size: string, count: number) =>
      `permanently deleted ${count} item(s), ${size}`,
    cleanupSkipped: (detail: string) => `skipped — ${detail}`,
    cleanupNothingRemoved: "Nothing could be cleared — see the skipped lines above.",
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
    wingetUpdateNotManaged:
      "winget can't update this — it wasn't installed through winget. Update it the way you installed it (the installer from the tool's website, or a version manager like nvm/fnm).",
    elevationHint: (cmd: string) =>
      `The install didn't complete. If it's a permissions issue, open a terminal as administrator and run it yourself:  ${cmd}`,
    timedOut: (mins: number) =>
      `timed out after ${mins} min and was stopped — check your network or run the command manually, then retry.`,

    // ── Network auto-recovery (lib/agentpack/network/recovery.ts) ──
    networkFailure: "This looks like a network problem — trying another route.",
    retryingVia: (label: string) => `↻ retrying via ${label}…`,
    retryingFallback: (label: string) => `↻ trying a different way to install: ${label}`,
    recoveredVia: (label: string) => `Succeeded via ${label}. Nothing on your machine was changed.`,
    recoveryExhausted: "Every alternative route failed too — the original error follows.",

    // ── GitHub Release direct install (releaseInstall steps) ──
    releaseFound: (title: string, tag: string, asset: string) =>
      `${title} ${tag} — downloading ${asset}`,
    releaseDownloading: (pct: number) => `downloading… ${pct}%`,
    releaseDownloaded: (path: string) => `downloaded → ${path}`,
    releaseNoAsset: (title: string, tag: string, arch: string) =>
      `${title} ${tag} publishes no installer for this platform (${arch}) — install it manually.`,
    wouldReleaseInstall: (title: string, repo: string) =>
      `would download the latest ${title} release from ${repo} and install it`,
    wouldReleaseInstallVia: (title: string, repo: string, mirror: string) =>
      `would download the latest ${title} release from ${repo} via ${mirror} and install it`,
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
    ccswitch: "Accounts & relays",
    ccconnect: "cc-connect management",
    clis: "Install / upgrade CLIs",
    mcp: "MCP servers",
    pi: "Pi",
    network: "Network / mirrors",
    cleanup: "Clean up",
    preferences: "Preferences",
    saveConfig: "Profiles & backup",
    recovery: "Recovery points",
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

  /** Installed-skills browser (Skills section: Installed / Bundled / Add tabs). */
  skillsBrowser: {
    title: "Skills",
    subtitle: "Browse, configure and install skills across Claude Code, Codex and OpenCode.",
    tabInstalled: "Installed",
    tabCatalog: "Bundled",
    tabAdd: "Add skills",
    refresh: "Rescan",
    loading: "Scanning skills…",
    notTauri: "Skill browsing needs the desktop app.",
    scanError: (source: string, message: string) => `Scan failed for ${source}: ${message}`,
    scanIssueCount: (count: number) => `${count} scan issue${count === 1 ? "" : "s"}`,
    scanFailed: (msg: string) => `Couldn't scan the skills roots: ${msg}`,
    emptyScanFailed: "No skills could be read — the scan failed for the roots listed above.",
    retry: "Retry",
    searchPlaceholder: "Search skills…",
    filterAll: "All",
    /** The one button the status and sort selects fold into. */
    filtersLabel: "Filters",
    filtersReset: "Clear filters",
    sortLabel: "Sort by",
    statusFilter: "Status",
    statusAll: "All statuses",
    statusManaged: "Managed",
    statusUnmanaged: "Unmanaged",
    statusUpdates: "Updates available",
    statusIssues: "Conflicts or issues",
    sources: {
      claude: "Claude Code",
      codex: "Codex",
      opencode: "OpenCode",
      pi: "Pi",
      agents: "Shared (.agents)",
    } as Record<string, string>,
    sortName: "Name",
    sortModified: "Recently updated",
    skillCount: (n: number) => `${n} skill${n === 1 ? "" : "s"}`,
    symlinkBadge: "symlink",
    bundledBadge: "bundled",
    nameMismatchBadge: (name: string) => `name: ${name}`,
    empty: "No skills found in any agent directory.",
    emptyBrowse: "Install a bundled skill",
    /** Names the presence dots for a screen reader — a colour is not a label. */
    installedOn: "Installed in",
    emptyFiltered: "No skills match the current filter.",
    view: "View",
    actions: "Actions",
    copyTo: (target: string) => `Copy to ${target}`,
    installInto: (target: string) => `Install into ${target}`,
    /** Said once above the bundled list, so no row explains its own chips. */
    catalogHint:
      "Each row lists the agents a skill can be installed into. Click one to install it there; click it again to remove it.",
    deleteFrom: (source: string) => `Delete from ${source}`,
    deleteConfirmTitle: (name: string) => `Delete skill "${name}"?`,
    deleteConfirmBody: (path: string) =>
      `This removes ${path}. A symlinked skill only loses its link — the shared copy under ~/.agents/skills stays.`,
    confirmDelete: "Delete",
    cancel: "Cancel",
    detailPath: "Path",
    detailLinkTarget: "Link target",
    detailModified: "Modified",
    frontmatterTitle: "Frontmatter",
    configTitle: "Per-agent configuration",
    configHint: "Applies at the next session start.",
    visibilityLabel: "Claude Code visibility",
    visibility: {
      on: "On (default)",
      "name-only": "Name only",
      "user-invocable-only": "User invocable only",
      off: "Off",
    } as Record<string, string>,
    permissionLabel: "OpenCode permission",
    permission: {
      allow: "Allow (default)",
      ask: "Ask",
      deny: "Deny",
    } as Record<string, string>,
    addGithubTitle: "Install from GitHub",
    addGithubHint:
      "owner/repo or a GitHub URL — any public repo with skills (folders containing SKILL.md).",
    sourcePlaceholder: "owner/repo or https://github.com/…",
    fetchSkills: "Fetch skills",
    fetching: "Fetching…",
    invalidSource: "Not a valid GitHub repo reference.",
    fetchError: (msg: string) => `Fetch failed: ${msg}`,
    noSkillsInRepo: "No skills (folders containing SKILL.md) found in this repo.",
    selectTargets: "Install into",
    installSelected: (n: number) => `Install ${n} selected`,
    advancedTitle: "Advanced",
    mirrorLabel: "GitHub mirror prefix",
    mirrorHint: "Optional proxy prefix (e.g. https://gh-proxy.com/) for blocked networks.",
    useNpx: "Install via skills CLI (npx)",
    npxHint: "Runs `npx skills add` — needs Node.js; creates symlinked installs.",
    npxNoTarget:
      "Pick Claude Code, Codex or OpenCode — without one, the skills CLI installs into every agent it finds.",
    addLocalTitle: "Import a local folder",
    addLocalHint: "Pick a folder that contains a SKILL.md.",
    pickFolder: "Choose folder…",
    notASkillFolder: "The selected folder has no SKILL.md.",
    importNow: "Import",

    // --- Stats overview strip ---
    statTotal: "Total",
    statSources: "Sources",
    statBundled: "Bundled",
    statCustom: "Custom",
    statManaged: "Managed",
    statUpdates: "Updates",
    statScanIssues: "Scan issues",
    /** Why Updates reads `—`: nothing has been checked yet. */
    statUpdatesPending: "Updates are counted once Check updates has run.",
    summaryLabel: "Skills summary",
    actionsLabel: "Skill management views",
    installedPanel: "Installed skills",
    installedActionHint: "Everything found across the four skills roots.",
    catalogActionHint: "Install the bundled engineering skills into selected agents.",
    addActionHint: "Install from GitHub, a local folder, skills CLI, or create a new skill.",
    detailPanel: "Skill management details",

    // --- Reveal / open externally ---
    revealInFolder: "Reveal in folder",
    openSkillMd: "Open SKILL.md",

    // --- Rich detail view ---
    invocationTitle: "Invocation",
    invokeCommand: (cmd: string) => `Type ${cmd}`,
    invokeAuto: "Claude can auto-load",
    invokeManual: "Manual only",
    invokeUserHidden: "Hidden from / menu",
    whenToUseLabel: "When to use",
    argumentHintLabel: "Arguments",
    allowedToolsLabel: "Allowed tools",
    modelLabel: "Model",
    effortLabel: "Effort",
    pathsLabel: "Path scope",
    costTitle: "Context cost",
    costLine: (bytes: number, lines: number, tokens: number) =>
      `${bytes.toLocaleString()} B · ${lines} lines · ~${tokens.toLocaleString()} tokens`,
    filesTitle: "Files in this skill",
    filesLoading: "Listing files…",
    filesEmpty: "Only SKILL.md.",
    allFieldsTitle: "All frontmatter fields",
    sourceRepo: (repo: string) => `from ${repo}`,

    // --- In-app edit ---
    edit: "Edit",
    editSave: "Save",
    editCancel: "Cancel",
    editHint: "Editing the raw SKILL.md. Saving backs up the previous version.",
    editDiscardTitle: "Discard your SKILL.md edits?",
    editDiscardBody: "Closing now drops the changes you haven't saved.",
    editKeep: "Keep editing",
    editDiscard: "Discard edits",

    // --- Update / sync ---
    checkUpdates: "Check updates",
    checking: "Checking…",
    updateAll: (n: number) => `Update all (${n})`,
    updateAvailable: "Update available",
    update: "Update",
    checkFailed: (msg: string) => `Update check failed: ${msg}`,
    checkUpdatesNoneManaged: "Only skills installed from GitHub can be checked for updates.",

    // --- Backups ---
    backups: "Backups",
    backupsTitle: "Skill backups",
    backupsSubtitle: "Deleting a skill keeps a backup here first.",
    backupsEmpty: "No backups yet.",
    backupsLoading: "Loading backups…",
    backupName: "Skill",
    backupSource: "From",
    backupCreated: "Backed up",
    backupSize: "Size",
    restore: "Restore",
    restoreInto: "Restore into",
    deleteBackup: "Delete",
    deleteBackupConfirm: (name: string) => `Delete backup of "${name}"?`,
    deleteBackupBody: "This permanently removes the backup.",
    backupDeleted: "Backup deleted.",
    backupActionFailed: (msg: string) => `Failed: ${msg}`,
    backupsLoadFailed: (msg: string) => `Couldn't list backups: ${msg}`,
    restoreStep: (name: string, targets: string) => `Restore skill ${name} into ${targets}`,

    // --- Create a skill ---
    createTitle: "Create a skill",
    createHint: "Scaffold a new SKILL.md in the chosen agents.",
    nameLabel: "Name",
    nameHint: "Becomes the folder and the /command.",
    descriptionLabel: "Description",
    descriptionPlaceholder: "What it does and when to use it",
    templateLabel: "Template",
    templateBlank: "Blank",
    templateReference: "Reference (knowledge)",
    templateTask: "Task (steps)",
    createNow: "Create skill",
    nameInvalid: "Use letters, numbers and dashes — no spaces or slashes.",

    // --- Full-text search ---
    contentMatch: "content match",

    // --- Bundled catalog install status (all four sources) ---
    catalogInstalledIn: (sources: string) => `Installed: ${sources}`,
    catalogNotInstalled: "Not installed",

    // --- Batch actions (installed list multi-select) ---
    selectRow: "Select skill",
    selectedCount: (n: number) => `${n} selected`,
    clearSelection: "Clear",
    batchCopyTo: "Copy to…",
    batchDeleteScope: "Delete from…",
    deleteScopeAll: "All sources",
    batchDelete: "Delete",
    batchNothingToCopy: "Every selected skill is already in those targets.",
    batchNothingToDelete: (scope: string) => `None of the selected skills are in ${scope}.`,
    batchDeleteConfirmTitle: (n: number) => `Delete ${n} skill${n === 1 ? "" : "s"}?`,
    batchDeleteConfirmBody: (scope: string) =>
      `Each skill is backed up first, then removed from ${scope}.`,

    // --- Install conflict (per-target overwrite / skip) ---
    conflict: {
      title: "Some skills already exist",
      body: "Choose which targets to overwrite. Unchecked targets keep their current skill.",
      overwrite: "Overwrite",
      skip: "Skip — keep current",
      overwriteAll: "Overwrite all",
      keepAll: "Skip all",
      confirm: "Install",
      cancel: "Cancel",
      allSkipped: "All targets skipped — nothing to install.",
    },

    // --- Saved repo sources (marketplace) ---
    reposTitle: "Skill repositories",
    reposHint: "Save GitHub repos to browse and install from.",
    reposEmpty: "No saved repositories yet.",
    repoUrlPlaceholder: "Add a repo: owner/repo",
    repoLabelPlaceholder: "Label (optional)",
    addRepo: "Save",
    browse: "Browse",
    removeRepo: "Remove",
    recommendedTitle: "Recommended",
  },

  /** Account and relay management, with native and cc-switch storage. */
  ccswitch: {
    menuTitle: "Accounts & relays",
    /** The first-run checklist. Its steps differ per storage backend. */
    guideTitle: "Set up account switching",
    guideHint:
      "A provider is one endpoint a CLI talks to — your official account, or a relay that stands in for it. Add one, make it current, and Claude Code, Codex and OpenCode are pointed at it.",
    guideProgress: (done: number, total: number) => `${done} of ${total} done`,
    stepInstallTitle: "Install the cc-switch app",
    stepInstallDesc:
      "Compatibility mode reads cc-switch's own database, so the app has to exist on this machine.",
    stepDatabaseTitle: "Create the provider database",
    stepDatabaseDesc: "One SQLite file under ~/.cc-switch holds every provider row.",
    stepProviderTitle: "Add your first provider",
    stepProviderDesc:
      "Pick an official login or a relay preset from Quick add, or fill the form in yourself.",
    stepProviderDone: (n: number) => (n === 1 ? "1 provider saved" : `${n} providers saved`),
    stepCurrentTitle: "Point your CLIs at it",
    stepCurrentDesc:
      "Making a provider current writes it into that app's live config — the CLI uses it on its next run.",
    stepCurrentDone: (n: number) =>
      n === 1 ? "1 app is pointed at a provider" : `${n} apps are pointed at a provider`,
    backendTitle: "Provider storage",
    backendHint:
      "Choose where provider and account-switch records live. Both modes update the same Claude Code, Codex, and OpenCode config files.",
    backendNative: "Agentpack native",
    backendRecommended: "Recommended",
    backendCcSwitch: "CC Switch compatible",
    backendNativeHint:
      "Independent mode. Records live in ~/.agentpack/providers.json; CC Switch is not required.",
    backendCcSwitchHint:
      "Compatibility mode. Reads and writes ~/.cc-switch/cc-switch.db so both apps see the same providers.",
    install: "Install / check cc-switch",
    visibleApps: "Visible apps (show only Claude & Codex)",
    providers: "Provider management",
    detected: "cc-switch detected",
    notDetected: "cc-switch not detected",
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
    providersTitle: "Accounts and relay providers",
    providersCount: (n: number) => (n === 1 ? "1 provider" : `${n} providers`),
    providerToolbarLabel: "Filter providers",
    columnEndpoint: "Endpoint",
    columnActions: "Actions",
    emptyHint:
      "Nothing is stored yet. Quick add fills the form in for the common cases; Add provider starts from blank.",
    quickAddTitle: "Quick add",
    quickAddHint: "Opens the form pre-filled. Nothing is written until you save it.",
    quickAddOfficial: "Official logins",
    quickAddPresets: "Relay presets",
    quickAddAllOfficial: "Every app already has an official-login row.",
    providerSearch: "Search providers…",
    providerAppFilter: "Application",
    providerAllApps: "All applications",
    providerStatusFilter: "Provider status",
    providerStatusAll: "All statuses",
    providerStatusOfficial: "Official",
    providerStatusCustom: "Custom",
    providerStatusCurrent: "Current",
    providerSort: "Sort providers",
    providerSortName: "Name",
    providerSortApp: "Application",
    providerSortCurrent: "Current first",
    providerFilterEmpty: "No providers match the current filters.",
    summaryLabel: "Accounts and relays summary",
    actionsLabel: "Accounts and relays controls",
    metricProviders: "Providers",
    metricCurrent: "Current",
    metricAccounts: "Profiles",
    /** The cc-switch app is irrelevant while the native backend is selected. */
    metricNotUsed: "Not used",
    metricCcSwitch: "CC Switch",
    metricDatabase: "Database",
    runtimeWarning: (current: string, min: string) =>
      `Provider management needs Node ≥ ${min} (node:sqlite); current Node is ${current}. Upgrade Node, or use the standalone binary.`,
    noDb: "cc-switch database not found. Initialize it below, then return here.",
    initDb: "Initialize database",
    initDbHint:
      "Providers live in a SQLite database under ~/.cc-switch. agentpack creates it for you — cc-switch itself is optional.",
    initializing: "Creating the database…",
    initFailed: "Couldn't create the database. Check that ~/.cc-switch is writable, then retry.",
    launchCcSwitch: "Launch cc-switch",
    unmanagedTitle: (n: number) =>
      n === 1 ? "1 endpoint isn't managed here yet" : `${n} endpoints aren't managed here yet`,
    unmanagedHint:
      "Found API endpoints in your live config that no provider covers. Import them, or switching providers will overwrite them.",
    importOne: (app: string, baseUrl: string) => `Import ${app}: ${baseUrl}`,
    tabForm: "Form",
    tabRaw: "Raw",
    rawLabel: "settings_config",
    rawHint:
      "The settings_config stored for this provider. Edit it directly for anything the form doesn't cover — custom headers, query params, per-model overrides. Raw edits win over the form fields.",
    rawInvalid: "Not valid JSON — fix it before saving.",
    showToken: "Show token",
    hideToken: "Hide token",
    testConnection: "Test connection",
    probeOk: (ms: number, models: number) =>
      models > 0 ? `OK · ${ms}ms · ${models} models` : `OK · ${ms}ms`,
    probeUnauthorized: "Rejected — check the token and the auth method.",
    probeNotFound: "404 — the base URL's path looks wrong (Codex usually needs /v1).",
    probeUnreachable: "Couldn't reach it — check the network or your proxy.",
    probeHttpError: (status: number) => `Endpoint returned ${status}.`,
    exportProviders: "Export",
    exportTokensAsk:
      "Export every provider to a JSON file. Without tokens the file is safe to share; with tokens it is a credential file — treat it like one.",
    exportWithoutTokens: "Without tokens",
    exportWithTokens: "With tokens",
    importProviders: "Import",
    importNothing: "No providers found in that file.",
    importConflicts: (fresh: number, names: string) =>
      `${fresh} new provider(s). These already exist and would be replaced: ${names}.`,
    importFreshOnly: "New only",
    importOverwrite: "Replace existing",
    accountsTitle: "Account profiles",
    accountsHint:
      "Named combinations of provider selections — switch every CLI at once. A profile records which provider row each app points at, never a copy of its config and never a credential.",
    accountNewLabel: "Profile name",
    accountSave: "Save current",
    accountUpdate: "Save profile",
    accountEditTitle: "Edit account profile",
    accountPick: (app: string) => `${app} provider`,
    accountLeaveUnchanged: "Leave this app unchanged",
    accountEmpty: "No account profiles for this storage mode yet.",
    accountDeleteConfirm: (name: string) => `Delete the account profile “${name}”?`,
    accountCancel: "Cancel",
    accountWriteFailed: "Couldn't save the account profiles. Your previous profiles are unchanged.",
    accountApply: "Switch to",
    accountStale: (apps: string) => `(${apps}: provider deleted)`,
    loginTitle: "Official logins",
    loginHint:
      "Read-only. Credentials stay owned by each CLI; Agentpack reports only status metadata and never returns tokens or API keys.",
    loginSignedIn: "Signed in",
    loginUnavailable: "Couldn't read the login state. Refresh to retry.",
    loginSignedOut: "Not signed in",
    loginExpires: (date: string) => `expires ${date}`,
    officialBadge: "Official",
    officialName: "Official login",
    addOfficial: (app: string) => `Add official login (${app})`,
    schemaStale: (cols: string) =>
      `This cc-switch database predates the columns agentpack needs (${cols}). Launch cc-switch once — it migrates on startup — then refresh.`,
    dbReady: "Database ready. Close cc-switch before editing providers here.",
    refresh: "Refresh",
    checking: "Checking cc-switch…",
    loading: "Loading…",
    runningTitle: "cc-switch is running",
    runningHint:
      "Providers can't be edited while cc-switch has the database open. Quit it here and the controls unlock.",

    // App control: open / quit the desktop app and see its live state.
    appTitle: "cc-switch app",
    appRunning: "Running",
    appStopped: "Not running",
    appOpen: "Open",
    appQuit: "Quit",
    launchFailed: "Could not launch cc-switch.",
    quitFailed: "cc-switch didn't quit — close it from the app itself, then Refresh.",
    deleteConfirm: "Delete this provider? A snapshot is taken first, but this removes it.",
    setCurrentConfirm:
      "Set as current and overwrite the live config (Claude settings.json / Codex config.toml / OpenCode opencode.json)? A snapshot is taken first.",
    restoreFailed: "Restore failed. See the logs for details.",
    loadFailed: "Couldn't read the provider state. Click Refresh to retry.",
    empty: "No providers yet.",
    addProvider: "Add provider",
    addRecommended: (label: string) => `★ Add recommended: ${label}`,
    current: "current",
    rowActionEdit: "Edit",
    rowActionDelete: "Delete",
    rowActionSetCurrent: "Set as current",
    rowActionBack: "Back",
    setCurrentNote:
      "Setting a provider as current also syncs it into the live config (Claude settings.json / Codex config.toml / OpenCode opencode.json).",
    syncCurrent: "Sync current to live config",
    syncHint:
      "Write each app's current provider into ~/.claude/settings.json, ~/.codex/config.toml, and ~/.config/opencode/opencode.json.",
    syncNoCurrent: "No current provider to sync.",
    backupsTitle: "Backups & restore",
    backupsHint:
      "Every provider change and sync snapshots its store and all live CLI configs here.",
    noBackups: "No backups yet.",
    restore: "Restore",
    restoreConfirm: "Restore this backup? Current DB and live configs are snapshotted first.",
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
    addNeedsDb:
      "Adding a provider needs the provider database. Initialize it in the checklist first.",
    addNeedsMigration:
      "This cc-switch database is too old to write to. Launch cc-switch once so it migrates, then Refresh.",
    listOutdated:
      "The provider list can't be read: this cc-switch database predates the columns agentpack needs. Launch cc-switch once so it migrates, then Refresh.",
    deleteCurrentBlocked: "The current provider can't be deleted — make another one current first.",
    visibleUnchanged: "Matches cc-switch's settings. Toggle an app to change it.",
    accountActive: "Active — every app already points at this profile's providers.",
    accountNothingToApply:
      "Nothing to switch — the providers this profile names are deleted or already current.",
    accountSaveNeedsCurrent:
      "Make a provider current first — a profile records which provider each app points at.",
    importNothingNew: "Nothing imported — every provider in that file already exists here.",
    importReadFailed: (path: string, reason: string) =>
      `Couldn't read ${path || "the import file"}: ${reason}. Choose the file again.`,
    exportFailed: (path: string, reason: string) =>
      `Couldn't write ${path}: ${reason}. Choose a folder you can write to, then export again.`,
  },

  /** cc-connect management screens (bridge local agents to chat platforms). */
  ccconnect: {
    menuTitle: "cc-connect management",
    /** The first-run checklist: install, configure, start, open. In that order. */
    guideTitle: "Get cc-connect running",
    guideHint:
      "cc-connect runs a small bridge on this machine. Once it is configured and started, the dashboard below is where projects, providers and chat platforms are wired up.",
    guideProgress: (done: number, total: number) => `${done} of ${total} done`,
    stepInstallTitle: "Install cc-connect",
    stepInstallDesc: "The bridge ships as a command-line package; agentpack installs it for you.",
    stepConfigTitle: "Configure a project",
    stepConfigDesc:
      "config.toml needs at least one [[projects]] entry naming a folder and a chat platform. Create config writes a filled-in starting point.",
    stepConfigDone: (n: number) => (n === 1 ? "1 project configured" : `${n} projects configured`),
    stepConfigPlaceholders: (keys: string) =>
      `The starter config still holds placeholders (${keys}). Replace them with your project folder and chat-app credentials — Edit config here, or the dashboard once the bridge runs.`,
    stepStartTitle: "Start the bridge",
    stepStartDesc: "Runs in the background and keeps your projects connected.",
    // Start is disabled until there is a project; with no config file at all
    // the "needs a project" alert has nothing to hang on, so the row says it.
    stepStartNeedsConfig: "Waits for a project — create the config in the step above first.",
    stepOpenTitle: "Open the dashboard",
    summaryLabel: "cc-connect summary",
    actionsLabel: "cc-connect endpoints",
    metricVersion: "Installed version",
    metricProjects: "Projects",
    metricPlatforms: "Platforms",
    metricManagement: "Management",
    metricBridge: "Bridge",
    metricWebhook: "Webhook",
    /** The aside's endpoint list — three ports, one panel, not three cards. */
    endpointsTitle: "Local endpoints",
    endpointsHint: "The ports cc-connect opens on this machine.",
    endpointEnabled: "enabled",
    endpointDisabled: "disabled",
    metricAgents: "Agent types",
    install: "Install / check cc-connect",
    detected: "cc-connect detected",
    notDetected: "cc-connect not detected",
    checking: "Checking cc-connect…",
    refresh: "Refresh",
    uninstall: "Uninstall",
    uninstallConfirm:
      "Uninstall cc-connect? Its ~/.cc-connect config directory is kept, so reinstalling restores your setup.",
    serviceTitle: "Bridge service",
    serviceHint:
      "Runs the cc-connect bridge in the background. Once web admin is enabled it serves the management dashboard, and it keeps running to bridge your configured projects to chat platforms.",
    running: "running",
    stopped: "stopped",
    start: "Start",
    stop: "Stop",
    startFailed:
      "Couldn't start cc-connect. Check config.toml — it exits at once on a config it can't load.",
    stopFailed: "Couldn't stop cc-connect. Stop it manually, then click Refresh.",
    noProjects: "no project configured",
    needsProject:
      "cc-connect won't start until config.toml declares at least one [[projects]] entry with a platform — it refuses the config before opening any port. Use Create config for a filled-in starting point, then replace the placeholders.",
    daemonNote:
      "Installed cc-connect as a system service? Manage it with `cc-connect daemon start/stop` instead — this app drives the plain background process.",
    dryRunBlocked: "Preview mode is on — starting or stopping the service is disabled.",
    webUrl: (url: string) => `Served at ${url} while the bridge runs with web admin enabled.`,
    openWeb: "Open dashboard",
    enableAndOpen: "Enable & open dashboard",
    openInBrowser: "In browser",
    embedTitle: "cc-connect dashboard",
    embedDescription: (url: string) => `The cc-connect management dashboard served at ${url}.`,
    embedLoading: "Loading the dashboard…",
    embedStalled:
      "The dashboard hasn't loaded. Reload it, or open it in your browser to see what the page says.",
    embedLoginHint:
      "Asked for a token? The dashboard remembered an older one. Reload — it has cleared it by now.",
    embedReload: "Reload",
    embedExternal: "Open in browser",
    embedClose: "Close",
    enableWebAdmin: "Enable web admin",
    webAdminEnabled: "Web admin enabled — start the bridge to open the dashboard.",
    webAdminFailed: "Couldn't open the dashboard. Check config.toml, then try again.",
    webAdminHint:
      "The dashboard is off by default. One click enables the management server and the bridge, starts the service and opens it right here — already logged in — so you can edit projects, providers and platforms without leaving the app.",
    webReadyHint:
      "Opens the dashboard in a panel here, pre-authenticated (via a login token), starting the service first if it isn't running. Use In browser to hand the same page to your browser instead.",
    managementEnabled: "web admin enabled",
    managementDisabled: "web admin disabled",
    configTitle: "Configuration",
    configInitialized: "config.toml present",
    configMissing: "not initialized — cc-connect creates it on first start",
    reveal: "Show in folder",
    loadFailed: "Couldn't read the cc-connect state. Click Refresh to retry.",
    configEdit: "Edit config",
    configCreate: "Create config",
    editorTitle: "cc-connect configuration",
    configSearch: "Search settings…",
    configGroups: {
      all: "All",
      core: "Core",
      connection: "Connection",
      media: "Media",
      display: "Conversation display",
      reliability: "Reliability",
      security: "Security",
    } as Record<string, string>,
    editorHint:
      "Global settings edited as a form; projects, providers and hooks live in the TOML tab (or the dashboard). Restart the bridge to apply changes.",
    tabForm: "Form",
    tabToml: "TOML",
    save: "Save",
    saved: "config.toml saved.",
    saveFailed: "Couldn't save config.toml.",
    invalidToml: "Not valid TOML — fix the syntax before saving.",
    formUnavailable: "The current config.toml couldn't be parsed — edit it in the TOML tab first.",
    unset: "(unset)",
    providerFirst: "Select a provider first",
    sections: {
      general: "General",
      management: "Web dashboard / Management API",
      bridge: "Bridge (WebSocket)",
      webhook: "Webhook",
      speech: "Speech-to-text",
      tts: "Text-to-speech",
      display: "Display",
      streamPreview: "Streaming preview",
      instantReply: "Instant reply",
      rateLimit: "Rate limit (incoming)",
      outgoingRateLimit: "Rate limit (outgoing)",
      relay: "Relay",
      cron: "Scheduling & queue",
      timeouts: "Timeouts (minutes)",
    },
    fields: {
      language: "Bot language",
      dataDir: "Data directory",
      shell: "Shell",
      shellProfile: "Shell profile",
      attachmentSend: "Attachment send-back",
      maxAttachmentSize: "Max attachment size (MB)",
      quiet: "Quiet mode",
      bannedWords: "Banned words",
      providerPresetsUrl: "Provider presets URL",
      logLevel: "Log level",
      enabled: "Enabled",
      port: "Port",
      token: "Auth token",
      corsOrigins: "CORS origins",
      path: "URL path",
      insecure: "Allow insecure",
      provider: "Provider",
      apiKey: "API key",
      baseUrl: "Base URL",
      model: "Model",
      speechLanguage: "Recognition language",
      voice: "Voice",
      voiceId: "Voice ID",
      languageType: "Language hint",
      speed: "Speed",
      ttsMode: "TTS mode",
      maxTextLen: "Max text length",
      displayMode: "Display mode",
      cardMode: "Card style",
      thinkingMessages: "Show thinking",
      thinkingMaxLen: "Thinking max length",
      toolMessages: "Show tool use",
      toolMaxLen: "Tool max length",
      historyMaxLen: "History max length",
      showContextIndicator: "Show context indicator",
      replyFooter: "Reply footer",
      hideAgentFooter: "Hide agent footer",
      intervalMs: "Update interval (ms)",
      minDeltaChars: "Min delta chars",
      maxChars: "Max chars",
      disabledPlatforms: "Disabled on platforms",
      instantReplyContent: "Reply text",
      maxMessages: "Max messages",
      windowSecs: "Window (seconds)",
      maxPerSecond: "Max messages / second",
      burst: "Burst",
      relayTimeout: "Relay timeout (seconds)",
      visibility: "Visibility",
      cronSilent: "Silent cron start",
      cronSessionMode: "Cron session mode",
      queueMaxDepth: "Queue depth per session",
      idleTimeout: "Idle timeout",
      maxTurnTime: "Max turn time",
      workspaceIdleTimeout: "Workspace idle timeout",
    },
  },

  management: {
    title: "Accounts & quota",
    subtitle: "Operate more-token accounts, balances, automation, audit, and alerts.",
    desktopOnly: "Account management is available in the signed desktop app only.",
    tabs: {
      overview: "Operations overview",
      accounts: "Account center",
      quota: "Quota center",
      analytics: "Usage analytics",
      audit: "Audit & alerts",
    },
    statusSummary: "Management status",
    supportingActions: "Management controls",
    instances: "Instances",
    apiVersion: "Management API",
    connection: "Connection",
    connectionHint: "Active instance, endpoint, and desktop credential state.",
    workspace: "Workspace",
    workspaceHint: "Current management scope and access granted by the server.",
    grantedScopes: "Granted scopes",
    instance: "Instance",
    addInstance: "Add instance",
    editInstance: "Edit instance",
    removeInstance: "Remove instance",
    instanceName: "Instance name",
    instanceUrl: "Server address",
    instanceId: "Instance ID",
    customCa: "Custom CA PEM path",
    customCaHint:
      "Optional — for a server behind a private certificate authority. The certificate is added to what this app trusts; verification is never skipped.",
    // The dialog's own subtitle; the CA note used to stand in for it.
    instanceDialogHint:
      "Where this app reaches your more-token server. Signing in comes next, and the credential stays in the OS credential store.",
    readOnly: "Read-only instance",
    displayCurrency: "Display currency",
    save: "Save",
    cancel: "Cancel",
    pairTitle: "Pair this desktop",
    pairHint:
      "Create a one-time code in more-token Profile → Desktop management access. The code expires in 5 minutes.",
    pairingCode: "One-time pairing code",
    pair: "Pair securely",
    pairing: "Pairing…",
    persistentCredential: "Credential stored in the operating system vault.",
    memoryCredential:
      "The system vault is unavailable. This credential exists only until agentpack quits.",
    reconnect: "Reconnect",
    disconnect: "Forget credential",
    localOnlyCredentialWarning:
      "The server could not revoke this credential. Delete only the local copy? The server credential may remain active.",
    exchangeRateExpired: "Exchange rate expired",
    exchangeRateExpiredHint: "Raw quota remains authoritative until the display rate is updated.",
    auditActionFilter: "Filter by action",
    searchAlertRules: "Search alert rules",
    resendInvitation: "Resend invitation",
    revokeInvitation: "Revoke invitation",
    edit: "Edit",
    delete: "Delete",
    previousPage: "Previous page",
    nextPage: "Next page",
    health: "Instance health",
    healthy: "Connected",
    unavailable: "Unavailable",
    incompatible: "Incompatible API",
    stale: "Showing last good in-memory data",
    partial: "Some instances are unavailable. Totals are not combined.",
    noInstances: "Add a more-token instance to begin.",
    retry: "Retry",
    loading: "Loading management data…",
    noData: "No data matches the current filters.",
    accounts: "Accounts",
    masters: "Master accounts",
    children: "Child accounts",
    disabled: "Disabled",
    archived: "Archived",
    totalQuota: "Available quota",
    quotaTotal: "Total quota",
    openAlerts: "Open alerts",
    topology: "Account relationships",
    topologyHint: "One level only: master → direct child.",
    balanceRisk: "Balance & risk distribution",
    exhausting: "Likely to exhaust soon",
    pendingAlerts: "Pending alerts",
    searchAccounts: "Search username or display name",
    search: "Search",
    filters: "Filters",
    clearFilters: "Clear filters",
    removeFilter: (name: string) => `Remove filter: ${name}`,
    accountsTotal: (count: number) => `${count} accounts`,
    pageSummary: (page: number, pages: number) => `Page ${page} of ${pages}`,
    clearSelection: "Clear selection",
    writeDenied: "This connection has no account write scope.",
    root: "Root",
    admin: "Admin",
    user: "User",
    independent: "Independent",
    childOf: (id: number) => `Child of #${id}`,
    childrenCount: (count: number) => `${count} ${count === 1 ? "child" : "children"}`,
    allStates: "All lifecycle states",
    active: "Active",
    closing: "Closing",
    tableView: "Table",
    treeView: "Tree",
    createAccount: "Create account",
    temporaryPasswordOnce: "Temporary password — shown once",
    email: "Email",
    initialQuota: "Initial quota",
    activeBillingSessions: "Active billing sessions",
    exportLedgerPage: "Export page",
    viewAccount: (id: number) => `View account #${id}`,
    directParent: "Direct parent",
    directChildren: "Direct children",
    childrenTruncated: "Only the first 200 children are shown.",
    activeSessionsTruncated: "Only the 100 most recent active sessions are shown.",
    reservedQuota: "Reserved quota",
    leaseExpires: "Lease expires",
    startedAt: "Started",
    credentialState: "Credential state",
    passwordChangeRequired: "Password change required",
    ready: "Ready",
    sendInvitationEmail: "Send a 24-hour invitation email",
    accessStatus: "Access status",
    allAccessStates: "All access states",
    enabled: "Enabled",
    allRelationships: "All relationships",
    master: "Master",
    child: "Child",
    allRoles: "All roles",
    sortAccounts: "Sort accounts",
    sortOrder: "Sort order",
    ascending: "Oldest / A–Z first",
    descending: "Newest / Z–A first",
    sortByColumn: (column: string) => `Sort by ${column}`,
    exportAccounts: "Export page",
    viewChildren: "View child accounts",
    childrenOf: (name: string) => `Children of ${name}`,
    treeScope: "Relationships are drawn from the accounts on this page only.",
    moreChildren: (count: number) => `${count} more`,
    created: "Created",
    noChildren: "No child accounts.",
    noActiveSessions: "No active billing sessions.",
    newest: "Newest",
    lastLogin: "Last login",
    username: "Username",
    displayName: "Display name",
    password: "Password",
    masterId: "Master account ID",
    createAsMaster: "Create as master account",
    selected: (count: number) => `${count} selected`,
    batchEnable: "Enable selected",
    batchDisable: "Disable selected",
    batchArchive: "Archive selected",
    accountDetail: "Account detail",
    role: "Role",
    balance: "Balance",
    usedQuota: "Used quota",
    relationship: "Relationship",
    lifecycle: "Lifecycle",
    actions: "Actions",
    enable: "Enable",
    disable: "Disable",
    archive: "Archive",
    restore: "Restore",
    attach: "Attach",
    detach: "Detach",
    promote: "Promote to master",
    demote: "Demote master",
    changePassword: "Change password",
    close: "Close account",
    undoArchive: "Undo archive",
    reason: "Reason",
    reasonHint: "Required and recorded in the immutable audit trail.",
    confirmAccount: "Type the account name to confirm",
    preview: "Preview impact",
    previewing: "Preparing preview…",
    previewImpact: "Server-verified impact",
    before: "Before",
    after: "After",
    confirm: "Confirm operation",
    versionConflict: "The account changed after this preview. Review a fresh preview.",
    balanceTarget: "Balance transfer target ID",
    writeOff: "Write off remaining quota (root only)",
    quotaSummary: "Quota summary",
    transfer: "Transfer quota",
    adjustment: "Adjustment",
    batchTransfer: "Batch transfer",
    batchProgress: "Batch progress",
    batchPartialFailure: "Some batch items failed. Review each result before closing.",
    ledger: "Immutable ledger",
    policies: "Automation policy",
    amount: "Amount",
    sourceId: "Source account ID",
    targetId: "Target account ID",
    direction: "Direction",
    credit: "Credit",
    debit: "Debit",
    reverse: "Reverse",
    operationId: "Operation ID",
    transactionType: "Type",
    status: "Status",
    minimumReserve: "Master minimum reserve",
    childBalanceCap: "Child balance cap",
    singleTransferLimit: "Single transfer limit",
    dailyTransferLimit: "Daily transfer limit",
    autoRefill: "Automatic refill",
    autoRefillThreshold: "Refill below",
    autoRefillAmount: "Refill amount",
    autoRefillDailyCap: "Daily refill cap",
    cooldown: "Cooldown (seconds)",
    monthlyBudget: "Monthly soft budget",
    disableOnExhaustion: "Disable exhausted children",
    savePolicy: "Save policy",
    automationOff: "Policy automation is disabled by this instance.",
    analyticsDefinition: "Persisted more-token billing logs",
    localEstimate: "Local CLI estimate",
    localEstimateHint:
      "Calculated from local Claude/Codex/OpenCode transcripts; it is not a billing fact.",
    localTokens: "Local tokens",
    serverBilling: "Server billing facts",
    throughput: "RPM / TPM",
    usageOverTime: "Token usage over time",
    requests: "Requests",
    promptTokens: "Prompt tokens",
    completionTokens: "Completion tokens",
    peakRpm: "Peak RPM",
    peakTpm: "Peak TPM",
    from: "From",
    to: "To",
    model: "Model",
    group: "Group",
    apiKey: "API Key name",
    success: "Success",
    error: "Error",
    all: "All",
    exportCsv: "Export CSV",
    generatedAt: "Generated",
    timezone: "Timezone",
    auditTimeline: "Audit timeline",
    alertRules: "Alert rules",
    alertEvents: "Alert events",
    notifications: "Desktop notification outbox",
    createRule: "Create rule",
    ruleName: "Rule name",
    ruleKind: "Rule kind",
    threshold: "Threshold",
    balanceBelow: "Balance below",
    monthlyBudgetRule: "Monthly budget",
    tokenExhausted: "Token exhausted",
    acknowledge: "Acknowledge",
    acknowledged: "Acknowledged",
    failedReason: "Failure reason",
    requestId: "Request ID",
    noScopes: "This credential does not grant access to this module.",
    readonlyBanner: "This instance is read-only. Write controls are disabled.",
    featureDisabled: "This feature is disabled on the server.",
    batchItemsHint: "One transfer per line: source_id,target_id,amount,reason",
    atomic: "Atomic — all or none",
    bestEffort: "Best effort — resume failed items",
    submitBatch: "Start batch",
    waitingForBrowser: "Waiting for browser approval…",
    cancelApproval: "Cancel approval",
    stepUpExpired:
      "Browser approval expired before anyone confirmed it. Start the operation again.",
    done: "Done",
    batchItemCount: (count: number) => `${count} ${count === 1 ? "item" : "items"}`,
    bulkReason: {
      enable: "Bulk enable from agentpack",
      disable: "Bulk disable from agentpack",
      archive: "Bulk archive from agentpack",
    },
    bulkResult: (succeeded: number, failed: number) => `${succeeded} succeeded · ${failed} failed`,
    batchArchiveTitle: (count: number) =>
      `Archive ${count} ${count === 1 ? "account" : "accounts"}?`,
    batchArchiveBody:
      "They move to the Archived lifecycle state. Each one can be brought back with Restore from its actions menu. The server asks for browser approval before anything changes.",
    reverseTitle: (id: number) => `Reverse transaction #${id}?`,
    reverseBody: (amount: string, from: number, to: number) =>
      `Moves ${amount} from #${from} back to #${to}. The reversal is recorded as a new ledger entry; the original stays in the immutable ledger.`,
    reverseReason: (id: number) => `Reverse transaction #${id}`,
    removeInstanceTitle: (name: string) => `Remove ${name}?`,
    removeInstanceBody:
      "Deletes this saved connection and its desktop credential. The server is asked to revoke the credential first; if it can't be reached you can still delete the local copy, and the server credential may stay active until it expires.",
    removingInstance: "Removing…",
    removeCustomCa: "Remove custom CA",
    localOnlyCredentialTitle: "Delete only the local credential?",
    deleteLocalCopy: "Delete local copy",
    deleteRuleTitle: (name: string) => `Delete alert rule “${name}”?`,
    deleteRuleBody:
      "The rule stops evaluating immediately. This can't be undone — create the rule again to bring it back.",
    accountId: "ID",
    policyWriteDenied: "This connection has no policy write scope.",
    transferScopeDenied: "This connection has no quota transfer scope.",
    invitesDisabled: "Invitation email is disabled on this server.",
    nothingToExport: "Nothing on this page to export.",
    csvSaved: (path: string) => `Saved ${path}`,
    csvSaveFailed: (reason: string) => `Couldn't save the CSV: ${reason}`,
  },

  personal: {
    title: "My more-token account",
    subtitle: "Manage your own profile, balance, usage, and signed-in desktop sessions.",
    desktopOnly: "Personal account management is available in the signed desktop app only.",
    tabs: {
      account: "My account",
      balance: "Balance",
      usage: "My usage",
      models: "Models",
      security: "Security",
    },
    statusSummary: "Personal account status",
    supportingActions: "Personal account controls",
    apiVersion: "Personal API",
    balanceSummary: "Balance summary",
    accessSummary: "Access & activity",
    usedShare: (percent: string) => `${percent} used`,
    packageLabel: "Personal package",
    isolationNote:
      "This connection can access only the paired user. It cannot call administrator or child-account operations.",
    signInTitle: "Sign in to more-token",
    signInHint:
      "Use the same username or email and password as the more-token website. Your password is sent by the Rust transport and is never saved.",
    usernameOrEmail: "Username or email",
    signIn: "Sign in",
    signingIn: "Signing in…",
    twoFactorCode: "Two-factor or backup code",
    twoFactorHint: "This account requires its current authenticator or backup code.",
    pairingOption: "Code",
    passwordOption: "Password",
    browserOption: "Browser",
    otherLoginMethods: "OAuth, Passkey, WeChat, or another login method",
    otherLoginHint:
      "Authorize in your browser with its existing session or any enabled more-token login method.",
    browserSignIn: "Continue in browser",
    browserSignInHint:
      "Recommended. If more-token is already signed in, you only need to approve this desktop.",
    waitingForBrowser: "Waiting for browser approval…",
    browserAuthorized: "Browser authorization completed.",
    available: "Available",
    used: "Used",
    total: "Total",
    requests: "Requests",
    memberOf: "Member of",
    independent: "Independent account",
    billingPortal: "Billing portal",
    openBillingPortal: "Open billing portal",
    profile: "Profile",
    displayName: "Display name",
    saveProfile: "Save profile",
    profileEditDisabled: "This server does not allow editing your profile from the desktop app.",
    ledger: "Balance ledger",
    ledgerHint: "Only transactions involving your account are shown.",
    noTransactions: "No balance transactions yet.",
    delta: "Change",
    balanceAfter: "Balance after",
    counterparty: "Counterparty",
    usageDefinition: "Persisted more-token billing records for this account only.",
    usageRange: "Usage range",
    usageDays: (days: number) => `${days} days`,
    usageModelFilter: "Usage model",
    allModels: "All models",
    usageGroupFilter: "Usage group",
    allGroups: "All groups",
    usageApiKeyFilter: "Usage API key",
    allApiKeys: "All API keys",
    usageStatus: "Usage status",
    statusBillable: "Billable",
    statusAll: "All statuses",
    statusSuccess: "Success",
    statusRefund: "Refund",
    statusError: "Error",
    promptTokens: "Prompt tokens",
    completionTokens: "Completion tokens",
    rawQuota: "Raw quota",
    modelBreakdown: "Usage by model",
    usageRecords: "Usage records",
    usageRecordsHint: "Paginated billing events for this account and the selected filters.",
    recordedAt: "Recorded at",
    noUsageRecords: "No usage records match these filters.",
    exportCsv: "Export CSV",
    exportingCsv: "Exporting…",
    previousPage: "Previous page",
    nextPage: "Next page",
    pageSummary: (page: number, pages: number) => `Page ${page} of ${pages}`,
    requestId: "Request ID",
    apiKey: "API Key",
    duration: "Duration",
    stream: "Stream",
    batch: "Batch",
    modelMarketplace: "Model marketplace",
    modelMarketplaceHint: "Models and billing metadata available to your current group.",
    searchModels: "Search models, tags, or vendors",
    modelVendorFilter: "Model vendor",
    allVendors: "All vendors",
    billingTypeFilter: "Billing type",
    allBillingTypes: "All billing types",
    model: "Model",
    vendor: "Vendor",
    billing: "Billing",
    endpoints: "Endpoints",
    noModels: "No models are currently available to this account.",
    fixedPrice: "Fixed price",
    ratioBilling: "Ratio billing",
    modelDetails: "Model details",
    groups: "Available groups",
    pricingDetails: "Pricing details",
    endpointDetails: "Supported endpoints",
    inputRatio: "Input ratio",
    outputRatio: "Output ratio",
    cacheRatio: "Cache ratio",
    cacheWriteRatio: "Cache write ratio",
    imageRatio: "Image ratio",
    audioRatio: "Audio input ratio",
    audioCompletionRatio: "Audio output ratio",
    modelOwner: "Model owner",
    billingMode: "Billing mode",
    accountGroup: "Account group",
    activeApiKeys: "Active API keys",
    desktopSessions: "Desktop sessions",
    signInMethods: "Sign-in methods",
    lastLogin: "Last login",
    generatedAt: "Generated",
    timezone: "Timezone",
    sessions: "Desktop sessions",
    currentSession: "Current session",
    mustChangePassword: "Password change required",
    mustChangePasswordHint:
      "Business access and API key creation remain blocked until you set a permanent password.",
    sessionsHint: "Each personal desktop connection is isolated from management access.",
    revokeSession: "Revoke",
    revoked: "Revoked",
    password: "Password",
    currentPassword: "Current password",
    newPassword: "New password",
    changePassword: "Change password",
    reauthentication:
      "Changing your password revokes all personal and management desktop sessions for this user.",
    closeAccount: "Close account",
    closeHint:
      "Closing blocks new access immediately. Child-account balance returns to its parent after active billing sessions finish.",
    confirmUsername: "Type your username to confirm",
    closeReason: "Reason for closing",
    closeBlockedBalance:
      "Independent accounts must use or transfer their remaining balance before closing.",
    restartBrowserSignIn: "Start over",
    durationMs: (ms: string) => `${ms} ms`,
    openSecurity: "Open Security",
    currentSessionHint: "This is the desktop you're using. Use Forget credential to sign it out.",
    noSessions: "No desktop sessions.",
    passwordChangeDisabled:
      "This server does not allow changing your password from the desktop app.",
    accountCloseDisabled: "This server does not allow closing your account from the desktop app.",
  },

  /** GUI shell strings (header controls, dialogs) — GUI-only, not in the TUI. */
  /**
   * The five task domains in the rail. Named after what someone is trying to
   * do, which is why none of them is called after a file format or a vendor.
   */
  workspaces: {
    nav: "Task areas",
    open: "Open task areas",
    overview: "Overview",
    overviewHint: "What this machine looks like right now.",
    install: "Install & repair",
    installHint: "Put the agents, runtimes and network route in place.",
    capabilities: "Capabilities",
    capabilitiesHint: "Skills, MCP servers and providers the agents can reach.",
    account: "My account",
    accountHint: "Your own more-token profile, balance, usage, and security.",
    management: "Accounts & quota",
    managementHint: "Accounts, balances, policy automation, audit, and alerts.",
    usage: "Usage",
    usageHint: "What the agents have been doing, and what it cost.",
    settings: "Settings",
    settingsHint: "Profiles, config files, and the app itself.",
  },

  /**
   * The ⌘K command palette. It indexes destinations and app actions only —
   * never chat transcripts, config contents or keys.
   */
  palette: {
    open: "Search",
    title: "Command palette",
    description: "Jump to a task area or run an app action.",
    placeholder: "Go to a task area, or type an action…",
    empty: "Nothing matches that.",
    groupGo: "Go to",
    groupActions: "Actions",
    quickConfig: "Open quick config",
    rescan: "Rescan this machine",
    review: "Review pending changes",
    reviewCount: (n: number) => `Review ${n} pending change${n === 1 ? "" : "s"}`,
    toggleTheme: "Switch light / dark",
    onboarding: "Reopen the setup guide",
    updates: "Check for app updates",
  },

  /**
   * The overview's to-do list. Each line names what was observed on this
   * machine — never a category, never a score.
   */
  diagnostics: {
    title: "Needs your attention",
    severity: {
      critical: "Blocking",
      warning: "Worth a look",
      info: "Optional",
    },
    rescan: "Rescan",
    restore: "Restore from backup",
    open: "Open",
    setUp: "Set one up",
    openNetwork: "Open network",
    openRuntimes: "Open Runtimes",
    degradedTitle: "Some of this machine couldn't be read",
    degradedDetail:
      "A config file was locked or unreadable, so everything below was worked out from a partial view. Installs are held back until a clean scan lands.",
    noAgentTitle: "No coding agent installed",
    noAgentDetail: "Neither Claude Code nor Codex was found on this machine.",
    fileClaudeSettings: "Claude settings",
    fileCodexConfig: "Codex config",
    configInvalidTitle: (file: string) => `${file} doesn't parse`,
    configMissingTitle: (file: string) => `${file} is gone, but a backup is here`,
    networkTitle: "Nothing was reachable",
    networkDetail:
      "The network check reached neither the direct route nor any proxy it found. Installs will fail until that changes.",
    upgradeTitle: (tool: string, version: string) => `${tool} ${version} is out`,
    upgradeFrom: (version: string) => `You have ${version}.`,
    /** The update exists but npm would refuse it on this machine's Node. */
    nodeFloorDetail: (need: number, found: string) =>
      `npm needs Node ${need} or newer for this update, and this machine has Node ${found}.`,
    /**
     * Batch repairs. One label per action kind, because a batch is only honest
     * when a single sentence describes every member of it.
     */
    selectRow: (title: string) => `Select "${title}" to fix with others like it`,
    selected: (n: number) => `${n} selected`,
    clearSelection: "Clear",
    batch: {
      "upgrade-cli": (n: number) => `Upgrade ${n} tools`,
      "restore-config": (n: number) => `Restore ${n} files from backup`,
    },
  },

  /**
   * The pre-flight brief, read at the moment someone is asked to approve a run.
   * Plain language on purpose: this is the one screen where a first-time user
   * has to decide something, and every sentence here answers a question they
   * would otherwise only get an answer to by watching it go wrong.
   */
  preflight: {
    title: "Before you apply",
    /** The tone mark is aria-hidden, so each note states its tone in words. */
    tone: {
      blocked: "Needs you",
      warn: "Heads up",
      info: "For information",
    },
    blockedTitle: (label: string) => `${label} can't be done automatically here`,
    offlineTitle: "This machine can't reach the internet",
    offlineDetail: "Downloads will fail. Fix the network first, or apply this later.",
    elevationTitle: "Your system will ask for permission",
    elevationDetail: (n: number) =>
      `${n} step${n === 1 ? "" : "s"} need an administrator, so a password prompt appears partway through. That prompt comes from your operating system, not from this app.`,
    keysTitle: (n: number) => `${n} server${n === 1 ? "" : "s"} still need an API key`,
    keysDetail: (names: string) =>
      `${names} will be set up, but won't answer until a key is filled in. You can do that afterwards under MCP servers.`,
    prereqTitle: (label: string) => `${label} — a prerequisite, not something you picked`,
    prereqNode:
      "Node.js is what starts the servers in this list. Without it they install fine and then never run.",
    prereqUv: "uv is what starts the Python-based servers in this list.",
    alreadyTitle: (n: number) =>
      `${n} of your picks ${n === 1 ? "is" : "are"} already on this machine, and will be left alone`,
  },

  /**
   * The recovery centre. Its whole reason to exist is `safety` below: the four
   * backup mechanisms each only know about their own writes, so none of them
   * notices that the file it is about to restore over was edited by hand
   * afterwards.
   */
  recoveryCentre: {
    title: "Recovery points",
    subtitle:
      "Every way back this app has left behind, in one list — config snapshots, skill backups, quarantined cleanups and the backup left beside an edited config.",
    actionsLabel: "Recovery actions",
    refresh: "Refresh",
    refreshing: "Reading…",
    summaryLabel: "Recovery summary",
    metricTotal: "Restore points",
    metricStale: "Older than the live file",
    metricNewest: "Newest",
    listPanel: "Restore points",
    empty: "No restore points yet. Anything this app changes leaves one behind.",
    notMeasured: "Not read yet",
    notTauri:
      "Restore points live on your machine — run the desktop app to see what can be undone.",
    degradedNote:
      "One of the backup stores couldn't be read, so this list may be short — it is not proof that a restore point is gone.",
    undated: "Date not recorded",
    covers: (n: number) => `${n} file${n === 1 ? "" : "s"}`,
    restore: "Restore",
    restoreIn: (section: string) => `Restore in ${section}`,
    /**
     * Why two of the four kinds hand off instead of restoring from here: each
     * needs an answer this page has no way to ask for.
     */
    handOffSkill: "Restoring a skill needs you to say which agents it goes back into.",
    handOffQuarantine: "Restoring a batch needs you to see what is in it first.",
    restoreFailed: "The restore didn't finish — the run log has the detail.",
    restoreCancelled: "Restore cancelled — nothing was written.",
    loadingNote: "Reading the backup stores…",
    confirmTitle: "This would overwrite newer work",
    confirmBody: (when: string) =>
      `A file this restores over was changed after ${when}. Restoring puts it back to how it was then, and the later change is not kept anywhere.`,
    confirmProceed: "Restore anyway",
    kind: {
      configSnapshot: "Provider store snapshot",
      configBackupFile: "Config backup",
      skillBackup: "Skill backup",
      quarantineBatch: "Quarantined cleanup",
    },
    /** The verdict word. The mark that carries it visually is aria-hidden. */
    safety: {
      safe: "Safe to restore",
      stale: "Would overwrite newer work",
      unknown: "Can't tell",
    },
    safetyHint: {
      safe: "Nothing here has changed since this was taken.",
      stale:
        "A file this would write over was changed after this point was taken — restoring discards that change.",
      unknown: "Not enough was measured to say whether this would overwrite anything newer.",
    },
  },

  /**
   * Why a step failed, and what to do about it. Every reading here ends
   * somewhere real — a page in this app, or one concrete act. "Check your
   * configuration" is the absence of a diagnosis wearing one's clothes.
   */
  failure: {
    heading: "What went wrong",
    openSection: (section: string) => `Open ${section}`,
    /** Introduces the tool's own words, so a wrong reading is visibly wrong. */
    evidenceLabel: "It said:",
    nodeTooOldTitle: "This package needs a newer Node.js",
    nodeTooOldAdvice:
      "npm refused the install because the package requires a Node version above the one on this machine. Update Node, then retry.",
    diskFullTitle: "This machine ran out of disk space",
    diskFullAdvice:
      "The download had nowhere to go. Clean up reclaims the space the agent CLIs fill, and then this is worth retrying.",
    networkTitle: "The download couldn't get through",
    networkAdvice:
      "Mirrors and proxies were already tried and none of them worked. Test the routes, pick one that does, then retry.",
    permissionTitle: "The system refused permission",
    permissionAdvice:
      "The install needed rights this app doesn't have. Some tools offer a user-scope install method that needs none — pick one and run it again.",
    notFoundTitle: "A command it needed isn't on this machine",
    notFoundAdvice:
      "The installer it tried to use isn't there. Install it, or choose an install method that uses a different one.",
    unknownTitle: "This step failed for a reason we couldn't read",
    unknownAdvice:
      "Nothing in the output matched a cause we know how to explain, so here is exactly what it printed. Retry re-runs only what failed.",
  },

  /** The overview's record of what this app has actually done to the machine. */
  activity: {
    title: "Recent activity",
    empty: "Nothing yet. Runs you apply will be listed here.",
    notTauri: "Run the desktop app to keep a record of what changed.",
    viewAll: "Open recovery points",
    steps: (n: number) => `${n} step${n === 1 ? "" : "s"}`,
    outcome: {
      done: "Applied",
      warning: "Applied with warnings",
      error: "Failed",
      cancelled: "Stopped",
    },
    source: {
      "quick-config": "Quick config",
      section: "Section action",
      recovery: "Network recovery",
      restore: "Restore",
      unknown: "Run",
    } as Record<string, string>,
    /** Said plainly rather than offering an undo that would fail. */
    noUndo: "No automatic undo",
    restorePoint: "Restore point kept",
  },

  /** The bottom change tray — what's selected but not yet reviewed. */
  tray: {
    label: "Pending selection",
    count: (n: number) => `${n} selected`,
    clear: "Clear selection",
    review: "Review changes",
    /** What a run staged from the tray is called — in the panel and the activity log. */
    runTitle: (n: number) => `Set up ${n} selected item${n === 1 ? "" : "s"}`,
  },

  shell: {
    toggleTheme: "Toggle theme",
    light: "Light",
    dark: "Dark",
    system: "System",
    preview: "Preview (dry-run)",
    settings: "Settings",
    // Custom window controls (Windows/Linux frameless window).
    minimize: "Minimize",
    maximize: "Maximize",
    restore: "Restore",
    closeWindow: "Close window",
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
    downloadLatest: "Download latest",
    // "…" rather than "now": these stage the change for the review panel, and a
    // label that promised an immediate install described a gate as if it weren't one.
    installNow: "Install…",
    uninstallNow: "Uninstall…",
    installMethod: "Install method",
    apply: "Apply",
    /** The four SetupSteps states as words — the marker itself is only colour. */
    setupDone: "done",
    setupCurrent: "do this next",
    setupWaiting: "waiting on the step above",
    setupBlocked: "needs attention",
    add: "Add",
    edit: "Edit",
    delete: "Delete",
    setCurrent: "Set current",
    save: "Save",
    emptyPlan: "Your plan is empty. Select CLIs, skills, MCP servers or network options first.",
    nothingToDo: "Everything in your plan is already installed and up to date — nothing to do.",
    notInTauri: "Run the desktop app (pnpm tauri dev) to execute installs.",
    // The review panel while a run is executing, and the header control that
    // brings it back once it has been closed.
    runBusy: "A run is still going. Let it finish, or cancel it, before staging another.",
    runningDesc: "Applying the reviewed steps. Closing this panel doesn't stop them.",
    finishedDesc: "What ran, step by step.",
    runningBadge: (done: number, total: number) => `Running ${done}/${total}`,
    showRun: "Show the run in progress",
    preparing: "Preparing…",
    scanFailed:
      "Couldn't read what's already set up, so the install was not started — running blind would try to re-add things you already have. Try again in a moment.",
    // Shown after a network retry rescued a step. Nothing was written to get
    // there, so making it permanent is the user's call.
    recoveredTitle: (label: string) => `Installed via ${label}`,
    recoveredBody:
      "That was a one-off retry — nothing on your machine changed. Save it so future installs use it too?",
    recoveredPersist: "Save it",
    configSaved: (path: string) => `Saved config to ${path}`,
    configLoaded: "Config loaded into your plan.",
  },

  /** Environment health dashboard (real installed state scanned from disk). */
  dashboard: {
    title: "Environment dashboard",
    subtitle: "Your real installed state, scanned from disk.",
    statusSummary: "Environment status",
    supporting: "Usage and activity",
    systemInventory: "System inventory",
    refresh: "Rescan",
    scanning: "Scanning your environment…",
    notTauri: "Run the desktop app to scan your real environment.",
    notMeasured: "Not measured in web mode",
    runtimeChecking: "Checking desktop runtime…",
    partialScan: "Scan incomplete",
    overviewTools: "Tools",
    overviewMcp: "MCP",
    overviewSkills: "Skills",
    overviewProviders: "Providers",
    overviewRelay: "Relay",
    sectionClis: "CLIs & environment",
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
    currentProvider: "Current provider",
    inactiveProvider: "Available provider",
    configOk: "valid",
    configInvalid: "unparsable",
    configMissing: "absent",
    hasBackup: "backup available",
    restore: "Restore backup",
    fileClaudeSettings: "Claude settings.json",
    fileCodexConfig: "Codex config.toml",
    // Health banner: the dashboard leads with whatever needs the user's attention.
    healthAllGood: "Everything looks good",
    healthAllGoodHint: "No updates pending and every config file parses.",
    healthNeedsAttention: (n: number) =>
      n === 1 ? "1 item needs attention" : `${n} items need attention`,
    healthNeedsAttentionHint:
      "Each fix below is staged in the review panel before anything is written.",
    scannedAt: (time: string) => `scanned ${time}`,
    healthUpgrade: (name: string, version: string) => `${name} can be upgraded to ${version}`,
    healthConfig: (file: string, state: string) => `${file} is ${state}`,
    /** Accessible name for a status readout, which is also a way into a section. */
    /** Spoken stand-in for the em dash, so a readout never reads "dash dash". */
    readoutUnknown: "not measured",
    readoutAction: (label: string, value: string, section: string) =>
      `${label}: ${value} — open ${section}`,
    // Truncated overview lists link out to the section that owns them.
    viewAll: (n: number) => `${n} total · View all`,
    // Spend card: the one number on this page that isn't about configuration.
    spend: {
      title: "Spend this month",
      scanning: "Reading your session history…",
      cost: "Cost",
      tokens: "Tokens",
      sessions: "Sessions",
      vsPrevious: "vs previous period",
      estimated: "estimated from token counts",
      unpriced: (n: number) =>
        n === 1 ? "1 transcript has no known rate" : `${n} transcripts have no known rate`,
      empty: "No sessions yet",
      emptyHint: "Install a CLI and start a chat — your spend shows up here.",
      emptyAction: "Install a CLI",
      monthEmpty: "No activity this month",
      monthEmptyHint: "Earlier sessions were found. Open the usage dashboard to view them.",
      details: "Open usage dashboard →",
      notTauri: "Run the desktop app to read your session history.",
      // A failed read is not a month with no spend, and a partial one is not
      // the whole month.
      failed: (message: string) => `Couldn't read your session history: ${message}`,
      retry: "Read again",
      partial: (n: number) =>
        n === 1
          ? "1 source couldn't be read — this is a partial total"
          : `${n} sources couldn't be read — this is a partial total`,
    },
  },

  /** Chat-history reader + usage statistics across Claude Code, Codex, OpenCode. */
  history: {
    title: "Chat history",
    subtitle: "Read past sessions and token usage across Claude Code, Codex, OpenCode and Pi.",
    notTauri: "Run the desktop app to read your local chat history.",
    loading: "Reading your chat history…",
    refresh: "Rescan",
    /** The Rescan button while any history scan runs — same width, label replaced. */
    refreshing: "Scanning…",
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
    /** The scan command itself failed, so nothing was read — not an empty machine. */
    scanFailed: (message: string) =>
      `Couldn't read the chat history: ${message}. Rescan to try again.`,
    seriesFailed: (message: string) =>
      `Couldn't load per-message usage: ${message}. Rescan to try again.`,
    seriesUnavailable: "Per-message usage couldn't be loaded — see the error above.",

    /**
     * The header band: what the scan found, before any filter is applied. Read
     * as a sentence of measured facts, the way every other workbench states its
     * summary — never as a row of stat tiles.
     */
    summaryLabel: "Chat history summary",
    /**
     * Each label carries its own scope ("All …"), because the usage dashboard
     * one tab down states the same quantities for a chosen period. Two figures
     * called "Total tokens" on one screen, disagreeing, is worse than no
     * summary at all.
     */
    statAllSessions: "All sessions",
    statAllTokens: "All tokens",
    statAllSpend: "Total spend",
    statLastActive: "Last active",
    statLastActiveNever: "never",
    /** Which of the three CLIs actually have transcripts on this machine. */
    statSources: "Tools",
    summaryNote: "The filters below change the list only, never these totals.",

    /** The two views, each with the one line that says what it answers. */
    tabSessionsHint: "Every conversation, newest first. Open one to read the whole transcript.",
    tabUsageHint: "Charts and totals for a period you choose.",
    viewLabel: "History view",

    /** The session list and its toolbar. */
    listPanel: "Sessions",
    filtersLabel: "Sort & filter",
    filtersReset: "Reset",
    /** A filter chip's accessible name, which keeps the chip's own text. */
    clearFilter: (filter: string) => `Clear ${filter}`,
    projectFilter: (project: string) => `Project: ${project}`,
    periodFilter: (period: string) => `Period: ${period}`,
    /** Row meta, labelled rather than run together — a bare "1.2M" beside a
        bare "$3.40" tells a newcomer nothing about which is which. */
    rowTokens: (tokens: string) => `${tokens} tokens`,
    listCount: (shown: number, total: number) =>
      shown === total ? `${total} sessions` : `${shown} of ${total} sessions`,
    /** Session sources — display names. */
    sources: {
      claude: "Claude Code",
      codex: "Codex",
      opencode: "OpenCode",
      pi: "Pi",
    } as Record<string, string>,
    messages: (n: number) => `${n} msg`,
    branchView: "Session branch",
    branchOption: (n: number) => `Branch ${n}`,
    branches: (n: number) => `${n} branches`,
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
    event: (name: string) => name.replace(/_/g, " "),
    // Codex multi-agent traffic: `kind` is the wire constant, `agent` the other
    // agent's canonical path (`/root/pip_i18n`).
    agentMessage: (kind: string, agent: string) => {
      const kinds: Record<string, string> = {
        NEW_TASK: "Task hand-off",
        MESSAGE: "Agent message",
        FINAL_ANSWER: "Agent report",
      }
      const label = kinds[kind] ?? kind.replace(/_/g, " ")
      return agent ? `${label} · ${agent}` : label
    },
    subagentActivity: (kind: string, agent: string) => {
      const kinds: Record<string, string> = {
        started: "Sub-agent started",
        interacted: "Sub-agent interaction",
        interrupted: "Sub-agent interrupted",
      }
      const label = kinds[kind] ?? `Sub-agent ${kind.replace(/_/g, " ")}`
      return agent ? `${label} · ${agent}` : label
    },
    loadFailed: "Couldn't load this transcript.",
    retry: "Retry",
    transcriptEmpty: "This session has no renderable messages.",
    turns: (n: number) => `${n} turn${n === 1 ? "" : "s"}`,
    // Oversized payloads arrive truncated and are fetched on demand.
    loadFullText: (kb: string) => `Load full output (${kb})`,
    loadingFullText: "Loading…",
    fullTextFailed: "Couldn't load the full output.",
    // Sub-agent transcripts, nested under the session that spawned them.
    subagents: (n: number) => `${n} sub-agent${n === 1 ? "" : "s"}`,
    subagentParent: "Main session",
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
    statDuration: "Time spent",
    statAvgDuration: "Avg time / session",
    durationCoverage: (covered: number, total: number) => `${covered} of ${total} sessions`,
    statAvgTokens: "Avg tokens / session",
    statAvgCost: "Avg cost / session",
    costNote:
      "Cost is exact for OpenCode; for Claude Code and Codex it's estimated from current per-model pricing (2026-07). Rates change — treat estimates as approximate.",
    costEstimatedSub: (v: string) => `incl. ${v} estimated`,
    ratePerMillion: (input: string, output: string) => `${input} / ${output} per 1M`,
    chartByDay: "Tokens by day",
    chartCostByDay: "Cost by day",
    costViewLabel: "Cost chart view",
    costView: { heatmap: "Heatmap", bar: "Bar chart" } as Record<string, string>,
    heatmapHint: "One cell per day, shaded by that day's cost.",
    heatmapStat: (total: string, days: number) => `${total} across ${days} active days`,
    heatmapCell: (date: string, cost: string) => `${date}: ${cost}`,
    heatmapCellEmpty: (date: string) => `${date}: no usage`,
    heatmapLabel: "Daily cost heatmap",
    heatmapLegendLabel: "Cost intensity",
    // A `{{level}}` template rather than a function: the heatmap primitive does
    // the interpolation itself when it renders the legend swatches.
    heatmapLegendLevel: "Cost intensity level {{level}}",
    heatmapLess: "Less",
    heatmapMore: "More",
    heatmapPick: "Hover or focus a day to see its cost.",
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

    // --- Scan progress (a cache rebuild re-parses every transcript on disk) ---
    scanProgress: (done: number, total: number) => `Reading transcripts… ${done} / ${total}`,
    seriesLoading: "Loading per-message usage…",

    // --- Range + granularity ---
    /** Names the pill row, so it isn't six unexplained words in a strip. */
    periodLabel: "Period",
    /** Groups the two format buttons under one caption. */
    exportLabel: "Export",
    ranges: {
      today: "Today",
      "7d": "7 days",
      "30d": "30 days",
      "90d": "90 days",
      month: "This month",
      all: "All time",
      custom: "Custom",
    } as Record<string, string>,
    customRangeLabel: (from: string, to: string) => `${from} – ${to}`,
    applyRange: "Apply",
    granularityLabel: "Group by",
    granularity: { day: "Daily", week: "Weekly", month: "Monthly" } as Record<string, string>,
    /** Why "Group by" is disabled for Today. */
    granularityDayOnly: "A single day is one bucket.",
    rangeEmpty: "No sessions in this period.",
    dayFilter: (day: string) => `Day: ${day}`,
    clickToDrill: "Click a row to see the sessions behind it.",
    clickDayToDrill: "Click a day to see the sessions behind it.",
    clickToOpen: "Click a row to read its transcript.",

    // --- Usage sub-tabs ---
    tabOverview: "Overview",
    tabCost: "Cost & windows",
    tabBehaviour: "How you work",

    // --- Cost provenance ---
    rootSessionsHint: "top-level only",
    costBreakdownTitle: "Where the cost figure comes from",
    costBreakdownHint:
      "Three different kinds of number, kept apart rather than summed into one that looks more precise than it is.",
    costActual: "Recorded",
    costActualNote: "Billed figures OpenCode stores per session.",
    costEstimated: "Estimated",
    costEstimatedNote: "Priced from token counts for Claude Code and Codex (rates as of 2026-07).",
    costUnpriced: "Unpriced",
    costUnpricedNone: "None",
    costUnpricedNote: "Models with no known rate — excluded from both figures above.",
    unpricedValue: (transcripts: number, tokens: string) =>
      `${transcripts} transcript${transcripts === 1 ? "" : "s"} · ${tokens}`,
    unpricedExcluded: (sessions: number) =>
      `${sessions} session${sessions === 1 ? "" : "s"} left out — no known rate for the model.`,
    unpricedBadge: "no rate",
    costLowerBound: (entries: number) =>
      `Lower bound — ${entries} request${entries === 1 ? "" : "s"} on an unpriced model.`,
    statSubagents: "Sub-agent tokens",
    subagentShare: (percent: number, transcripts: number) =>
      `${percent}% of tokens, across ${transcripts} run${transcripts === 1 ? "" : "s"}`,

    // --- Five-hour windows ---
    activeBlockTitle: "Current 5-hour window",
    activeBlockHint: "Claude Code meters usage in rolling five-hour windows.",
    blockRemaining: "Time left",
    blockTokens: "Used so far",
    blockBurn: "Burn rate",
    blockProjected: "Projected at close",
    tokensPerMin: (v: string) => `${v}/min`,
    costPerHour: (v: string) => `${v}/h`,
    p90Label: (v: string) => `vs your P90 window (${v})`,
    p90NotEnough: "Not enough completed windows yet to draw a reference line.",
    blocksTitle: "Completed windows",
    blocksHint: "Each window opens on your first message and lasts five hours.",
    blocksEmpty: "No completed windows in this period.",
    blocksTruncated: (shown: number, total: number) =>
      `Showing the ${shown} most recent of ${total} windows — export for the rest.`,
    blocksNoQuotaNote:
      "No percent-of-plan figure here on purpose: published limits are counted in prompts and compute hours, not tokens, and the quota is shared with claude.ai — which local transcripts can't see. The reference line is your own P90 instead.",
    colWindow: "Window",
    colModels: "Models",
    colDuration: "Active for",
    modelCostHint: "Tokens and estimated cost per model, with its current rate.",

    // --- Subscription comparison ---
    subscriptionSetting: "Subscription",
    subscriptionLabel: "Monthly subscription spend (USD)",
    subscriptionSettingHint:
      "Optional. Only used to compare metered API pricing against what you actually pay — leave empty to hide that card.",
    subscriptionInvalid: "Enter a number, like 200 or $1,000.",
    subscriptionTitle: "API-equivalent vs what you pay",
    subscriptionHint: "What this period's work would have cost at metered API rates.",
    subscriptionApi: "API equivalent",
    subscriptionPaid: "You pay",
    subscriptionRatio: "Ratio",

    // --- How you work ---
    statToolCalls: "Tool calls",
    statMcpShare: "MCP share",
    mcpVsBuiltin: (mcp: string, builtin: string) => `${mcp} MCP · ${builtin} built-in`,
    statCacheHit: "Cache hit rate",
    cacheBreakdown: (read: string, fresh: string) => `${read} cached · ${fresh} fresh`,
    statCacheSaved: "Saved by caching",
    cacheSavedNote: "vs paying full input rate for the same tokens",
    toolsTitle: "Tools",
    toolsHint: "Calls and failures per tool, busiest first.",
    toolsEmpty: "No tool calls in this period.",
    toolErrors: (count: string, rate: string) => `${count} failed (${rate}%)`,
    toolErrorsCaveat:
      "Failure counts cover Claude Code and OpenCode. Codex writes tool output as free text with no failure flag, so its tools always read as zero errors.",
    modelMixTitle: "Model mix over time",
    modelMixHint: "Which models the tokens went to, period by period.",
    modelMixEmpty: "No per-message data in this period.",
    modelOther: "Other models",
    costHistogramTitle: "Cost per session",
    costHistogramHint: "How many sessions land in each cost bracket.",
    branchesTitle: "By git branch",
    branchesHint: "Only Claude Code records a branch, and only the first one it saw.",
    branchesEmpty: "No branch information in this period.",
    colBranch: "Branch",
    topSessionsTitle: "Most expensive sessions",
    colSession: "Session",
    outlierBadge: "outlier",

    // --- Export ---
    exportCsv: "Export CSV",
    exportJson: "Export JSON",
    exportFailed: (message: string) => `Couldn't write the export: ${message}`,

    // --- Shareable report ---
    // CSV and JSON are for spreadsheets and scripts; this is the one a person
    // actually posts, so every string here is user-facing prose.
    report: {
      share: "Share",
      dialogTitle: "Shareable report",
      dialogSubtitle: "A card and a Markdown summary of the range you're viewing.",
      cardTitle: "AI coding spend",
      copyMarkdown: "Copy Markdown",
      copied: "Copied to clipboard",
      savePng: "Save PNG",
      saveSvg: "Save SVG",
      saved: (path: string) => `Saved to ${path}`,
      renderFailed: "Couldn't render the image — save the SVG instead.",
      copyFailed: "Couldn't write to the clipboard. Try again.",
      saveFailed: (message: string) => `Couldn't save the file: ${message}`,
      cost: "Cost",
      tokens: "Tokens",
      sessions: "Sessions",
      perSession: "Per session",
      topModels: "Top models",
      vsPrevious: "vs previous period",
      estimatedNote: "Costs for Claude Code and Codex are estimated from token counts.",
      unpricedNote: (n: number) =>
        n === 1
          ? "1 transcript used a model with no known rate and is excluded."
          : `${n} transcripts used models with no known rate and are excluded.`,
      noActivity: "No sessions in this range",
      footer: "Measured with agentpack",
    },
  },

  /** About & self-update section (app version, check/download/install). */
  about: {
    title: "About & updates",
    subtitle: "Which build this is, and how it gets the next one.",
    actionsLabel: "Project links and locations",
    updatePanel: "Application updates",
    locationsTitle: "Configuration folders",
    locationsHint: "Open the folders the installed coding agents keep their config in.",
    locationsUnavailable: "Configuration folders are available in the desktop app.",
    sourceTitle: "Project",
    sourceHint: "Release notes, issues and the changelog live on GitHub.",
    summaryLabel: "Application status summary",
    metricVersion: "Version",
    metricSystem: "System",
    metricUpdate: "Update",
    metricChecked: "Checked",
    updateNotChecked: "Not checked",
    updateCurrent: "Current",
    updateFailed: "Check failed",
    systemLoading: "Reading system information",
    systemUnavailable: "System information is only available in the desktop app",
    unknownError: "Unknown system error",
    updateError: (reason: string) =>
      `Update operation failed: ${reason}. Check the network and try again.`,
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
    installFailed:
      "The update didn't install. The reason is under Application updates — try Install & restart again.",
    updateInstallFailed: "Install failed",
    lastChecked: (when: string) => `Last checked: ${when}`,
    never: "never",
    configFolders: "Config folders",
    openClaudeFolder: "Open Claude folder",
    openCodexFolder: "Open Codex folder",
    notifyTitle: "Update available",
    notifyBody: (v: string) => `agentpack ${v} is ready to install.`,
  },

  /**
   * Preferences — everything about how the app itself behaves, split out of
   * About so that screen is only about which build you are running.
   */
  preferences: {
    title: "Preferences",
    subtitle: "How agentpack looks, where it opens, and what it may do on its own.",
    summaryLabel: "Preference summary",
    actionsLabel: "Guidance and defaults",
    panelLabel: "Application preferences",

    metricTheme: "Theme",
    metricScale: "Scale",
    metricStartup: "Opens on",
    metricLanguage: "Language",

    appearanceTitle: "Appearance",
    appearanceHint: "Applied to this window as you change it.",
    themeLabel: "Theme",
    themeHint: "System follows the OS; the header's toggle flips between the other two.",
    themeSystem: "System",
    themeLight: "Light",
    themeDark: "Dark",
    languageLabel: "Language",
    languageHint: "Every screen, the run log included.",
    scaleLabel: "Interface scale",
    scaleHint: "Resizes text, controls and spacing together.",
    scaleValue: (pct: number) => `${pct}%`,
    scaleDefault: (pct: number) => `${pct}% · default`,
    motionLabel: "Reduce motion",
    motionHint:
      "Collapses panel fades and the tray slide. Your system setting already does this — turn it on for agentpack alone.",

    startupTitle: "Startup",
    startupSectionLabel: "Open on",
    startupSectionHint: "The screen agentpack shows when it launches.",
    startupDefault: "Overview (default)",
    autoCheckLabel: "Check for updates on startup",
    autoCheckHint: "One request to the release feed, at launch.",
    quickStartLabel: "Show the quick-start card",
    quickStartHint: "The overview's setup shortcut, shown while no assistant is installed.",

    systemTitle: "This machine",
    hotkeyLabel: "Global hotkey",
    hotkeyHint: "Bring agentpack to the front from anywhere with",
    hotkeyTaken: (accel: string) => `${accel} is already used by another app.`,
    hotkeyDesktopOnly: "The global hotkey can only be registered by the desktop app.",
    osLabel: "Build commands for",
    osHint: "Write install commands for a different OS than this one.",
    osAuto: "This machine",

    guidanceTitle: "Guided help",
    guidanceHint: "Walk the workspaces again, or reopen the first-run wizard.",
    defaultsTitle: "Restore defaults",
    defaultsHint:
      "Resets the preferences on this page only. Profiles, providers, network settings and installed tools are untouched.",
    defaultsAction: "Restore defaults",
    defaultsDone: "Preferences restored to their defaults.",

    webNote: "Preferences apply to this window. The desktop app remembers them between launches.",
  },

  /** Multi-profile management (save / switch named setups). */
  profiles: {
    title: "Profiles & backup",
    subtitle: "Save this machine's setup under a name, or move the whole thing elsewhere.",
    summaryLabel: "Saved setup summary",
    actionsLabel: "Backup and config-file actions",
    listPanel: "Saved profiles",
    listTitle: "Profiles",
    listHint:
      "A profile is a snapshot of the current selection — CLIs, skills, MCP servers and their keys.",
    metricSaved: "Profiles",
    metricActive: "Active",
    metricSelection: "Current selection",
    none: "none",
    saveAs: "Save current as profile",
    namePlaceholder: "Profile name",
    apply: "Load into selection",
    rename: "Rename",
    renameLabel: (name: string) => `New name for ${name}`,
    renameCommit: "Save name",
    renameCancel: "Cancel rename",
    delete: "Delete",
    current: "current",
    empty: "No profiles saved yet.",
    emptyHint:
      "Name the current selection above and it lands here, ready to re-apply on this machine or another one.",
    savedAt: (when: string) => `Saved ${when}`,
    machineComplete: "This machine already has everything in it.",
    machineMissing: (n: number) =>
      `${n} of these ${n === 1 ? "is" : "are"} not on this machine yet — loading it and reviewing the changes installs just those.`,
    fileTitle: "Config file",
    fileHint: "The plan-only format the headless CLI reads.",
    applied: (name: string) =>
      `Loaded "${name}" into the selection — nothing is installed until you review the changes.`,
    saved: (name: string) => `Saved profile "${name}"`,
    deleted: (name: string) => `Deleted profile "${name}"`,
    nameRequired: "Enter a profile name.",
    // Saving an empty selection made a profile whose only effect, loaded
    // later, was to clear whatever had been picked since.
    emptySelection:
      "Nothing is selected yet — pick CLIs, skills or MCP servers first, then save them here.",
    deleteTitle: (name: string) => `Delete the profile "${name}"?`,
    deleteBody: (path: string) => `It is removed from ${path}, and no copy is kept.`,
    storeUnreadable: (path: string, reason: string) =>
      `Couldn't read ${path}: ${reason}. Nothing is written to it until it can be read — fix the file, then read it again.`,
    storeCorrupt: (path: string) =>
      `${path} isn't a profile list agentpack can read, so it is left untouched and nothing is saved to it — fix or move the file, then read it again.`,
    readAgain: "Read again",
    writeFailed: (path: string, reason: string) =>
      `Couldn't write ${path}: ${reason}. The profile list was left as it was.`,
    configWriteFailed: (path: string, reason: string) => `Couldn't write ${path}: ${reason}.`,
  },

  bundle: {
    title: "Backup",
    subtitle: "Move a whole setup to another machine, or share parts of it.",
    exportOpen: "Export backup…",
    importOpen: "Import backup…",
    exportTitle: "Export a backup",
    exportHint: "Pick what to include. Everything is optional.",
    importTitle: "Import a backup",
    importHint: "Choose a file or paste one, then pick what to restore.",
    partPlan: "Plan",
    partProfiles: "Profiles",
    partProviders: "Providers",
    partFiles: "Config files",
    partSettings: "App settings",
    /**
     * The honest completion of an import: a transfer file never carries
     * credentials, so the last thing it can do is say precisely which ones it
     * withheld. Derived from the file itself — see `pendingCredentials`.
     */
    partCredentials: "Still to supply",
    credentialsHint:
      "A transfer file never carries credentials. Until these are filled in, the parts that need them are set up but won't work.",
    credentialMcpKey: (id: string, env: string) => `${id} — API key (${env})`,
    credentialProxy: (field: string) => `Proxy — ${field}`,
    credentialConfigField: (file: string, field: string) => `${file} — ${field}`,
    planSummary: (clis: number, skills: number, mcps: number) =>
      `${clis} ${clis === 1 ? "CLI" : "CLIs"} · ${skills} ${skills === 1 ? "skill" : "skills"} · ${mcps} MCP ${mcps === 1 ? "server" : "servers"}`,
    countProfiles: (n: number) => `${n} saved`,
    countProviders: (n: number) => `${n} configured`,
    fileMissing: "not on this machine",
    fileUnredactable: "can't be redacted — excluded",
    fileNew: "new",
    fileSame: "identical",
    fileDiffers: "differs",
    fileLocalUnreadable: "Your copy doesn't parse, so its credentials can't be kept.",
    includeSecrets: "Include credentials",
    secretsHint:
      "Off by default: API keys, tokens and proxy passwords are blanked. Importing puts your own back where a blank arrives.",
    secretsWarning:
      "This file will contain working credentials in plain text. Don't share it or commit it.",
    clipboardAlwaysRedacts: "Copying always leaves credentials out.",
    copyToClipboard: "Copy",
    saveFile: "Save file…",
    chooseFile: "Choose file…",
    pasteClipboard: "Paste",
    copied: "Backup copied to the clipboard.",
    exported: (path: string) => `Backup saved to ${path}`,
    nothingToExport: "Select at least one part to export.",
    planMerge: "Merge",
    planReplace: "Replace",
    profilesMerge: "Merge",
    profilesReplace: "Replace",
    profilesSkip: "Skip",
    overwriteConflicts: "Replace providers with the same name",
    ccSwitchRunning: "Quit cc-switch before importing providers — it holds the database open.",
    diffAdded: (n: number) => `+${n}`,
    diffRemoved: (n: number) => `−${n}`,
    diffNetwork: "network settings change",
    diffProfiles: (fresh: number, updated: number) => `${fresh} new · ${updated} updated`,
    diffProviders: (fresh: number, conflicts: number) => `${fresh} new · ${conflicts} conflicting`,
    legacyDetected: "Older config format — contains a plan only.",
    secretsPresent: "This backup carries working credentials.",
    skippedParts: (list: string) => `Could not read: ${list}`,
    importDone: "Backup imported.",
    importDiscarded: "Import cancelled — nothing was written.",
    importStopped:
      "Import stopped before it finished — the review panel lists what ran, and your selection was left as it was.",
    exportWebNote:
      "Saving a file, and reading providers and config files, needs the desktop app. Copy carries the plan, profiles and settings this window holds.",
    importWebNote:
      "Importing writes to this machine, so it needs the desktop app. You can still paste a backup to read what it holds.",
    exportFailed: (reason: string) =>
      `Couldn't save the backup: ${reason}. Pick another location and try again.`,
    copyFailed:
      "Couldn't copy the backup — the system refused clipboard access. Try again, or save a file instead.",
    providersUnreadable: (reason: string) =>
      `Couldn't read the provider store: ${reason}. Untick Providers to export without them.`,
    profilesDropped: (n: number) =>
      `Replace deletes ${n} profile${n === 1 ? "" : "s"} saved on this machine that this backup doesn't have. A copy of the current list is kept beside it.`,
    stepProfilesKeep: (path: string) => `Keep a copy of ${path} as it is now`,
    stepProfilesWrite: (path: string) => `Write the imported profiles to ${path}`,
    profilesWritten: (n: number) => `saved ${n} profile${n === 1 ? "" : "s"}`,
    stepSettings: (n: number) => `Save ${n} app setting${n === 1 ? "" : "s"}`,
    importPlaceholder: "Paste the contents of a backup file here",
    tomlReformatHint: "TOML comments are not preserved in a redacted export.",
  },

  configFiles: {
    title: "Config files",
    subtitle: "Edit the agent CLIs' own config files — as a form, or as text.",
    edit: "Edit",
    create: "Create",
    present: "present",
    missing: "missing",
    checking: "checking…",
    stepLabel: (path: string) => `Save ${path} from the editor`,
    notTauri: "Editing your config files needs the desktop app.",
    tabForm: "Form",
    tabRaw: "Text",
    save: "Save",
    cancel: "Cancel",
    reset: "Reset to file",
    saved: (name: string) => `Saved ${name}`,
    saveFailed: "Could not write the file.",
    loadFailed: "Could not read the file.",
    invalidJson: "That isn't valid JSON — fix it before saving.",
    invalidToml: "That isn't valid TOML — fix it before saving.",
    formUnavailable: "The file doesn't parse, so the form is unavailable. Fix it in the Text tab.",
    editorHint:
      "The text is what gets saved. Editing a field rewrites the file from its parsed form, which drops TOML comments; a file you only read is left byte-for-byte alone.",
    unset: "(unset)",
    lockedHint: "This key holds a shape the form can't edit — use the Text tab.",
    providerFirst: "Pick a provider first",
    mapAdd: "Add",
    mapRemove: "Remove",
    mapKey: "Name",
    mapValue: "Value",
    conflictTitle: "The file changed on disk",
    conflictBody:
      "Something else wrote this file after you opened it. Saving now would discard those changes.",
    conflictReload: "Reload from disk",
    conflictOverwrite: "Overwrite anyway",
    discardTitle: "Discard your edits?",
    discardBody: "This editor has unsaved changes.",
    discardConfirm: "Discard",
    discardCancel: "Keep editing",
    tooLarge: (mb: string) =>
      `This file is ${mb} MB — too large to edit as text here. Use an external editor.`,
    volatileWarning:
      "The Claude CLI rewrites this file while it runs. agentpack normally only reads it; edit with care.",
    backupNote: (path: string) => `The original was backed up to ${path}`,
    mcpInventoryTitle: "MCP servers",
    mcpInventoryEmpty: "No user-scope MCP servers configured.",
    openMcp: "Open the MCP section",
    files: {
      claudeSettings: {
        title: "Claude Code settings",
        desc: "Model, permissions, environment and status line. Switching a cc-switch provider overwrites the ANTHROPIC_* entries under env.",
      },
      codexConfig: {
        title: "Codex config",
        desc: "Model, sandbox, shell environment and history. Switching a cc-switch provider overwrites model, model_provider, reasoning effort, context window and [model_providers.custom].",
      },
      opencodeConfig: {
        title: "OpenCode config",
        desc: "Model, agent defaults and per-tool permissions.",
      },
      claudeConfig: {
        title: "Claude Code user config",
        desc: "Holds user-scope MCP servers alongside the CLI's own session state. Read-only here — add servers from the MCP section.",
      },
    },
    sections: {
      claudeGeneral: "General",
      claudePermissions: "Permissions",
      claudeEnv: "Environment",
      claudeStatusLine: "Status line",
      claudeMcp: "MCP",
      codexModel: "Model",
      codexSandbox: "Approval & sandbox",
      codexUi: "Interface",
      codexShellEnv: "Shell environment",
      codexHistory: "History",
      ocGeneral: "General",
      ocPermission: "Permissions",
    },
    fields: {
      // Claude Code — settings.json
      claudeModel: "Model",
      claudeTheme: "Theme",
      claudeVerbose: "Verbose output",
      claudeCoAuthored: "Add Co-authored-by",
      claudeCleanupDays: "Keep transcripts (days)",
      claudeSpinnerTips: "Spinner tips",
      claudeAlwaysThinking: "Always think",
      claudeApiKeyHelper: "API key helper script",
      claudeSandboxEnabled: "Sandbox",
      claudeDefaultMode: "Default mode",
      claudeAllow: "Allow",
      claudeAsk: "Ask",
      claudeDeny: "Deny",
      claudeAddDirs: "Extra directories",
      claudeDisableBypass: "Disable bypass mode",
      claudeEnvVars: "Environment variables",
      claudeStatusType: "Type",
      claudeStatusCommand: "Command",
      claudeStatusPadding: "Padding",
      claudeEnableProjectMcp: "Enable all project MCP servers",
      claudeEnabledMcpJson: "Enabled .mcp.json servers",
      claudeDisabledMcpJson: "Disabled .mcp.json servers",
      // Codex — config.toml
      codexModel: "Model",
      codexProvider: "Provider",
      codexEffort: "Reasoning effort",
      codexSummary: "Reasoning summary",
      codexVerbosity: "Verbosity",
      codexContextWindow: "Context window",
      codexApproval: "Approval policy",
      codexSandboxMode: "Sandbox mode",
      codexNetworkAccess: "Network access",
      codexWritableRoots: "Writable roots",
      codexFileOpener: "File opener",
      codexHideReasoning: "Hide reasoning",
      codexRawReasoning: "Show raw reasoning",
      codexWebSearch: "Web search",
      codexViewImage: "Image viewing tool",
      codexShellInherit: "Inherit",
      codexShellSet: "Set variables",
      codexHistoryPersistence: "Persistence",
      codexHistoryMaxBytes: "Max size (bytes)",
      // OpenCode — opencode.json
      ocSchema: "Schema URL",
      ocModel: "Model",
      ocSmallModel: "Small model",
      ocUsername: "Username",
      ocShare: "Sharing",
      ocSnapshot: "Snapshots",
      ocSubagentDepth: "Sub-agent depth",
      ocDefaultAgent: "Default agent",
      ocLogLevel: "Log level",
      ocDisabledProviders: "Disabled providers",
      ocInstructions: "Instruction files",
      ocPermEdit: "Edit",
      ocPermBash: "Bash",
      ocPermWebfetch: "Web fetch",
    },
  },
}
