"use client"

/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V5 */
/* Hallmark · genre: modern-minimal · macrostructure: asymmetric settings workbench · theme: inherited Cobalt · contrast: pass (40–41) · slop: pass (42–49) · mobile: pass (34, 49, 50–57) */

import { useCallback, useEffect, useState } from "react"
import { Check, Download, Plus, Upload, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
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
import { CapabilityTile, CapabilityWorkbench } from "./sections/capability-workbench"
import { SectionStatus } from "./sections/section-status"

/**
 * Profiles and the two ways a setup leaves this machine: the plan-only config
 * file the headless CLI reads, and the whole-machine backup.
 *
 * The three used to be three same-sized cards stacked above a fourth holding
 * eight config files — a column of boxes where nothing said which one was the
 * point. They are ranked now: profiles are what someone comes here to do, so
 * they get the wide column; export and import are two-button errands, so they
 * are tiles beside it; and the config-file editors are a reference list at the
 * bottom, below the fold, where reaching for them is deliberate.
 */
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

  const activeProfile = profiles.find((p) => p.id === currentProfileId)

  return (
    <CapabilityWorkbench
      title={t.profiles.title}
      subtitle={t.profiles.subtitle}
      actionsLabel={t.profiles.actionsLabel}
      lead={
        <SectionStatus
          label={t.profiles.summaryLabel}
          facts={[
            { label: t.profiles.metricSaved, value: profiles.length },
            { label: t.profiles.metricActive, value: activeProfile?.name ?? t.profiles.none },
            {
              label: t.profiles.metricSelection,
              value: t.bundle.planSummary(plan.clis.length, plan.skills.length, plan.mcps.length),
            },
          ]}
        />
      }
      primary={
        <section aria-label={t.profiles.listPanel} className="min-w-0 rounded-lg border">
          <div className="border-b p-4">
            <h3 className="font-medium">{t.profiles.listTitle}</h3>
            <p className="mt-1 max-w-prose text-xs leading-relaxed text-muted-foreground">
              {t.profiles.listHint}
            </p>
            <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void onSaveProfile()
                }}
                placeholder={t.profiles.namePlaceholder}
                className="h-9 max-w-xs flex-1"
              />
              <Button onClick={() => void onSaveProfile()} className="h-9 gap-2">
                <Plus className="size-4" />
                {t.profiles.saveAs}
              </Button>
            </div>
          </div>

          {profiles.length === 0 ? (
            <Empty className="border-0 p-8">
              <EmptyHeader>
                <EmptyTitle className="text-sm">{t.profiles.empty}</EmptyTitle>
                <EmptyDescription className="max-w-prose text-xs">
                  {t.profiles.emptyHint}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="divide-y">
              {profiles.map((p) => (
                <div
                  key={p.id}
                  className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 p-4"
                >
                  {editingId === p.id ? (
                    <div className="flex min-w-0 flex-1 items-center gap-1">
                      <Input
                        value={editName}
                        aria-label={t.profiles.renameLabel(p.name)}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void onRenameCommit()
                          if (e.key === "Escape") setEditingId(null)
                        }}
                        className="h-8 max-w-xs"
                        autoFocus
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8"
                        aria-label={t.profiles.renameCommit}
                        onClick={() => void onRenameCommit()}
                      >
                        <Check className="size-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8"
                        aria-label={t.profiles.renameCancel}
                        onClick={() => setEditingId(null)}
                      >
                        <X className="size-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="min-w-0 flex-1 basis-56">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm font-medium">{p.name}</span>
                        {currentProfileId === p.id ? (
                          <Badge variant="secondary" className="font-normal">
                            {t.profiles.current}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-1 font-mono text-[var(--hm-text-2xs)] text-muted-foreground [overflow-wrap:anywhere]">
                        {t.bundle.planSummary(
                          p.plan.clis.length,
                          p.plan.skills.length,
                          p.plan.mcps.length
                        )}
                        {" · "}
                        {t.profiles.savedAt(new Date(p.createdAt).toLocaleDateString())}
                      </p>
                    </div>
                  )}
                  {editingId === p.id ? null : (
                    <div className="flex shrink-0 gap-1">
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
                        className="text-[var(--hm-danger)] hover:text-[var(--hm-danger)]"
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
        </section>
      }
      aside={
        <>
          {/* The plan-only file stays exactly as it was — the headless CLI path
              consumes that format. The backup below it is the whole machine. */}
          <CapabilityTile title={t.profiles.fileTitle} description={t.profiles.fileHint}>
            <div className="flex flex-col gap-2">
              <Button variant="outline" size="sm" onClick={() => void save()} className="gap-2">
                <Download className="size-4" />
                {t.shell.saveConfigBtn}
              </Button>
              <Button variant="outline" size="sm" onClick={() => void load()} className="gap-2">
                <Upload className="size-4" />
                {t.shell.loadConfig}
              </Button>
            </div>
          </CapabilityTile>
          <CapabilityTile title={t.bundle.title} description={t.bundle.subtitle}>
            <div className="flex flex-col gap-2">
              <ExportBundleDialog />
              <ImportBundleDialog />
            </div>
          </CapabilityTile>
        </>
      }
      detail={<ConfigFilesCard onOpenMcp={onOpenMcp} />}
    />
  )
}
