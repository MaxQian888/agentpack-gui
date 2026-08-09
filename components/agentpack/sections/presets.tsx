"use client"

import { Server, Terminal, Wrench } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { clisByKind, MCP_SERVERS, SKILLS } from "@/lib/agentpack/registry"
import { matchPreset, mcpTargetsFor, PRESETS, skillTargetsFor } from "@/lib/agentpack/presets"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { CapabilityMetric, CapabilityTile, CapabilityWorkbench } from "./capability-workbench"
import { HelpTip } from "../help-tip"
import { KeyInput } from "./mcp/helpers"

const OPTIONS = ["custom", ...PRESETS.map((p) => p.id)] as const

/**
 * Quick config — the first stop in Install & repair.
 *
 * This used to be a modal: a bundle picker, three checklists, a preview switch
 * and an install button, all inside one dialog that ran out of room at the
 * 900px window floor and hid the app behind itself while you used it. It is now
 * a workspace. Same selections, same store mutations — but the checklists get a
 * tab each instead of a third of a column, and the outcome of your choices is
 * stated beside them instead of being a number in a footer.
 *
 * Nothing here starts a run. Selecting writes to the shared plan, and the
 * change tray at the bottom of the shell is the only way onward — to the review
 * panel, never straight to disk.
 */
export function PresetsSection() {
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

  const selectedClis = new Set(plan.clis)
  const selectedSkills = new Set(plan.skills.map((s) => s.id))
  const selectedMcps = new Set(plan.mcps.map((m) => m.id))
  const anyPicked = selectedClis.size + selectedSkills.size + selectedMcps.size > 0
  // Derived from the plan rather than remembered locally, so the active chip
  // agrees with what will actually be installed — including a bundle the user
  // has since edited item by item. An empty plan matches no chip: it isn't a
  // "Custom" choice the user has made yet.
  const activePreset = anyPicked ? matchPreset(plan) : null

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

  const label = {
    cli: (id: string) => t.catalog.cli[id]?.title ?? id,
    skill: (id: string) => t.catalog.skills[id]?.title ?? id,
    mcp: (id: string) => t.catalog.mcp[id]?.title ?? id,
  }

  return (
    <CapabilityWorkbench
      title={t.presetsScreen.title}
      subtitle={t.presetsScreen.subtitle}
      help={<HelpTip text={t.help.preset} />}
      summaryLabel={t.presetsScreen.summaryLabel}
      actionsLabel={t.presetsScreen.actionsLabel}
      metrics={
        <>
          <CapabilityMetric
            label={t.presetsScreen.metricPreset}
            value={
              activePreset
                ? activePreset === "custom"
                  ? t.presetsScreen.customValue
                  : (t.presets[activePreset]?.title ?? activePreset)
                : "—"
            }
          />
          <CapabilityMetric label={t.presetsScreen.metricClis} value={selectedClis.size} />
          <CapabilityMetric label={t.presetsScreen.metricSkills} value={selectedSkills.size} />
          <CapabilityMetric label={t.presetsScreen.metricMcp} value={selectedMcps.size} />
        </>
      }
      primary={
        <section
          aria-label={t.presetsScreen.catalogPanel}
          className="min-w-0 rounded-lg border p-4"
        >
          {/* Bundle chips — a shortcut that pre-fills the checklists below. */}
          <div className="flex flex-col gap-2 border-b pb-4">
            <div className="text-sm font-medium">{d.presetLabel}</div>
            <div className="flex flex-wrap gap-2">
              {OPTIONS.map((id) => {
                const active = activePreset === id
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => choosePreset(id)}
                    className={cn(
                      "rounded-[var(--hm-radius-control)] border px-3 py-1.5 text-sm",
                      "transition-colors duration-(--hm-dur-fast) ease-(--hm-ease-out)",
                      active
                        ? "border-[var(--hm-accent)] bg-[var(--hm-accent-soft)] font-medium text-[var(--hm-accent)]"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {id === "custom" ? d.custom : (t.presets[id]?.title ?? id)}
                  </button>
                )
              })}
            </div>
            {/* The description of whichever bundle is active, stated once. It used
            to be a `title` on each chip, which both hid it from the keyboard
            and — because a title wins the accessible-name computation —
            replaced "Recommended" with a sentence for screen-reader users. */}
            <p className="min-h-5 text-sm text-muted-foreground" aria-live="polite">
              {activePreset ? (t.presets[activePreset]?.description ?? "") : ""}
            </p>
          </div>

          {/* The checklists get the width; the summary is a column of its own from
          1100px up. Below that the change tray already states the count, so a
          second summary would just be the same number twice. */}
          <Tabs defaultValue="clis" className="min-w-0 pt-4">
            <TabsList>
              <TabsTrigger value="clis">{d.clis}</TabsTrigger>
              <TabsTrigger value="skills">{d.skills}</TabsTrigger>
              <TabsTrigger value="mcp">{d.mcp}</TabsTrigger>
            </TabsList>

            <TabsContent value="clis">
              {/* One block per kind, so the agents aren't interleaved with the
                tools that manage them (see `clisByKind`). */}
              {clisByKind().map(({ kind, tools }) => (
                <Group key={kind} icon={Terminal} title={t.tools.kinds[kind] ?? kind}>
                  {tools.map((tool) => (
                    <CheckRow
                      key={tool.id}
                      id={`qi-cli-${tool.id}`}
                      label={label.cli(tool.id)}
                      checked={selectedClis.has(tool.id)}
                      installed={detections[tool.id]?.installed}
                      installedLabel={t.envcheck.installed}
                      onToggle={() => toggleCliAndRetarget(tool.id)}
                    />
                  ))}
                </Group>
              ))}
            </TabsContent>

            <TabsContent value="skills">
              <Group icon={Wrench} title={d.skills} note={d.writesTo(targetNames(skillTargets))}>
                {SKILLS.map((skill) => (
                  <CheckRow
                    key={skill.id}
                    id={`qi-skill-${skill.id}`}
                    label={label.skill(skill.id)}
                    checked={selectedSkills.has(skill.id)}
                    onToggle={() =>
                      setSkill(skill.id, selectedSkills.has(skill.id) ? [] : skillTargets)
                    }
                  />
                ))}
              </Group>
            </TabsContent>

            <TabsContent value="mcp">
              <Group icon={Server} title={d.mcp} note={d.writesTo(targetNames(mcpTargets))}>
                {MCP_SERVERS.map((server) => {
                  const checked = selectedMcps.has(server.id)
                  return (
                    <div key={server.id} className="flex flex-col gap-1">
                      <CheckRow
                        id={`qi-mcp-${server.id}`}
                        label={label.mcp(server.id)}
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
            </TabsContent>
          </Tabs>
        </section>
      }
      aside={
        <CapabilityTile title={d.summary}>
          {anyPicked ? (
            <dl className="flex flex-col gap-3 text-sm">
              <SummaryGroup title={d.clis} items={plan.clis.map(label.cli)} />
              <SummaryGroup title={d.skills} items={plan.skills.map((s) => label.skill(s.id))} />
              <SummaryGroup title={d.mcp} items={plan.mcps.map((m) => label.mcp(m.id))} />
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">{d.summaryEmpty}</p>
          )}
        </CapabilityTile>
      }
    />
  )
}

function SummaryGroup({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null
  return (
    <div className="min-w-0">
      <dt className="font-mono text-[var(--hm-text-2xs)] tracking-[var(--hm-tracking-mono)] text-muted-foreground uppercase">
        {title}
      </dt>
      <dd className="mt-1 flex flex-col gap-0.5">
        {items.map((name) => (
          <span key={name} className="truncate [overflow-wrap:anywhere]">
            {name}
          </span>
        ))}
      </dd>
    </div>
  )
}

/** A titled block of check rows, with an optional sub-line (e.g. where it writes). */
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
    <div className="flex flex-col gap-1.5 pt-4">
      <div className="flex items-center gap-2 font-mono text-[var(--hm-text-2xs)] tracking-[var(--hm-tracking-mono)] text-muted-foreground uppercase">
        <Icon className="size-3.5" aria-hidden="true" />
        {title}
      </div>
      {note ? <p className="-mt-0.5 text-xs text-muted-foreground">{note}</p> : null}
      <div className="mt-1 flex flex-col gap-0.5">{children}</div>
    </div>
  )
}

/** One selectable item, with a dot when it's already installed. */
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
      className="flex cursor-pointer items-center gap-2 rounded-[var(--hm-radius-control)] px-1.5 py-1.5 text-sm transition-colors duration-(--hm-dur-fast) hover:bg-muted"
    >
      <Checkbox id={id} checked={checked} onCheckedChange={onToggle} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge ? (
        <span className="shrink-0 rounded-[var(--hm-radius-control)] border px-1.5 text-[var(--hm-text-2xs)] text-muted-foreground">
          {badge}
        </span>
      ) : null}
      {installed ? (
        <span
          className="size-1.5 shrink-0 rounded-[var(--hm-radius-dot)] bg-[var(--hm-ok)]"
          title={installedLabel}
          aria-label={installedLabel}
        />
      ) : null}
    </label>
  )
}
