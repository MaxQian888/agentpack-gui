"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Plus, Star, RefreshCw, Database, History, Loader2, AlertTriangle } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import { Card } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { CLI_TOOLS } from "@/lib/agentpack/registry"
import {
  cliInstallStep,
  providerStep,
  snapshotStep,
  syncLiveConfigSteps,
  visibleAppsStep,
} from "@/lib/agentpack/plan"
import {
  DEFAULT_VISIBLE_APPS,
  VISIBLE_APP_KEYS,
  readVisibleApps,
} from "@/lib/agentpack/ccswitch/settings"
import { RECOMMENDED_PROVIDERS } from "@/lib/agentpack/ccswitch/preset"
import { buildSettingsConfig, parseSettingsConfig } from "@/lib/agentpack/ccswitch/provider"
import type {
  Provider,
  ProviderForm as ProviderFormData,
  VisibleApps,
} from "@/lib/agentpack/ccswitch/types"
import {
  backupList,
  backupRestore,
  ccLoadProviders,
  detectCli,
  isProcessRunning,
  launchApp,
  pathExists,
  readTextFile,
  type BackupEntry,
} from "@/lib/tauri/commands"
import { isTauri } from "@/lib/tauri"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { SectionShell } from "./section-shell"
import { ProviderForm } from "../provider-form"
import { useRunnerCtx } from "../run/runner-context"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function CcSwitchSection() {
  const t = useT()
  const c = t.ccswitch
  const paths = useAppStore((s) => s.paths)
  const effectiveOS = useAppStore((s) => s.effectiveOS)
  const storeDetected = useAppStore((s) => s.detections["cc-switch"])
  const { run } = useRunnerCtx()

  const [detected, setDetected] = useState<boolean | null>(
    storeDetected ? storeDetected.installed : null
  )
  const [dbReady, setDbReady] = useState<boolean | null>(null)
  const [ccRunning, setCcRunning] = useState<boolean | null>(null)
  // Starts true only in the desktop app (where the first scan runs); in web mode
  // there's nothing to scan, so we skip straight to the not-in-Tauri message.
  const [loading, setLoading] = useState(() => isTauri())
  const [initializing, setInitializing] = useState(false)
  const [initTimedOut, setInitTimedOut] = useState(false)
  const [providers, setProviders] = useState<Provider[] | null>(null)
  const [visible, setVisible] = useState<VisibleApps>(DEFAULT_VISIBLE_APPS)
  const [backups, setBackups] = useState<BackupEntry[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [formInitial, setFormInitial] = useState<Partial<ProviderFormData>>({})
  const [editingId, setEditingId] = useState<string | undefined>(undefined)
  // Bumped on every open so <ProviderForm> remounts and re-seeds its fields from
  // `formInitial` (useState initializers only run once per mount).
  const [formKey, setFormKey] = useState(0)

  // Guards the DB-init polling loop from setting state after unmount.
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // Refresh every slice from disk/DB: detection (mirrored into the shared store so
  // the dashboard agrees), providers, DB presence, visible apps, and backup list.
  const scan = useCallback(async () => {
    if (!isTauri()) return
    try {
      const [d, list] = await Promise.all([detectCli("cc-switch", true), ccLoadProviders()])
      if (!mounted.current) return
      setDetected(d.installed)
      useAppStore.getState().setDetection("cc-switch", d)
      setProviders(list)
      if (paths) {
        const [dbExists, settingsJson, bks, running] = await Promise.all([
          pathExists(paths.ccSwitchDb),
          readTextFile(paths.ccSwitchSettings),
          backupList(),
          isProcessRunning("cc-switch"),
        ])
        if (!mounted.current) return
        setDbReady(dbExists)
        setVisible(readVisibleApps(settingsJson))
        setBackups(bks)
        setCcRunning(running)
      }
    } finally {
      // A failed scan must never wedge the UI in a permanent loading state; the
      // user can retry via Refresh.
      if (mounted.current) setLoading(false)
    }
  }, [paths])

  // Surface a failed scan instead of leaving an unhandled rejection — the user
  // retries via Refresh. (Handled here rather than a catch inside `scan`: a
  // catch block makes the React Compiler bail out of memoizing it.)
  const reload = useCallback(
    () =>
      scan().catch(() => {
        if (mounted.current) toast.error(c.loadFailed)
      }),
    [scan, c.loadFailed]
  )

  useEffect(() => {
    void reload()
  }, [reload])

  const runThen = async (steps: Parameters<typeof run>[0]) => {
    const reports = await run(steps)
    await reload()
    return reports
  }

  const installCcSwitch = () => {
    const tool = CLI_TOOLS.find((x) => x.id === "cc-switch")!
    const cmd = tool.install[effectiveOS()]
    if (!cmd) return
    void runThen([cliInstallStep("cc-switch", cmd, false, t)])
  }

  // Launch cc-switch once so it self-creates its SQLite DB, then poll until the
  // file appears (cc-switch keeps running; the user closes it before editing).
  const initDb = async () => {
    if (!paths || initializing) return
    setInitializing(true)
    setInitTimedOut(false)
    try {
      try {
        await launchApp({ file: "cc-switch", args: [] })
      } catch {
        if (mounted.current) toast.error(c.initLaunchFailed)
        return
      }
      for (let i = 0; i < 60 && mounted.current; i++) {
        await sleep(1000)
        if (await pathExists(paths.ccSwitchDb)) {
          if (mounted.current) setDbReady(true)
          return
        }
      }
      if (mounted.current) setInitTimedOut(true)
    } finally {
      if (mounted.current) setInitializing(false)
      await reload()
    }
  }

  const applyVisible = () => {
    if (!paths) return
    void runThen([visibleAppsStep(paths.ccSwitchSettings, visible, t)])
  }

  const setCurrent = (p: Provider) => {
    if (!paths) return
    // cc_write_provider snapshots the DB + live configs before the flag change,
    // so no extra snapshotStep is needed here; the sync steps then write live.
    // They depend on the DB write: a failed switch must not touch live configs.
    void runThen([
      providerStep("setCurrent", p.app_type, p.name, undefined, p.id, t),
      ...syncLiveConfigSteps(p, paths, t, ["cc-provider-setCurrent"]),
    ])
  }

  // Manually push each app's current provider into the live config.
  const syncCurrent = () => {
    if (!paths || !providers) return
    const current = providers.filter((p) => p.is_current)
    if (!current.length) return
    void runThen([
      snapshotStep("manual sync", t),
      ...current.flatMap((p) => syncLiveConfigSteps(p, paths, t)),
    ])
  }

  const openAdd = (initial: Partial<ProviderFormData> = {}) => {
    setEditingId(undefined)
    setFormInitial(initial)
    setFormKey((k) => k + 1)
    setFormOpen(true)
  }

  const openEdit = (p: Provider) => {
    setEditingId(p.id)
    setFormInitial({
      name: p.name,
      app: p.app_type,
      websiteUrl: p.website_url ?? undefined,
      notes: p.notes ?? undefined,
      ...parseSettingsConfig(p.app_type, p.settings_config),
    })
    setFormKey((k) => k + 1)
    setFormOpen(true)
  }

  const submitForm = async (form: ProviderFormData) => {
    const id = editingId
    const op = id ? ("update" as const) : ("add" as const)
    // The saved config must take effect immediately when this row is (or
    // becomes) the live one: editing the current provider, or adding the first
    // provider of an app (cc_write_provider marks it current).
    const landsOnCurrent = id
      ? !!providers?.some((p) => p.id === id && p.is_current)
      : !providers?.some((p) => p.app_type === form.app && p.is_current)
    const steps = [providerStep(op, form.app, form.name, form, id, t)]
    if (landsOnCurrent && paths) {
      const saved: Provider = {
        id: id ?? "",
        app_type: form.app,
        name: form.name,
        settings_config: buildSettingsConfig(form),
        is_current: true,
      }
      // dependsOn the DB write: a failed save must not rewrite live configs.
      steps.push(...syncLiveConfigSteps(saved, paths, t, [`cc-provider-${op}`]))
    }
    const reports = await runThen(steps)
    if (reports.some((r) => r.status === "error")) {
      // The write failed (cc-switch running, stale row, …). The form already
      // closed itself on submit; re-open it carrying the exact values the user
      // tried so a transient failure never discards their input.
      setEditingId(id)
      setFormInitial(form)
      setFormKey((k) => k + 1)
      setFormOpen(true)
    }
  }

  const doRestore = async (id: string) => {
    try {
      await backupRestore(id)
      toast.success(c.restored)
    } catch {
      toast.error(c.restoreFailed)
    } finally {
      await reload()
    }
  }

  const tool = CLI_TOOLS.find((x) => x.id === "cc-switch")!
  const canInstall = !!tool.install[effectiveOS()]
  const hasCurrent = !!providers?.some((p) => p.is_current)
  // Providers can only be managed once the DB exists.
  const needsDb = detected === true && dbReady === false
  // cc-switch locks its SQLite DB while open, so every write would fail; block the
  // editing controls and guide the user to close it first.
  const editingBlocked = ccRunning === true

  return (
    <SectionShell title={c.menuTitle}>
      {/* Install / check / initialize */}
      <Card className="gap-3 p-4">
        <div className="flex flex-row items-center gap-3">
          <div className="flex-1">
            <div className="font-medium">{c.install}</div>
            {detected !== null ? (
              <Badge
                variant={detected ? "secondary" : "outline"}
                className="mt-1 font-normal text-muted-foreground"
              >
                {detected ? c.detected : c.notDetected}
              </Badge>
            ) : (
              <Badge variant="outline" className="mt-1 gap-1 font-normal text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                {c.checking}
              </Badge>
            )}
          </div>
          {isTauri() ? (
            <Button variant="ghost" size="sm" className="gap-1" onClick={() => void reload()}>
              <RefreshCw className="size-3.5" />
              {c.refresh}
            </Button>
          ) : null}
          {!detected && canInstall ? (
            <Button variant="outline" onClick={installCcSwitch}>
              {c.install}
            </Button>
          ) : null}
          {!canInstall ? (
            <span className="text-xs text-muted-foreground">{tool.manualNote}</span>
          ) : null}
        </div>

        {needsDb ? (
          <div className="flex flex-row items-center gap-3 border-t pt-3">
            <div className="flex-1">
              <div className="flex items-center gap-1.5 font-medium">
                <Database className="size-4" />
                {c.initDb}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {initializing ? c.initializing : initTimedOut ? c.initTimeout : c.initDbHint}
              </p>
            </div>
            <Button variant="outline" onClick={() => void initDb()} disabled={initializing}>
              {c.initDb}
            </Button>
          </div>
        ) : detected === true && dbReady === true ? (
          <p className="border-t pt-3 text-xs text-muted-foreground">{c.dbReady}</p>
        ) : null}
      </Card>

      {/* Visible apps */}
      <Card className="gap-3 p-4">
        <div className="font-medium">{c.visibleTitle}</div>
        <div className="grid grid-cols-2 gap-3">
          {VISIBLE_APP_KEYS.map((key) => (
            <div key={key} className="flex items-center justify-between gap-2">
              <Label htmlFor={`va-${key}`} className="cursor-pointer text-sm font-normal">
                {c.appLabels[key]}
              </Label>
              <Switch
                id={`va-${key}`}
                checked={visible[key]}
                onCheckedChange={(v) => setVisible((prev) => ({ ...prev, [key]: v }))}
              />
            </div>
          ))}
        </div>
        <div>
          <Button variant="outline" size="sm" onClick={applyVisible} disabled={editingBlocked}>
            {t.shell.apply}
          </Button>
        </div>
      </Card>

      {/* Providers */}
      <Card className="gap-3 p-4">
        {editingBlocked ? (
          <Alert>
            <AlertTriangle />
            <AlertTitle>{c.runningTitle}</AlertTitle>
            <AlertDescription>
              <span>{c.runningHint}</span>
              <Button
                variant="outline"
                size="sm"
                className="mt-1 gap-1"
                onClick={() => void reload()}
              >
                <RefreshCw className="size-3.5" />
                {c.refresh}
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="flex items-center justify-between">
          <div className="font-medium">{c.providersTitle}</div>
          <div className="flex flex-wrap gap-2">
            {RECOMMENDED_PROVIDERS.map((preset) => (
              <Button
                key={preset.key}
                variant="ghost"
                size="sm"
                className="gap-1"
                disabled={editingBlocked}
                onClick={() => openAdd(preset.form)}
              >
                <Star className="size-3.5" />
                {preset.label}
              </Button>
            ))}
            <Button size="sm" className="gap-1" disabled={editingBlocked} onClick={() => openAdd()}>
              <Plus className="size-4" />
              {c.addProvider}
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {hasCurrent ? c.setCurrentNote : c.syncNoCurrent}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={syncCurrent}
            disabled={!hasCurrent || editingBlocked}
          >
            {c.syncCurrent}
          </Button>
        </div>

        {providers && providers.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{c.fieldName.replace(":", "")}</TableHead>
                <TableHead>{c.fieldApp}</TableHead>
                <TableHead className="text-right">{c.rowActionEdit}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {providers.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">
                    {p.name}
                    {p.is_current ? (
                      <Badge variant="secondary" className="ml-2 font-normal">
                        {c.current}
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="capitalize text-muted-foreground">{p.app_type}</TableCell>
                  <TableCell className="space-x-1 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={editingBlocked}
                      onClick={() => openEdit(p)}
                    >
                      {c.rowActionEdit}
                    </Button>
                    {!p.is_current ? (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="sm" disabled={editingBlocked}>
                            {c.rowActionSetCurrent}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>{c.rowActionSetCurrent}</AlertDialogTitle>
                            <AlertDialogDescription>{c.setCurrentConfirm}</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{t.shell.cancel}</AlertDialogCancel>
                            <AlertDialogAction onClick={() => setCurrent(p)}>
                              {c.rowActionSetCurrent}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    ) : null}
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-500"
                          disabled={p.is_current || editingBlocked}
                        >
                          {c.rowActionDelete}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>{c.rowActionDelete}</AlertDialogTitle>
                          <AlertDialogDescription>{c.deleteConfirm}</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{t.shell.cancel}</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() =>
                              void runThen([
                                providerStep("delete", p.app_type, p.name, undefined, p.id, t),
                              ])
                            }
                          >
                            {c.rowActionDelete}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : loading && providers === null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {c.loading}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {providers ? c.empty : isTauri() ? c.noDb : t.shell.notInTauri}
          </p>
        )}
      </Card>

      {/* Backups & restore */}
      <Card className="gap-3 p-4">
        <div className="flex items-center gap-1.5 font-medium">
          <History className="size-4" />
          {c.backupsTitle}
        </div>
        <p className="text-xs text-muted-foreground">{c.backupsHint}</p>
        {backups.length > 0 ? (
          <Table>
            <TableBody>
              {backups.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="text-sm">
                    {new Date(b.ts).toLocaleString()}
                    <span className="ml-2 text-muted-foreground">{b.reason}</span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {c.backupFiles(b.files.length)}
                  </TableCell>
                  <TableCell className="text-right">
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="sm">
                          {c.restore}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>{c.restore}</AlertDialogTitle>
                          <AlertDialogDescription>{c.restoreConfirm}</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{t.shell.cancel}</AlertDialogCancel>
                          <AlertDialogAction onClick={() => void doRestore(b.id)}>
                            {c.restore}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : loading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {c.loading}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">{c.noBackups}</p>
        )}
      </Card>

      <ProviderForm
        key={formKey}
        open={formOpen}
        onOpenChange={setFormOpen}
        initial={formInitial}
        editing={!!editingId}
        onSubmit={submitForm}
      />
    </SectionShell>
  )
}
