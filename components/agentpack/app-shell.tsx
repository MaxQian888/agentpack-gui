"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { isTauri } from "@/lib/tauri"
import { detectCli, detectRuntime, getPaths, latestVersion } from "@/lib/tauri/commands"
import { checkForUpdate, getAppVersion } from "@/lib/tauri/updater"
import { loadSettings } from "@/lib/tauri/settings"
import { notify } from "@/lib/tauri/system"
import { buildSteps } from "@/lib/agentpack/plan"
import { CLI_TOOLS, RUNTIMES } from "@/lib/agentpack/registry"
import { useAppStore } from "@/store/app-store"
import { useT } from "@/lib/i18n/provider"
import { Header } from "./header"
import { SidebarNav, type SectionKey } from "./sidebar-nav"
import { DashboardSection, scanEnvironment, type DashboardScan } from "./sections/dashboard"
import { PresetsSection } from "./sections/presets"
import { EnvironmentSection } from "./sections/environment"
import { ClisSection } from "./sections/clis"
import { SkillsSection } from "./sections/skills"
import { McpSection } from "./sections/mcp"
import { NetworkSection } from "./sections/network"
import { CcSwitchSection } from "./sections/ccswitch"
import { AboutSection } from "./sections/about"
import { ConfigIO } from "./config-io"
import { RunnerProvider, useRunnerCtx } from "./run/runner-context"
import { ExecutionPanel } from "./run/execution-panel"

function ShellBody() {
  const t = useT()
  const plan = useAppStore((s) => s.plan)
  const paths = useAppStore((s) => s.paths)
  const setPaths = useAppStore((s) => s.setPaths)
  const setDetections = useAppStore((s) => s.setDetections)
  const setLatestVersion = useAppStore((s) => s.setLatestVersion)
  const installedClis = useAppStore((s) => s.installedClis)
  const setAppVersion = useAppStore((s) => s.setAppVersion)
  const setUpdateState = useAppStore((s) => s.setUpdateState)
  const setUpdateInfo = useAppStore((s) => s.setUpdateInfo)
  const setSettings = useAppStore((s) => s.setSettings)
  const { run, onAfterRun } = useRunnerCtx()
  const [section, setSection] = useState<SectionKey>("dashboard")

  // Dashboard scan lives here (ShellBody never unmounts) so it runs once on
  // startup instead of re-scanning every time the user returns to the home page.
  const [dashboardScan, setDashboardScan] = useState<DashboardScan | null>(null)
  const [dashboardScanning, setDashboardScanning] = useState(false)

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
    const entries = await Promise.all([
      ...CLI_TOOLS.map(async (tool) => [tool.id, await detectCli(tool.bin, !!tool.gui)] as const),
      ...RUNTIMES.map(async (rt) => [rt.id, await detectRuntime(rt)] as const),
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
    }
  }, [setDetections, setLatestVersion])

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
  }, [t, setSettings, setAppVersion, setUpdateInfo, setUpdateState])

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

  const onRun = () => {
    if (!paths) {
      void run([], { plan })
      return
    }
    void run(buildSteps(plan, paths, t, installedClis()), { plan, review: true })
  }

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
      case "presets":
        return <PresetsSection />
      case "environment":
        return <EnvironmentSection />
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
        <Header onRun={onRun} onShowUpdates={() => setSection("about")} />
        <main className="flex-1 overflow-auto p-6">{renderSection()}</main>
      </div>
      <ExecutionPanel />
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
