"use client"

import {
  ArrowLeftRight,
  Boxes,
  Cable,
  ChartNoAxesColumn,
  Eraser,
  FileJson,
  Globe,
  Info,
  LayoutDashboard,
  type LucideIcon,
  Menu,
  MessagesSquare,
  Package,
  Server,
  Settings,
  SlidersHorizontal,
  Terminal,
  Wrench,
} from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/provider"
import type { Messages } from "@/lib/i18n/types"
import {
  landingSection,
  WORKSPACES,
  type SectionKey,
  type WorkspaceKey,
} from "@/lib/agentpack/workspaces"
import { useAppStore } from "@/store/app-store"
import { MACOS_TRAFFIC_LIGHT_INSET, useWindowChrome } from "./window-chrome"

export type { SectionKey, WorkspaceKey }

interface SectionDef {
  key: SectionKey
  icon: LucideIcon
  label: (m: Messages) => string
}

/**
 * Per-section presentation. The sections themselves no longer form the primary
 * navigation — they are the sub-tabs inside a workspace — but they still need a
 * label and an icon, and the guided tour still walks them in this order.
 */
export const SECTIONS: SectionDef[] = [
  { key: "dashboard", icon: LayoutDashboard, label: (m) => m.menu.dashboard },
  { key: "presets", icon: Package, label: (m) => m.menu.presets },
  { key: "environment", icon: Boxes, label: (m) => m.menu.environment },
  { key: "clis", icon: Terminal, label: (m) => m.menu.clis },
  { key: "network", icon: Globe, label: (m) => m.menu.network },
  { key: "cleanup", icon: Eraser, label: (m) => m.menu.cleanup },
  { key: "skills", icon: Wrench, label: (m) => m.menu.skills },
  { key: "mcp", icon: Server, label: (m) => m.menu.mcp },
  { key: "ccswitch", icon: ArrowLeftRight, label: (m) => m.menu.ccswitch },
  { key: "ccconnect", icon: Cable, label: (m) => m.menu.ccconnect },
  { key: "history", icon: MessagesSquare, label: (m) => m.menu.history },
  { key: "config", icon: FileJson, label: (m) => m.menu.saveConfig },
  { key: "about", icon: Info, label: (m) => m.menu.about },
]

export function sectionMeta(key: SectionKey): SectionDef {
  return SECTIONS.find((s) => s.key === key) ?? SECTIONS[0]
}

interface WorkspaceMeta {
  key: WorkspaceKey
  icon: LucideIcon
  label: (m: Messages) => string
  hint: (m: Messages) => string
}

export const WORKSPACE_META: WorkspaceMeta[] = [
  {
    key: "overview",
    icon: LayoutDashboard,
    label: (m) => m.workspaces.overview,
    hint: (m) => m.workspaces.overviewHint,
  },
  {
    key: "install",
    icon: SlidersHorizontal,
    label: (m) => m.workspaces.install,
    hint: (m) => m.workspaces.installHint,
  },
  {
    key: "capabilities",
    icon: Boxes,
    label: (m) => m.workspaces.capabilities,
    hint: (m) => m.workspaces.capabilitiesHint,
  },
  {
    key: "usage",
    icon: ChartNoAxesColumn,
    label: (m) => m.workspaces.usage,
    hint: (m) => m.workspaces.usageHint,
  },
  {
    key: "settings",
    icon: Settings,
    label: (m) => m.workspaces.settings,
    hint: (m) => m.workspaces.settingsHint,
  },
]

export function workspaceMeta(key: WorkspaceKey): WorkspaceMeta {
  return WORKSPACE_META.find((w) => w.key === key) ?? WORKSPACE_META[0]
}

/**
 * The rail items themselves, shared by the fixed rail and the mobile sheet so
 * the two can never drift in order, labelling or active state.
 *
 * Selecting a workspace lands on its first section. Re-selecting the workspace
 * you are already in deliberately does the same, so a rail click is always a
 * way back to a known place rather than a no-op.
 */
function RailItems({
  active,
  onSelect,
  hints,
}: {
  active: WorkspaceKey
  onSelect: (workspace: WorkspaceKey, section: SectionKey) => void
  /** Show the one-line description under each label (sheet only — the rail is too narrow). */
  hints?: boolean
}) {
  const t = useT()
  const hasUpdate = useAppStore((s) => s.hasUpdate())
  return (
    <>
      {WORKSPACES.map((w) => {
        const meta = workspaceMeta(w.key)
        const Icon = meta.icon
        const isActive = active === w.key
        return (
          <button
            key={w.key}
            type="button"
            data-tour={`workspace-${w.key}`}
            aria-current={isActive ? "page" : undefined}
            onClick={() => onSelect(w.key, landingSection(w.key))}
            className={cn(
              "group relative flex w-full items-start gap-2.5 rounded-md py-2 pl-3 pr-2.5 text-left",
              "transition-colors duration-(--hm-dur-fast) ease-(--hm-ease-out)",
              isActive
                ? "bg-[var(--hm-accent-soft)] text-[var(--hm-accent)] font-medium"
                : "text-sidebar-foreground hover:bg-sidebar-accent"
            )}
          >
            {/* The active marker is a drawn rule, not a fill — depth in this app
                comes from lines, and a full accent block would blow the 5% rule
                the moment the rail is on screen. */}
            <span
              aria-hidden="true"
              className={cn(
                "absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-[var(--hm-accent)]",
                isActive ? "opacity-100" : "opacity-0"
              )}
            />
            <Icon className="mt-px size-4 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{meta.label(t)}</span>
              {hints ? (
                <span className="mt-0.5 block text-xs text-muted-foreground">{meta.hint(t)}</span>
              ) : null}
            </span>
            {w.key === "settings" && hasUpdate ? (
              <span
                className="mt-1.5 size-2 shrink-0 rounded-[var(--hm-radius-dot)] bg-[var(--hm-accent)]"
                aria-hidden="true"
              />
            ) : null}
          </button>
        )
      })}
    </>
  )
}

/**
 * The fixed task rail. Hidden below the 900px desktop floor, where
 * `WorkspaceNavSheet` (rendered by the header) takes over with the same items.
 */
export function WorkspaceRail({
  active,
  onSelect,
}: {
  active: WorkspaceKey
  onSelect: (workspace: WorkspaceKey, section: SectionKey) => void
}) {
  const t = useT()
  const chrome = useWindowChrome()
  return (
    <nav
      data-tour="nav"
      aria-label={t.workspaces.nav}
      className={cn(
        "hidden shrink-0 flex-col gap-0.5 border-r bg-sidebar p-2.5",
        "min-[900px]:flex min-[900px]:w-[var(--hm-rail-width)]",
        "min-[1200px]:w-[var(--hm-rail-width-wide)]",
        // The window's top-left corner is the rail's, so this is where the
        // macOS traffic lights land — push the brand block below them.
        chrome === "macos" && MACOS_TRAFFIC_LIGHT_INSET
      )}
    >
      {/* Draggable alongside the header, so the whole top strip moves the window. */}
      <div
        data-tauri-drag-region={chrome === "none" ? undefined : "deep"}
        className="px-1.5 pb-3 pt-1"
      >
        <div className="text-base font-semibold tracking-tight">{t.brand}</div>
      </div>
      <RailItems active={active} onSelect={onSelect} />
    </nav>
  )
}

/**
 * The same five items as a sheet, for windows narrower than the desktop floor
 * (web mode on a phone, or a very narrow desktop window). Rendered by the
 * header so the trigger sits where a user expects a menu button.
 */
export function WorkspaceNavSheet({
  active,
  onSelect,
}: {
  active: WorkspaceKey
  onSelect: (workspace: WorkspaceKey, section: SectionKey) => void
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="min-[900px]:hidden"
          aria-label={t.workspaces.open}
        >
          <Menu className="size-4" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-[17rem] gap-0 p-0">
        <SheetHeader className="border-b">
          <SheetTitle>{t.brand}</SheetTitle>
          <SheetDescription>{t.header.tagline}</SheetDescription>
        </SheetHeader>
        <nav aria-label={t.workspaces.nav} className="flex flex-col gap-0.5 p-2.5">
          <RailItems
            active={active}
            hints
            onSelect={(w, s) => {
              setOpen(false)
              onSelect(w, s)
            }}
          />
        </nav>
      </SheetContent>
    </Sheet>
  )
}
