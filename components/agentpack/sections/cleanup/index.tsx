"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, RefreshCw, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import {
  AGE_PRESETS,
  appsPresent,
  formatBytes,
  groupByCategory,
  rowsForApp,
  safeSelection,
  specsFor,
  targetImpact,
  targetLabel,
  totalBytes,
  totalFiles,
  visibleRows,
  type CleanupConfigTarget,
  type CleanupRoots,
  type CleanupRow,
} from "@/lib/agentpack/cleanup"
import { cleanupConfigStep, cleanupStep } from "@/lib/agentpack/plan"
import type { StepDescriptor } from "@/lib/agentpack/types"
import { useT } from "@/lib/i18n/provider"
import { isTauri } from "@/lib/tauri"
import { cleanupQuarantineList, isProcessRunning, type QuarantineEntry } from "@/lib/tauri/commands"
import { useAppStore } from "@/store/app-store"
import { useMounted } from "@/hooks/use-mounted"
import { CapabilityWorkbench } from "../capability-workbench"
import { SectionStatus } from "../section-status"
import { DesktopOnlyNote } from "../../desktop-only-note"
import { useRunnerCtx } from "../../run/runner-context"
import { scanCleanup, type CleanupScanResult } from "./scan"
import { TrashCard } from "./trash-card"

/** Which CLI process holds a target's files open, for the "close it first" warning. */
const PROCESS_FOR_APP: Record<string, string> = {
  claude: "claude",
  codex: "codex",
  opencode: "opencode",
}

/**
 * Environment cleanup.
 *
 * The section is built around one asymmetry: reading is cheap and reversible,
 * removing is neither. So the scan runs on its own and shows real measured
 * sizes, while every removal leaves here as a step list and goes through the
 * review panel like every other write in this app — the user sees each path and
 * its size again, next to Preview and Apply, before anything moves.
 *
 * Two things are deliberately *not* offered:
 *
 * - **No "clean everything" button.** The quick action adds the `safe` rows to
 *   the selection and nothing else — it selects, it does not clean. A one-click
 *   that also took chat history would train people to click past the one
 *   screen in this section that matters.
 * - **No progress-free bulk mode.** Rows the scan couldn't fully read are marked
 *   as a floor, not rounded up into a confident total.
 */
export function CleanupSection() {
  const t = useT()
  const paths = useAppStore((s) => s.paths)
  const effectiveOS = useAppStore((s) => s.effectiveOS)
  const { run } = useRunnerCtx()
  // isTauri() is false in the pre-rendered HTML, so the note has to wait for
  // mount or it hydration-mismatches — same pairing as every other section.
  const mounted = useMounted()

  const [rows, setRows] = useState<CleanupRow[]>([])
  const [configTargets, setConfigTargets] = useState<CleanupConfigTarget[]>([])
  const [roots, setRoots] = useState<CleanupRoots | null>(null)
  const [trash, setTrash] = useState<QuarantineEntry[]>([])
  const [trashStatus, setTrashStatus] = useState<"loading" | "ready" | "error" | "unavailable">(
    "loading"
  )
  const [trashError, setTrashError] = useState<string | null>(null)
  const [running, setRunning] = useState<Record<string, boolean>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [ageDays, setAgeDays] = useState(0)
  const [mode, setMode] = useState<"quarantine" | "delete">("quarantine")
  const [scanError, setScanError] = useState<string | null>(null)
  // Starts true because the section really is scanning from its first render —
  // the mount effect measures the disk. Deriving it that way (rather than
  // flipping it on inside the effect) keeps the effect free of synchronous
  // state updates, and means the very first paint says "measuring" instead of
  // flashing an empty list that a moment later fills up.
  const [scanning, setScanning] = useState(true)
  const [scanned, setScanned] = useState(false)
  // Which scan is the current one. Changing the age filter twice in a row starts
  // two scans, and without this whichever resolved last would win — leaving
  // sizes measured under the old filter on screen under the new one, and in the
  // review panel after that.
  const scanSeq = useRef(0)

  const refreshTrash = useCallback(async () => {
    if (!isTauri()) {
      setTrashStatus("unavailable")
      return
    }
    setTrashStatus("loading")
    setTrashError(null)
    try {
      setTrash(await cleanupQuarantineList())
      setTrashStatus("ready")
    } catch (error) {
      setTrash([])
      setTrashStatus("error")
      setTrashError(error instanceof Error ? error.message : String(error))
    }
  }, [])

  const rescan = useCallback(
    async (days: number) => {
      // The `await` is unconditional on purpose: the mount effect calls this,
      // and everything below is a setState. Web mode (no machine to measure)
      // awaits `null` and lands on "scanned, nothing found" rather than leaving
      // the spinner up forever beside the desktop-only note.
      const seq = ++scanSeq.current
      setScanError(null)
      let result: CleanupScanResult | null = null
      let failure: string | null = null
      if (isTauri() && paths) {
        try {
          result = await scanCleanup(paths, effectiveOS(), days)
        } catch (error) {
          failure = error instanceof Error ? error.message : String(error)
        }
      }
      // A newer scan has started since: its answer is the one that describes
      // the filter on screen, and `scanning` stays up until it lands.
      if (seq !== scanSeq.current) return
      setRows(result?.rows ?? [])
      setConfigTargets(result?.configTargets ?? [])
      setRoots(result?.roots ?? null)
      // Drop anything that vanished between scans rather than carrying a
      // selection that would build a step for a path that no longer exists.
      const live = new Set([
        ...visibleRows(result?.rows ?? []).map((r) => r.target.id),
        ...(result?.configTargets ?? []).map((c) => c.id),
      ])
      setSelected((prev) => new Set([...prev].filter((id) => live.has(id))))
      setScanning(false)
      setScanned(true)
      setScanError(failure)
    },
    [paths, effectiveOS]
  )

  useEffect(() => {
    // Wrapped rather than called directly so nothing here runs in the effect's
    // synchronous body — same shape as the config-files card's presence probe.
    void (async () => {
      await rescan(ageDays)
      await refreshTrash()
    })()
  }, [rescan, ageDays, refreshTrash])

  // Which agent CLIs are up right now. A running CLI holds its database and log
  // files open, so cleaning underneath it silently skips them (Windows) or
  // leaves it writing to an unlinked inode (Unix) — either way the user needs
  // to be told before they press the button, not after.
  useEffect(() => {
    if (!isTauri()) return
    let cancelled = false
    void (async () => {
      const names = [...new Set(Object.values(PROCESS_FOR_APP))]
      const up = await Promise.all(names.map((n) => isProcessRunning(n).catch(() => false)))
      if (cancelled) return
      setRunning(Object.fromEntries(names.map((n, i) => [n, up[i]])))
    })()
    return () => {
      cancelled = true
    }
  }, [rows])

  const shown = useMemo(() => visibleRows(rows), [rows])
  const apps = useMemo(() => {
    const fromRows = appsPresent(rows)
    // A config-only app (Claude with hooks but no caches yet) still needs its card.
    for (const c of configTargets) if (!fromRows.includes(c.app)) fromRows.push(c.app)
    return fromRows
  }, [rows, configTargets])

  const selectedBytes = totalBytes(shown, selected)
  const selectedFiles = totalFiles(shown, selected)
  const reclaimable = shown.reduce((sum, r) => sum + r.bytes, 0)
  const hasSelection = selected.size > 0
  const safeIds = useMemo(() => safeSelection(rows), [rows])

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  const clean = async () => {
    if (!roots || !paths || !hasSelection) return
    const os = effectiveOS()
    const chosen = shown.filter((r) => selected.has(r.target.id))
    const specs = chosen.flatMap((r) => specsFor(r.target, roots, os, ageDays))
    // One entry per path so the review panel lists exactly what will move, with
    // the size the scan measured for it rather than a per-target total.
    const entries = chosen.flatMap((r) =>
      r.paths.map((path, i) => ({
        path,
        // A multi-path target is measured as a whole; attribute the weight to
        // its first path rather than inventing a split the scan never made.
        bytes: i === 0 ? r.bytes : 0,
        files: i === 0 ? r.files : 0,
      }))
    )

    const steps: StepDescriptor[] = []
    if (specs.length > 0) steps.push(cleanupStep(specs, entries, mode, t))
    for (const target of configTargets) {
      if (selected.has(target.id)) steps.push(cleanupConfigStep(target, paths[target.file], t))
    }
    if (steps.length === 0) return

    const reports = await run(steps, { activity: { title: t.cleanup.title, source: "section" } })
    // Empty means the review panel was closed without applying: nothing moved,
    // so the selection the user built is still exactly what they meant.
    if (reports.length === 0) return
    setSelected(new Set())
    setScanning(true)
    await rescan(ageDays)
    await refreshTrash()
  }

  // Putting a batch back changes what is on disk as much as a clean does, so
  // the targets and "Reclaimable" are re-measured along with the recycle area.
  // The rescan isn't awaited: the card only needs its own list to settle.
  const refreshAfterTrash = useCallback(async () => {
    setScanning(true)
    void rescan(ageDays)
    await refreshTrash()
  }, [rescan, ageDays, refreshTrash])

  const notReady = !isTauri() && mounted
  const diskMeasured = scanned && !scanning && !scanError && isTauri() && !!paths
  // The quick action's own line, which doubles as its disabled reason. While
  // measuring there is none: the summary beside the buttons already says so.
  const quickHint = scanning
    ? null
    : safeIds.length > 0
      ? t.cleanup.quickCleanHint
      : diskMeasured
        ? t.cleanup.quickCleanNone
        : null

  return (
    <CapabilityWorkbench
      title={t.cleanup.title}
      subtitle={t.cleanup.subtitle}
      actions={
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          disabled={scanning || notReady}
          onClick={() => {
            setScanning(true)
            void rescan(ageDays)
          }}
        >
          <RefreshCw className={cn("size-4", scanning && "animate-spin")} />
          {scanning ? t.cleanup.scanning : t.cleanup.scan}
        </Button>
      }
      actionsLabel={t.cleanup.actionsLabel}
      lead={
        <SectionStatus
          label={t.cleanup.summaryLabel}
          facts={[
            {
              label: t.cleanup.metricReclaimable,
              value: diskMeasured ? formatBytes(reclaimable) : "—",
            },
            {
              label: t.cleanup.metricTargets,
              value: diskMeasured ? shown.length + configTargets.length : "—",
            },
            { label: t.cleanup.metricSelected, value: selected.size },
            {
              label: t.cleanup.metricTrash,
              value: trashStatus === "ready" && isTauri() ? trash.length : "—",
            },
          ]}
          notes={[
            diskMeasured
              ? null
              : scanError
                ? t.cleanup.scanFailed(scanError)
                : t.cleanup.metricPending,
            trashStatus === "ready" && isTauri()
              ? null
              : trashStatus === "error"
                ? t.cleanup.metricReadFailed(trashError ?? t.cleanup.trash.unknownError)
                : trashStatus === "unavailable"
                  ? t.cleanup.metricUnavailable
                  : t.cleanup.metricPending,
          ]}
        />
      }
      primary={
        <section aria-label={t.cleanup.targetsPanel} className="flex min-w-0 flex-col gap-4">
          {notReady ? <DesktopOnlyNote>{t.cleanup.notTauri}</DesktopOnlyNote> : null}
          {scanError ? (
            <p role="alert" className="text-sm text-[var(--hm-danger)]">
              {t.cleanup.scanFailed(scanError)}
            </p>
          ) : null}

          {/* Controls that change what the numbers below mean, so they sit above them. */}
          <Card className="flex-row flex-wrap items-center gap-x-6 gap-y-3 p-4">
            <div className="flex min-w-0 basis-full flex-col items-stretch gap-1 sm:basis-auto sm:flex-none sm:flex-row sm:items-center sm:gap-2">
              <Label htmlFor="cleanup-age" className="text-xs text-muted-foreground">
                {t.cleanup.age.label}
              </Label>
              <Select
                value={String(ageDays)}
                onValueChange={(v) => {
                  // The sizes on screen are all filtered by this, so every row is
                  // stale the moment it changes — say "measuring" rather than leave
                  // the old numbers sitting under a new filter.
                  setScanning(true)
                  setAgeDays(Number(v))
                }}
              >
                <SelectTrigger id="cleanup-age" className="h-8 w-full min-w-0 sm:w-[150px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AGE_PRESETS.map((days) => (
                    <SelectItem key={days} value={String(days)}>
                      {days === 0 ? t.cleanup.age.all : t.cleanup.age.days(days)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex min-w-0 basis-full flex-col items-stretch gap-1 sm:basis-auto sm:flex-none sm:flex-row sm:items-center sm:gap-2">
              <Label htmlFor="cleanup-mode" className="text-xs text-muted-foreground">
                {t.cleanup.mode.label}
              </Label>
              <Select value={mode} onValueChange={(v) => setMode(v as "quarantine" | "delete")}>
                {/* Sized to its value, not to a width guessed from the English
                    label — "Move to the recycle area" clipped at 190px. */}
                <SelectTrigger id="cleanup-mode" className="h-8 w-full min-w-0 sm:w-fit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="quarantine">{t.cleanup.mode.quarantine}</SelectItem>
                  <SelectItem value="delete">{t.cleanup.mode.delete}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <p className="basis-full text-xs text-muted-foreground">
              {mode === "quarantine" ? t.cleanup.mode.quarantineHint : t.cleanup.mode.deleteHint}{" "}
              {ageDays > 0 ? t.cleanup.age.note : null}
            </p>
          </Card>

          {/* `diskMeasured`, not `scanned`: in web mode the scan short-circuits
              without ever reaching the disk, and "nothing to clean" printed
              under "there is no machine to scan" is the app asserting a fact it
              didn't measure. Rule 1 of this section — the scan is truth. */}
          {diskMeasured && shown.length === 0 && configTargets.length === 0 ? (
            <div className="rounded-lg border p-5">
              <p className="text-sm">{t.cleanup.empty}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t.cleanup.emptyHint}</p>
            </div>
          ) : null}

          {/* Capped, and scrolls inside itself, like `CapabilityList`: a list's
              length is the machine's, not the design's. Uncapped, twenty-odd
              targets put Clean ~2,500px below the row just ticked. Each app's
              heading sticks, so a scrolled list still says whose files these are. */}
          {apps.length > 0 ? (
            <div className="max-h-(--hm-list-max-h) min-w-0 divide-y overflow-x-hidden overflow-y-auto rounded-lg border">
              {apps.map((app) => {
                const appRows = rowsForApp(shown, app)
                const appConfig = configTargets.filter((c) => c.app === app)
                if (appRows.length === 0 && appConfig.length === 0) return null
                const appBytes = appRows.reduce((sum, r) => sum + r.bytes, 0)
                const proc = PROCESS_FOR_APP[app]
                const isUp = proc ? running[proc] : false
                return (
                  <section key={app} className="flex min-w-0 flex-col gap-3 p-5">
                    <div className="sticky top-0 z-10 -mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 bg-background py-1">
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="whitespace-nowrap text-sm font-medium">
                          {t.cleanup.apps[app] ?? app}
                        </span>
                        <Badge variant="secondary" className="font-normal">
                          {t.cleanup.reclaimable(formatBytes(appBytes))}
                        </Badge>
                      </div>
                      {isUp ? (
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <AlertTriangle className="size-3.5" />
                          {t.cleanup.running(t.cleanup.apps[app] ?? app)}
                        </span>
                      ) : null}
                    </div>

                    <div className="flex flex-col gap-3">
                      {groupByCategory([
                        ...appRows.map((row) => ({
                          category: row.target.category,
                          id: row.target.id,
                          risk: row.target.risk,
                          size: formatBytes(row.bytes),
                          files: row.files,
                          degraded: row.degraded,
                          paths: row.paths,
                        })),
                        ...appConfig.map((target) => ({
                          category: target.category,
                          id: target.id,
                          risk: target.risk,
                          // A config edit removes a key, not bytes. "0 B" would read as
                          // "nothing here"; no size at all is the honest answer.
                          size: null,
                          files: 0,
                          degraded: false,
                          paths: paths ? [paths[target.file]] : [],
                        })),
                      ]).map((group) => (
                        <div key={group.category} className="flex flex-col gap-1.5">
                          <div className="text-xs font-medium text-muted-foreground">
                            {t.cleanup.categories[group.category] ?? group.category}
                          </div>
                          {group.items.map((item) => (
                            <TargetRow
                              key={item.id}
                              {...item}
                              checked={selected.has(item.id)}
                              onChange={(on) => toggle(item.id, on)}
                            />
                          ))}
                        </div>
                      ))}
                    </div>
                  </section>
                )
              })}
            </div>
          ) : null}

          {/* The action bar stays at the bottom of the flow rather than floating:
          the change tray already owns the docked position, and two competing
          bars is how a user ends up applying the wrong one. */}
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={!hasSelection || scanning} onClick={() => void clean()}>
              {t.cleanup.clean}
            </Button>
            {/* Selects, never cleans: it adds the regenerated rows to whatever is
                already ticked, and Clean is still the only way on. */}
            <Button
              variant="outline"
              className="gap-2"
              aria-describedby={quickHint ? "cleanup-quick-hint" : undefined}
              disabled={scanning || safeIds.length === 0}
              onClick={() => setSelected((prev) => new Set([...prev, ...safeIds]))}
            >
              <Sparkles className="size-4" />
              {t.cleanup.quickClean}
            </Button>
            {hasSelection ? (
              <Button variant="ghost" onClick={() => setSelected(new Set())}>
                {t.cleanup.clearSelection}
              </Button>
            ) : null}
            <span className="text-sm text-muted-foreground">
              {scanning
                ? t.cleanup.scanning
                : hasSelection
                  ? t.cleanup.selectedSummary(formatBytes(selectedBytes), selectedFiles)
                  : // Unmeasured (web mode, a failed scan) is not "0 B can be
                    // cleared" — the note or the error above already says why.
                    diskMeasured
                    ? t.cleanup.reclaimable(formatBytes(reclaimable))
                    : null}
            </span>
            {quickHint ? (
              <p id="cleanup-quick-hint" className="basis-full text-xs text-muted-foreground">
                {quickHint}
              </p>
            ) : null}
          </div>
        </section>
      }
      aside={
        <section aria-label={t.cleanup.trashPanel} className="min-w-0">
          <TrashCard
            entries={trash}
            status={trashStatus}
            error={trashError}
            onChanged={refreshAfterTrash}
          />
        </section>
      }
    />
  )
}

/** One cleanup candidate: what it is, what clearing it costs, and how big it is. */
function TargetRow({
  id,
  risk,
  size,
  files,
  degraded,
  paths,
  checked,
  onChange,
}: {
  id: string
  risk: string
  /** Null for a config-key target, which has no size of its own. */
  size: string | null
  files: number
  degraded: boolean
  paths: string[]
  checked: boolean
  onChange: (on: boolean) => void
}) {
  const t = useT()
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-md border p-3",
        "transition-colors duration-(--hm-dur-fast) ease-(--hm-ease-out)",
        checked ? "border-[var(--hm-accent)] bg-accent/40" : "hover:bg-accent/30"
      )}
    >
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        className="mt-0.5"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{targetLabel(t, id)}</span>
          {/* The risk chip is the row's headline, not decoration: "Your data"
              next to a 1.9 GB number is what stops a reflexive tick. Its own
              provider, because this app mounts none globally — HelpTip carries
              one for the same reason. */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant={risk === "safe" ? "secondary" : "outline"}
                  className={cn(
                    "font-normal",
                    risk === "behavioural" && "border-[var(--hm-warn)] text-[var(--hm-warn)]"
                  )}
                >
                  {t.cleanup.risks[risk] ?? risk}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>{t.cleanup.riskHints[risk] ?? ""}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{targetImpact(t, id)}</p>
        <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground/80">
          {paths.join("  ·  ")}
        </p>
      </div>
      <div className="shrink-0 text-right">
        {size ? <div className="text-sm tabular-nums">{size}</div> : null}
        {files > 0 ? (
          <div className="text-xs text-muted-foreground tabular-nums">
            {t.cleanup.fileCount(files)}
          </div>
        ) : null}
        {degraded ? (
          <div className="text-xs text-[var(--hm-warn)]">{t.cleanup.degraded}</div>
        ) : null}
      </div>
    </label>
  )
}
