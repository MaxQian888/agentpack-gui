"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { toast } from "sonner"
import type { SkillsScanResult } from "@/lib/skills/types"
import { isTauri } from "@/lib/tauri"
import {
  detectCli,
  detectRuntime,
  getPaths,
  latestVersion,
  npmOwns,
  pkgManagerOwns,
  setProcessProxy,
  skillsScan,
} from "@/lib/tauri/commands"
import { checkForUpdate, getAppVersion } from "@/lib/tauri/updater"
import { loadActivity } from "@/lib/tauri/activity"
import { loadSettings, saveSettings, type OnboardingProgress } from "@/lib/tauri/settings"
import { registerSummonShortcut } from "@/lib/tauri/shortcut"
import { notify } from "@/lib/tauri/system"
import {
  buildSteps,
  countSelections,
  unappliedNetwork,
  type InstalledState,
} from "@/lib/agentpack/plan"
import { effectiveProxy, isProxyActive } from "@/lib/agentpack/network/proxy"
import { scanNetwork } from "@/lib/agentpack/network/scan"
import { hostArch } from "@/lib/tauri/system"
import {
  CLI_TOOLS,
  RUNTIMES,
  runtimePkgManager,
  runtimesForOS,
  SKILLS,
} from "@/lib/agentpack/registry"
import { skillTargetsFor, type Surface } from "@/lib/agentpack/presets"
import {
  hasTabs,
  SECTION_KEYS,
  workspaceOf,
  type NavigateIntent,
  type SectionKey,
  type WorkspaceKey,
} from "@/lib/agentpack/workspaces"
import { useAppStore } from "@/store/app-store"
import { useT } from "@/lib/i18n/provider"
import { useAppearance } from "@/hooks/use-appearance"
import { Header } from "./header"
import { WorkspaceRail } from "./sidebar-nav"
import { WorkspaceTabs } from "./workspace-tabs"
import { ChangeTray } from "./change-tray"
import { CommandPalette, useCommandShortcut } from "./command-palette"
import { DashboardSection, scanEnvironment, type DashboardScan } from "./sections/dashboard"
import { RecoverySection } from "./sections/recovery"
import { HistorySection } from "./sections/history"
import { useHistoryScans } from "./sections/history/use-history-scans"
import { PresetsSection } from "./sections/presets"
import { EnvironmentSection } from "./sections/environment"
import { ClisSection } from "./sections/clis"
import { SkillsSection } from "./sections/skills"
import { McpSection } from "./sections/mcp"
import { PiSection } from "./sections/pi"
import { usePiManagementController } from "./pi-controller"
import { NetworkSection } from "./sections/network"
import { CleanupSection } from "./sections/cleanup"
import { CcSwitchSection } from "./sections/ccswitch"
import { CcConnectSection } from "./sections/ccconnect"
import { AboutSection } from "./sections/about"
import { PreferencesSection } from "./sections/preferences"
import { MoreTokenSection } from "./sections/more-token"
import { PersonalMoreTokenSection } from "./sections/more-token/personal"
import { ConfigIO } from "./config-io"
import { OnboardingDialog } from "./onboarding-dialog"
import { GuidedTour } from "./guided-tour"
import { RunnerProvider, useRunnerCtx } from "./run/runner-context"
import { ExecutionPanel } from "./run/execution-panel"

function ShellBody() {
  const t = useT()
  const paths = useAppStore((s) => s.paths)
  const providerBackend = useAppStore((s) => s.settings.providerBackend)
  const setPaths = useAppStore((s) => s.setPaths)
  const setActivity = useAppStore((s) => s.setActivity)
  const setDetections = useAppStore((s) => s.setDetections)
  const setLatestVersion = useAppStore((s) => s.setLatestVersion)
  const setCliManager = useAppStore((s) => s.setCliManager)
  const setRuntimeOwned = useAppStore((s) => s.setRuntimeOwned)
  const setAppVersion = useAppStore((s) => s.setAppVersion)
  const setUpdateState = useAppStore((s) => s.setUpdateState)
  const setUpdateInfo = useAppStore((s) => s.setUpdateInfo)
  const setSettings = useAppStore((s) => s.setSettings)
  const setProxy = useAppStore((s) => s.setProxy)
  const setNetworkProbe = useAppStore((s) => s.setNetworkProbe)
  const setNetworkProbing = useAppStore((s) => s.setNetworkProbing)
  const applyPreset = useAppStore((s) => s.applyPreset)
  const setMcpKey = useAppStore((s) => s.setMcpKey)
  const setSkill = useAppStore((s) => s.setSkill)
  const onboardingOpen = useAppStore((s) => s.onboardingOpen)
  const setOnboardingOpen = useAppStore((s) => s.setOnboardingOpen)
  const setPanelOpen = useAppStore((s) => s.setPanelOpen)
  const tourActive = useAppStore((s) => s.tourActive)
  const setTourActive = useAppStore((s) => s.setTourActive)
  const { run, onAfterRun, running, reports } = useRunnerCtx()
  const panelOpen = useAppStore((s) => s.panelOpen)
  // Only while the panel that shows it is closed — two progress readouts for one
  // run is one too many.
  const backgroundRun =
    running && !panelOpen
      ? {
          done: reports.filter((r) => r.status !== "pending" && r.status !== "running").length,
          total: reports.length,
        }
      : null
  // Where we are: a task domain, and which of its destinations is showing. Both
  // are held here because the header names them, the rail highlights one and the
  // tab strip the other — a single `section` would leave the rail guessing.
  const [workspace, setWorkspace] = useState<WorkspaceKey>("overview")
  const [section, setSection] = useState<SectionKey>("dashboard")
  const [commandOpen, setCommandOpen] = useState(false)

  // Whether the user has steered yet. The startup preference below only lands
  // the app somewhere if they haven't — settings arrive asynchronously, and
  // yanking someone off a page they already opened is worse than ignoring the
  // preference for that launch.
  const navigatedRef = useRef(false)
  // Which History tab the next visit opens on. Only the overview's "Open usage
  // dashboard" asks for Usage; every other way in lands on Sessions, as before.
  const [historyTab, setHistoryTab] = useState<"sessions" | "usage">("sessions")
  // Likewise a hand-off that needs a particular view of its destination (see
  // `NavigateIntent`); every other way in lands on the section's default view.
  const [landing, setLanding] = useState<NavigateIntent | null>(null)
  const navigate = useCallback((next: WorkspaceKey, to: SectionKey) => {
    navigatedRef.current = true
    setHistoryTab("sessions")
    setLanding(null)
    setWorkspace(next)
    setSection(to)
  }, [])

  /** Navigate by destination — for the tour, the dashboard's links and the palette. */
  const goToSection = useCallback((to: SectionKey) => navigate(workspaceOf(to), to), [navigate])
  const goWithIntent = useCallback(
    (to: SectionKey, intent?: NavigateIntent) => {
      goToSection(to)
      if (intent) setLanding(intent)
    },
    [goToSection]
  )

  // Not during the tour: the palette would open *under* its z-100 overlay and
  // take focus into a dialog nobody can see, and Esc would then close both.
  const openCommand = useCallback(() => {
    if (useAppStore.getState().tourActive) return
    setCommandOpen(true)
  }, [])
  useCommandShortcut(openCommand)

  // Arriving somewhere starts at its top. `<main>` is one scroll container shared
  // by every destination, so without this a tab opened from halfway down a long
  // page (Skills, the usage dashboard) landed halfway down the new one too —
  // below its heading and status band, which read as the click having missed.
  // The entrance replays on the same beat; it is layout-effect so neither the
  // old offset nor the un-faded content is ever painted.
  const mainRef = useRef<HTMLElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = 0
    const el = contentRef.current
    if (!el) return
    // Restart the CSS animation without remounting the section — a key would
    // throw away state the more-token views share across their tabs.
    el.style.animation = "none"
    void el.offsetWidth
    el.style.animation = ""
  }, [section])
  // Interface scale + the reduced-motion override, applied to <html>. Reads the
  // store, so it covers both the restore at startup and a live change made in
  // Settings → Preferences.
  useAppearance()

  // Saved wizard progress, once settings have been read. The wizard seeds its
  // state from this exactly once, so it is keyed on it below rather than gated
  // behind it: gating on "settings loaded" would never release in web mode,
  // where the hydration effect returns early, and the wizard could then never be
  // opened outside Tauri at all.
  const [restoredProgress, setRestoredProgress] = useState<OnboardingProgress | null>(null)
  // The wizard's latest answers, kept in a ref because only the two exit paths
  // read them — routing this through state would re-render the whole shell on
  // every radio click.
  const onboardingProgress = useRef<OnboardingProgress | null>(null)

  // Dashboard scan lives here (ShellBody never unmounts) so it runs once on
  // startup instead of re-scanning every time the user returns to the home page.
  const [dashboardScan, setDashboardScan] = useState<DashboardScan | null>(null)
  const [dashboardScanning, setDashboardScanning] = useState(false)
  // Mirrors `dashboardScan`, but as a ref: runOneClick reads it at call time and
  // must not be rebuilt (and re-created as a callback) on every scan.
  const lastGoodScan = useRef<DashboardScan | null>(null)

  // NB: the shell deliberately subscribes to none of `detections`,
  // `latestVersions`, `cliManagers` or `networkProbe`. `refreshDetections`
  // writes the last three once per installed CLI, un-batched, so a subscription
  // here re-renders the whole window ~20 times on every startup and Rescan —
  // `<main>` and whatever section the user is scrolling with it. The one surface
  // that needs them folds them itself; see `ExecutionPanel`.

  // Chat-history scans — the summaries at startup, the per-message series on
  // first ask — cached here so returning to History reuses them. The hook owns
  // the ordering rules (a Rescan's result is never overwritten by an older one).
  const {
    result: historyResult,
    loading: historyLoading,
    progress: historyProgress,
    series: seriesResult,
    seriesLoading,
    rescan: loadHistory,
    loadSeries,
  } = useHistoryScans()
  const piController = usePiManagementController(
    historyResult?.sessions
      .filter((session) => session.source === "pi" && session.cwd)
      .map((session) => session.cwd) ?? []
  )

  // Installed-skills scan (reads every SKILL.md across the four global roots):
  // lazy on first Skills visit, cached here, invalidated after every real run.
  const [skillsResult, setSkillsResult] = useState<SkillsScanResult | null>(null)
  const [skillsLoading, setSkillsLoading] = useState(false)
  // A scan that failed is not an empty machine. The result still settles (so
  // the lazy effect below doesn't retry in a loop), but the section is told
  // why, and offers the retry, instead of reading "No skills found".
  const [skillsError, setSkillsError] = useState<string | null>(null)

  // Measure the network once at startup, in the background. Doing it here rather
  // than in the Network section is the whole point: a user who never opens that
  // section still gets working mirrors when an install fails, and the first-run
  // wizard has an answer ready by the time it asks.
  const probeNetworkNow = useCallback(async () => {
    if (!isTauri()) return
    setNetworkProbing(true)
    try {
      setNetworkProbe(await scanNetwork())
    } catch {
      // A failed probe just means no recovery routes — never a broken app.
      setNetworkProbe(null)
    } finally {
      setNetworkProbing(false)
    }
  }, [setNetworkProbe, setNetworkProbing])

  const loadSkills = useCallback(async () => {
    if (!isTauri()) return
    setSkillsLoading(true)
    try {
      setSkillsResult(await skillsScan())
      setSkillsError(null)
    } catch (e) {
      setSkillsResult({ skills: [], errors: [] })
      setSkillsError(e instanceof Error ? e.message : String(e))
    } finally {
      setSkillsLoading(false)
    }
  }, [])

  // Every scan goes through here, so "the last state we actually read from disk"
  // has exactly one writer. A degraded scan still updates the dashboard (a
  // partial view beats a stale one) but is NOT remembered as good, because the
  // one-click install dedups against the remembered scan — see runOneClick.
  const rememberScan = useCallback((scan: DashboardScan) => {
    if (!scan.degraded) lastGoodScan.current = scan
    setDashboardScan(scan)
  }, [])

  const rescanDashboard = useCallback(async () => {
    if (!isTauri() || !paths) return
    setDashboardScanning(true)
    try {
      rememberScan(await scanEnvironment(paths, providerBackend))
    } finally {
      setDashboardScanning(false)
    }
  }, [paths, providerBackend, rememberScan])

  // Initial scan once paths are known. Fire-and-forget so the UI renders
  // immediately; the (now async) Rust commands run off the main thread, and
  // setState lives in the async continuation to avoid cascading renders.
  useEffect(() => {
    if (!isTauri() || !paths) return
    let cancelled = false
    scanEnvironment(paths, providerBackend)
      .then((result) => {
        if (!cancelled) rememberScan(result)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [paths, providerBackend, rememberScan])

  // Detect every CLI + runtime and refresh latest-version info. Reused both on
  // startup and after every real run, so install/upgrade/uninstall are reflected
  // in the badges without an app restart.
  const refreshDetections = useCallback(async () => {
    if (!isTauri()) return
    const state = useAppStore.getState()
    // Machine dependencies follow the host, never the optional command-preview
    // override used to inspect plans for another OS.
    const os = state.paths?.os ?? state.effectiveOS()
    // Each probe is isolated: a single failing detection must not reject the
    // whole batch and blank every badge / install button in the UI — it just
    // marks that one tool "not installed" so the rest still render their actions.
    const entries = await Promise.all([
      ...CLI_TOOLS.map(
        async (tool) =>
          [
            tool.id,
            await detectCli(tool.bin, !!tool.gui, tool.appBundles).catch(() => ({
              installed: false,
            })),
          ] as const
      ),
      ...runtimesForOS(os).map(
        async (rt) => [rt.id, await detectRuntime(rt).catch(() => ({ installed: false }))] as const
      ),
    ])
    setDetections(Object.fromEntries(entries))
    // Fire-and-forget: resolve the latest published version for every installed
    // npm-based CLI so the UI can show Upgrade only when one is actually behind.
    for (const [id, det] of entries) {
      const tool = CLI_TOOLS.find((c) => c.id === id)
      if (!tool?.npmPackage || !det.installed) continue
      latestVersion(tool.npmPackage)
        .then((v) => {
          if (v) setLatestVersion(id, v)
        })
        .catch(() => {})
      // Learn how it was installed so an upgrade matches it in place (an npm
      // upgrade of a native install would leave a second, shadowing copy).
      npmOwns(tool.npmPackage)
        .then((owned) => setCliManager(id, owned ? "npm" : "native"))
        .catch(() => {})
    }
    // For a winget/brew-managed runtime, learn whether that manager actually owns
    // the install. When it doesn't (Node from nodejs.org / nvm, etc.) the
    // Environment section swaps its Update/Reinstall buttons for a download link,
    // since winget/brew can't update a copy they didn't install.
    for (const [id, det] of entries) {
      const rt = RUNTIMES.find((r) => r.id === id)
      if (!rt || !det.installed) continue
      const pm = runtimePkgManager(rt, os)
      if (!pm) continue
      pkgManagerOwns(pm.manager, pm.id)
        .then((owned) => setRuntimeOwned(id, owned))
        .catch(() => {})
    }
  }, [setDetections, setLatestVersion, setCliManager, setRuntimeOwned])

  /**
   * "Rescan" as the user means it: re-read the machine, *all* of it.
   *
   * The overview's tools readout, its CLI inventory and its upgrade findings
   * come from `detections`, not from the disk scan — so a Rescan that ran only
   * `scanEnvironment` left a CLI installed in a terminal a minute ago invisible
   * until the next launch, under a heading that says "your real installed
   * state". The two run together, as they already do after every applied run.
   *
   * `rescanDashboard` stays on its own for the section refreshes (MCP), which
   * change config files and have no reason to re-probe thirteen binaries.
   */
  const rescanMachine = useCallback(async () => {
    await Promise.all([refreshDetections(), rescanDashboard()])
  }, [refreshDetections, rescanDashboard])

  useEffect(() => {
    if (!isTauri()) return
    getPaths()
      .then((p) => {
        setPaths(p)
        // Platform-specific dependencies (Windows Terminal today) must be
        // selected from the backend-reported OS, not the store's macOS fallback
        // before `getPaths` resolves. Zustand updates synchronously, so the
        // detection reads the real OS immediately after this write.
        void refreshDetections()
        // What this app has already done to the machine. Read once, here,
        // because the overview shows it before the user touches anything —
        // and because it costs one small JSON read, unlike the scans above.
        loadActivity(p.home)
          .then(setActivity)
          .catch(() => {})
      })
      // Path resolution is not required for ordinary PATH probes. Preserve the
      // old best-effort scan if it fails, using the store's fallback OS.
      .catch(() => void refreshDetections())
  }, [setPaths, setActivity, refreshDetections])

  // Hydrate persisted settings + app version once on startup, then (if enabled)
  // silently check for an app update — surfaced via the header/sidebar badge and
  // a desktop notification. Guarded so React StrictMode / re-renders don't re-check.
  const updateInitRef = useRef(false)
  useEffect(() => {
    if (!isTauri() || updateInitRef.current) return
    updateInitRef.current = true
    let cancelled = false
    void (async () => {
      const settings = await loadSettings()
      if (cancelled) return
      setSettings(settings)
      // "Build commands for" is a preference like any other: restored here, or
      // the page that says it is remembered forgets it on every launch.
      if (settings.osOverride && ["win", "mac", "linux"].includes(settings.osOverride)) {
        useAppStore.getState().setOsOverride(settings.osOverride)
      }
      // Land on the screen the user chose in Preferences. Checked against the
      // live key list, not trusted: a section removed in a later release would
      // otherwise leave the shell rendering nothing at all.
      if (
        settings.startupSection &&
        !navigatedRef.current &&
        SECTION_KEYS.includes(settings.startupSection)
      ) {
        goToSection(settings.startupSection)
      }
      // Restore the proxy the user applied last time: the plan isn't persisted,
      // so without this agentpack's own downloads would go direct until they
      // re-applied it.
      if (settings.proxy) {
        setProxy(settings.proxy)
        const eff = effectiveProxy(settings.proxy)
        void setProcessProxy({
          http: eff.http,
          https: eff.https,
          all: eff.all,
          noProxy: eff.noProxy,
        })
      }
      // Global shortcuts don't survive a restart — re-claim the accelerator the
      // user opted into. If another app took it meanwhile, drop it from settings
      // so About doesn't show a switch that's on but does nothing.
      if (settings.summonShortcut) {
        const ok = await registerSummonShortcut(settings.summonShortcut)
        if (!cancelled && !ok) {
          setSettings({ summonShortcut: null })
          void saveSettings({ summonShortcut: null })
        }
      }
      // Measure the network right after the proxy is restored, so the probe runs
      // through whatever route the user already configured.
      void probeNetworkNow()
      // Greet a first-time user; About can reopen the wizard later. Someone who
      // closed it mid-way still counts as first-time and resumes where they were.
      setRestoredProgress(settings.onboardingProgress)
      onboardingProgress.current = settings.onboardingProgress
      if (!settings.onboarded) setOnboardingOpen(true)
      const version = await getAppVersion()
      if (!cancelled && version) setAppVersion(version)
      if (!settings.autoCheckUpdates) return
      try {
        const info = await checkForUpdate()
        if (cancelled) return
        // The startup check is a check: About reads "Last checked" from here
        // too, and used to say "never" on a machine that checks every launch.
        const at = Date.now()
        setSettings({ lastCheckAt: at })
        void saveSettings({ lastCheckAt: at })
        if (!info) setUpdateState("upToDate")
        if (!info || info.version === settings.skippedVersion) return
        setUpdateInfo(info)
        setUpdateState("available")
        void notify(t.about.notifyTitle, t.about.notifyBody(info.version))
      } catch {
        // Silent on startup; the About section offers a manual retry.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [
    t,
    setSettings,
    setProxy,
    setAppVersion,
    setUpdateInfo,
    setUpdateState,
    setOnboardingOpen,
    probeNetworkNow,
    goToSection,
  ])

  // The chat-history startup scan is `useHistoryScans`' own effect: it runs once
  // at startup, not on opening History, because the dashboard's spend card reads
  // those summaries. `historyResult === null` is its loading signal.

  // Lazily scan installed skills the first time the user opens the Skills
  // section (same shape as the history effect above).
  useEffect(() => {
    if (!isTauri() || section !== "skills" || skillsResult !== null) return
    let cancelled = false
    skillsScan()
      .then((r) => {
        if (!cancelled) setSkillsResult(r)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setSkillsResult({ skills: [], errors: [] })
        setSkillsError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [section, skillsResult])

  // After any real run (install/upgrade/uninstall/remove), re-detect tools and
  // re-scan the dashboard once, centrally, so every surface reflects the change.
  // The skills scan refreshes too when it has already been loaded (a run may
  // have installed/removed/copied skills); read via a ref so the subscription
  // isn't torn down on every scan.
  const skillsLoadedRef = useRef(false)
  useEffect(() => {
    skillsLoadedRef.current = skillsResult !== null
  }, [skillsResult])
  useEffect(
    () =>
      onAfterRun(() => {
        void refreshDetections()
        void rescanDashboard()
        if (skillsLoadedRef.current) void loadSkills()
      }),
    [onAfterRun, refreshDetections, rescanDashboard, loadSkills]
  )

  // Between the click and the panel opening there can be a full detection pass,
  // a scan and an arch probe, with nothing on screen — and a second click in
  // that gap staged the plan twice. The flag drives the tray button's label; the
  // ref is the guard, since the callback is stable and can't read fresh state.
  const [preparing, setPreparing] = useState(false)
  const preparingRef = useRef(false)
  // Mirrors `running` for the stable callback below: a review asked for while
  // a run executes is refused at once, not after a detection pass and a scan
  // that end in the same refusal.
  const runningRef = useRef(running)
  useEffect(() => {
    runningRef.current = running
  }, [running])

  // Turn the current selection into a reviewable change set, built against a
  // FRESH scan of the on-disk state so already-installed items are skipped
  // instead of re-installed. Plan and paths are read via getState() at call
  // time, not captured in a closure, so a bundle applied moments earlier (from
  // the wizard) is already reflected. Otherwise already-installed items get
  // re-emitted — a duplicate `claude mcp add` errors, and a redundant CLI/Node
  // install can re-trigger a UAC prompt.
  const reviewChanges = useCallback(() => {
    const paths = useAppStore.getState().paths
    if (!paths) {
      void run([], { plan: useAppStore.getState().plan })
      return
    }
    if (preparingRef.current) return
    if (runningRef.current) {
      toast.message(t.shell.runBusy)
      setPanelOpen(true)
      return
    }
    preparingRef.current = true
    setPreparing(true)
    const ready = () => {
      preparingRef.current = false
      setPreparing(false)
    }
    void (async () => {
      if (Object.keys(useAppStore.getState().detections).length === 0) {
        await refreshDetections().catch(() => undefined)
      }
      const scan = await scanEnvironment(
        paths,
        useAppStore.getState().settings.providerBackend
      ).catch(() => null)
      // Keep the dashboard in sync with the state this run deduped against (but
      // don't clobber a good cached scan if this fresh one failed).
      if (scan) rememberScan(scan)
      // A scan that couldn't read its sources used to fall back to "nothing is
      // installed", which turns the dedup off entirely: every MCP add and skill
      // copy is re-emitted, and `claude mcp add` rejects a duplicate id, so a
      // transient read error produced a screenful of red. Prefer the last good
      // scan; with neither, refuse to run rather than guess — guessing wrong
      // here is the loud, confusing case.
      const effective = scan && !scan.degraded ? scan : lastGoodScan.current
      if (!effective) {
        ready()
        toast.error(t.shell.scanFailed)
        return
      }
      const { plan, detections, latestVersions, cliManagers, settings, appliedNpmRegistry } =
        useAppStore.getState()
      const arch = await hostArch()
        .catch(() => undefined)
        .finally(ready)
      const installedTools = new Set(
        Object.entries(detections)
          .filter(([, d]) => d.installed)
          .map(([id]) => id)
      )
      const installedState: InstalledState = {
        versions: Object.fromEntries(Object.entries(detections).map(([id, d]) => [id, d.version])),
        latest: latestVersions,
        managers: cliManagers,
        claudeMcps: [...effective.claudeMcps.known, ...effective.claudeMcps.custom],
        codexMcps: [...effective.codexMcps.known, ...effective.codexMcps.custom],
        opencodeMcps: [...effective.opencodeMcps.known, ...effective.opencodeMcps.custom],
        claudeSkills: [...effective.claudeSkills.known, ...effective.claudeSkills.custom],
        codexSkills: [...effective.codexSkills.known, ...effective.codexSkills.custom],
      }
      // A proxy or mirror that is already on the machine isn't written again:
      // it isn't something the user picked this time, and the review would list
      // four config writes they never asked for.
      const toRun = {
        ...plan,
        network: unappliedNetwork(plan.network, {
          proxy: settings.proxy,
          npmRegistry: appliedNpmRegistry,
        }),
      }
      const reports = await run(
        buildSteps(toRun, paths, t, installedTools, installedState, {
          arch,
          ghMirrorPrefix: settings.ghMirrorPrefix,
        }),
        {
          plan,
          activity: { title: t.tray.runTitle(countSelections(toRun)), source: "quick-config" },
        }
      )
      // Clear the selection only once it has actually landed. An error or a
      // skipped step means part of the plan is still outstanding, and wiping it
      // would leave the user to rebuild by hand exactly when they are least
      // inclined to. `resetPlan` keeps the network config and MCP keys either
      // way — those are the machine's setup, not this batch's selection.
      const settled = reports.length > 0
      const incomplete = reports.some((r) => r.status === "error" || r.status === "skipped")
      if (settled && !incomplete) {
        const store = useAppStore.getState()
        store.markNetworkApplied(toRun.network)
        // A proxy applied from here is as applied as one applied from the
        // Network page: persisted, and used for agentpack's own traffic.
        const proxy = toRun.network.proxy
        if (proxy && isProxyActive(proxy)) {
          store.setSettings({ proxy })
          void saveSettings({ proxy })
          const eff = effectiveProxy(proxy)
          void setProcessProxy({
            http: eff.http,
            https: eff.https,
            all: eff.all,
            noProxy: eff.noProxy,
          })
        }
        store.resetPlan()
      }
    })()
  }, [run, refreshDetections, rememberScan, setPanelOpen, t])

  // A wizard that was finished (Install or "Maybe later") starts over when it
  // is opened again from Settings. It reads its progress only as initial state,
  // so without a new key it reopened on its last screen — "Review and install" —
  // as if the first three questions had been answered this time.
  const wizardFinished = useRef(false)
  const [wizardRun, setWizardRun] = useState(0)
  useLayoutEffect(() => {
    if (!onboardingOpen || !wizardFinished.current) return
    wizardFinished.current = false
    setRestoredProgress(null)
    setWizardRun((n) => n + 1)
  }, [onboardingOpen])

  // First-run wizard: the newcomer said "not now" (or just installed), so record
  // that they've been greeted and stop resuming. About can reopen it on demand.
  const dismissOnboarding = useCallback(() => {
    wizardFinished.current = true
    setOnboardingOpen(false)
    onboardingProgress.current = null
    setSettings({ onboarded: true, onboardingProgress: null })
    void saveSettings({ onboarded: true, onboardingProgress: null })
  }, [setOnboardingOpen, setSettings])

  // First-run wizard closed incidentally — Esc, the overlay, or following the
  // tour link. That is not the user declining to be onboarded, so `onboarded`
  // stays false and we save their place instead: next launch picks up where they
  // left off rather than greeting them from step 1 (or, as before, never again).
  const suspendOnboarding = useCallback(() => {
    setOnboardingOpen(false)
    const progress = onboardingProgress.current
    if (!progress) return
    setSettings({ onboardingProgress: progress })
    void saveSettings({ onboardingProgress: progress })
  }, [setOnboardingOpen, setSettings])

  // Wizard "Install": finish onboarding, then run the chosen bundle. Keys and
  // skills are applied AFTER applyPreset, not before — applyPreset rebuilds the
  // plan from the bundle and would drop anything written ahead of it.
  const installFromOnboarding = useCallback(
    (presetId: string, surface: Surface, keys: Record<string, string>, skills: string[]) => {
      dismissOnboarding()
      applyPreset(presetId, surface)
      for (const [id, key] of Object.entries(keys)) setMcpKey(id, key)
      // Both directions: the bundle may have selected skills the user unticked.
      const targets = skillTargetsFor(useAppStore.getState().plan.clis)
      for (const s of SKILLS) setSkill(s.id, skills.includes(s.id) ? targets : [])
      reviewChanges()
    },
    [dismissOnboarding, applyPreset, setMcpKey, setSkill, reviewChanges]
  )

  // Wizard "Take a tour": suspend rather than dismiss — taking the tour is a
  // detour, not a decision to skip setup, so the wizard is still waiting after.
  const tourFromWizard = useRef(false)
  const startTourFromOnboarding = useCallback(() => {
    suspendOnboarding()
    tourFromWizard.current = true
    setTourActive(true)
  }, [suspendOnboarding, setTourActive])

  // The tour drives section navigation itself; when it ends, return home — and
  // to the wizard, if that is where it was started from. "Still waiting after"
  // was the promise; ending on the dashboard left the user to find the wizard
  // again in Settings.
  const endTour = useCallback(() => {
    setTourActive(false)
    navigate("overview", "dashboard")
    if (tourFromWizard.current) {
      tourFromWizard.current = false
      setOnboardingOpen(true)
    }
  }, [setTourActive, navigate, setOnboardingOpen])

  const renderSection = () => {
    switch (section) {
      case "dashboard":
        return (
          <DashboardSection
            scan={dashboardScan}
            scanning={dashboardScanning}
            rescan={rescanMachine}
            onNavigate={goToSection}
            history={{
              data: historyResult,
              progress: historyProgress,
              retry: () => void loadHistory(),
            }}
            onOpenUsage={() => {
              navigate("usage", "history")
              setHistoryTab("usage")
            }}
          />
        )
      case "history":
        return (
          <HistorySection
            initialTab={historyTab}
            result={historyResult}
            loading={historyLoading}
            progress={historyProgress}
            series={{
              data: seriesResult,
              loading: seriesLoading,
              request: () => void loadSeries(),
            }}
            refresh={() => void loadHistory()}
          />
        )
      case "my-account":
      case "my-balance":
      case "my-usage":
      case "my-models":
      case "my-security":
        return (
          <PersonalMoreTokenSection
            view={section}
            onOpenSecurity={() => goToSection("my-security")}
          />
        )
      case "management-overview":
      case "accounts":
      case "quota":
      case "analytics":
      case "audit":
        return (
          <MoreTokenSection
            view={section}
            localUsage={{
              data: seriesResult,
              loading: seriesLoading,
              request: () => void loadSeries(),
            }}
          />
        )
      case "presets":
        return <PresetsSection onReview={reviewChanges} />
      case "environment":
        return <EnvironmentSection refresh={refreshDetections} />
      case "clis":
        return <ClisSection onOpenRuntimes={() => goToSection("environment")} />
      case "skills":
        return (
          <SkillsSection
            scan={skillsResult}
            error={skillsError}
            landing={landing?.skills ?? null}
            loading={skillsLoading}
            refresh={() => void loadSkills()}
          />
        )
      case "mcp":
        return (
          <McpSection
            scan={dashboardScan}
            loading={dashboardScanning}
            refresh={rescanDashboard}
            landing={landing?.mcp ?? null}
          />
        )
      case "pi":
        return <PiSection controller={piController} onOpenClis={() => goToSection("clis")} />
      case "network":
        return <NetworkSection />
      case "cleanup":
        return <CleanupSection />
      case "ccswitch":
        return <CcSwitchSection />
      case "ccconnect":
        return <CcConnectSection />
      case "preferences":
        return <PreferencesSection />
      case "config":
        return (
          <ConfigIO
            scan={dashboardScan}
            onOpenMcp={() => goToSection("mcp")}
            onReview={reviewChanges}
          />
        )
      case "recovery":
        return <RecoverySection scan={dashboardScan} onNavigate={goWithIntent} />
      case "about":
        return <AboutSection />
    }
  }

  // `h-full` takes the height html/body were pinned to in `app/layout.tsx`,
  // rather than asking the webview what a viewport height is — `h-dvh` is what
  // let the macOS build disagree with its own window. It only works because
  // body now HAS a resolved height; without that, `height: 100%` degrades to
  // "as tall as my content" and the shell stops filling the window entirely.
  return (
    <div className="flex h-full overflow-hidden bg-background text-foreground">
      <WorkspaceRail active={workspace} onSelect={navigate} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          workspace={workspace}
          section={section}
          onNavigate={navigate}
          onOpenCommand={openCommand}
          onShowUpdates={() => goToSection("about")}
          run={backgroundRun}
          onShowRun={() => setPanelOpen(true)}
        />
        {hasTabs(workspace) ? (
          <WorkspaceTabs workspace={workspace} active={section} onSelect={setSection} />
        ) : null}
        <main
          ref={mainRef}
          id={`panel-${section}`}
          role={hasTabs(workspace) ? "tabpanel" : undefined}
          aria-labelledby={hasTabs(workspace) ? `tab-${section}` : undefined}
          tabIndex={-1}
          // `min-h-0` is load-bearing, not decoration. A flex item's
          // `min-height: auto` resolves to its content size unless the item is
          // a scroll container — and WebKit (which is what the macOS desktop
          // build runs on) does not always apply that exception in a nested
          // column. Without it this pane grows to fit a tall page instead of
          // scrolling it, and the *document* scrolls instead: the rail slides
          // away and the window looks broken. Every other scroll container in
          // this repo already carries it.
          className="min-h-0 flex-1 overflow-auto p-4 sm:p-6"
        >
          <div ref={contentRef} className="hm-enter">
            {renderSection()}
          </div>
        </main>
        {/* Docked to the workspace column rather than the window, so it never
            covers the rail — the tray is a summary of what you picked, not a
            modal you have to dismiss to navigate. */}
        <ChangeTray
          onReview={reviewChanges}
          preparing={preparing}
          running={running}
          onShowRun={() => setPanelOpen(true)}
        />
      </div>
      <ExecutionPanel scan={dashboardScan} onNavigate={goWithIntent} />
      <CommandPalette
        open={commandOpen}
        onOpenChange={setCommandOpen}
        running={running}
        handlers={{
          navigate: (a) => navigate(a.workspace, a.section),
          quickConfig: () => navigate("install", "presets"),
          rescan: () => void rescanMachine(),
          review: reviewChanges,
          showRun: () => setPanelOpen(true),
          onboarding: () => setOnboardingOpen(true),
          updates: () => goToSection("about"),
        }}
      />
      {/* Keyed so that saved progress arriving after mount re-seeds the wizard,
          which reads `progress` only as its initial state. It can flip at most
          once, during startup, before the user has touched anything. */}
      <OnboardingDialog
        key={`${restoredProgress ? "resumed" : "fresh"}-${wizardRun}`}
        open={onboardingOpen}
        progress={restoredProgress}
        onProgress={(p) => {
          onboardingProgress.current = p
        }}
        onInstall={installFromOnboarding}
        onLater={dismissOnboarding}
        onSuspend={suspendOnboarding}
        onTour={startTourFromOnboarding}
      />
      {tourActive ? <GuidedTour onNavigate={goToSection} onClose={endTour} /> : null}
    </div>
  )
}

export function AppShell() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false },
          mutations: { retry: false },
        },
      })
  )
  return (
    <QueryClientProvider client={queryClient}>
      <RunnerProvider>
        <ShellBody />
      </RunnerProvider>
    </QueryClientProvider>
  )
}
