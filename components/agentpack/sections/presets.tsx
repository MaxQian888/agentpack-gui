"use client"

import { useState } from "react"
import { ArrowRight, Check, ChevronDown, Server, Terminal, Wrench } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { clisByKind, CLI_TOOLS, MCP_SERVERS, SKILLS } from "@/lib/agentpack/registry"
import {
  matchPreset,
  mcpTargetsFor,
  presetSelection,
  PRESETS,
  skillTargetsFor,
} from "@/lib/agentpack/presets"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { CapabilityTile, CapabilityWorkbench } from "./capability-workbench"
import { HelpTip } from "../help-tip"
import { useTrayCount } from "../change-tray"
import { KeyInput } from "./mcp/helpers"

/** The bundle this page opens pointing at, and the one row that gets a marker. */
const DEFAULT_PRESET = "recommended"

/**
 * The rows of step 01, in the order someone reads them: the answer first, then
 * the two edges it sits between, then "I'll pick myself". "custom" is not a
 * bundle — it is the empty plan — so it is appended rather than living in
 * `PRESETS`.
 */
const OPTIONS: readonly string[] = [
  DEFAULT_PRESET,
  ...PRESETS.map((p) => p.id).filter((id) => id !== DEFAULT_PRESET),
  "custom",
]

/**
 * Quick setup — the first stop in Install & repair, and the one screen a
 * newcomer has to get through.
 *
 * It reads as three numbered blocks in a single panel: **pick a preset**,
 * **fine-tune** (folded away), **review and install**. That shape replaced a
 * four-tile metric strip over a bundle chip row over three always-open
 * checklists. The strip is gone outright — design.md bans the row of uniform
 * stat cards, and here it was also redundant three ways over: the same counts
 * were already in the selection panel beside it and in the change tray below
 * it. The chips are now ruled rows that state what each preset installs, so
 * the difference between Minimal and Everything can be read instead of
 * discovered by clicking. And the sixteen-CLI checklist starts closed, because
 * it is the answer to a question a first-time user has not asked yet.
 *
 * Nothing here starts a run. Selecting writes to the shared plan; step 03 and
 * the change tray both lead to the review panel, which is the only door to
 * disk.
 */
export function PresetsSection({ onReview }: { onReview?: () => void }) {
  const t = useT()
  const d = t.installDialog
  const ps = t.presetsScreen
  const plan = useAppStore((s) => s.plan)
  // The tray's number, so this page and the tray below it never disagree about
  // how much is about to be reviewed.
  const trayCount = useTrayCount()
  const toggleCli = useAppStore((s) => s.toggleCli)
  const setSkill = useAppStore((s) => s.setSkill)
  const setMcp = useAppStore((s) => s.setMcp)
  const setMcpKey = useAppStore((s) => s.setMcpKey)
  const syncTargetsToClis = useAppStore((s) => s.syncTargetsToClis)
  const applyPreset = useAppStore((s) => s.applyPreset)
  const resetPlan = useAppStore((s) => s.resetPlan)
  const detections = useAppStore((s) => s.detections)

  // Closed on arrival. Picking "Custom" opens it, because "choose everything
  // manually" with nothing on screen to choose from is a dead end.
  const [tuning, setTuning] = useState(false)

  const selectedClis = new Set(plan.clis)
  const selectedSkills = new Set(plan.skills.map((s) => s.id))
  const selectedMcps = new Set(plan.mcps.map((m) => m.id))
  const anyPicked = selectedClis.size + selectedSkills.size + selectedMcps.size > 0
  // Derived from the plan rather than remembered locally, so the active row
  // agrees with what will actually be installed — including a bundle the user
  // has since edited item by item. An empty plan matches no row: it isn't a
  // "Custom" choice the user has made yet.
  const activePreset = anyPicked ? matchPreset(plan) : null
  // A hand-edited plan is what the Custom row stands for, so it states that —
  // "Nothing pre-selected" beside a staged selection contradicts the summary.
  const customCounts =
    activePreset === "custom"
      ? ps.presetCounts(selectedClis.size, selectedSkills.size, selectedMcps.size)
      : ps.presetCountsCustom

  // Where skills / MCP servers land: the agent CLIs this selection sets up.
  const skillTargets = skillTargetsFor(plan.clis)
  const mcpTargets = mcpTargetsFor(plan.clis)
  const targetNames = (targets: readonly string[]) =>
    targets.map((tg) => t.mcp.targets[tg] ?? tg).join(" · ")

  const choosePreset = (id: string) => {
    if (id === "custom") {
      // Once the plan is the user's own picks, "Custom" is the row that names
      // them — pressing it again opens the checklists to keep editing, and must
      // never wipe the selection it is describing. Only leaving a bundle for
      // Custom starts from the empty plan.
      if (activePreset !== "custom") resetPlan()
      setTuning(true)
      return
    }
    applyPreset(id)
  }

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
      title={ps.title}
      subtitle={ps.subtitle}
      help={<HelpTip text={t.help.preset} />}
      actionsLabel={ps.actionsLabel}
      primary={
        <section aria-label={ps.catalogPanel} className="min-w-0 rounded-lg border">
          <Step n="01" title={ps.stepPick} hint={ps.stepPickHint}>
            {/* Ruled rows rather than chips or a card grid: a preset has a name,
                a sentence and a size, and all three have to be readable before
                the click, not after it. */}
            <div className="mt-3 -mx-4 border-t md:-mx-5">
              {OPTIONS.map((id) => (
                <PresetRow
                  key={id}
                  id={id}
                  title={id === "custom" ? d.custom : (t.presets[id]?.title ?? id)}
                  description={t.presets[id]?.description ?? ""}
                  counts={id === "custom" ? customCounts : presetCounts(id, ps.presetCounts)}
                  tag={id === DEFAULT_PRESET ? ps.startHereTag : undefined}
                  active={activePreset === id}
                  onPick={() => choosePreset(id)}
                />
              ))}
            </div>
          </Step>

          <Collapsible open={tuning} onOpenChange={setTuning}>
            <Step
              n="02"
              title={ps.stepTune}
              tag={ps.stepTuneTag}
              hint={ps.stepTuneHint(CLI_TOOLS.length, SKILLS.length, MCP_SERVERS.length)}
              action={
                <CollapsibleTrigger asChild>
                  <Button variant="outline" size="sm">
                    {tuning ? ps.tuneHide : ps.tuneShow}
                    <ChevronDown
                      aria-hidden="true"
                      className={cn(
                        "size-4 transition-transform duration-(--hm-dur-fast) ease-(--hm-ease-out)",
                        tuning && "rotate-180"
                      )}
                    />
                  </Button>
                </CollapsibleTrigger>
              }
              bordered
            >
              <CollapsibleContent>
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
                    <Group
                      icon={Wrench}
                      title={d.skills}
                      note={d.writesTo(targetNames(skillTargets))}
                    >
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
              </CollapsibleContent>
            </Step>
          </Collapsible>

          {/* Step 03 names the destination before the user gets there: the
              review panel, never disk. The change tray carries the same action
              as the workspace's one primary button, so this one is outlined. */}
          <Step n="03" title={ps.stepReview} hint={ps.stepReviewHint} bordered>
            <div className="mt-3">
              {anyPicked && onReview ? (
                <Button variant="outline" size="sm" onClick={onReview}>
                  {ps.reviewAction(trayCount)}
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Button>
              ) : (
                <p className="text-sm text-muted-foreground">{ps.emptyHint}</p>
              )}
            </div>
          </Step>
        </section>
      }
      aside={
        <CapabilityTile title={d.summary}>
          {anyPicked ? (
            <dl className="flex flex-col gap-3 text-sm">
              <div className="font-mono text-[var(--hm-text-2xs)] tracking-[var(--hm-tracking-mono)] text-muted-foreground uppercase tabular-nums">
                {ps.selectedCount(trayCount)}
              </div>
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

/** What a preset stages, as one mono line. Empty for an id with no bundle. */
function presetCounts(id: string, sentence: (c: number, s: number, m: number) => string): string {
  const picked = presetSelection(id)
  return picked ? sentence(picked.clis.length, picked.skills.length, picked.mcps.length) : ""
}

/**
 * One numbered block of the flow. The number is mono and accent because it is
 * the only thing on the row the eye has to find; everything else is ink.
 * `bordered` draws the section rule that separates it from the block above —
 * a rule rather than a second box, since a panel inside a panel is a smell.
 */
function Step({
  n,
  title,
  tag,
  hint,
  action,
  bordered,
  children,
}: {
  n: string
  title: string
  /** Short qualifier after the title, e.g. "Optional". */
  tag?: string
  hint?: string
  action?: React.ReactNode
  bordered?: boolean
  children?: React.ReactNode
}) {
  return (
    <div className={cn("min-w-0 p-4 md:p-5", bordered && "border-t")}>
      <div className="flex min-w-0 items-center justify-between gap-3">
        {/* The number rides the title line rather than a column of its own, so
            the hint and the step's content share one left edge with everything
            else in the panel. */}
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span
            aria-hidden="true"
            className="shrink-0 font-mono text-[var(--hm-text-xs)] text-[var(--hm-accent)] tabular-nums"
          >
            {n}
          </span>
          <h3 className="font-medium">{title}</h3>
          {tag ? (
            <span className="rounded-[var(--hm-radius-control)] border px-1.5 font-mono text-[var(--hm-text-2xs)] tracking-[var(--hm-tracking-mono)] text-muted-foreground uppercase">
              {tag}
            </span>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {hint ? <p className="mt-1 text-sm text-muted-foreground">{hint}</p> : null}
      {children}
    </div>
  )
}

/**
 * One preset, as a full-bleed ruled row: name, what it is for, and how big it
 * is. Still a toggle button rather than a radio — the row means "make the plan
 * be this", and pressing the one that is already active leaves the plan as it
 * is, not a second state (an active Custom just unfolds step 02). The
 * description is wired up with `aria-describedby` so the accessible name stays
 * the preset's name.
 */
function PresetRow({
  id,
  title,
  description,
  counts,
  tag,
  active,
  onPick,
}: {
  id: string
  title: string
  description: string
  counts: string
  /** Marker on the default row, e.g. "Start here". */
  tag?: string
  active: boolean
  onPick: () => void
}) {
  const descId = `qi-preset-${id}-desc`
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={title}
      aria-describedby={description ? descId : undefined}
      onClick={onPick}
      className={cn(
        "flex w-full min-w-0 items-start gap-3 border-b px-4 py-3 text-left last:border-b-0 md:px-5",
        "transition-colors duration-(--hm-dur-fast) ease-(--hm-ease-out)",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none",
        active ? "bg-[var(--hm-accent-soft)]" : "hover:bg-muted"
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{title}</span>
          {/* The marker is advice for someone who hasn't chosen yet, so it steps
              aside for the tick once they have — which also keeps accent text
              off the accent wash, where it clears 4.5:1 by too little. */}
          {tag && !active ? (
            <span className="rounded-[var(--hm-radius-control)] bg-[var(--hm-accent-soft)] px-1.5 font-mono text-[var(--hm-text-2xs)] tracking-[var(--hm-tracking-mono)] text-[var(--hm-accent)] uppercase">
              {tag}
            </span>
          ) : null}
        </span>
        {description ? (
          <span
            id={descId}
            className={cn(
              "mt-0.5 block text-sm",
              active ? "text-[var(--hm-ink-2)]" : "text-muted-foreground"
            )}
          >
            {description}
          </span>
        ) : null}
        <span
          className={cn(
            "mt-1 block font-mono text-[var(--hm-text-2xs)] tabular-nums [overflow-wrap:anywhere]",
            active ? "text-[var(--hm-ink-2)]" : "text-muted-foreground"
          )}
        >
          {counts}
        </span>
      </span>
      <Check
        aria-hidden="true"
        className={cn(
          "mt-0.5 size-4 shrink-0 text-[var(--hm-accent)]",
          active ? "opacity-100" : "opacity-0"
        )}
      />
    </button>
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
      className="flex cursor-pointer items-center gap-2 rounded-[var(--hm-radius-control)] px-1.5 py-1.5 text-sm transition-colors duration-(--hm-dur-fast) ease-(--hm-ease-out) hover:bg-muted"
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
