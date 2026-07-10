"use client"

import { useEffect, useMemo, useState } from "react"
import { format } from "date-fns"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { isTauri } from "@/lib/tauri"
import { readTextFile } from "@/lib/tauri/commands"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { skillPermissionStep, skillVisibilityStep } from "@/lib/agentpack/plan"
import {
  parseClaudeSkillOverrides,
  parseOpencodeSkillPermissions,
  type ClaudeSkillVisibility,
  type OpencodeSkillPermission,
} from "@/lib/agentpack/merge/skill-config"
import { splitFrontmatter } from "@/lib/skills/frontmatter"
import { primaryEntry, SKILL_SOURCES } from "@/lib/skills/browse"
import type { SkillRow } from "@/lib/skills/types"
import { useRunnerCtx } from "../../run/runner-context"
import { MarkdownView } from "../history/markdown-view"

const VISIBILITY_VALUES: ClaudeSkillVisibility[] = ["on", "name-only", "user-invocable-only", "off"]
const PERMISSION_VALUES: OpencodeSkillPermission[] = ["allow", "ask", "deny"]

/**
 * SKILL.md viewer + per-agent config. Frontmatter renders as a key/value card,
 * the body as document-style markdown; the selects write `skillOverrides`
 * (Claude) / `permission.skill` (OpenCode) through runner steps so dry-run and
 * backups apply.
 */
export function SkillDetailDialog({
  row,
  open,
  onOpenChange,
}: {
  row: SkillRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const t = useT()
  const sb = t.skillsBrowser
  const paths = useAppStore((s) => s.paths)
  const { run } = useRunnerCtx()

  const entry = row ? primaryEntry(row) : undefined
  const doc = useMemo(() => (entry ? splitFrontmatter(entry.skillMd) : null), [entry])

  // Current config values, read fresh each time the dialog opens (both files are
  // tiny). Config keys use the skill NAME, not the dir name.
  const [visibility, setVisibility] = useState<string>("on")
  const [permission, setPermission] = useState<string>("allow")
  useEffect(() => {
    if (!open || !row || !paths || !isTauri()) return
    let cancelled = false
    readTextFile(paths.claudeSettings)
      .then((text) => {
        if (!cancelled) setVisibility(parseClaudeSkillOverrides(text)[row.name] ?? "on")
      })
      .catch(() => {})
    readTextFile(paths.opencodeConfig)
      .then((text) => {
        if (!cancelled) setPermission(parseOpencodeSkillPermissions(text)[row.name] ?? "allow")
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [open, row, paths])

  const changeVisibility = async (value: ClaudeSkillVisibility) => {
    if (!row || !paths) return
    setVisibility(value)
    await run([skillVisibilityStep(row.name, value, paths, t)])
  }

  const changePermission = async (value: OpencodeSkillPermission) => {
    if (!row || !paths) return
    setPermission(value)
    await run([skillPermissionStep(row.name, value, paths, t)])
  }

  const attrs = doc ? Object.entries(doc.attrs) : []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>{row?.name}</DialogTitle>
          <DialogDescription className="line-clamp-2">
            {row?.description ?? row?.dirName}
          </DialogDescription>
        </DialogHeader>
        {/* Native scroll div on purpose — Radix ScrollArea's display:table wrapper
            widens to the widest child (code blocks) and overflows the dialog. */}
        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-6 py-4">
          {row ? (
            <div className="flex flex-col gap-4">
              <div className="rounded-lg border p-3">
                <p className="mb-2 text-xs font-medium text-muted-foreground">{sb.configTitle}</p>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                  <label className="flex items-center gap-2">
                    <span className="text-muted-foreground">{sb.visibilityLabel}</span>
                    <Select
                      value={visibility}
                      onValueChange={(v) => void changeVisibility(v as ClaudeSkillVisibility)}
                    >
                      <SelectTrigger size="sm" className="w-44">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {VISIBILITY_VALUES.map((v) => (
                          <SelectItem key={v} value={v}>
                            {sb.visibility[v]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  <label className="flex items-center gap-2">
                    <span className="text-muted-foreground">{sb.permissionLabel}</span>
                    <Select
                      value={permission}
                      onValueChange={(v) => void changePermission(v as OpencodeSkillPermission)}
                    >
                      <SelectTrigger size="sm" className="w-36">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PERMISSION_VALUES.map((v) => (
                          <SelectItem key={v} value={v}>
                            {sb.permission[v]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{sb.configHint}</p>
              </div>

              <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                {SKILL_SOURCES.filter((s) => row.entries[s]).map((s) => {
                  const e = row.entries[s]!
                  return (
                    <div key={s} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <Badge variant="outline" className="font-normal">
                        {sb.sources[s]}
                      </Badge>
                      <code className="break-all">{e.path}</code>
                      {e.isSymlink && e.linkTarget ? (
                        <span>
                          → <code className="break-all">{e.linkTarget}</code>
                        </span>
                      ) : null}
                      {e.modifiedAt > 0 ? (
                        <span>
                          {sb.detailModified}: {format(new Date(e.modifiedAt), "yyyy-MM-dd HH:mm")}
                        </span>
                      ) : null}
                    </div>
                  )
                })}
              </div>

              {attrs.length > 0 ? (
                <div className="rounded-lg border p-3">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">
                    {sb.frontmatterTitle}
                  </p>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
                    {attrs.map(([key, value]) => (
                      <div key={key} className="contents">
                        <dt className="font-mono text-muted-foreground">{key}</dt>
                        <dd className="break-words">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ) : null}

              {doc ? <MarkdownView variant="doc" text={doc.body} /> : null}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
