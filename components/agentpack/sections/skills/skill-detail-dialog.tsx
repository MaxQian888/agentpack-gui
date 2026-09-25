"use client"

import { useEffect, useMemo, useState } from "react"
import { format } from "date-fns"
import { FileText, FolderOpen, Pencil } from "lucide-react"
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { isTauri } from "@/lib/tauri"
import { listSkillFiles, readTextFile } from "@/lib/tauri/commands"
import { openPath, revealPath } from "@/lib/tauri/system"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { skillEditStep, skillPermissionStep, skillVisibilityStep } from "@/lib/agentpack/plan"
import { runApplied } from "@/lib/agentpack/report"
import {
  parseClaudeSkillOverrides,
  parseOpencodeSkillPermissions,
  type ClaudeSkillVisibility,
  type OpencodeSkillPermission,
} from "@/lib/agentpack/merge/skill-config"
import { splitFrontmatter } from "@/lib/skills/frontmatter"
import { invocation, skillCost, toolList } from "@/lib/skills/meta"
import { primaryEntry, SKILL_SOURCES } from "@/lib/skills/browse"
import type { SkillFile, SkillRow } from "@/lib/skills/types"
import { useRunnerCtx } from "../../run/runner-context"
import { MarkdownView } from "../history/markdown-view"

const VISIBILITY_VALUES: ClaudeSkillVisibility[] = ["on", "name-only", "user-invocable-only", "off"]
const PERMISSION_VALUES: OpencodeSkillPermission[] = ["allow", "ask", "deny"]

/** Frontmatter keys rendered elsewhere (header, invocation, highlight rows). */
const RENDERED_KEYS = new Set([
  "name",
  "description",
  "when_to_use",
  "argument-hint",
  "allowed-tools",
  "model",
  "effort",
  "paths",
  "disable-model-invocation",
  "user-invocable",
])

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * SKILL.md viewer + per-agent config. Surfaces structured frontmatter (when-to-use,
 * allowed-tools, model, invocation), the skill's supporting files, an approximate
 * context cost, and an in-app raw editor. The selects write `skillOverrides`
 * (Claude) / `permission.skill` (OpenCode); edits write SKILL.md — all through
 * runner steps so dry-run and backups apply.
 */
export function SkillDetailDialog({
  row,
  open,
  onOpenChange,
  refresh,
}: {
  row: SkillRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
  refresh: () => void
}) {
  const t = useT()
  const sb = t.skillsBrowser
  const paths = useAppStore((s) => s.paths)
  const { run } = useRunnerCtx()

  const entry = row ? primaryEntry(row) : undefined

  // Optimistic post-edit content, keyed by skill path so switching skills resets
  // it during render (no effect) instead of showing a stale edit.
  const [localEdit, setLocalEdit] = useState<{ path: string; md: string } | null>(null)
  const skillMd =
    localEdit && localEdit.path === entry?.path ? localEdit.md : (entry?.skillMd ?? "")
  const doc = useMemo(() => splitFrontmatter(skillMd), [skillMd])
  const cost = useMemo(() => skillCost(skillMd), [skillMd])
  const inv = invocation(doc.attrs)

  // Supporting files, loaded per skill when the dialog opens. Keyed by path so a
  // previous skill's files never bleed into a newly-opened one.
  const [files, setFiles] = useState<{ path: string; list: SkillFile[] } | null>(null)
  const currentFiles = files && files.path === entry?.path ? files.list : null
  useEffect(() => {
    if (!open || !entry || !isTauri()) return
    let cancelled = false
    listSkillFiles(entry.path)
      .then((list) => {
        if (!cancelled) setFiles({ path: entry.path, list })
      })
      .catch(() => {
        if (!cancelled) setFiles({ path: entry.path, list: [] })
      })
    return () => {
      cancelled = true
    }
  }, [open, entry])

  // Current per-agent config values, read fresh each open (both files are tiny).
  // Config keys use the skill NAME, not the dir name.
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

  // In-app editor state. Reset on close via the dialog's onOpenChange handler
  // (an event, not an effect).
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  // Esc or a click on the overlay with unsaved edits asks first: the draft is
  // the only copy of that work, and closing used to drop it without a word.
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const dirty = editing && draft !== skillMd

  // The selects show what is on disk, so they move only once the write has
  // actually happened — not when it was merely staged for review.
  const changeVisibility = async (value: ClaudeSkillVisibility) => {
    if (!row || !paths) return
    const reports = await run([skillVisibilityStep(row.name, value, paths, t)])
    if (runApplied(reports)) setVisibility(value)
  }

  const changePermission = async (value: OpencodeSkillPermission) => {
    if (!row || !paths) return
    const reports = await run([skillPermissionStep(row.name, value, paths, t)])
    if (runApplied(reports)) setPermission(value)
  }

  const startEdit = () => {
    setDraft(skillMd)
    setEditing(true)
  }

  const saveEdit = async () => {
    if (!row || !entry) return
    const reports = await run([skillEditStep(row.dirName, `${entry.path}/SKILL.md`, draft, t)])
    // Not written: stay in the editor with the draft intact.
    if (runApplied(reports)) {
      setLocalEdit({ path: entry.path, md: draft })
      setEditing(false)
    }
    refresh()
  }

  const attrs = doc.attrs
  const extraAttrs = Object.entries(attrs).filter(([k]) => !RENDERED_KEYS.has(k))
  const allowed = toolList(attrs["allowed-tools"])
  const highlights: [string, string | undefined][] = [
    [sb.whenToUseLabel, attrs["when_to_use"]],
    [sb.argumentHintLabel, attrs["argument-hint"]],
    [sb.modelLabel, attrs["model"]],
    [sb.effortLabel, attrs["effort"]],
    [sb.pathsLabel, attrs["paths"]],
  ]

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && dirty) {
          setConfirmDiscard(true)
          return
        }
        if (!o) setEditing(false)
        onOpenChange(o)
      }}
    >
      <DialogContent className="flex h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="border-b px-6 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle>{row?.name}</DialogTitle>
              <DialogDescription className="line-clamp-2">
                {row?.description ?? row?.dirName}
              </DialogDescription>
            </div>
            {entry && isTauri() ? (
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => void revealPath(entry.path)}
                >
                  <FolderOpen className="size-4" /> {sb.revealInFolder}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => void openPath(`${entry.path}/SKILL.md`)}
                >
                  <FileText className="size-4" /> {sb.openSkillMd}
                </Button>
                {!editing ? (
                  <Button variant="ghost" size="sm" className="gap-1.5" onClick={startEdit}>
                    <Pencil className="size-4" /> {sb.edit}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        </DialogHeader>
        {/* Native scroll div on purpose — Radix ScrollArea's display:table wrapper
            widens to the widest child (code blocks) and overflows the dialog. */}
        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-6 py-4">
          {row ? (
            editing ? (
              <div className="flex h-full flex-col gap-3">
                <p className="text-xs text-muted-foreground">{sb.editHint}</p>
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  className="min-h-80 flex-1 font-mono text-xs"
                  spellCheck={false}
                />
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setEditing(false)}>
                    {sb.editCancel}
                  </Button>
                  <Button size="sm" onClick={() => void saveEdit()}>
                    {sb.editSave}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {/* Invocation + cost */}
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border p-3 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">{sb.invocationTitle}</span>
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">/{row.dirName}</code>
                    <Badge variant={inv.model ? "secondary" : "outline"} className="font-normal">
                      {inv.model ? sb.invokeAuto : sb.invokeManual}
                    </Badge>
                    {!inv.user ? (
                      <Badge variant="outline" className="font-normal">
                        {sb.invokeUserHidden}
                      </Badge>
                    ) : null}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {sb.costTitle}: {sb.costLine(cost.bytes, cost.lines, cost.tokens)}
                  </span>
                </div>

                {/* Per-agent configuration */}
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

                {/* Highlighted frontmatter */}
                {highlights.some(([, v]) => v) || allowed.length > 0 ? (
                  <div className="rounded-lg border p-3">
                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
                      {highlights
                        .filter(([, v]) => v)
                        .map(([label, value]) => (
                          <div key={label} className="contents">
                            <dt className="text-muted-foreground">{label}</dt>
                            <dd className="break-words">{value}</dd>
                          </div>
                        ))}
                      {allowed.length > 0 ? (
                        <div className="contents">
                          <dt className="text-muted-foreground">{sb.allowedToolsLabel}</dt>
                          <dd className="flex flex-wrap gap-1">
                            {allowed.map((tool) => (
                              <Badge key={tool} variant="outline" className="font-mono font-normal">
                                {tool}
                              </Badge>
                            ))}
                          </dd>
                        </div>
                      ) : null}
                    </dl>
                  </div>
                ) : null}

                {/* Source locations */}
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
                        {e.origin ? <span>· {sb.sourceRepo(e.origin.repo)}</span> : null}
                        {e.modifiedAt > 0 ? (
                          <span>
                            {sb.detailModified}:{" "}
                            {format(new Date(e.modifiedAt), "yyyy-MM-dd HH:mm")}
                          </span>
                        ) : null}
                      </div>
                    )
                  })}
                </div>

                {/* Supporting files */}
                {currentFiles && currentFiles.length > 0 ? (
                  <div className="rounded-lg border p-3">
                    <p className="mb-2 text-xs font-medium text-muted-foreground">
                      {sb.filesTitle}
                    </p>
                    <ul className="flex flex-col gap-0.5 text-xs">
                      {currentFiles.map((f) => (
                        <li key={f.relPath} className="flex items-center justify-between gap-2">
                          <code className="break-all">{f.relPath}</code>
                          {!f.isDir ? (
                            <span className="shrink-0 text-muted-foreground">
                              {fmtBytes(f.bytes)}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {/* Remaining frontmatter fields */}
                {extraAttrs.length > 0 ? (
                  <details className="rounded-lg border p-3 text-xs">
                    <summary className="cursor-pointer font-medium text-muted-foreground">
                      {sb.allFieldsTitle}
                    </summary>
                    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                      {extraAttrs.map(([key, value]) => (
                        <div key={key} className="contents">
                          <dt className="font-mono text-muted-foreground">{key}</dt>
                          <dd className="break-words">{value}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                ) : null}

                <MarkdownView variant="doc" text={doc.body} />
              </div>
            )
          ) : null}
        </div>

        {/* Esc or the overlay with unsaved edits lands here, not on a closed dialog. */}
        <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{sb.editDiscardTitle}</AlertDialogTitle>
              <AlertDialogDescription>{sb.editDiscardBody}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{sb.editKeep}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  setEditing(false)
                  onOpenChange(false)
                }}
              >
                {sb.editDiscard}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  )
}
