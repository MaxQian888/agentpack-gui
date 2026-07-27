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
import { matchPreset, mcpTargetsFor, PRESETS, skillTargetsFor } from "@/lib/agentpack/presets"
import { planHasSelections } from "@/lib/agentpack/plan"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { KeyInput } from "./sections/mcp/helpers"

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
  const setMcpKey = useAppStore((s) => s.setMcpKey)
  const syncTargetsToClis = useAppStore((s) => s.syncTargetsToClis)
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
  // Where skills / MCP servers land: the agent CLIs this selection sets up.
  const skillTargets = skillTargetsFor(plan.clis)
  const mcpTargets = mcpTargetsFor(plan.clis)
  const targetNames = (targets: readonly string[]) =>
    targets.map((tg) => t.mcp.targets[tg] ?? tg).join(" · ")

  const choosePreset = (id: string) => (id === "custom" ? resetPlan() : applyPreset(id))

  // Changing the CLI selection re-points what's already ticked, so the "writes to"
  // line below never promises an agent the user just unticked.
  const toggleCliAndRetarget = (id: Parameters<typeof toggleCli>[0]) => {
    toggleCli(id)
    syncTargetsToClis()
  }

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
                onToggle={() => toggleCliAndRetarget(tool.id)}
              />
            ))}
          </Group>
          <Group icon={Wrench} title={d.skills} note={d.writesTo(targetNames(skillTargets))}>
            {SKILLS.map((skill) => (
              <CheckRow
                key={skill.id}
                id={`qi-skill-${skill.id}`}
                label={t.catalog.skills[skill.id]?.title ?? skill.id}
                checked={selectedSkills.has(skill.id)}
                onToggle={() =>
                  setSkill(skill.id, selectedSkills.has(skill.id) ? [] : skillTargets)
                }
              />
            ))}
          </Group>
          <Group icon={Server} title={d.mcp} note={d.writesTo(targetNames(mcpTargets))}>
            {MCP_SERVERS.map((server) => {
              const checked = selectedMcps.has(server.id)
              return (
                <div key={server.id} className="flex flex-col gap-1">
                  <CheckRow
                    id={`qi-mcp-${server.id}`}
                    label={t.catalog.mcp[server.id]?.title ?? server.id}
                    checked={checked}
                    badge={server.keyEnv ? t.mcp.needsKeyBadge : undefined}
                    onToggle={() => setMcp(server.id, checked ? [] : mcpTargets)}
                  />
                  {/* Ask for the key here rather than sending the user to the MCP
                      page: a bundle can select a key-gated server (context7,
                      github), and without one the server installs degraded. */}
                  {checked && server.keyEnv ? (
                    <div className="pl-6">
                      <KeyInput
                        ariaLabel={`${server.id} ${server.keyEnv}`}
                        placeholder={server.keyEnv}
                        value={plan.mcpKeys[server.id] ?? ""}
                        onChange={(v) => setMcpKey(server.id, v)}
                      />
                    </div>
                  ) : null}
                </div>
              )
            })}
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
            {/* Network-only plans (a relay endpoint, an npm mirror, a proxy) are
                runnable too, so the button follows the plan, not the tick count. */}
            <Button disabled={!planHasSelections(plan)} onClick={onInstall}>
              {dryRun ? d.installPreview : d.install}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** A titled column of check rows, with an optional sub-line (e.g. where it writes). */
function Group({
  icon: Icon,
  title,
  note,
  children,
}: {
  icon: LucideIcon
  title: string
  note?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        <Icon className="size-3.5" aria-hidden="true" />
        {title}
      </div>
      {note ? <p className="-mt-1 text-xs text-muted-foreground">{note}</p> : null}
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
  badge,
  onToggle,
}: {
  id: string
  label: string
  checked: boolean
  installed?: boolean
  installedLabel?: string
  /** Short marker after the label, e.g. "key" for a server that needs an API key. */
  badge?: string
  onToggle: () => void
}) {
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-sm transition-colors hover:bg-muted/50"
    >
      <Checkbox id={id} checked={checked} onCheckedChange={onToggle} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge ? (
        <span className="shrink-0 rounded-full border px-1.5 text-[10px] text-muted-foreground">
          {badge}
        </span>
      ) : null}
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
