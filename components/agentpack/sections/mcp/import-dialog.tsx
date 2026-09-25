"use client"

import { useMemo, useState } from "react"
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
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { mcpAddSpecStep, mcpEditStep, type ClaudeMcpRoute } from "@/lib/agentpack/plan"
import { runApplied } from "@/lib/agentpack/report"
import { parseMcpImport, type ImportedServer } from "@/lib/agentpack/mcp-import"
import type { McpTarget } from "@/lib/agentpack/types"
import { useRunnerCtx } from "../../run/runner-context"
import type { DashboardScan } from "../dashboard"
import { existingIds, MCP_TARGETS, TargetDot } from "./helpers"

/**
 * Import MCP servers by pasting an `mcpServers` / `mcp` JSON block, a single
 * server object, or a `claude mcp add …` command. Parsing is pure
 * (`parseMcpImport`); this dialog previews the result, warns on id collisions,
 * and writes the chosen servers through the runner (dry-run / backup for free).
 *
 * An id that is already configured is written as an edit, not an add: the
 * collision note promises the import overwrites it, and `claude mcp add`
 * refuses a duplicate id — so it has to remove first, as `mcpEditStep` does.
 */
export function ImportDialog({
  open,
  onOpenChange,
  scan,
  refresh,
  route,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  scan: DashboardScan | null
  refresh: () => void
  /** How Claude's config is reached (`claudeMcpRoute`), decided by the section. */
  route: ClaudeMcpRoute
}) {
  const t = useT()
  const m = t.mcp
  const paths = useAppStore((s) => s.paths)
  const { run } = useRunnerCtx()

  const [text, setText] = useState("")
  const [targets, setTargets] = useState<Set<McpTarget>>(new Set<McpTarget>(["claude"]))

  const taken = useMemo(() => existingIds(scan), [scan])
  const parsed = useMemo(() => parseMcpImport(text), [text])
  const servers: ImportedServer[] = "servers" in parsed ? parsed.servers : []
  const errorCode = "error" in parsed ? parsed.error : null

  // Targets nothing here can write: Claude with no route to it, and Codex when
  // every server pasted is SSE (Codex has no SSE transport). A mixed paste keeps
  // Codex and says, per row, which servers it will skip.
  const allSse = servers.length > 0 && servers.every((s) => s.spec.transport === "sse")
  const disabled: Partial<Record<McpTarget, string>> = {
    ...(route === "none" ? { claude: m.claudeMissing } : {}),
    ...(allSse ? { codex: m.capCodexNoSse } : {}),
  }
  const chosen = [...targets].filter((tg) => !disabled[tg])

  const toggle = (tg: McpTarget) =>
    setTargets((prev) => {
      const next = new Set(prev)
      if (next.has(tg)) next.delete(tg)
      else next.add(tg)
      return next
    })

  const doImport = async () => {
    if (!paths || servers.length === 0 || chosen.length === 0) return
    const steps = servers.flatMap((s) =>
      taken.has(s.id)
        ? mcpEditStep(s.id, s.spec, chosen, paths, t, route)
        : mcpAddSpecStep(s.id, s.spec, chosen, paths, t, route)
    )
    const reports = await run(steps)
    // The paste is the only copy of what was being imported; keep it (and the
    // dialog) until it is actually on disk.
    if (runApplied(reports)) {
      setText("")
      onOpenChange(false)
    }
    refresh()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{m.importDialogTitle}</DialogTitle>
          <DialogDescription>{m.importCardHint}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Textarea
            aria-label={m.importDialogTitle}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={m.importPlaceholder}
            className="min-h-32 font-mono text-xs"
          />

          {text.trim() && errorCode === "parse" ? (
            <p className="text-sm text-destructive">{m.importParseError}</p>
          ) : null}
          {text.trim() && errorCode === "unsupported" ? (
            <p className="text-sm text-destructive">{m.importUnsupported}</p>
          ) : null}

          {servers.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-medium text-muted-foreground">
                {m.importFound(servers.length)}
              </p>
              {servers.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm"
                >
                  <span className="font-medium">{s.id}</span>
                  <Badge variant="outline" className="font-normal text-muted-foreground">
                    {s.spec.transport}
                  </Badge>
                  {s.spec.transport === "sse" && chosen.includes("codex") ? (
                    <span className="text-xs text-muted-foreground">{m.importSkipsCodex}</span>
                  ) : null}
                  {taken.has(s.id) ? (
                    <span className="ml-auto text-xs text-amber-600">{m.importCollision}</span>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label>{m.importSelectTargets}</Label>
            <div className="flex flex-wrap items-center gap-4 text-sm">
              {MCP_TARGETS.map((tg) => {
                const reason = disabled[tg]
                const on = targets.has(tg) && !reason
                return (
                  <label
                    key={tg}
                    title={reason}
                    className={cn(
                      "flex items-center gap-2",
                      reason ? "cursor-not-allowed opacity-50" : "cursor-pointer"
                    )}
                  >
                    <Checkbox checked={on} disabled={!!reason} onCheckedChange={() => toggle(tg)} />
                    <TargetDot target={tg} on={on} />
                    {m.targets[tg]}
                  </label>
                )
              })}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {m.cancel}
          </Button>
          <Button
            disabled={servers.length === 0 || chosen.length === 0}
            onClick={() => void doImport()}
          >
            {m.importButton(servers.length)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
