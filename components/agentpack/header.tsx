"use client"

import { Download, Moon, Search, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { useT } from "@/lib/i18n/provider"
import { hasTabs, type SectionKey, type WorkspaceKey } from "@/lib/agentpack/workspaces"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/store/app-store"
import { sectionMeta, workspaceMeta, WorkspaceNavSheet } from "./sidebar-nav"
import { useWindowChrome, WindowControls } from "./window-chrome"

/**
 * The title bar. It says where you are, offers the one way to get anywhere, and
 * then gets out of the way.
 *
 * What used to live here — a global dry-run switch and a Run ▾ menu that could
 * install a whole bundle in two clicks from any screen — has moved. Preview is
 * now a button inside the review panel, next to the step list it previews, and
 * a run starts from the workspace whose changes it is about to apply. A title
 * bar is the wrong place to put the app's most destructive control: it is
 * always in reach, and it is the one row of the window that never explains
 * itself.
 */
export function Header({
  workspace,
  section,
  onNavigate,
  onOpenCommand,
  onShowUpdates,
}: {
  workspace: WorkspaceKey
  section: SectionKey
  onNavigate: (workspace: WorkspaceKey, section: SectionKey) => void
  onOpenCommand: () => void
  onShowUpdates?: () => void
}) {
  const t = useT()
  const { resolvedTheme, setTheme } = useTheme()
  const hasUpdate = useAppStore((s) => s.hasUpdate())
  const updateVersion = useAppStore((s) => s.updateInfo?.version)
  const chrome = useWindowChrome()

  return (
    // Doubles as the window's title bar once the frame is gone. `deep` makes the
    // whole subtree draggable *except* clickable elements — Tauri's drag script
    // bails on BUTTON/INPUT/SELECT/LABEL and anything with an interactive role,
    // so every control below keeps working untouched.
    <header
      data-tauri-drag-region={chrome === "none" ? undefined : "deep"}
      className={cn(
        "flex items-center gap-2 border-b px-3 py-2 sm:px-4",
        chrome === "custom" && "pr-0"
      )}
    >
      <WorkspaceNavSheet active={workspace} onSelect={onNavigate} />

      {/* Current context. The section is named only when the workspace has more
          than one — otherwise it would repeat the workspace back at itself. */}
      <div className="flex min-w-0 items-baseline gap-1.5">
        <span className="truncate text-sm font-medium">{workspaceMeta(workspace).label(t)}</span>
        {hasTabs(workspace) ? (
          <>
            <span aria-hidden="true" className="text-muted-foreground/60">
              /
            </span>
            <span className="truncate text-sm text-muted-foreground">
              {sectionMeta(section).label(t)}
            </span>
          </>
        ) : null}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1">
        {/* The palette's affordance is a real control, not a hint: someone who
            never learns the accelerator still gets the same search. */}
        <Button
          variant="outline"
          size="sm"
          data-tour="command"
          onClick={onOpenCommand}
          className="gap-2 text-muted-foreground font-normal"
        >
          <Search className="size-4" />
          <span className="hidden sm:inline">{t.palette.open}</span>
          <Kbd className="hidden md:inline-flex">⌘K</Kbd>
        </Button>

        {hasUpdate && onShowUpdates ? (
          <Button
            variant="ghost"
            size="icon"
            className="relative"
            aria-label={updateVersion ? t.about.updateAvailable(updateVersion) : t.menu.about}
            onClick={onShowUpdates}
          >
            <Download className="size-4" />
            <span className="absolute right-1.5 top-1.5 size-2 rounded-[var(--hm-radius-dot)] bg-[var(--hm-accent)]" />
          </Button>
        ) : null}

        <Button
          variant="ghost"
          size="icon"
          aria-label={t.shell.toggleTheme}
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        >
          <Sun className="size-4 dark:hidden" />
          <Moon className="hidden size-4 dark:block" />
        </Button>
      </div>

      <WindowControls chrome={chrome} />
    </header>
  )
}
