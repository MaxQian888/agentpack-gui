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
  const [status, setStatus] = useState<string | null>(null)

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
    if (!(await copyText(markdown))) return
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const savePng = async () => {
    if (!isTauri()) return
    const bytes = await svgToPng(svg, CARD_W, CARD_H)
    if (!bytes) {
      setStatus(r.renderFailed)
      return
    }
    const path = await pickSavePath({
      defaultPath: reportFilename(data, "png"),
      filters: [{ name: "PNG", extensions: ["png"] }],
    })
    if (!path) return
    await writeBinaryFile(path, bytes)
    setStatus(r.saved(path))
  }

  const saveSvg = async () => {
    if (!isTauri()) return
    const path = await pickSavePath({
      defaultPath: reportFilename(data, "svg"),
      filters: [{ name: "SVG", extensions: ["svg"] }],
    })
    if (!path) return
    await writeTextFile(path, svg)
    setStatus(r.saved(path))
  }

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

        {status ? <p className="text-xs break-all text-muted-foreground">{status}</p> : null}

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
