"use client"

import { useMemo, useState } from "react"
import { Check, Copy, Download, Image as ImageIcon } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { isTauri } from "@/lib/tauri"
import { writeBinaryFile, writeTextFile } from "@/lib/tauri/commands"
import { pickSavePath } from "@/lib/tauri/dialog"
import { copyText } from "@/lib/tauri/clipboard"
import { useT } from "@/lib/i18n/provider"
import type { SessionSummary } from "@/lib/history/types"
import type { TimeRange } from "@/lib/history/range"
import {
  buildReport,
  reportFilename,
  reportToMarkdown,
  reportToSvg,
  type ReportLabels,
} from "@/lib/history/report"
import { svgDataUrl, svgToPng } from "./rasterize"

const CARD_W = 1200
const CARD_H = 630

/**
 * "Share" over the range currently on screen.
 *
 * The CSV/JSON exports next to it serve spreadsheets and scripts; this produces
 * the two artifacts a person actually posts — a PNG card and a Markdown
 * summary. Both are rendered from one `ReportData`, so the picture and the text
 * can never disagree.
 */
export function ShareDialog({
  open,
  onOpenChange,
  sessions,
  range,
  rangeLabel,
  now,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessions: SessionSummary[]
  range: TimeRange
  /** Human-readable window, already localized by the caller's range picker. */
  rangeLabel: string
  now: number
}) {
  const t = useT().history
  const r = t.report
  const [copied, setCopied] = useState(false)
  // The outcome of the last save or copy, in words. `ok: false` is an error and
  // reads as one; a failed write must never look like the success line.
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)

  // A fresh dialog starts with no outcome. The dialog stays mounted between
  // openings, so without this the last session's "Saved to …" greeted the next
  // one, describing a file this opening never wrote. Adjusted during render
  // rather than in an effect, so the stale line is never painted first.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setStatus(null)
      setCopied(false)
    }
  }

  const labels: ReportLabels = useMemo(
    () => ({
      title: r.cardTitle,
      periodLabel: rangeLabel,
      cost: r.cost,
      tokens: r.tokens,
      sessions: r.sessions,
      perSession: r.perSession,
      topModels: r.topModels,
      vsPrevious: r.vsPrevious,
      estimatedNote: r.estimatedNote,
      unpricedNote: r.unpricedNote,
      noActivity: r.noActivity,
      footer: r.footer,
      sourceLabel: (source) => t.sources[source] ?? source,
    }),
    [r, rangeLabel, t.sources]
  )

  // `now` is frozen by the caller for the render pass, so the report and the
  // preview can't drift apart mid-dialog.
  const data = useMemo(() => buildReport({ sessions, now, range }), [sessions, now, range])
  const svg = useMemo(() => reportToSvg(data, labels), [data, labels])
  const markdown = useMemo(() => reportToMarkdown(data, labels), [data, labels])

  const copyMarkdown = async () => {
    if (!(await copyText(markdown))) {
      setStatus({ ok: false, text: r.copyFailed })
      return
    }
    setStatus(null)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Both saves share one failure path: a rejected dialog or write says what the
  // system said, instead of an unhandled rejection and a dialog that looks idle.
  const save = async (write: () => Promise<string | null>) => {
    setStatus(null)
    try {
      const path = await write()
      if (path) setStatus({ ok: true, text: r.saved(path) })
    } catch (error) {
      setStatus({
        ok: false,
        text: r.saveFailed(error instanceof Error ? error.message : String(error)),
      })
    }
  }

  const savePng = () =>
    save(async () => {
      if (!isTauri()) return null
      const bytes = await svgToPng(svg, CARD_W, CARD_H)
      if (!bytes) {
        setStatus({ ok: false, text: r.renderFailed })
        return null
      }
      const path = await pickSavePath({
        defaultPath: reportFilename(data, "png"),
        filters: [{ name: "PNG", extensions: ["png"] }],
      })
      if (!path) return null
      await writeBinaryFile(path, bytes)
      return path
    })

  const saveSvg = () =>
    save(async () => {
      if (!isTauri()) return null
      const path = await pickSavePath({
        defaultPath: reportFilename(data, "svg"),
        filters: [{ name: "SVG", extensions: ["svg"] }],
      })
      if (!path) return null
      await writeTextFile(path, svg)
      return path
    })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{r.dialogTitle}</DialogTitle>
          <DialogDescription>{r.dialogSubtitle}</DialogDescription>
        </DialogHeader>

        {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL of
            an SVG we just built in memory; next/image would only add a loader. */}
        <img
          src={svgDataUrl(svg)}
          alt={r.cardTitle}
          width={CARD_W}
          height={CARD_H}
          className="w-full rounded-lg border"
        />

        {status ? (
          <p
            role={status.ok ? "status" : "alert"}
            className={cn(
              "text-xs break-all",
              status.ok ? "text-muted-foreground" : "text-destructive"
            )}
          >
            {status.text}
          </p>
        ) : null}

        <DialogFooter className="sm:justify-start">
          <Button variant="outline" size="sm" className="gap-2" onClick={() => void copyMarkdown()}>
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? r.copied : r.copyMarkdown}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => void savePng()}
            disabled={!isTauri()}
          >
            <ImageIcon className="size-4" />
            {r.savePng}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => void saveSvg()}
            disabled={!isTauri()}
          >
            <Download className="size-4" />
            {r.saveSvg}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
