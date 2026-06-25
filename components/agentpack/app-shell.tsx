"use client"

import { useEffect, useState } from "react"
import { isTauri } from "@/lib/tauri"
import { getPaths } from "@/lib/tauri/commands"
import { useAppStore } from "@/store/app-store"
import { useT } from "@/lib/i18n/provider"
import { Header } from "./header"
import { SidebarNav, type SectionKey } from "./sidebar-nav"
import { PresetsSection } from "./sections/presets"
import { ClisSection } from "./sections/clis"
import { SkillsSection } from "./sections/skills"
import { McpSection } from "./sections/mcp"
import { NetworkSection } from "./sections/network"

function Placeholder({ title }: { title: string }) {
  return (
    <div className="rounded-lg border border-dashed p-8 text-sm text-muted-foreground">{title}</div>
  )
}

export function AppShell() {
  const t = useT()
  const setPaths = useAppStore((s) => s.setPaths)
  const setPanelOpen = useAppStore((s) => s.setPanelOpen)
  const [section, setSection] = useState<SectionKey>("presets")

  useEffect(() => {
    if (isTauri())
      getPaths()
        .then(setPaths)
        .catch(() => {})
  }, [setPaths])

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
        return <Placeholder title={t.menu.ccswitch} />
      case "config":
        return <Placeholder title={t.menu.saveConfig} />
    }
  }

  return (
    <div className="flex h-screen bg-background text-foreground">
      <SidebarNav active={section} onSelect={setSection} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header onRun={() => setPanelOpen(true)} />
        <main className="flex-1 overflow-auto p-6">{renderSection()}</main>
      </div>
    </div>
  )
}
