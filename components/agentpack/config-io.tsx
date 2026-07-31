"use client"

import { useCallback, useEffect, useState } from "react"
import { Check, Download, Plus, Upload, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { isTauri } from "@/lib/tauri"
import { readTextFile, writeTextFile } from "@/lib/tauri/commands"
import { pickFile, pickSavePath } from "@/lib/tauri/dialog"
import { parseConfig, serializePlan } from "@/lib/agentpack/config"
import {
  parseProfiles,
  profilesPath,
  serializeProfiles,
  PROFILE_VERSION,
} from "@/lib/agentpack/profile"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { ExportBundleDialog } from "./bundle/export-dialog"
import { ImportBundleDialog } from "./bundle/import-dialog"
import { ConfigFilesCard } from "./sections/config-files-card"
import { SectionShell } from "./sections/section-shell"

export function ConfigIO({ onOpenMcp }: { onOpenMcp?: () => void }) {
  const t = useT()
  const plan = useAppStore((s) => s.plan)
  const loadPlan = useAppStore((s) => s.loadPlan)
  const paths = useAppStore((s) => s.paths)
  const profiles = useAppStore((s) => s.profiles)
  const currentProfileId = useAppStore((s) => s.currentProfileId)
  const setProfiles = useAppStore((s) => s.setProfiles)
  const saveCurrentAsProfile = useAppStore((s) => s.saveCurrentAsProfile)
  const applyProfile = useAppStore((s) => s.applyProfile)
  const deleteProfile = useAppStore((s) => s.deleteProfile)
  const renameProfile = useAppStore((s) => s.renameProfile)

  const [newName, setNewName] = useState("")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState("")

  // Load the profile store from disk on mount.
  useEffect(() => {
    if (!isTauri() || !paths) return
    readTextFile(profilesPath(paths.home))
      .then((json) => setProfiles(parseProfiles(json).profiles))
      .catch(() => {})
  }, [paths, setProfiles])

  /**
   * Persist whatever the store currently holds (called after each mutation).
   * Reports whether the write actually happened: in web mode there is nowhere to
   * write, and the callers below used to announce success regardless — telling
   * the user their profile was saved when nothing had been.
   */
  const persist = useCallback(async (): Promise<boolean> => {
    if (!isTauri() || !paths) return false
    const list = useAppStore.getState().profiles
    await writeTextFile(
      profilesPath(paths.home),
      serializeProfiles({ version: PROFILE_VERSION, profiles: list })
    )
    return true
  }, [paths])

  const onSaveProfile = async () => {
    const name = newName.trim()
    if (!name) return toast.error(t.profiles.nameRequired)
    saveCurrentAsProfile(name)
    setNewName("")
    if (!(await persist())) return toast.error(t.shell.notInTauri)
    toast.success(t.profiles.saved(name))
  }

  // No write involved — applying a profile only touches the in-memory plan, so
  // it genuinely does work in web mode.
  const onApply = (id: string, name: string) => {
    applyProfile(id)
    toast.success(t.profiles.applied(name))
  }

  const onDelete = async (id: string, name: string) => {
    deleteProfile(id)
    if (!(await persist())) return toast.error(t.shell.notInTauri)
    toast.success(t.profiles.deleted(name))
  }

  const onRenameCommit = async () => {
    const name = editName.trim()
    if (editingId && name) {
      renameProfile(editingId, name)
      if (!(await persist())) toast.error(t.shell.notInTauri)
    }
    setEditingId(null)
    setEditName("")
  }

  const save = async () => {
    if (!isTauri()) return toast.error(t.shell.notInTauri)
    const path = await pickSavePath({ defaultPath: "agentpack.config.json" })
    if (!path) return
    await writeTextFile(path, serializePlan(plan))
    toast.success(t.shell.configSaved(path))
  }

  const load = async () => {
    if (!isTauri()) return toast.error(t.shell.notInTauri)
    const path = await pickFile([{ name: "json", extensions: ["json"] }])
    if (!path) return
    try {
      loadPlan(parseConfig(await readTextFile(path), t))
      toast.success(t.shell.configLoaded)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.errors.invalidJson)
    }
  }

  return (
    <SectionShell title={t.profiles.title} subtitle={t.profiles.subtitle}>
      <Card className="gap-4 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t.profiles.namePlaceholder}
            className="max-w-xs"
          />
          <Button onClick={onSaveProfile} className="gap-2">
            <Plus className="size-4" />
            {t.profiles.saveAs}
          </Button>
        </div>

        {profiles.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.profiles.empty}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {profiles.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm"
              >
                {editingId === p.id ? (
                  <div className="flex flex-1 items-center gap-2">
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="max-w-xs"
                      autoFocus
                    />
                    <Button size="sm" variant="ghost" onClick={() => void onRenameCommit()}>
                      <Check className="size-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                      <X className="size-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{p.name}</span>
                    {currentProfileId === p.id ? (
                      <Badge variant="secondary" className="font-normal">
                        {t.profiles.current}
                      </Badge>
                    ) : null}
                  </div>
                )}
                {editingId === p.id ? null : (
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => onApply(p.id, p.name)}>
                      {t.profiles.apply}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditingId(p.id)
                        setEditName(p.name)
                      }}
                    >
                      {t.profiles.rename}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-500"
                      onClick={() => void onDelete(p.id, p.name)}
                    >
                      {t.profiles.delete}
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="flex-row flex-wrap gap-3 p-5">
        <Button onClick={save} className="gap-2">
          <Download className="size-4" />
          {t.shell.saveConfigBtn}
        </Button>
        <Button variant="outline" onClick={load} className="gap-2">
          <Upload className="size-4" />
          {t.shell.loadConfig}
        </Button>
      </Card>

      {/* The plan-only buttons above stay as they are — the headless CLI path
          consumes that format. This is the whole-machine backup alongside it. */}
      <Card className="gap-3 p-5">
        <div>
          <div className="text-sm font-medium">{t.bundle.title}</div>
          <p className="text-xs text-muted-foreground">{t.bundle.subtitle}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <ExportBundleDialog />
          <ImportBundleDialog />
        </div>
      </Card>

      <ConfigFilesCard onOpenMcp={onOpenMcp} />
    </SectionShell>
  )
}
