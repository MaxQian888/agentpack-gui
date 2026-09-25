"use client"

import { useMemo, useState } from "react"
import { Pencil, TriangleAlert } from "lucide-react"
import { toast } from "sonner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { ConfigFileDef } from "@/lib/agentpack/config-editor/files"
import type { ConfigDoc } from "@/lib/agentpack/config-editor/schema"
import { specFromClaudeRecord } from "@/lib/agentpack/merge/mcp"
import { runApplied } from "@/lib/agentpack/report"
import { useT } from "@/lib/i18n/provider"
import { readTextFile } from "@/lib/tauri/commands"
import { useRunnerCtx } from "../run/runner-context"
import { CodeEditor } from "./code-editor"
import { ConfigFormFields } from "./config-form"

/**
 * Read-only listing of a doc's `mcpServers`. Used for `~/.claude.json`, which
 * agentpack refuses to form-edit: the Claude CLI rewrites that file while it
 * runs, so a read-modify-write can swallow whatever it wrote in between. Showing
 * what's there and pointing at the MCP section is the honest amount of help.
 */
function McpInventory({ doc, onOpenMcp }: { doc: ConfigDoc | null; onOpenMcp?: () => void }) {
  const t = useT().configFiles
  const raw = doc?.["mcpServers"]
  const entries =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? Object.entries(raw as Record<string, unknown>)
      : []
  const rows = entries.flatMap(([id, value]) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return []
    const spec = specFromClaudeRecord(value as Record<string, unknown>)
    if (!spec) return []
    return [
      {
        id,
        transport: spec.transport,
        target: spec.transport === "stdio" ? spec.command : spec.url,
      },
    ]
  })

  return (
    <div className="space-y-3">
      <div className="text-xs font-medium">{t.mcpInventoryTitle}</div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.mcpInventoryEmpty}</p>
      ) : (
        <div className="flex flex-col gap-1">
          {rows.map((r) => (
            <div
              key={r.id}
              className="flex items-center justify-between gap-3 rounded-md border p-2 text-xs"
            >
              <span className="font-medium">{r.id}</span>
              <Badge variant="secondary" className="font-normal">
                {r.transport}
              </Badge>
              <span className="flex-1 truncate text-right font-mono text-muted-foreground">
                {r.target}
              </span>
            </div>
          ))}
        </div>
      )}
      {onOpenMcp ? (
        <Button size="sm" variant="outline" onClick={onOpenMcp}>
          {t.openMcp}
        </Button>
      ) : null}
    </div>
  )
}

interface Props {
  def: ConfigFileDef
  /** Absolute path of the file, resolved from `Paths[def.pathKey]`. */
  path: string
  /** Whether the file exists — decides Edit vs Create wording and initial text. */
  exists: boolean
  /**
   * The presence probe hasn't answered yet. The trigger waits rather than
   * guessing: offering Create for a file that is there would open it seeded
   * with `{}` instead of its contents.
   */
  probing?: boolean
  /** Called after a successful save so the caller can re-scan. */
  onSaved: () => void
  /** Navigates to the MCP section (the `~/.claude.json` inventory's escape). */
  onOpenMcp?: () => void
}

/**
 * Dual-mode editor for one agent CLI config file.
 *
 * The raw text is the single source of truth and is what gets written, so a file
 * the user only *reads* round-trips byte-for-byte — which is why Save stays
 * disabled until something actually changed. Only a form edit re-serializes the
 * parsed doc (and for TOML, that is where comments are lost).
 *
 * Saving stages a `mergeFile` step and goes through the review panel like every
 * other write (design.md § 1): the runner takes the `.agentpack.bak` on first
 * touch, the preview names the file without writing it, and the run lands in
 * the activity log.
 */
export function ConfigFileEditor({ def, path, exists, probing, onSaved, onOpenMcp }: Props) {
  const t = useT().configFiles
  const { run } = useRunnerCtx()
  const [open, setOpen] = useState(false)
  const [raw, setRaw] = useState("")
  // What the editor opened with — the dirty baseline. For a missing file that
  // is the seeded `{}`, which is not what the disk holds.
  const [loaded, setLoaded] = useState("")
  // What the disk actually held at load — the drift baseline. Kept apart from
  // `loaded` because a missing file reads as "" while the editor shows `{}`, and
  // comparing the two turned every Create into a false "changed on disk".
  const [disk, setDisk] = useState("")
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [conflict, setConflict] = useState<string | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  const doc = useMemo(() => def.format.parse(raw), [def, raw])
  const dirty = raw !== loaded
  const tooLarge = raw.length > def.rawLimitBytes
  const fileName = t.files[def.id].title

  const load = async () => {
    setLoading(true)
    setConflict(null)
    try {
      const text = exists ? await readTextFile(path) : ""
      // Seed a brand-new file from the format itself, so JSON opens as `{}` and
      // never as an empty string the parser would reject on save.
      const seeded = text.trim() ? text : def.format.serialize({})
      setRaw(seeded)
      setLoaded(seeded)
      setDisk(text)
    } catch {
      toast.error(t.loadFailed)
      setOpen(false)
    } finally {
      setLoading(false)
    }
  }

  /**
   * Stage the write against `baseline`, the disk text the user decided over.
   * The runner re-reads right before writing and refuses if the file moved
   * again while the review panel was open — the same guard as `save`, held
   * until the moment it matters.
   */
  const write = async (baseline: string) => {
    setSaving(true)
    try {
      const content = raw.endsWith("\n") ? raw : `${raw}\n`
      const reports = await run(
        [
          {
            kind: "mergeFile",
            id: `config-file-${def.id}`,
            label: t.stepLabel(path),
            path,
            merge: (existing) => {
              if (existing !== baseline) throw new Error(t.conflictBody)
              return content
            },
            writtenNote: t.saved(fileName),
          },
        ],
        { activity: { title: t.saved(fileName), source: "section" } }
      )
      // Walked away from the panel, or stopped it: nothing was written, and the
      // edits are still here to try again with.
      if (!runApplied(reports)) {
        if (reports.some((r) => r.status === "error")) toast.error(t.saveFailed)
        return
      }
      setLoaded(raw)
      setDisk(content)
      setConflict(null)
      // Silent: the review panel the save just went through says "All set".
      setOpen(false)
      onSaved()
    } catch {
      toast.error(t.saveFailed)
    } finally {
      setSaving(false)
    }
  }

  const save = async () => {
    if (!def.format.parse(raw)) {
      toast.error(def.format.lang === "json" ? t.invalidJson : t.invalidToml)
      return
    }
    // Re-read rather than trusting the load-time snapshot: these files have other
    // writers (the CLIs themselves, cc-switch), and silently overwriting whatever
    // they wrote while the dialog sat open is the one unrecoverable mistake here.
    let onDisk: string
    try {
      onDisk = await readTextFile(path)
    } catch {
      toast.error(t.loadFailed)
      return
    }
    if (onDisk !== disk) {
      setConflict(onDisk)
      return
    }
    await write(onDisk)
  }

  const requestClose = (next: boolean) => {
    if (!next && dirty) {
      setConfirmDiscard(true)
      return
    }
    setOpen(next)
    if (next) void load()
  }

  return (
    <>
      <Dialog open={open} onOpenChange={requestClose}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1" disabled={probing}>
            <Pencil className="size-3.5" />
            {probing ? t.checking : exists ? t.edit : t.create}
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{fileName}</DialogTitle>
            <DialogDescription>{t.files[def.id].desc}</DialogDescription>
          </DialogHeader>
          <code className="block truncate rounded bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
            {path}
          </code>

          {def.volatile ? (
            <Alert>
              <TriangleAlert className="size-4" />
              <AlertDescription>{t.volatileWarning}</AlertDescription>
            </Alert>
          ) : null}

          {conflict !== null ? (
            <Alert variant="destructive">
              <TriangleAlert className="size-4" />
              <AlertTitle>{t.conflictTitle}</AlertTitle>
              <AlertDescription className="flex flex-col items-start gap-2">
                <span>{t.conflictBody}</span>
                <span className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => void load()}>
                    {t.conflictReload}
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => void write(conflict)}>
                    {t.conflictOverwrite}
                  </Button>
                </span>
              </AlertDescription>
            </Alert>
          ) : null}

          {loading ? null : (
            <Tabs defaultValue={doc ? "form" : "raw"}>
              <TabsList>
                <TabsTrigger value="form">{t.tabForm}</TabsTrigger>
                <TabsTrigger value="raw">{t.tabRaw}</TabsTrigger>
              </TabsList>
              <TabsContent value="form">
                {def.form.kind === "mcpInventory" ? (
                  <McpInventory doc={doc} onOpenMcp={onOpenMcp} />
                ) : doc ? (
                  <ConfigFormFields
                    idPrefix={def.id}
                    sections={def.form.sections}
                    doc={doc}
                    onChange={(next) => setRaw(def.format.serialize(next))}
                    labels={t.fields}
                    sectionLabels={t.sections}
                    unsetLabel={t.unset}
                    lockedHint={t.lockedHint}
                    providerFirstHint={t.providerFirst}
                    mapLabels={{
                      add: t.mapAdd,
                      remove: t.mapRemove,
                      key: t.mapKey,
                      value: t.mapValue,
                    }}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">{t.formUnavailable}</p>
                )}
              </TabsContent>
              <TabsContent value="raw">
                {tooLarge ? (
                  <p className="text-sm text-muted-foreground">
                    {t.tooLarge((raw.length / 1_000_000).toFixed(1))}
                  </p>
                ) : (
                  <CodeEditor
                    lang={def.format.lang}
                    ariaLabel={t.tabRaw}
                    value={raw}
                    onChange={setRaw}
                  />
                )}
              </TabsContent>
            </Tabs>
          )}

          <p className="text-xs text-muted-foreground">{t.editorHint}</p>

          <DialogFooter>
            <Button variant="ghost" disabled={!dirty || saving} onClick={() => void load()}>
              {t.reset}
            </Button>
            <Button variant="outline" onClick={() => requestClose(false)}>
              {t.cancel}
            </Button>
            <Button onClick={() => void save()} disabled={!dirty || saving || loading}>
              {t.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.discardTitle}</AlertDialogTitle>
            <AlertDialogDescription>{t.discardBody}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.discardCancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmDiscard(false)
                setOpen(false)
              }}
            >
              {t.discardConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
