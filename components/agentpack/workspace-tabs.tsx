"use client"

import { useCallback, useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/provider"
import { sectionsOf, type SectionKey, type WorkspaceKey } from "@/lib/agentpack/workspaces"
import { sectionMeta, workspaceMeta } from "./sidebar-nav"

/**
 * The sub-tab strip for a workspace with more than one destination.
 *
 * Real tab semantics rather than a row of links: the sections swap content in
 * place, so a keyboard user expects ←/→ to move between them and Tab to leave
 * the strip entirely. That's a roving tabindex — exactly one tab is reachable
 * by Tab, and the arrows move both focus and selection.
 *
 * The strip scrolls horizontally rather than wrapping. A tab label that breaks
 * onto a second line is the first thing that goes wrong when the window hits
 * the 900px floor or the labels switch to English.
 */
export function WorkspaceTabs({
  workspace,
  active,
  onSelect,
}: {
  workspace: WorkspaceKey
  active: SectionKey
  onSelect: (section: SectionKey) => void
}) {
  const t = useT()
  const sections = sectionsOf(workspace)
  const refs = useRef(new Map<SectionKey, HTMLButtonElement>())

  useEffect(() => {
    refs.current.get(active)?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }, [active, workspace])

  const move = useCallback(
    (delta: number | "first" | "last") => {
      const i = sections.indexOf(active)
      const next =
        delta === "first"
          ? 0
          : delta === "last"
            ? sections.length - 1
            : (i + delta + sections.length) % sections.length
      const key = sections[next]
      onSelect(key)
      // Focus follows selection, which is what makes ←/→ feel like a tab strip
      // rather than a set of buttons that happen to be next to each other.
      refs.current.get(key)?.focus()
    },
    [active, onSelect, sections]
  )

  return (
    <div
      role="tablist"
      aria-label={workspaceMeta(workspace).label(t)}
      className="flex min-w-0 gap-1 overflow-x-auto border-b px-4 [scrollbar-width:none] sm:px-6"
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") {
          e.preventDefault()
          move(1)
        } else if (e.key === "ArrowLeft") {
          e.preventDefault()
          move(-1)
        } else if (e.key === "Home") {
          e.preventDefault()
          move("first")
        } else if (e.key === "End") {
          e.preventDefault()
          move("last")
        }
      }}
    >
      {sections.map((key) => {
        const meta = sectionMeta(key)
        const isActive = key === active
        return (
          <button
            key={key}
            ref={(el) => {
              if (el) refs.current.set(key, el)
              else refs.current.delete(key)
            }}
            type="button"
            role="tab"
            id={`tab-${key}`}
            aria-selected={isActive}
            aria-controls={`panel-${key}`}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onSelect(key)}
            className={cn(
              "-mb-px shrink-0 whitespace-nowrap border-b-2 px-2 py-2.5 text-sm",
              "transition-colors duration-(--hm-dur-fast) ease-(--hm-ease-out)",
              isActive
                ? "border-[var(--hm-accent)] text-[var(--hm-accent)] font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {meta.label(t)}
          </button>
        )
      })}
    </div>
  )
}
