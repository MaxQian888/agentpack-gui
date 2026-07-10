"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { ListResult } from "@/lib/history/types"
import { isTauri } from "@/lib/tauri"
import {
  detectCli,
  detectRuntime,
  getPaths,
  historyListSessions,
  latestVersion,
  npmOwns,
  pkgManagerOwns,
} from "@/lib/tauri/commands"
import { checkForUpdate, getAppVersion } from "@/lib/tauri/updater"
import { loadSettings, saveSettings } from "@/lib/tauri/settings"
import { notify } from "@/lib/tauri/system"
import { buildSteps, type InstalledState } from "@/lib/agentpack/plan"
import { CLI_TOOLS, RUNTIMES, runtimePkgManager } from "@/lib/agentpack/registry"
import { useAppStore } from "@/store/app-store"
import { useT } from "@/lib/i18n/provider"
import { Header } from "./header"
import { SidebarNav, type SectionKey } from "./sidebar-nav"
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
import { QuickInstallDialog } from "./quick-install-dialog"
import { GuidedTour } from "./guided-tour"
import { RunnerProvider, useRunnerCtx } from "./run/runner-context"
import { ExecutionPanel } from "./run/execution-panel"

function ShellBody() {
  const t = useT()
  const paths = useAppStore((s) => s.paths)
  const setPaths = useAppStore((s) => s.setPaths)
  const setDetections = useAppStore((s) => s.setDetections)
  const setLatestVersion = useAppStore((s) => s.setLatestVersion)
  const setCliManager = useAppStore((s) => s.setCliManager)
  const setRuntimeOwned = useAppStore((s) => s.setRuntimeOwned)
  const setAppVersion = useAppStore((s) => s.setAppVersion)
  const setUpdateState = useAppStore((s) => s.setUpdateState)
  const setUpdateInfo = useAppStore((s) => s.setUpdateInfo)
  const setSettings = useAppStore((s) => s.setSettings)
  const applyPreset = useAppStore((s) => s.applyPreset)
  const onboardingOpen = useAppStore((s) => s.onboardingOpen)
  const setOnboardingOpen = useAppStore((s) => s.setOnboardingOpen)
  const tourActive = useAppStore((s) => s.tourActive)
  const setTourActive = useAppStore((s) => s.setTourActive)
  const { run, onAfterRun } = useRunnerCtx()
  const [section, setSection] = useState<SectionKey>("dashboard")
  // One-page quick-install (customize) dialog, opened from the header Run ▾ menu.
  const [customizeOpen, setCustomizeOpen] = useState(false)

  // Dashboard scan lives here (ShellBody never unmounts) so it runs once on
  // startup instead of re-scanning every time the user returns to the home page.
  const [dashboardScan, setDashboardScan] = useState<DashboardScan | null>(null)
  const [dashboardScanning, setDashboardScanning] = useState(false)

  // Chat-history scan is lazy (it reads every JSONL + the OpenCode DB, too slow
  // to run on startup) and cached here so returning to History reuses it.
  const [historyResult, setHistoryResult] = useState<ListResult | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)

  const loadHistory = useCallback(async () => {
    if (!isTauri()) return
    // No blanket transcript-cache clear on Rescan: transcript keys fold in each
    // session's `updatedAt`, so a session that grew on disk misses its stale
    // entry and refetches, while unchanged sessions stay warm.
    setHistoryLoading(true)
    try {
      setHistoryResult(await historyListSessions())
    } catch {
      setHistoryResult({ sessions: [], errors: [] })
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  const rescanDashboard = useCallback(async () => {
    if (!isTauri() || !paths) return
    setDashboardScanning(true)
    try {
      setDashboardScan(await scanEnvironment(paths))
    } finally {
      setDashboardScanning(false)
    }
  }, [paths])

  // Initial scan once paths are known. Fire-and-forget so the UI renders
  // immediately; the (now async) Rust commands run off the main thread, and
  // setState lives in the async continuation to avoid cascading renders.
  useEffect(() => {
    if (!isTauri() || !paths) return
    let cancelled = false
    scanEnvironment(paths)
      .then((result) => {
        if (!cancelled) setDashboardScan(result)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [paths])

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
            await detectCli(tool.bin, !!tool.gui).catch(() => ({ installed: false })),
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
      .then(setPaths)
      .catch(() => {})
    void refreshDetections()
  }, [setPaths, refreshDetections])

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
      // Greet a first-time user once; About can reopen the wizard later.
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
  }, [t, setSettings, setAppVersion, setUpdateInfo, setUpdateState, setOnboardingOpen])

  // Lazily scan chat history the first time the user opens that section. Set
  // state only in the async continuation (like the dashboard scan above) so no
  // setState runs synchronously inside the effect. `loadHistory` (with its
  // loading flag) still backs the manual Rescan button.
  useEffect(() => {
    if (!isTauri() || section !== "history" || historyResult !== null) return
    let cancelled = false
    historyListSessions()
      .then((r) => {
        if (!cancelled) setHistoryResult(r)
      })
      .catch(() => {
        if (!cancelled) setHistoryResult({ sessions: [], errors: [] })
      })
    return () => {
      cancelled = true
    }
  }, [section, historyResult])

  // After any real run (install/upgrade/uninstall/remove), re-detect tools and
  // re-scan the dashboard once, centrally, so every surface reflects the change.
  useEffect(
    () =>
      onAfterRun(() => {
        void refreshDetections()
        void rescanDashboard()
      }),
    [onAfterRun, refreshDetections, rescanDashboard]
  )

  // One-click install: build the plan against a FRESH scan of the current
  // on-disk state, so already-installed items are skipped instead of re-installed
  // — the whole point of the header Run button (and the welcome wizard's Install)
  // being "correct". Plan and paths are read via getState() at call time, not
  // captured in a closure, so a preset applied moments earlier (from the wizard)
  // is already reflected. Otherwise already-installed items get re-installed — a
  // duplicate `claude mcp add` errors, and a redundant CLI/Node install can
  // re-trigger a UAC prompt.
  const runOneClick = useCallback(() => {
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
      if (scan) setDashboardScan(scan)
      const { plan, detections, latestVersions, cliManagers } = useAppStore.getState()
      const installedTools = new Set(
        Object.entries(detections)
          .filter(([, d]) => d.installed)
          .map(([id]) => id)
      )
      const installedState: InstalledState = {
        versions: Object.fromEntries(Object.entries(detections).map(([id, d]) => [id, d.version])),
        latest: latestVersions,
        managers: cliManagers,
        claudeMcps: scan ? [...scan.claudeMcps.known, ...scan.claudeMcps.custom] : [],
        codexMcps: scan ? [...scan.codexMcps.known, ...scan.codexMcps.custom] : [],
        claudeSkills: scan ? [...scan.claudeSkills.known, ...scan.claudeSkills.custom] : [],
        codexSkills: scan ? [...scan.codexSkills.known, ...scan.codexSkills.custom] : [],
      }
      void run(buildSteps(plan, paths, t, installedTools, installedState), { plan, review: true })
    })()
  }, [run, refreshDetections, t])

  // First-run wizard: persist that the newcomer has been greeted (so it doesn't
  // reappear next launch — About can reopen it on demand), then close it.
  const closeOnboarding = useCallback(() => {
    setOnboardingOpen(false)
    setSettings({ onboarded: true })
    void saveSettings({ onboarded: true })
  }, [setOnboardingOpen, setSettings])

  // Apply a bundle and run the same one-click install as the header Run button.
  // applyPreset writes the store synchronously, so runOneClick (which reads the
  // plan via getState) picks up the new bundle. Shared by the wizard Install, the
  // header Run ▾ quick-install menu, and — implicitly — the customize dialog.
  const runPreset = useCallback(
    (presetId: string) => {
      applyPreset(presetId)
      runOneClick()
    },
    [applyPreset, runOneClick]
  )

  // Wizard "Install": dismiss the wizard, then run the chosen bundle.
  const installFromOnboarding = useCallback(
    (presetId: string) => {
      closeOnboarding()
      runPreset(presetId)
    },
    [closeOnboarding, runPreset]
  )

  // Customize dialog "Install now": close it, then run the plan the user tuned
  // in place (no preset applied — the dialog wrote straight to the plan).
  const installFromCustomize = useCallback(() => {
    setCustomizeOpen(false)
    runOneClick()
  }, [runOneClick])

  // Wizard "Take a tour": dismiss the wizard (marks onboarded) and start the tour.
  const startTourFromOnboarding = useCallback(() => {
    closeOnboarding()
    setTourActive(true)
  }, [closeOnboarding, setTourActive])

  // The tour drives section navigation itself; when it ends, return home.
  const endTour = useCallback(() => {
    setTourActive(false)
    setSection("dashboard")
  }, [setTourActive])

  const renderSection = () => {
    switch (section) {
      case "dashboard":
        return (
          <DashboardSection
            scan={dashboardScan}
            scanning={dashboardScanning}
            rescan={rescanDashboard}
          />
        )
      case "history":
        return (
          <HistorySection
            result={historyResult}
            loading={historyLoading}
            refresh={() => void loadHistory()}
          />
        )
      case "presets":
        return <PresetsSection onCustomize={() => setCustomizeOpen(true)} />
      case "environment":
        return <EnvironmentSection refresh={refreshDetections} />
      case "clis":
        return <ClisSection />
      case "skills":
        return <SkillsSection />
      case "mcp":
        return <McpSection />
      case "network":
        return <NetworkSection />
      case "ccswitch":
        return <CcSwitchSection />
      case "ccconnect":
        return <CcConnectSection />
      case "config":
        return <ConfigIO />
      case "about":
        return <AboutSection />
    }
  }

  return (
    <div className="flex h-screen bg-background text-foreground">
      <SidebarNav active={section} onSelect={setSection} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          onRun={runOneClick}
          onQuickInstall={runPreset}
          onCustomize={() => setCustomizeOpen(true)}
          onShowUpdates={() => setSection("about")}
        />
        <main className="flex-1 overflow-auto p-6">{renderSection()}</main>
      </div>
      <ExecutionPanel />
      <OnboardingDialog
        open={onboardingOpen}
        onInstall={installFromOnboarding}
        onDismiss={closeOnboarding}
        onTour={startTourFromOnboarding}
      />
      <QuickInstallDialog
        open={customizeOpen}
        onInstall={installFromCustomize}
        onClose={() => setCustomizeOpen(false)}
      />
      {tourActive ? <GuidedTour onNavigate={setSection} onClose={endTour} /> : null}
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
