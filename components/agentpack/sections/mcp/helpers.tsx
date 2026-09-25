"use client"

import { useState } from "react"
import { Check, Copy, Eye, EyeOff, Plus } from "lucide-react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { copyText } from "@/lib/tauri/clipboard"
import { useT } from "@/lib/i18n/provider"
import { MCP_REGISTRY_IDS } from "@/lib/agentpack/scan"
import {
  buildCodexMcpEntryFromSpec,
  buildOpencodeMcpEntryFromSpec,
  mergeCodexMcp,
  mergeOpencodeMcp,
  type McpSpec,
} from "@/lib/agentpack/merge/mcp"
import { MCP_TARGETS, type McpTarget } from "@/lib/agentpack/types"
import type { ClassifiedIds } from "@/lib/agentpack/scan"
import type { DashboardScan } from "../dashboard"

/** The three MCP write targets, in display order (canonical list lives with the types). */
export { MCP_TARGETS }

/**
 * Per-target dot colours — the design system's per-CLI identity tokens.
 *
 * These were three hex literals, which is the one thing design.md § 11 forbids
 * anywhere but `tokens.css`: they ignored the theme, so the dots kept their
 * light-mode chroma on the dark band, and they drifted from the same three
 * colours the history dashboard draws.
 */
export const MCP_TARGET_COLORS: Record<McpTarget, string> = {
  claude: "var(--hm-source-claude)",
  codex: "var(--hm-source-codex)",
  opencode: "var(--hm-source-opencode)",
}

/** Whether a server id is configured on each target. */
export type McpPresence = Record<McpTarget, boolean>

const has = (c: ClassifiedIds, id: string): boolean => c.known.includes(id) || c.custom.includes(id)

/** Derive a server's per-target presence from the shared dashboard scan. */
export function presenceOf(scan: DashboardScan | null, id: string): McpPresence {
  return {
    claude: scan ? has(scan.claudeMcps, id) : false,
    codex: scan ? has(scan.codexMcps, id) : false,
    opencode: scan ? has(scan.opencodeMcps, id) : false,
  }
}

export const anyPresent = (p: McpPresence): boolean => p.claude || p.codex || p.opencode

/** One aggregated row for the Installed tab. */
export interface McpRow {
  id: string
  presence: McpPresence
  /** True when the id is one of the built-in catalog servers. */
  known: boolean
}

/** Every server id present on any target, aggregated into rows. */
export function installedRows(scan: DashboardScan | null): McpRow[] {
  if (!scan) return []
  const ids = new Set<string>()
  for (const c of [scan.claudeMcps, scan.codexMcps, scan.opencodeMcps]) {
    for (const id of c.known) ids.add(id)
    for (const id of c.custom) ids.add(id)
  }
  return [...ids].map((id) => ({
    id,
    presence: presenceOf(scan, id),
    known: MCP_REGISTRY_IDS.includes(id),
  }))
}

/** Ids already configured on any target — used to reject duplicate custom ids. */
export function existingIds(scan: DashboardScan | null): Set<string> {
  return new Set(installedRows(scan).map((r) => r.id))
}

/** A short, secret-masked description of a resolved spec for the config viewer. */
export function describeSpec(spec: McpSpec): string[] {
  if (spec.transport !== "stdio") {
    const lines = [`url: ${spec.url}`]
    for (const k of Object.keys(spec.headers)) lines.push(`header: ${k}: ••••••`)
    if (spec.bearerTokenEnvVar) lines.push(`bearer env: ${spec.bearerTokenEnvVar}`)
    return lines
  }
  const lines = [`command: ${[spec.command, ...spec.args].join(" ")}`]
  for (const k of Object.keys(spec.env)) lines.push(`env: ${k}=••••••`)
  for (const [k, ref] of Object.entries(spec.envRefs ?? {})) lines.push(`env: ${k}=$${ref}`)
  return lines
}

/** One labelled row of a spec for the structured detail viewer. */
export interface SpecField {
  label: string
  /** The real value (copied verbatim); rendered masked when `secret`. */
  value: string
  mono?: boolean
  secret?: boolean
}

/** Field labels the detail viewer passes in (kept out of this pure helper). */
export interface SpecFieldLabels {
  command: string
  url: string
  env: string
  headers: string
  bearerEnv: string
}

/**
 * Break a resolved spec into labelled fields for the structured viewer — the
 * command line + each env var (stdio), or the url + each header + bearer env var
 * (http). Secret-bearing values (env values, header values) are flagged so the
 * view masks them while a copy button still yields the real value.
 */
export function specFields(spec: McpSpec, labels: SpecFieldLabels): SpecField[] {
  if (spec.transport !== "stdio") {
    const out: SpecField[] = [{ label: labels.url, value: spec.url, mono: true }]
    for (const [k, v] of Object.entries(spec.headers))
      out.push({ label: `${labels.headers}: ${k}`, value: v, mono: true, secret: true })
    if (spec.bearerTokenEnvVar)
      out.push({ label: labels.bearerEnv, value: spec.bearerTokenEnvVar, mono: true })
    return out
  }
  const out: SpecField[] = [
    { label: labels.command, value: [spec.command, ...spec.args].join(" "), mono: true },
  ]
  for (const [k, v] of Object.entries(spec.env))
    out.push({ label: `${labels.env}: ${k}`, value: v, mono: true, secret: true })
  // Env references are host var names, not secret values — show them unmasked.
  for (const [k, ref] of Object.entries(spec.envRefs ?? {}))
    out.push({ label: `${labels.env}: ${k}`, value: `$${ref}`, mono: true })
  return out
}

const MASK = "••••••"

/** A copy of a spec with every secret value replaced by a mask (keys kept). */
function maskSpec(spec: McpSpec): McpSpec {
  if (spec.transport !== "stdio") {
    const headers: Record<string, string> = {}
    for (const k of Object.keys(spec.headers)) headers[k] = MASK
    return { ...spec, headers }
  }
  // Only literal env values are secret; `envRefs` are host var names, kept as-is.
  const env: Record<string, string> = {}
  for (const k of Object.keys(spec.env)) env[k] = MASK
  return { ...spec, env }
}

/**
 * Render one server's on-disk entry as the exact text that target writes, with
 * secrets masked — so the viewer can show the real per-target file shape (Codex
 * TOML, OpenCode / Claude JSON) rather than a lossy summary. Pure + unit-testable.
 */
export function rawConfigText(id: string, spec: McpSpec, target: McpTarget): string {
  const masked = maskSpec(spec)
  if (target === "codex") return mergeCodexMcp("", id, buildCodexMcpEntryFromSpec(masked)).trim()
  if (target === "opencode")
    return mergeOpencodeMcp("", id, buildOpencodeMcpEntryFromSpec(masked)).trim()
  // Claude ~/.claude.json `mcpServers.<id>` object.
  let entry: Record<string, unknown>
  if (masked.transport !== "stdio") {
    entry = {
      ...(masked.transport === "sse" ? { type: "sse" } : {}),
      url: masked.url,
      ...(Object.keys(masked.headers).length ? { headers: masked.headers } : {}),
    }
  } else {
    // Claude renders env references inline via ${VAR} expansion.
    const env: Record<string, string> = { ...masked.env }
    for (const [k, ref] of Object.entries(masked.envRefs ?? {})) env[k] = `\${${ref}}`
    entry = {
      command: masked.command,
      args: masked.args,
      ...(Object.keys(env).length ? { env } : {}),
    }
  }
  return JSON.stringify({ mcpServers: { [id]: entry } }, null, 2)
}

/** Copy `value` to the clipboard (the user's own machine → unmasked). */
export function CopyButton({ value, ariaLabel }: { value: string; ariaLabel?: string }) {
  const t = useT().mcp
  const [done, setDone] = useState(false)
  const copy = async () => {
    // Goes through the clipboard-manager plugin under Tauri — `navigator.
    // clipboard` is rejected outright by WebKitGTK, so copying a key silently
    // did nothing on Linux.
    if (await copyText(value)) {
      setDone(true)
      setTimeout(() => setDone(false), 1500)
    }
  }
  return (
    <button
      type="button"
      onClick={() => void copy()}
      title={done ? t.copied : t.copy}
      aria-label={ariaLabel ?? t.copy}
      className="shrink-0 text-muted-foreground transition-colors duration-(--hm-dur-fast) ease-(--hm-ease-out) hover:text-foreground"
    >
      {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  )
}

/** A colored (present) / hollow (absent) target dot. */
export function TargetDot({ target, on }: { target: McpTarget; on: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-2.5 shrink-0 rounded-(--hm-radius-dot)",
        !on && "border border-muted-foreground/50"
      )}
      style={on ? { backgroundColor: MCP_TARGET_COLORS[target] } : undefined}
    />
  )
}

/**
 * Per-target add/remove chips. Clicking a not-installed target adds; clicking an
 * installed one asks to remove — the single-step interaction that replaces the
 * old "tick a checkbox, then press Add now".
 */
export function TargetToggles({
  presence,
  onToggle,
  disabled,
}: {
  presence: McpPresence
  onToggle: (target: McpTarget, installed: boolean) => void
  disabled?: Partial<Record<McpTarget, string>>
}) {
  const t = useT().mcp
  return (
    <div className="flex flex-wrap items-center gap-2">
      {MCP_TARGETS.map((target) => {
        const on = presence[target]
        const dis = disabled?.[target]
        const label = t.targets[target]
        return (
          <button
            key={target}
            type="button"
            disabled={!!dis}
            onClick={() => onToggle(target, on)}
            title={dis ?? (on ? t.removeFromTarget(label) : t.addToTarget(label))}
            className={cn(
              // 6px, not a pill: design.md § 5 puts pills on status dots and
              // count bubbles only, and these are buttons.
              "flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs",
              "transition-colors duration-(--hm-dur-fast) ease-(--hm-ease-out)",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none",
              on
                ? "border-[var(--hm-accent)] bg-[var(--hm-accent-soft)] font-medium text-[var(--hm-ink)]"
                : "text-muted-foreground hover:bg-muted",
              dis && "cursor-not-allowed opacity-50"
            )}
          >
            <TargetDot target={target} on={on} />
            {label}
            {on ? <Check className="size-3" /> : <Plus className="size-3" />}
          </button>
        )
      })}
    </div>
  )
}

/** A password input with a show/hide toggle. */
export function KeyInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  ariaLabel?: string
}) {
  const t = useT().mcp
  const [shown, setShown] = useState(false)
  return (
    <div className="relative">
      <Input
        type={shown ? "text" : "password"}
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pr-9"
      />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        title={shown ? t.hideKey : t.showKey}
        aria-label={shown ? t.hideKey : t.showKey}
        className="absolute top-1/2 right-2.5 -translate-y-1/2 text-muted-foreground hover:text-foreground"
      >
        {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  )
}

/**
 * Where a server is configured, as one dot per target.
 *
 * This replaces the row of `<Badge>`s each installed row used to carry — up to
 * three bordered pills repeating names the scope chips above already spell out.
 * The dots inherit that legend, so the row keeps the fact and spends a tenth of
 * the width on it; the whole group carries one accessible label naming the
 * targets in words, because a colour is not a label.
 */
export function PresenceDots({ presence }: { presence: McpPresence }) {
  const t = useT().mcp
  const on = MCP_TARGETS.filter((target) => presence[target])
  return (
    <span
      className="flex shrink-0 items-center gap-1"
      title={on.map((target) => t.targets[target]).join(" · ")}
      aria-label={
        on.length === 0
          ? t.detailNotConfigured
          : `${t.detailPresence}: ${on.map((target) => t.targets[target]).join(", ")}`
      }
    >
      {MCP_TARGETS.map((target) => (
        <TargetDot key={target} target={target} on={presence[target]} />
      ))}
    </span>
  )
}
