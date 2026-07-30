/**
 * The shareable usage report: one Markdown document and one self-contained SVG
 * card built from the same `ReportData`.
 *
 * Why a card at all — the dashboard's numbers are the reason someone opens this
 * app, but they are locked inside it. CSV and JSON (see `export.ts`) serve
 * spreadsheets and scripts; neither is something a person posts. The SVG is
 * rasterised to PNG by the caller and is the only artifact that travels.
 *
 * Everything here is pure: no Tauri, no DOM, no `Date.now()`. Display strings
 * arrive via `ReportLabels` so the card renders in whichever locale the app is
 * running — the CSV/JSON exports keep their machine-readable English keys.
 *
 * The SVG references no external font, image or stylesheet, both because the
 * app's CSP forbids it and because a card that has to fetch something cannot be
 * drawn onto a canvas.
 */
import type { HistorySource, SessionSummary } from "./types"
import { computeUsageStats } from "./stats"
import { sessionsInRange } from "./insights"
import { computeSpend, computeSpendIn, dailyCostSeries, type SpendSummary } from "./spend"
import { formatCost, formatNumber, formatTokens } from "./format"
import { SOURCE_COLORS } from "./display"
import type { RangePreset, TimeRange } from "./range"

export interface ReportModel {
  model: string
  cost: number
  tokens: number
}

export interface ReportData {
  generatedAt: number
  spend: SpendSummary
  /** Zero-filled daily cost, oldest first — the sparkline's columns. */
  daily: { day: string; cost: number }[]
  /** Top three models by cost in the window. */
  topModels: ReportModel[]
}

/** Every human-readable string on the card, supplied by the caller's catalog. */
export interface ReportLabels {
  title: string
  periodLabel: string
  cost: string
  tokens: string
  sessions: string
  perSession: string
  topModels: string
  vsPrevious: string
  estimatedNote: string
  unpricedNote: (n: number) => string
  noActivity: string
  footer: string
  /** Display name for a CLI ("claude" → "Claude Code"). */
  sourceLabel: (source: HistorySource) => string
}

export function buildReport(args: {
  sessions: SessionSummary[]
  now: number
  /** Ignored when `range` is supplied. */
  preset?: Exclude<RangePreset, "custom">
  /** An already-resolved window — what the usage dashboard's picker produces. */
  range?: TimeRange
}): ReportData {
  const { sessions, now, preset = "month", range } = args
  const spend = range ? computeSpendIn(sessions, range) : computeSpend(sessions, now, preset)
  const stats = computeUsageStats(sessionsInRange(sessions, spend.range))
  return {
    generatedAt: now,
    spend,
    daily: dailyCostSeries(sessions, spend.range),
    topModels: [...stats.byModel]
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 3)
      .map((m) => ({ model: m.model, cost: m.cost, tokens: m.usage.total })),
  }
}

/** Signed percentage, e.g. "+18%" / "-4%". `null` renders as an em dash. */
export function formatDelta(pct: number | null): string {
  if (pct == null) return "—"
  const rounded = Math.round(pct)
  return `${rounded > 0 ? "+" : ""}${rounded}%`
}

// --- Markdown ---------------------------------------------------------------

export function reportToMarkdown(data: ReportData, labels: ReportLabels): string {
  const { spend } = data
  const lines: string[] = []
  lines.push(`# ${labels.title}`)
  lines.push("")
  lines.push(`> ${labels.periodLabel}`)
  lines.push("")

  if (!spend.hasActivity) {
    lines.push(labels.noActivity)
    lines.push("")
    lines.push(`— ${labels.footer}`)
    return lines.join("\n")
  }

  lines.push(`| | |`)
  lines.push(`| --- | --- |`)
  lines.push(`| **${labels.cost}** | **${formatCost(spend.cost)}** |`)
  lines.push(`| ${labels.tokens} | ${formatNumber(spend.tokens)} |`)
  lines.push(`| ${labels.sessions} | ${formatNumber(spend.sessions)} |`)
  if (spend.deltaPct != null) {
    lines.push(`| ${labels.vsPrevious} | ${formatDelta(spend.deltaPct)} |`)
  }
  lines.push("")

  if (spend.bySource.length > 0) {
    for (const s of spend.bySource) {
      lines.push(
        `- **${labels.sourceLabel(s.source)}** — ${formatCost(s.cost)} · ${formatTokens(s.tokens)}`
      )
    }
    lines.push("")
  }

  if (data.topModels.length > 0) {
    lines.push(`### ${labels.topModels}`)
    lines.push("")
    for (const m of data.topModels) {
      lines.push(`- \`${m.model}\` — ${formatCost(m.cost)} · ${formatTokens(m.tokens)}`)
    }
    lines.push("")
  }

  // Caveats last and always: a number posted without them invites being read as
  // an invoice.
  if (spend.estimatedCost > 0) lines.push(`_${labels.estimatedNote}_`)
  if (spend.unpricedTranscripts > 0) {
    lines.push(`_${labels.unpricedNote(spend.unpricedTranscripts)}_`)
  }
  lines.push("")
  lines.push(`— ${labels.footer}`)
  return lines.join("\n")
}

// --- SVG card ---------------------------------------------------------------

const CARD_W = 1200
const CARD_H = 630

/**
 * A system-font stack: the card must render identically without loading
 * anything, and must not fall back to a glyphless box for CJK.
 */
const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif"

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

/** Clip an over-long label so it can't overflow its column. */
function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`
}

function statTile(x: number, label: string, value: string): string {
  return `
    <text x="${x}" y="392" font-family="${FONT}" font-size="22" fill="#94a3b8">${escapeXml(label)}</text>
    <text x="${x}" y="440" font-family="${FONT}" font-size="40" font-weight="600" fill="#e2e8f0">${escapeXml(value)}</text>`
}

/**
 * Daily-cost columns. Heights are scaled to the window's own maximum, so the
 * shape reads as "which days were heavy", never as an absolute scale — there is
 * no axis on a card this size and a labelled one would be a lie.
 */
function sparkline(daily: { day: string; cost: number }[]): string {
  if (daily.length === 0) return ""
  const x0 = 64
  const width = CARD_W - 128
  const baseline = 560
  const maxH = 70
  const max = Math.max(...daily.map((d) => d.cost))
  const slot = width / daily.length
  const barW = Math.max(2, Math.min(18, slot * 0.7))
  return daily
    .map((d, i) => {
      // A day with real but tiny spend still gets a visible stub, so "quiet" and
      // "nothing at all" stay distinguishable.
      const h = max > 0 && d.cost > 0 ? Math.max(3, (d.cost / max) * maxH) : 0
      if (h === 0) return ""
      const x = x0 + i * slot + (slot - barW) / 2
      return `<rect x="${x.toFixed(1)}" y="${(baseline - h).toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="#38bdf8" opacity="0.85"/>`
    })
    .join("")
}

function sourceChips(spend: SpendSummary, labels: ReportLabels): string {
  return spend.bySource
    .slice(0, 3)
    .map((s, i) => {
      const x = 64 + i * 240
      return `
    <circle cx="${x + 7}" cy="596" r="7" fill="${SOURCE_COLORS[s.source]}"/>
    <text x="${x + 24}" y="601" font-family="${FONT}" font-size="20" fill="#94a3b8">${escapeXml(
      truncate(labels.sourceLabel(s.source), 12)
    )} ${escapeXml(formatCost(s.cost))}</text>`
    })
    .join("")
}

export function reportToSvg(data: ReportData, labels: ReportLabels): string {
  const { spend } = data
  const perSession = spend.sessions > 0 ? spend.cost / spend.sessions : 0

  const deltaText =
    spend.deltaPct == null
      ? ""
      : `<text x="${64 + measureBig(formatCost(spend.cost)) + 28}" y="300" font-family="${FONT}" font-size="28" font-weight="600" fill="${
          spend.deltaPct > 0 ? "#f87171" : "#4ade80"
        }">${escapeXml(formatDelta(spend.deltaPct))}</text>
    <text x="${64 + measureBig(formatCost(spend.cost)) + 28}" y="332" font-family="${FONT}" font-size="18" fill="#64748b">${escapeXml(
      labels.vsPrevious
    )}</text>`

  const caveats: string[] = []
  if (spend.estimatedCost > 0) caveats.push(labels.estimatedNote)
  if (spend.unpricedTranscripts > 0) caveats.push(labels.unpricedNote(spend.unpricedTranscripts))

  const body = spend.hasActivity
    ? `
    <text x="64" y="300" font-family="${FONT}" font-size="96" font-weight="700" fill="#f8fafc">${escapeXml(
      formatCost(spend.cost)
    )}</text>
    ${deltaText}
    ${statTile(64, labels.tokens, formatTokens(spend.tokens))}
    ${statTile(424, labels.sessions, formatNumber(spend.sessions))}
    ${statTile(784, labels.perSession, formatCost(perSession))}
    ${sparkline(data.daily)}
    ${sourceChips(spend, labels)}`
    : `
    <text x="64" y="300" font-family="${FONT}" font-size="40" font-weight="600" fill="#94a3b8">${escapeXml(
      labels.noActivity
    )}</text>`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}" role="img" aria-label="${escapeXml(
    labels.title
  )}">
  <rect width="${CARD_W}" height="${CARD_H}" fill="#0f172a"/>
  <rect x="0" y="0" width="${CARD_W}" height="6" fill="#38bdf8"/>
  <text x="64" y="104" font-family="${FONT}" font-size="34" font-weight="600" fill="#e2e8f0">${escapeXml(
    labels.title
  )}</text>
  <text x="64" y="146" font-family="${FONT}" font-size="22" fill="#64748b">${escapeXml(
    labels.periodLabel
  )}</text>
  <text x="${CARD_W - 64}" y="104" text-anchor="end" font-family="${FONT}" font-size="26" font-weight="600" fill="#38bdf8">agentpack</text>
  ${body}
  <!-- Above the sparkline, not beside the source chips: right-anchored at the
       card edge it would run back into the third chip. -->
  <text x="${CARD_W - 64}" y="474" text-anchor="end" font-family="${FONT}" font-size="18" fill="#475569">${escapeXml(
    caveats.join(" · ")
  )}</text>
  <text x="${CARD_W - 64}" y="601" text-anchor="end" font-family="${FONT}" font-size="18" fill="#475569">${escapeXml(
    labels.footer
  )}</text>
</svg>`
}

/**
 * Rough advance width of the headline figure, so the delta badge can sit beside
 * it. SVG has no text metrics without a DOM and the card is drawn off-screen, so
 * this approximates: the string is digits, "$" and "." at ~0.58em of 96px.
 */
function measureBig(s: string): number {
  return Math.round(s.length * 96 * 0.58)
}

/** `agentpack-usage-2026-07.png` — stable, sorts chronologically. */
export function reportFilename(data: ReportData, ext: "png" | "svg" | "md"): string {
  const d = new Date(data.generatedAt)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  const stamp = data.spend.range.preset === "month" ? `${y}-${m}` : `${y}-${m}-${day}`
  return `agentpack-usage-${stamp}.${ext}`
}
