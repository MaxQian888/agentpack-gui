"use client"

import { useEffect, useState } from "react"
import { isTauri } from "@/lib/tauri"
import { detectCli, getPaths, latestVersion } from "@/lib/tauri/commands"
import { buildSteps } from "@/lib/agentpack/plan"
import { CLI_TOOLS } from "@/lib/agentpack/registry"
import { useAppStore } from "@/store/app-store"
import { useT } from "@/lib/i18n/provider"
import { Header } from "./header"
import { SidebarNav, type SectionKey } from "./sidebar-nav"
import { PresetsSection } from "./sections/presets"
import { ClisSection } from "./sections/clis"
import { SkillsSection } from "./sections/skills"
import { McpSection } from "./sections/mcp"
import { NetworkSection } from "./sections/network"
import { CcSwitchSection } from "./sections/ccswitch"
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
  const { run } = useRunnerCtx()
  const [section, setSection] = useState<SectionKey>("presets")

  useEffect(() => {
    if (!isTauri()) return
    getPaths()
      .then(setPaths)
      .catch(() => {})
    Promise.all(
      CLI_TOOLS.map(async (tool) => [tool.id, await detectCli(tool.bin, !!tool.gui)] as const)
    )
      .then((entries) => {
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
      })
      .catch(() => {})
  }, [setPaths, setDetections, setLatestVersion])

  const onRun = () => {
    if (!paths) {
      void run([], { plan })
      return
    }
    void run(buildSteps(plan, paths, t, installedClis()), { plan, review: true })
  }

  const renderSection = () => {
    switch (section) {
      case "presets":
        return <PresetsSection />
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
    }
  }

  return (
    <div className="flex h-screen bg-background text-foreground">
      <SidebarNav active={section} onSelect={setSection} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header onRun={onRun} />
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
