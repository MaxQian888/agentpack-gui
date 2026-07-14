"use client"

import { useEffect, useState } from "react"
import { ExternalLink, Pencil } from "lucide-react"
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
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { isTauri } from "@/lib/tauri"
import { readTextFile } from "@/lib/tauri/commands"
import { openUrl } from "@/lib/tauri/system"
import { findMcp } from "@/lib/agentpack/registry"
import {
  parseClaudeMcpEntry,
  parseCodexMcpEntry,
  parseOpencodeMcpEntry,
  type McpSpec,
} from "@/lib/agentpack/merge/mcp"
import type { McpTarget } from "@/lib/agentpack/types"
import type { DashboardScan } from "../dashboard"
import { describeSpec, MCP_TARGETS, presenceOf, TargetDot } from "./helpers"
import type { CustomFormValue } from "./custom-form"

type Specs = Partial<Record<McpTarget, McpSpec | undefined>>

/**
 * Read-only "what's actually on disk" viewer for one MCP server, opened from the
 * Catalog and Installed tabs. Reads all three config files fresh on open (they
 * are tiny) and shows the resolved spec per target. Custom servers get an Edit
 * button that hands the reconstructed spec back to the caller.
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
  /** Kept for API symmetry with sibling dialogs; the viewer is read-only. */
  refresh?: () => void
  onEdit?: (initial: CustomFormValue) => void
}) {
  const t = useT()
  const m = t.mcp
  const paths = useAppStore((s) => s.paths)
  const [specs, setSpecs] = useState<Specs>({})

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

  // Reconstruct a spec for editing: prefer the first present target's on-disk
  // entry (claude → codex → opencode).
  const editSpec = presentTargets.map((tg) => specs[tg]).find(Boolean) ?? undefined
  const canEdit = !known && !!onEdit && !!editSpec && presentTargets.length > 0

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
          <p className="mb-2 text-xs font-medium text-muted-foreground">{m.detailConfigTitle}</p>
          {presentTargets.length === 0 ? (
            <p className="text-sm text-muted-foreground">{m.detailNotConfigured}</p>
          ) : (
            <div className="flex flex-col gap-3">
              {presentTargets.map((tg) => {
                const spec = specs[tg]
                return (
                  <div key={tg} className="rounded-lg border p-3">
                    <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                      <TargetDot target={tg} on />
                      {m.targets[tg]}
                    </div>
                    {spec ? (
                      <pre className="overflow-x-auto text-xs text-muted-foreground">
                        {describeSpec(spec).join("\n")}
                      </pre>
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
