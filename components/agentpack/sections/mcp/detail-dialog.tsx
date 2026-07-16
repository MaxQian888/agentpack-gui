"use client"

import { useEffect, useState } from "react"
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  FileCode2,
  Pencil,
  Play,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { CodeHighlight } from "@/components/agentpack/code-highlight"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { isTauri } from "@/lib/tauri"
import { commandOnPath, probeHost, readTextFile } from "@/lib/tauri/commands"
import { openUrl } from "@/lib/tauri/system"
import { findMcp } from "@/lib/agentpack/registry"
import {
  parseClaudeMcpEntry,
  parseCodexMcpEntry,
  parseOpencodeMcpEntry,
  type McpSpec,
} from "@/lib/agentpack/merge/mcp"
import { checkSpecHealth, type McpHealth } from "@/lib/agentpack/mcp-health"
import type { McpTarget } from "@/lib/agentpack/types"
import type { DashboardScan } from "../dashboard"
import {
  CopyButton,
  MCP_TARGETS,
  presenceOf,
  rawConfigText,
  specFields,
  TargetDot,
} from "./helpers"
import type { CustomFormValue } from "./custom-form"

type Specs = Partial<Record<McpTarget, McpSpec | undefined>>
type HealthState = Partial<Record<McpTarget, McpHealth | "testing">>

/** A collapsible section built on native <details> — no state, fully testable. */
function Foldable({
  label,
  icon,
  children,
}: {
  label: React.ReactNode
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <details className="group mt-2 rounded-md border bg-card">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-1.5 text-xs font-medium text-muted-foreground">
        {icon}
        <span className="min-w-0 truncate">{label}</span>
        <ChevronRight className="ml-auto size-3 shrink-0 transition-transform group-open:rotate-90" />
      </summary>
      <div className="border-t px-3 py-2">{children}</div>
    </details>
  )
}

/** Monospace, scrollable code block for the raw per-target config. */
function CodeBlock({ text, lang }: { text: string; lang?: string }) {
  return (
    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-foreground/90">
      <CodeHighlight code={text} lang={lang} />
    </pre>
  )
}

/**
 * Structured, secret-masked viewer for one MCP server across all three agents.
 * Reads every config file fresh on open, shows each present target's fields with
 * copy buttons + a collapsible raw entry, and can run a lightweight health check
 * (command-on-PATH for stdio, endpoint reachability for http). Custom servers get
 * an Edit button that hands the reconstructed spec back to the caller.
 */
export function McpDetailDialog({
  id,
  open,
  onOpenChange,
  scan,
  onEdit,
}: {
  id: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  scan: DashboardScan | null
  /** Kept for API symmetry with sibling dialogs; the viewer never mutates. */
  refresh?: () => void
  onEdit?: (initial: CustomFormValue) => void
}) {
  const t = useT()
  const m = t.mcp
  const paths = useAppStore((s) => s.paths)
  const [specs, setSpecs] = useState<Specs>({})
  const [health, setHealth] = useState<HealthState>({})

  useEffect(() => {
    if (!open || !id || !paths || !isTauri()) return
    let cancelled = false
    void (async () => {
      const [claudeJson, codexToml, opencodeJson] = await Promise.all([
        readTextFile(paths.claudeConfig).catch(() => ""),
        readTextFile(paths.codexConfig).catch(() => ""),
        readTextFile(paths.opencodeConfig).catch(() => ""),
      ])
      if (cancelled) return
      // Reset any prior server's health results as the new specs land.
      setHealth({})
      setSpecs({
        claude: parseClaudeMcpEntry(claudeJson, id),
        codex: parseCodexMcpEntry(codexToml, id),
        opencode: parseOpencodeMcpEntry(opencodeJson, id),
      })
    })()
    return () => {
      cancelled = true
    }
  }, [open, id, paths])

  if (!id) return null
  const known = findMcp(id)
  const meta = t.catalog.mcp[id]
  const title = meta?.title ?? id
  const presence = presenceOf(scan, id)
  const presentTargets = MCP_TARGETS.filter((tg) => presence[tg])

  const editSpec = presentTargets.map((tg) => specs[tg]).find(Boolean) ?? undefined
  const canEdit = !known && !!onEdit && !!editSpec && presentTargets.length > 0

  const fieldLabels = {
    command: m.fieldCommand,
    url: m.fieldUrl,
    env: m.fieldEnv,
    headers: m.fieldHeaders,
    bearerEnv: m.fieldBearerEnv,
  }

  const testTarget = async (tg: McpTarget) => {
    const spec = specs[tg]
    if (!spec) return
    setHealth((h) => ({ ...h, [tg]: "testing" }))
    const res = await checkSpecHealth(spec, { commandOnPath, probeHost })
    setHealth((h) => ({ ...h, [tg]: res }))
  }
  const testAll = () => {
    for (const tg of presentTargets) if (specs[tg]) void testTarget(tg)
  }

  const healthDetail = (spec: McpSpec, h: McpHealth): string => {
    const cmd = spec.transport === "stdio" ? spec.command : ""
    switch (h.reason) {
      case "cmd-ok":
        return m.healthCmdOk(cmd)
      case "cmd-missing":
        return m.healthCmdMissing(cmd)
      case "http-ok":
        return h.latencyMs != null ? m.healthHttpOk(h.latencyMs) : m.healthHttpReachable
      case "http-unreachable":
        return m.healthHttpUnreachable
      case "bad-url":
        return m.healthBadUrl
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle className="flex items-center gap-2">
            {title}
            <Badge variant="outline" className="font-normal text-muted-foreground">
              {known ? m.bundledBadge : m.customBadge}
            </Badge>
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2">
            {meta?.purpose ?? m.detailConfigTitle}
            {known?.docsUrl ? (
              <button
                type="button"
                onClick={() => void openUrl(known.docsUrl!)}
                className="inline-flex items-center gap-1 text-xs hover:text-foreground"
              >
                {m.docs}
                <ExternalLink className="size-3" />
              </button>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {/* Presence summary across all three agents. */}
          <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
            <span className="text-muted-foreground">{m.detailPresence}</span>
            {MCP_TARGETS.map((tg) => (
              <span
                key={tg}
                className={cn("flex items-center gap-1.5", !presence[tg] && "opacity-40")}
              >
                <TargetDot target={tg} on={presence[tg]} />
                {m.targets[tg]}
              </span>
            ))}
          </div>

          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">{m.detailConfigTitle}</p>
            {presentTargets.length > 0 ? (
              <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={testAll}>
                <Play className="size-3.5" />
                {m.testAll}
              </Button>
            ) : null}
          </div>

          {presentTargets.length === 0 ? (
            <p className="text-sm text-muted-foreground">{m.detailNotConfigured}</p>
          ) : (
            <div className="flex flex-col gap-3">
              {presentTargets.map((tg) => {
                const spec = specs[tg]
                const h = health[tg]
                return (
                  <div key={tg} className="rounded-lg border p-3">
                    <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                      <TargetDot target={tg} on />
                      {m.targets[tg]}
                      <div className="ml-auto flex items-center gap-2">
                        {h === "testing" ? (
                          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Spinner className="size-3.5" />
                            {m.testing}
                          </span>
                        ) : h ? (
                          <span
                            className={cn(
                              "flex items-center gap-1.5 text-xs",
                              h.status === "ok" ? "text-emerald-600" : "text-destructive"
                            )}
                            title={spec ? healthDetail(spec, h) : undefined}
                          >
                            {h.status === "ok" ? (
                              <CheckCircle2 className="size-3.5" />
                            ) : (
                              <AlertTriangle className="size-3.5" />
                            )}
                            {spec ? healthDetail(spec, h) : ""}
                          </span>
                        ) : null}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 gap-1 px-2 text-xs"
                          disabled={!spec}
                          onClick={() => void testTarget(tg)}
                        >
                          <Play className="size-3" />
                          {m.test}
                        </Button>
                      </div>
                    </div>
                    {spec ? (
                      <>
                        <div className="flex flex-col gap-1.5">
                          {specFields(spec, fieldLabels).map((f, i) => (
                            <div key={i} className="flex items-start gap-2 text-xs">
                              <span className="w-32 shrink-0 pt-0.5 text-muted-foreground">
                                {f.label}
                              </span>
                              <span
                                className={cn("min-w-0 flex-1 break-all", f.mono && "font-mono")}
                              >
                                {f.secret ? "••••••" : f.value}
                              </span>
                              <CopyButton value={f.value} ariaLabel={`${m.copy} ${f.label}`} />
                            </div>
                          ))}
                        </div>
                        <Foldable label={m.detailRaw} icon={<FileCode2 className="size-3.5" />}>
                          <CodeBlock
                            text={rawConfigText(id, spec, tg)}
                            lang={tg === "codex" ? "toml" : "json"}
                          />
                        </Foldable>
                      </>
                    ) : (
                      <p className="text-xs text-muted-foreground">✓</p>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {canEdit ? (
          <DialogFooter className="border-t px-6 py-4">
            <Button
              variant="outline"
              className="gap-1.5"
              onClick={() => {
                onEdit!({ id, spec: editSpec!, targets: presentTargets })
                onOpenChange(false)
              }}
            >
              <Pencil className="size-4" />
              {m.edit}
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
