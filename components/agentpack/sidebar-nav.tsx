"use client"

import {
  ArrowLeftRight,
  Boxes,
  FileJson,
  Globe,
  LayoutDashboard,
  Package,
  Server,
  Terminal,
  Wrench,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/provider"
import type { Messages } from "@/lib/i18n/types"

export type SectionKey =
  | "dashboard"
  | "presets"
  | "environment"
  | "clis"
  | "skills"
  | "mcp"
  | "network"
  | "ccswitch"
  | "config"

interface SectionDef {
  key: SectionKey
  icon: typeof Package
  label: (m: Messages) => string
}

export const SECTIONS: SectionDef[] = [
  { key: "dashboard", icon: LayoutDashboard, label: (m) => m.menu.dashboard },
  { key: "presets", icon: Package, label: (m) => m.menu.presets },
  { key: "environment", icon: Boxes, label: (m) => m.menu.environment },
  { key: "clis", icon: Terminal, label: (m) => m.menu.clis },
  { key: "skills", icon: Wrench, label: (m) => m.menu.skills },
  { key: "mcp", icon: Server, label: (m) => m.menu.mcp },
  { key: "network", icon: Globe, label: (m) => m.menu.network },
  { key: "ccswitch", icon: ArrowLeftRight, label: (m) => m.menu.ccswitch },
  { key: "config", icon: FileJson, label: (m) => m.menu.saveConfig },
]

export function SidebarNav({
  active,
  onSelect,
}: {
  active: SectionKey
  onSelect: (key: SectionKey) => void
}) {
  const t = useT()
  return (
    <nav className="flex w-60 shrink-0 flex-col gap-1 border-r bg-sidebar p-3">
      <div className="px-2 pb-3 pt-1">
        <div className="text-lg font-semibold tracking-tight">{t.brand}</div>
        <p className="text-xs text-muted-foreground">{t.header.tagline}</p>
      </div>
      {SECTIONS.map((s) => {
        const Icon = s.icon
        return (
          <button
            key={s.key}
            type="button"
            onClick={() => onSelect(s.key)}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors",
              active === s.key
                ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50"
            )}
          >
            <Icon className="size-4 shrink-0" />
            <span className="truncate">{s.label(t)}</span>
          </button>
        )
      })}
    </nav>
  )
}
