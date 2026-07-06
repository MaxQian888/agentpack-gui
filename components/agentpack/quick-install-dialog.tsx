"use client"

import { Server, Sparkles, Terminal, Wrench } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { CLI_TOOLS, MCP_SERVERS, SKILLS } from "@/lib/agentpack/registry"
import { PRESETS } from "@/lib/agentpack/presets"
import type { AgentTarget, Plan } from "@/lib/agentpack/types"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"

/** Targets a preset assigns: skills → both agents; MCP servers → Claude only. */
const SKILL_TARGETS: AgentTarget[] = ["claude", "codex"]
const MCP_TARGETS: AgentTarget[] = ["claude"]

const sameSet = (a: readonly string[], b: readonly string[]): boolean => {
  if (a.length !== b.length) return false
  const sb = new Set(b)
  return a.every((x) => sb.has(x))
}

/**
 * Which preset the current plan exactly matches (by id sets), else "custom" —
 * drives the highlighted chip. Only ids are compared, so it stays true even
 * though the plan also carries per-item targets.
 */
export function matchPreset(plan: Plan): string {
  for (const p of PRESETS) {
    if (
      sameSet(plan.clis, p.clis) &&
      sameSet(
        plan.skills.map((s) => s.id),
        p.skills
      ) &&
      sameSet(
        plan.mcps.map((m) => m.id),
        p.mcps
      )
    ) {
      return p.id
    }
  }
  return "custom"
}

/**
 * One-page quick-install dialog opened from the header "Run ▾" menu. Lets the
 * user start from a bundle *and* fine-tune the exact CLIs / skills / MCP servers
 * — all without leaving the current page. Selections write straight to the
 * shared plan (same store mutations as the individual sections), so `onInstall`
 * runs the very same one-click flow as the header Run button.
 */
export function QuickInstallDialog({
  open,
  onInstall,
  onClose,
}: {
  open: boolean
  /** Run the current plan (dedup + review handled by the shell's one-click flow). */
  onInstall: () => void
  onClose: () => void
}) {
  const t = useT()
  const d = t.installDialog
  const plan = useAppStore((s) => s.plan)
  const toggleCli = useAppStore((s) => s.toggleCli)
  const setSkill = useAppStore((s) => s.setSkill)
  const setMcp = useAppStore((s) => s.setMcp)
  const applyPreset = useAppStore((s) => s.applyPreset)
  const resetPlan = useAppStore((s) => s.resetPlan)
  const detections = useAppStore((s) => s.detections)
  const dryRun = useAppStore((s) => s.dryRun)
  const toggleDryRun = useAppStore((s) => s.toggleDryRun)

  const active = matchPreset(plan)
  const selectedClis = new Set(plan.clis)
  const selectedSkills = new Set(plan.skills.map((s) => s.id))
  const selectedMcps = new Set(plan.mcps.map((m) => m.id))
  const total = selectedClis.size + selectedSkills.size + selectedMcps.size

  const choosePreset = (id: string) => (id === "custom" ? resetPlan() : applyPreset(id))

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] gap-5 overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-5 text-primary" aria-hidden="true" />
            {d.title}
          </DialogTitle>
          <DialogDescription>{d.subtitle}</DialogDescription>
        </DialogHeader>

        {/* Bundle chips — a shortcut that pre-fills the checklists below. */}
        <div className="flex flex-col gap-2">
          <div className="text-sm font-medium">{d.presetLabel}</div>
          <div className="flex flex-wrap gap-2">
            {["custom", ...PRESETS.map((p) => p.id)].map((id) => {
              const label = id === "custom" ? d.custom : (t.presets[id]?.title ?? id)
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={active === id}
                  onClick={() => choosePreset(id)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-sm transition-colors hover:border-primary/50",
                    active === id
                      ? "border-primary bg-primary/10 font-medium text-primary"
                      : "text-muted-foreground"
                  )}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Fine-grained selection, grouped by kind. */}
        <div className="grid gap-4 sm:grid-cols-3">
          <Group icon={Terminal} title={d.clis}>
            {CLI_TOOLS.map((tool) => (
              <CheckRow
                key={tool.id}
                id={`qi-cli-${tool.id}`}
                label={t.catalog.cli[tool.id]?.title ?? tool.id}
                checked={selectedClis.has(tool.id)}
                installed={detections[tool.id]?.installed}
                installedLabel={t.envcheck.installed}
                onToggle={() => toggleCli(tool.id)}
              />
            ))}
          </Group>
          <Group icon={Wrench} title={d.skills}>
            {SKILLS.map((skill) => (
              <CheckRow
                key={skill.id}
                id={`qi-skill-${skill.id}`}
                label={t.catalog.skills[skill.id]?.title ?? skill.id}
                checked={selectedSkills.has(skill.id)}
                onToggle={() =>
                  setSkill(skill.id, selectedSkills.has(skill.id) ? [] : SKILL_TARGETS)
                }
              />
            ))}
          </Group>
          <Group icon={Server} title={d.mcp}>
            {MCP_SERVERS.map((server) => (
              <CheckRow
                key={server.id}
                id={`qi-mcp-${server.id}`}
                label={t.catalog.mcp[server.id]?.title ?? server.id}
                checked={selectedMcps.has(server.id)}
                onToggle={() => setMcp(server.id, selectedMcps.has(server.id) ? [] : MCP_TARGETS)}
              />
            ))}
          </Group>
        </div>

        {/* Preview (dry-run) — same store flag as the header toggle. */}
        <div className="flex items-start justify-between gap-3 rounded-lg border p-3">
          <div>
            <Label htmlFor="qi-preview" className="cursor-pointer text-sm font-medium">
              {t.welcome.previewLabel}
            </Label>
            <p className="text-xs text-muted-foreground">{t.welcome.previewHint}</p>
          </div>
          <Switch id="qi-preview" checked={dryRun} onCheckedChange={toggleDryRun} />
        </div>

        <DialogFooter className="items-center gap-2 sm:justify-between sm:gap-2">
          <span className="text-sm text-muted-foreground">
            {total === 0 ? d.none : d.selected(total)}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              {t.shell.cancel}
            </Button>
            <Button disabled={total === 0} onClick={onInstall}>
              {dryRun ? d.installPreview : d.install}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** A titled column of check rows. */
function Group({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="size-3.5" aria-hidden="true" />
        {title}
      </div>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  )
}

/** One selectable item, with a green dot when it's already installed. */
function CheckRow({
  id,
  label,
  checked,
  installed,
  installedLabel,
  onToggle,
}: {
  id: string
  label: string
  checked: boolean
  installed?: boolean
  installedLabel?: string
  onToggle: () => void
}) {
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-sm transition-colors hover:bg-muted/50"
    >
      <Checkbox id={id} checked={checked} onCheckedChange={onToggle} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {installed ? (
        <span
          className="size-1.5 shrink-0 rounded-full bg-emerald-500"
          title={installedLabel}
          aria-label={installedLabel}
        />
      ) : null}
    </label>
  )
}
