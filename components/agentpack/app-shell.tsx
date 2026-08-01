"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import type { ListResult, ScanProgress, UsageSeriesResult } from "@/lib/history/types"
import type { SkillsScanResult } from "@/lib/skills/types"
import { isTauri } from "@/lib/tauri"
import {
  detectCli,
  detectRuntime,
  getPaths,
  historyListSessions,
  historyUsageSeries,
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
import { buildSteps, type InstalledState } from "@/lib/agentpack/plan"
import { effectiveProxy } from "@/lib/agentpack/network/proxy"
import { scanNetwork } from "@/lib/agentpack/network/scan"
import { hostArch } from "@/lib/tauri/system"
import { CLI_TOOLS, RUNTIMES, runtimePkgManager, SKILLS } from "@/lib/agentpack/registry"
import { skillTargetsFor, type Surface } from "@/lib/agentpack/presets"
import {
  hasTabs,
  workspaceOf,
  type SectionKey,
  type WorkspaceKey,
} from "@/lib/agentpack/workspaces"
import { useAppStore } from "@/store/app-store"
import { useT } from "@/lib/i18n/provider"
import { Header } from "./header"
import { WorkspaceRail } from "./sidebar-nav"
import { WorkspaceTabs } from "./workspace-tabs"
import { ChangeTray } from "./change-tray"
import { CommandPalette, useCommandShortcut } from "./command-palette"
import { DashboardSection, scanEnvironment, type DashboardScan } from "./sections/dashboard"
import { HistorySection } from "./sections/history"
import { PresetsSection } from "./sections/presets"
import { EnvironmentSection } from "./sections/environment"
import { ClisSection } from "./sections/clis"
import { SkillsSection } from "./sections/skills"
import { McpSection } from "./sections/mcp"
import { NetworkSection } from "./sections/network"
import { CcSwitchSection } from "./sections/ccswitch"
import { CcConnectSection } from "./sections/ccconnect"
import { AboutSection } from "./sections/about"
import { ConfigIO } from "./config-io"
import { OnboardingDialog } from "./onboarding-dialog"
import { GuidedTour } from "./guided-tour"
import { RunnerProvider, useRunnerCtx } from "./run/runner-context"
import { ExecutionPanel } from "./run/execution-panel"

function ShellBody() {
  const t = useT()
  const paths = useAppStore((s) => s.paths)
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
  const { run, onAfterRun, pendingCount } = useRunnerCtx()
  // Where we are: a task domain, and which of its destinations is showing. Both
  // are held here because the header names them, the rail highlights one and the
  // tab strip the other — a single `section` would leave the rail guessing.
  const [workspace, setWorkspace] = useState<WorkspaceKey>("overview")
  const [section, setSection] = useState<SectionKey>("dashboard")
  const [commandOpen, setCommandOpen] = useState(false)

  const navigate = useCallback((next: WorkspaceKey, to: SectionKey) => {
    setWorkspace(next)
    setSection(to)
  }, [])

  /** Navigate by destination — for the tour, the dashboard's links and the palette. */
  const goToSection = useCallback((to: SectionKey) => navigate(workspaceOf(to), to), [navigate])

  const openCommand = useCallback(() => setCommandOpen(true), [])
  useCommandShortcut(openCommand)

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

  // Chat-history scan is lazy (it reads every JSONL + the OpenCode DB, too slow
  // to run on startup) and cached here so returning to History reuses it.
  const [historyResult, setHistoryResult] = useState<ListResult | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  // Rebuilding the caches means re-parsing gigabytes of JSONL, so the scan
  // streams how far it has got rather than leaving a bare spinner up.
  const [historyProgress, setHistoryProgress] = useState<ScanProgress | null>(null)

  // The per-message usage series is one to two orders of magnitude larger than
  // the summaries, so it loads only when the usage dashboard actually asks.
  const [seriesResult, setSeriesResult] = useState<UsageSeriesResult | null>(null)
  const [seriesLoading, setSeriesLoading] = useState(false)

  // Installed-skills scan (reads every SKILL.md across the four global roots):
  // lazy on first Skills visit, cached here, invalidated after every real run.
  const [skillsResult, setSkillsResult] = useState<SkillsScanResult | null>(null)
  const [skillsLoading, setSkillsLoading] = useState(false)

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
    } catch {
      setSkillsResult({ skills: [], errors: [] })
    } finally {
      setSkillsLoading(false)
    }
  }, [])

  const loadHistory = useCallback(async () => {
    if (!isTauri()) return
    // No blanket transcript-cache clear on Rescan: transcript keys fold in each
    // session's `updatedAt`, so a session that grew on disk misses its stale
    // entry and refetches, while unchanged sessions stay warm.
    setHistoryLoading(true)
    // Drop the series too: it was built from the same files, so keeping it
    // would leave the dashboard showing pre-rescan numbers.
    setSeriesResult(null)
    try {
      setHistoryResult(await historyListSessions(setHistoryProgress))
    } catch {
      setHistoryResult({ sessions: [], errors: [] })
    } finally {
      setHistoryLoading(false)
      setHistoryProgress(null)
    }
  }, [])

  const loadSeries = useCallback(async () => {
    if (!isTauri()) return
    setSeriesLoading(true)
    try {
      setSeriesResult(await historyUsageSeries(setHistoryProgress))
    } catch {
      setSeriesResult({ sessions: [], errors: [] })
    } finally {
      setSeriesLoading(false)
      setHistoryProgress(null)
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
      rememberScan(await scanEnvironment(paths))
    } finally {
      setDashboardScanning(false)
    }
  }, [paths, rememberScan])

  // Initial scan once paths are known. Fire-and-forget so the UI renders
  // immediately; the (now async) Rust commands run off the main thread, and
  // setState lives in the async continuation to avoid cascading renders.
  useEffect(() => {
    if (!isTauri() || !paths) return
    let cancelled = false
    scanEnvironment(paths)
      .then((result) => {
        if (!cancelled) rememberScan(result)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [paths, rememberScan])

  // Detect every CLI + runtime and refresh latest-version info. Reused both on
  // startup and after every real run, so install/upgrade/uninstall are reflected
  // in the badges without an app restart.
  const refreshDetections = useCallback(async () => {
    if (!isTauri()) return
    // Each probe is isolated: a single failing detection must not reject the
    // whole batch and blank every badge / install button in the UI — it just
    // marks that one tool "not installed" so the rest still render their actions.
    const entries = await Promise.all([
      ...CLI_TOOLS.map(
        async (tool) =>
          [
            tool.id,
            await detectCli(tool.bin, !!tool.gui, tool.appBundle).catch(() => ({
              installed: false,
            })),
          ] as const
      ),
      ...RUNTIMES.map(
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
    const os = useAppStore.getState().effectiveOS()
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

  useEffect(() => {
    if (!isTauri()) return
    getPaths()
      .then((p) => {
        setPaths(p)
        // What this app has already done to the machine. Read once, here,
        // because the overview shows it before the user touches anything —
        // and because it costs one small JSON read, unlike the scans above.
        loadActivity(p.home)
          .then(setActivity)
          .catch(() => {})
      })
      .catch(() => {})
    void refreshDetections()
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
        if (cancelled || !info || info.version === settings.skippedVersion) return
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
  ])

  // Scan chat history once at startup — no longer gated on opening the History
  // section, because the dashboard's spend card is now the first thing rendered
  // and it reads these summaries. Cold that costs ~17s (every JSONL plus the
  // OpenCode DB), so progress streams and the card holds a skeleton until it
  // lands; warm it returns from cache in ~200ms. `historyResult === null` IS the
  // loading signal — set state only in the async continuation (like the
  // dashboard scan above) so no setState runs synchronously inside the effect.
  // `loadHistory` (with its loading flag) still backs the manual Rescan button.
  useEffect(() => {
    if (!isTauri() || historyResult !== null) return
    let cancelled = false
    historyListSessions(setHistoryProgress)
      .then((r) => {
        if (!cancelled) setHistoryResult(r)
      })
      .catch(() => {
        if (!cancelled) setHistoryResult({ sessions: [], errors: [] })
      })
      .finally(() => {
        if (!cancelled) setHistoryProgress(null)
      })
    return () => {
      cancelled = true
    }
  }, [historyResult])

  // Lazily scan installed skills the first time the user opens the Skills
  // section (same shape as the history effect above).
  useEffect(() => {
    if (!isTauri() || section !== "skills" || skillsResult !== null) return
    let cancelled = false
    skillsScan()
      .then((r) => {
        if (!cancelled) setSkillsResult(r)
      })
      .catch(() => {
        if (!cancelled) setSkillsResult({ skills: [], errors: [] })
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
    void (async () => {
      if (Object.keys(useAppStore.getState().detections).length === 0) {
        await refreshDetections()
      }
      const scan = await scanEnvironment(paths).catch(() => null)
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
        toast.error(t.shell.scanFailed)
        return
      }
      const { plan, detections, latestVersions, cliManagers, settings } = useAppStore.getState()
      const arch = await hostArch()
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
      const reports = await run(
        buildSteps(plan, paths, t, installedTools, installedState, {
          arch,
          ghMirrorPrefix: settings.ghMirrorPrefix,
        }),
        { plan, activity: { title: t.tray.review, source: "quick-config" } }
      )
      // Clear the selection only once it has actually landed. An error or a
      // skipped step means part of the plan is still outstanding, and wiping it
      // would leave the user to rebuild by hand exactly when they are least
      // inclined to. `resetPlan` keeps the network config and MCP keys either
      // way — those are the machine's setup, not this batch's selection.
      const settled = reports.length > 0
      const incomplete = reports.some((r) => r.status === "error" || r.status === "skipped")
      if (settled && !incomplete) useAppStore.getState().resetPlan()
    })()
  }, [run, refreshDetections, rememberScan, t])

  // First-run wizard: the newcomer said "not now" (or just installed), so record
  // that they've been greeted and stop resuming. About can reopen it on demand.
  const dismissOnboarding = useCallback(() => {
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
  const startTourFromOnboarding = useCallback(() => {
    suspendOnboarding()
    setTourActive(true)
  }, [suspendOnboarding, setTourActive])

  // The tour drives section navigation itself; when it ends, return home.
  const endTour = useCallback(() => {
    setTourActive(false)
    navigate("overview", "dashboard")
  }, [setTourActive, navigate])

  const renderSection = () => {
    switch (section) {
      case "dashboard":
        return (
          <DashboardSection
            scan={dashboardScan}
            scanning={dashboardScanning}
            rescan={rescanDashboard}
            onNavigate={goToSection}
            history={{ data: historyResult, progress: historyProgress }}
          />
        )
      case "history":
        return (
          <HistorySection
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
      case "presets":
        return <PresetsSection />
      case "environment":
        return <EnvironmentSection refresh={refreshDetections} />
      case "clis":
        return <ClisSection />
      case "skills":
        return (
          <SkillsSection
            scan={skillsResult}
            loading={skillsLoading}
            refresh={() => void loadSkills()}
          />
        )
      case "mcp":
        return (
          <McpSection scan={dashboardScan} loading={dashboardScanning} refresh={rescanDashboard} />
        )
      case "network":
        return <NetworkSection />
      case "ccswitch":
        return <CcSwitchSection />
      case "ccconnect":
        return <CcConnectSection />
      case "config":
        return <ConfigIO onOpenMcp={() => goToSection("mcp")} />
      case "about":
        return <AboutSection />
    }
  }

  return (
    <div className="flex h-dvh bg-background text-foreground">
      <WorkspaceRail active={workspace} onSelect={navigate} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          workspace={workspace}
          section={section}
          onNavigate={navigate}
          onOpenCommand={openCommand}
          onShowUpdates={() => goToSection("about")}
        />
        {hasTabs(workspace) ? (
          <WorkspaceTabs workspace={workspace} active={section} onSelect={setSection} />
        ) : null}
        <main
          id={`panel-${section}`}
          role={hasTabs(workspace) ? "tabpanel" : undefined}
          aria-labelledby={hasTabs(workspace) ? `tab-${section}` : undefined}
          tabIndex={-1}
          className="flex-1 overflow-auto p-4 sm:p-6"
        >
          {renderSection()}
        </main>
        {/* Docked to the workspace column rather than the window, so it never
            covers the rail — the tray is a summary of what you picked, not a
            modal you have to dismiss to navigate. */}
        <ChangeTray onReview={reviewChanges} />
      </div>
      <ExecutionPanel />
      <CommandPalette
        open={commandOpen}
        onOpenChange={setCommandOpen}
        pendingChanges={pendingCount}
        handlers={{
          navigate: (a) => navigate(a.workspace, a.section),
          quickConfig: () => navigate("install", "presets"),
          rescan: () => void rescanDashboard(),
          review: () => setPanelOpen(true),
          onboarding: () => setOnboardingOpen(true),
          updates: () => goToSection("about"),
        }}
      />
      {/* Keyed so that saved progress arriving after mount re-seeds the wizard,
          which reads `progress` only as its initial state. It can flip at most
          once, during startup, before the user has touched anything. */}
      <OnboardingDialog
        key={restoredProgress ? "resumed" : "fresh"}
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
  return (
    <RunnerProvider>
      <ShellBody />
    </RunnerProvider>
  )
}
