"use client"

import { useState } from "react"
import { Check, Eye, EyeOff, Plus } from "lucide-react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/provider"
import { MCP_REGISTRY_IDS } from "@/lib/agentpack/scan"
import type { McpSpec } from "@/lib/agentpack/merge/mcp"
import type { McpTarget } from "@/lib/agentpack/types"
import type { ClassifiedIds } from "@/lib/agentpack/scan"
import type { DashboardScan } from "../dashboard"

/** The three MCP write targets, in display order. */
export const MCP_TARGETS: readonly McpTarget[] = ["claude", "codex", "opencode"]

/** Per-target dot colors — shared with the skills/history source palette. */
export const MCP_TARGET_COLORS: Record<McpTarget, string> = {
  claude: "#d97757",
  codex: "#10a37f",
  opencode: "#8b5cf6",
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
  if (spec.transport === "http") {
    const lines = [`url: ${spec.url}`]
    for (const k of Object.keys(spec.headers)) lines.push(`header: ${k}: ••••••`)
    if (spec.bearerTokenEnvVar) lines.push(`bearer env: ${spec.bearerTokenEnvVar}`)
    return lines
  }
  const lines = [`command: ${[spec.command, ...spec.args].join(" ")}`]
  for (const k of Object.keys(spec.env)) lines.push(`env: ${k}=••••••`)
  return lines
}

/** A colored (present) / hollow (absent) target dot. */
export function TargetDot({ target, on }: { target: McpTarget; on: boolean }) {
  return (
    <span
      aria-hidden
      className={cn("size-2.5 shrink-0 rounded-full", !on && "border border-muted-foreground/50")}
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
              "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors",
              on ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent/40",
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

/** A compact stat tile for the header strip (dashboard idiom, violet MCP tint). */
export function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border p-3">
      <div className="flex flex-col">
        <span className="text-2xl font-semibold tabular-nums">{value}</span>
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
    </div>
  )
}
