"use client"

import { useMemo, useState } from "react"
import { toast } from "sonner"
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
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { mcpAddSpecStep } from "@/lib/agentpack/plan"
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
 */
export function ImportDialog({
  open,
  onOpenChange,
  scan,
  refresh,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  scan: DashboardScan | null
  refresh: () => void
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

  const toggle = (tg: McpTarget) =>
    setTargets((prev) => {
      const next = new Set(prev)
      if (next.has(tg)) next.delete(tg)
      else next.add(tg)
      return next
    })

  const doImport = async () => {
    if (!paths || servers.length === 0 || targets.size === 0) return
    const tg = [...targets]
    const steps = servers.flatMap((s) => mcpAddSpecStep(s.id, s.spec, tg, paths, t))
    await run(steps)
    toast.success(m.importDone(servers.length))
    setText("")
    onOpenChange(false)
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
              {MCP_TARGETS.map((tg) => (
                <label key={tg} className="flex cursor-pointer items-center gap-2">
                  <Checkbox checked={targets.has(tg)} onCheckedChange={() => toggle(tg)} />
                  <TargetDot target={tg} on={targets.has(tg)} />
                  {m.targets[tg]}
                </label>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {m.cancel}
          </Button>
          <Button
            disabled={servers.length === 0 || targets.size === 0}
            onClick={() => void doImport()}
          >
            {m.importButton(servers.length)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
