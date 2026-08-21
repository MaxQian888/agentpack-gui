"use client"

import { useState } from "react"
import { Check, Plus } from "lucide-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { cn } from "@/lib/utils"
import { SKILLS } from "@/lib/agentpack/registry"
import { skillInstallStep, skillRemoveStep } from "@/lib/agentpack/plan"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { SKILL_SOURCES } from "@/lib/skills/browse"
import { skillDestPath } from "@/lib/skills/paths"
import type { InstalledSkill, SkillsScanResult, SkillSource } from "@/lib/skills/types"
import { useRunnerCtx } from "../../run/runner-context"
import { CapabilityList, CapabilityRow } from "../capability-list"
import { SKILL_SOURCE_COLORS } from "./installed"
import { useInstallGuard } from "./install-conflict-dialog"

/** Sources that currently have the bundled skill `id` installed, from the scan. */
function installedSources(skills: InstalledSkill[], id: string): SkillSource[] {
  const out: SkillSource[] = []
  for (const source of SKILL_SOURCES) {
    if (skills.some((s) => s.source === source && s.dirName === id)) out.push(source)
  }
  return out
}

/**
 * Per-root install/remove chips — one click, not "tick four boxes then press a
 * button that only appears once you have".
 *
 * The old shape put a checkbox column and a pair of buttons on every one of the
 * six rows, and the buttons materialised only after a tick, so a first-time
 * reader saw four checkboxes and no way to act. This is the same control the MCP
 * catalog uses, so both capability catalogs now behave identically: a filled
 * chip means installed there, clicking it removes, clicking a hollow one adds.
 */
function SourceToggles({
  installed,
  onToggle,
}: {
  installed: SkillSource[]
  onToggle: (source: SkillSource, installed: boolean) => void
}) {
  const sb = useT().skillsBrowser
  return (
    <div className="flex flex-wrap items-center gap-2">
      {SKILL_SOURCES.map((source) => {
        const on = installed.includes(source)
        const label = sb.sources[source] ?? source
        return (
          <button
            key={source}
            type="button"
            onClick={() => onToggle(source, on)}
            title={on ? sb.deleteFrom(label) : sb.installInto(label)}
            className={cn(
              "flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs",
              "transition-colors duration-(--hm-dur-fast) ease-(--hm-ease-out)",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none",
              on
                ? "border-[var(--hm-accent)] bg-[var(--hm-accent-soft)] font-medium text-[var(--hm-ink)]"
                : "text-muted-foreground hover:bg-muted"
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "size-2.5 shrink-0 rounded-(--hm-radius-dot)",
                !on && "border border-muted-foreground/50"
              )}
              style={on ? { backgroundColor: SKILL_SOURCE_COLORS[source] } : undefined}
            />
            {label}
            {on ? (
              <Check aria-hidden="true" className="size-3" />
            ) : (
              <Plus aria-hidden="true" className="size-3" />
            )}
          </button>
        )
      })}
    </div>
  )
}

/**
 * The six bundled domain skills, each installable into (or removable from) any of
 * the four skill roots (claude/codex/opencode/agents). Target selection is local
 * to this tab — the bundled catalog is self-contained and no longer feeds the
 * onboarding plan. Installs are guarded against overwriting an existing skill.
 */
export function CatalogTab({
  scan,
  refresh,
}: {
  scan: SkillsScanResult | null
  refresh: () => void
}) {
  const t = useT()
  const sb = t.skillsBrowser
  const paths = useAppStore((s) => s.paths)
  const { run } = useRunnerCtx()
  const { guard, dialog } = useInstallGuard()
  const [confirm, setConfirm] = useState<{ id: string; title: string; source: SkillSource } | null>(
    null
  )

  const skills = scan?.skills ?? []

  const installNow = async (id: string, title: string, target: SkillSource) => {
    if (!paths) return
    const resolved = await guard([{ dirName: id, targets: [target] }], skills)
    if (!resolved || resolved.length === 0) return
    await run([skillInstallStep(id, title, resolved[0].targets, t)])
    refresh()
  }

  const uninstallNow = async (id: string, title: string, target: SkillSource) => {
    if (!paths) return
    await run([skillRemoveStep(id, title, [target], [skillDestPath(paths, target, id)], t)])
    refresh()
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Said once above the list rather than implied six times below it. */}
      <p className="text-sm text-muted-foreground">{sb.catalogHint}</p>

      <CapabilityList label={sb.tabCatalog}>
        {SKILLS.map((skill) => {
          const meta = t.catalog.skills[skill.id]
          const title = meta?.title ?? skill.id
          const installed = installedSources(skills, skill.id)
          return (
            <CapabilityRow
              key={skill.id}
              title={title}
              tags={<span className="font-mono">{skill.id}</span>}
              description={meta?.description}
            >
              <SourceToggles
                installed={installed}
                onToggle={(source, on) =>
                  on
                    ? setConfirm({ id: skill.id, title, source })
                    : void installNow(skill.id, title, source)
                }
              />
            </CapabilityRow>
          )
        })}
      </CapabilityList>

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm ? sb.deleteConfirmTitle(confirm.title) : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm && paths
                ? sb.deleteConfirmBody(skillDestPath(paths, confirm.source, confirm.id))
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{sb.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirm) void uninstallNow(confirm.id, confirm.title, confirm.source)
                setConfirm(null)
              }}
            >
              {sb.confirmDelete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {dialog}
    </div>
  )
}
