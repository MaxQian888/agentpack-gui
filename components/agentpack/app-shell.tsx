"use client"

import { useEffect, useState } from "react"
import { isTauri } from "@/lib/tauri"
import { getPaths } from "@/lib/tauri/commands"
import { buildSteps } from "@/lib/agentpack/plan"
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
  const { run } = useRunnerCtx()
  const [section, setSection] = useState<SectionKey>("presets")

  useEffect(() => {
    if (isTauri())
      getPaths()
        .then(setPaths)
        .catch(() => {})
  }, [setPaths])

  const onRun = () => {
    if (!paths) {
      void run([], plan)
      return
    }
    void run(buildSteps(plan, paths, t), plan)
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
