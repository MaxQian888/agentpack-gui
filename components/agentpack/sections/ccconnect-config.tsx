"use client"

import { useMemo, useState } from "react"
import { Pencil } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
import {
  CONFIG_SECTIONS,
  defaultConfigToml,
  parseConfigDoc,
  serializeConfigDoc,
} from "@/lib/agentpack/ccconnect"
import { readTextFile } from "@/lib/tauri/commands"
import { useT } from "@/lib/i18n/provider"
import { CodeEditor } from "./code-editor"
import { ConfigFormFields } from "./config-form"
import { useRunnerCtx } from "../run/runner-context"

type ConfigGroup = "all" | "core" | "connection" | "media" | "display" | "reliability" | "security"

const CONFIG_GROUPS: Record<Exclude<ConfigGroup, "all">, string[]> = {
  core: ["general"],
  connection: ["management", "bridge", "webhook", "relay"],
  media: ["speech", "tts"],
  display: ["display", "streamPreview", "instantReply"],
  reliability: ["rateLimit", "outgoingRateLimit", "cron", "timeouts"],
  security: ["management", "bridge", "webhook", "rateLimit"],
}

interface Props {
  /** Absolute path of ~/.cc-connect/config.toml. */
  path: string
  /** Whether the file exists — decides Edit vs Create wording and initial text. */
  exists: boolean
  /** Called after a successful save so the section re-scans ports/state. */
  onSaved: () => void
}

/**
 * Visual editor for cc-connect's config.toml. The raw TOML text is the single
 * source of truth; the form is a projection over its parsed document, so
 * unknown keys ([[projects]], hooks, comments aside) survive a form edit via
 * smol-toml round-tripping. Form editing is disabled while the text doesn't
 * parse.
 *
 * The controls themselves live in `./config-form`, shared with the agent CLIs'
 * editor — only the schema (`CONFIG_SECTIONS`) and this file's load/save are
 * cc-connect-specific. `idPrefix="ccconf"` keeps the input ids stable.
 */
export function CcConnectConfigEditor({ path, exists, onSaved }: Props) {
  const t = useT()
  const c = t.ccconnect
  const { run } = useRunnerCtx()
  const [open, setOpen] = useState(false)
  const [raw, setRaw] = useState("")
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [query, setQuery] = useState("")
  const [group, setGroup] = useState<ConfigGroup>("all")

  const doc = useMemo(() => parseConfigDoc(raw), [raw])
  const visibleSections = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    const keys = group === "all" ? null : new Set(CONFIG_GROUPS[group])
    const sectionLabels = c.sections as Record<string, string>
    const fieldLabels = c.fields as Record<string, string>
    return CONFIG_SECTIONS.filter((section) => {
      if (keys && !keys.has(section.key)) return false
      if (!normalized) return true
      const sectionLabel = sectionLabels[section.key] ?? section.key
      const labels = section.fields.map((field) => fieldLabels[field.key] ?? field.key)
      return [sectionLabel, ...labels].some((label) =>
        label.toLocaleLowerCase().includes(normalized)
      )
    })
  }, [c.fields, c.sections, group, query])

  const load = async () => {
    setLoading(true)
    try {
      const text = exists ? await readTextFile(path) : ""
      setRaw(text.trim() ? text : defaultConfigToml())
    } catch {
      toast.error(c.loadFailed)
      setOpen(false)
    } finally {
      setLoading(false)
    }
  }

  const save = async () => {
    if (!parseConfigDoc(raw)) {
      toast.error(c.invalidToml)
      return
    }
    setSaving(true)
    try {
      const content = raw.endsWith("\n") ? raw : `${raw}\n`
      const reports = await run([
        {
          kind: "mergeFile",
          id: "ccconnect-config-save",
          label: c.save,
          path,
          merge: () => content,
          writtenNote: c.saved,
        },
      ])
      if (
        !reports.some((report) => report.id === "ccconnect-config-save" && report.status === "done")
      ) {
        if (reports.some((report) => report.status === "error")) toast.error(c.saveFailed)
        return
      }
      toast.success(c.saved)
      setOpen(false)
      onSaved()
    } catch {
      toast.error(c.saveFailed)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) void load()
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1">
          <Pencil className="size-3.5" />
          {exists ? c.configEdit : c.configCreate}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{c.editorTitle}</DialogTitle>
          <DialogDescription>{c.editorHint}</DialogDescription>
        </DialogHeader>
        {loading ? null : (
          <Tabs defaultValue={doc ? "form" : "toml"}>
            <TabsList>
              <TabsTrigger value="form">{c.tabForm}</TabsTrigger>
              <TabsTrigger value="toml">{c.tabToml}</TabsTrigger>
            </TabsList>
            <TabsContent value="form">
              {doc ? (
                <div className="flex flex-col gap-3">
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={c.configSearch}
                  />
                  <div className="flex flex-wrap gap-2">
                    {(Object.keys(c.configGroups) as ConfigGroup[]).map((key) => (
                      <Button
                        key={key}
                        type="button"
                        size="sm"
                        variant={group === key ? "secondary" : "outline"}
                        onClick={() => setGroup(key)}
                      >
                        {c.configGroups[key]}
                      </Button>
                    ))}
                  </div>
                  <ConfigFormFields
                    idPrefix="ccconf"
                    sections={visibleSections}
                    doc={doc}
                    onChange={(next) => setRaw(serializeConfigDoc(next))}
                    labels={c.fields}
                    sectionLabels={c.sections}
                    unsetLabel={c.unset}
                    lockedHint={t.configFiles.lockedHint}
                    providerFirstHint={c.providerFirst}
                    mapLabels={{
                      add: t.configFiles.mapAdd,
                      remove: t.configFiles.mapRemove,
                      key: t.configFiles.mapKey,
                      value: t.configFiles.mapValue,
                    }}
                  />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{c.formUnavailable}</p>
              )}
            </TabsContent>
            <TabsContent value="toml">
              <CodeEditor lang="toml" ariaLabel={c.tabToml} value={raw} onChange={setRaw} />
            </TabsContent>
          </Tabs>
        )}
        <DialogFooter>
          <Button onClick={() => void save()} disabled={saving || loading}>
            {c.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
