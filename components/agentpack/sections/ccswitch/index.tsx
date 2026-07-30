"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  Plus,
  Star,
  RefreshCw,
  Database,
  Download,
  ExternalLink,
  KeyRound,
  Loader2,
  Power,
  AlertTriangle,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import { Card } from "@/components/ui/card"
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
  providerImportStep,
  providerStep,
  providerStepId,
  snapshotStep,
  syncLiveConfigSteps,
  visibleAppsStep,
} from "@/lib/agentpack/plan"
import { DEFAULT_VISIBLE_APPS, readVisibleApps } from "@/lib/agentpack/ccswitch/settings"
import { RECOMMENDED_PROVIDERS } from "@/lib/agentpack/ccswitch/preset"
import { detectUnmanagedProviders, type UnmanagedProvider } from "@/lib/agentpack/ccswitch/import"
import { appsMissingOfficial, isOfficial, officialForm } from "@/lib/agentpack/ccswitch/official"
import {
  ACCOUNTS_VERSION,
  accountsPath,
  captureAccount,
  parseAccounts,
  resolveAccount,
  serializeAccounts,
  type AccountProfile,
} from "@/lib/agentpack/ccswitch/accounts"
import {
  exportProviders,
  parseProviderBundle,
  planImport,
  type ImportPlan,
} from "@/lib/agentpack/ccswitch/transfer"
import { buildSettingsConfig, parseSettingsConfig } from "@/lib/agentpack/ccswitch/provider"
import type {
  Provider,
  ProviderForm as ProviderFormData,
  VisibleApps,
} from "@/lib/agentpack/ccswitch/types"
import {
  backupList,
  backupRestore,
  ccInitDb,
  ccLoadProviders,
  ccSchemaStatus,
  detectCli,
  ccSwitchRunning,
  launchCcSwitch,
  quitCcSwitch,
  loginStatus,
  readTextFile,
  writeTextFile,
  type BackupEntry,
  type LoginReport,
} from "@/lib/tauri/commands"

import { isTauri } from "@/lib/tauri"
import { pickFile, pickSavePath } from "@/lib/tauri/dialog"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { SectionShell } from "../section-shell"
import { HelpTip } from "../../help-tip"
import { ProviderForm } from "../../provider-form"
import { useRunnerCtx } from "../../run/runner-context"
import { AccountsCard } from "./accounts-card"
import { BackupsCard } from "./backups-card"
import { LoadingLine } from "./loading-line"
import { LoginsCard } from "./logins-card"
import { VisibleAppsCard } from "./visible-apps-card"

/** Apps agentpack manages providers for; cc-switch itself supports more. */
const PROVIDER_APPS = ["claude", "codex", "opencode"] as const

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
  // Columns the existing DB lacks; non-empty => it predates agentpack's needs and
  // only cc-switch's own migrator should touch it.
  const [staleColumns, setStaleColumns] = useState<string[]>([])
  const [ccRunning, setCcRunning] = useState<boolean | null>(null)
  // Starts true only in the desktop app (where the first scan runs); in web mode
  // there's nothing to scan, so we skip straight to the not-in-Tauri message.
  const [loading, setLoading] = useState(() => isTauri())
  const [initializing, setInitializing] = useState(false)
  const [providers, setProviders] = useState<Provider[] | null>(null)
  // Relay config already on disk that no provider row covers — offered for import
  // so a switch can't silently overwrite what the user configured by hand.
  const [unmanaged, setUnmanaged] = useState<UnmanagedProvider[]>([])
  // Each CLI's own login, read-only — see `login_status` for why macOS reports
  // no plan/expiry.
  const [login, setLogin] = useState<LoginReport | null>(null)
  const [accounts, setAccounts] = useState<AccountProfile[]>([])
  const [newAccount, setNewAccount] = useState("")
  // Set only when an import has name collisions worth asking about.
  const [importPlan, setImportPlan] = useState<ImportPlan | null>(null)
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
        const [
          schema,
          settingsJson,
          bks,
          running,
          claudeJson,
          codexToml,
          who,
          opencodeJson,
          accountsJson,
        ] = await Promise.all([
          ccSchemaStatus(),
          readTextFile(paths.ccSwitchSettings),
          backupList(),
          // Not `isProcessRunning("cc-switch")`: on macOS the process name is the
          // binary inside the .app bundle, which the backend resolves for us.
          ccSwitchRunning(),
          readTextFile(paths.claudeSettings),
          readTextFile(paths.codexConfig),
          loginStatus(),
          readTextFile(paths.opencodeConfig),
          readTextFile(accountsPath(paths.home)),
        ])
        if (!mounted.current) return
        setLogin(who)
        setAccounts(parseAccounts(accountsJson).profiles)
        setDbReady(schema.exists && schema.missingColumns.length === 0)
        setStaleColumns(schema.exists ? schema.missingColumns : [])
        setVisible(readVisibleApps(settingsJson))
        setBackups(bks)
        setCcRunning(running)
        setUnmanaged(
          detectUnmanagedProviders({
            claudeSettings: claudeJson,
            codexConfig: codexToml,
            opencodeConfig: opencodeJson,
            providers: list,
          })
        )
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

  // ── Launch / quit the cc-switch app ──────────────────────────────────────
  //
  // Both matter because cc-switch locks the SQLite DB agentpack writes: opening
  // it is how you use its own UI, and quitting it is what unblocks editing here.
  // Until now the only way to close it was to go find the app yourself.
  const [appBusy, setAppBusy] = useState<"open" | "quit" | null>(null)

  /**
   * Poll until the running state settles, then refresh.
   *
   * A launched app isn't in the process table the instant `open` returns, so
   * refreshing straight away would show "not running" and make the button look
   * broken. Short by design: `quit_cc_switch` already waits for the process to
   * exit before it resolves, so this only has to cover launch propagation.
   */
  const settleThenReload = useCallback(
    async (expected: boolean) => {
      for (let i = 0; i < 8; i++) {
        const running = await ccSwitchRunning().catch(() => null)
        if (running === expected) break
        await new Promise((resolve) => setTimeout(resolve, 200))
      }
      await reload()
    },
    [reload]
  )

  const openApp = useCallback(async () => {
    setAppBusy("open")
    try {
      await launchCcSwitch()
      await settleThenReload(true)
    } catch {
      if (mounted.current) toast.error(c.launchFailed)
    } finally {
      if (mounted.current) setAppBusy(null)
    }
  }, [settleThenReload, c.launchFailed])

  const quitApp = useCallback(async () => {
    setAppBusy("quit")
    try {
      // `false` means it survived both a graceful and a forced quit — say so
      // rather than silently refreshing back into the blocked state.
      const gone = await quitCcSwitch()
      await settleThenReload(false)
      if (!gone && mounted.current) toast.error(c.quitFailed)
    } catch {
      if (mounted.current) toast.error(c.quitFailed)
    } finally {
      if (mounted.current) setAppBusy(null)
    }
  }, [settleThenReload, c.quitFailed])

  const installCcSwitch = () => {
    const tool = CLI_TOOLS.find((x) => x.id === "cc-switch")!
    const cmd = tool.install[effectiveOS()]
    if (!cmd) return
    void runThen([cliInstallStep("cc-switch", cmd, false, t)])
  }

  // Create the SQLite DB ourselves rather than launching cc-switch and polling
  // for the file it writes on first run: that made cc-switch a hard prerequisite
  // and cost up to a minute of waiting. A ref (not the `initializing` state)
  // guards re-entry so the auto-trigger effect and the manual button can't both
  // fire — the memoized callback would otherwise read a stale `initializing`.
  const initInFlight = useRef(false)
  const initDb = useCallback(async () => {
    if (initInFlight.current) return
    initInFlight.current = true
    setInitializing(true)
    try {
      await ccInitDb()
    } catch {
      if (mounted.current) toast.error(c.initFailed)
    } finally {
      initInFlight.current = false
      if (mounted.current) setInitializing(false)
      await reload()
    }
  }, [reload, c.initFailed])

  // No database yet → create it, without waiting for a manual click and without
  // needing cc-switch installed. Single-shot per mount so a failure doesn't retry
  // in a loop; the button below stays available for an explicit retry.
  const autoInitAttempted = useRef(false)
  useEffect(() => {
    if (dbReady === false && staleColumns.length === 0 && !autoInitAttempted.current) {
      autoInitAttempted.current = true
      void initDb()
    }
  }, [dbReady, staleColumns, initDb])

  const applyVisible = () => {
    if (!paths) return
    void runThen([visibleAppsStep(paths.ccSwitchSettings, visible, t)])
  }

  /**
   * Make one provider current, then push its config live.
   *
   * `cc_write_provider` snapshots the DB + live configs before the flag change,
   * so no extra snapshotStep is needed; the sync steps declare a dependency on
   * the DB write so a failed switch never touches live configs. Shared with
   * `applyAccount`, which is the same switch repeated per app — and the two
   * drifting apart would mean a profile switch that skips the sync.
   */
  const setCurrentSteps = (p: Provider, ps: NonNullable<typeof paths>) => [
    providerStep("setCurrent", p.app_type, p.name, undefined, p.id, t),
    ...syncLiveConfigSteps(p, ps, t, [providerStepId("setCurrent", p.app_type)]),
  ]

  const setCurrent = (p: Provider) => {
    if (!paths) return
    void runThen(setCurrentSteps(p, paths))
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
      steps.push(...syncLiveConfigSteps(saved, paths, t, [providerStepId(op, form.app)]))
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

  const writeAccounts = async (profiles: AccountProfile[]) => {
    if (!paths) return
    setAccounts(profiles)
    await writeTextFile(
      accountsPath(paths.home),
      serializeAccounts({ version: ACCOUNTS_VERSION, profiles })
    )
  }

  const saveAccount = () => {
    const name = newAccount.trim()
    if (!name || !providers) return
    // Stamped here rather than in the pure module so it stays free of clock reads.
    const id = `acct-${Date.now().toString(36)}`
    setNewAccount("")
    void writeAccounts([...accounts, captureAccount(id, name, providers)])
  }

  // Applying a profile is a batch of the same setCurrent the list does, so the
  // `is_current` flag stays the only switch and the badges follow along.
  const applyAccount = (profile: AccountProfile) => {
    if (!paths || !providers) return
    const targets = resolveAccount(profile, providers)
    if (!targets.length) return
    void runThen(targets.flatMap((p) => setCurrentSteps(p, paths)))
  }

  const exportProviderBundle = async (includeTokens: boolean) => {
    if (!providers?.length) return
    const path = await pickSavePath({ defaultPath: "agentpack.providers.json" })
    if (!path) return
    await writeTextFile(path, exportProviders(providers, { includeTokens }))
    toast.success(t.shell.configSaved(path))
  }

  const runImport = (plan: ImportPlan, overwrite: boolean) => {
    setImportPlan(null)
    // An imported entry's stored `settings_config` travels verbatim — see
    // `providerImportStep`, which takes it directly rather than making the
    // caller smuggle it through a form shape it doesn't fit.
    const steps = [
      ...plan.fresh.map((e) => providerImportStep(e, undefined, t)),
      ...(overwrite
        ? plan.conflicts.map((c) => providerImportStep(c.entry, c.existing.id, t))
        : []),
    ]
    if (steps.length) void runThen(steps)
  }

  const pickImportFile = async () => {
    const path = await pickFile([{ name: "json", extensions: ["json"] }])
    if (!path) return
    const entries = parseProviderBundle(await readTextFile(path))
    if (!entries.length) return toast.error(c.importNothing)
    const plan = planImport(entries, providers ?? [])
    // Nothing to decide when no name collides — just run it.
    if (!plan.conflicts.length) return runImport(plan, false)
    setImportPlan(plan)
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
  // Providers can only be managed once the DB exists. An out-of-date DB is a
  // different problem: agentpack must not migrate someone else's schema, so it
  // points at cc-switch instead of offering to create anything.
  const needsDb = dbReady === false && staleColumns.length === 0
  const needsMigration = staleColumns.length > 0
  // Apps with no "official login" row yet: without one there's no way back from a
  // relay to the CLI's own account.
  const missingOfficial = appsMissingOfficial(providers ?? [], PROVIDER_APPS)
  // cc-switch locks its SQLite DB while open, so every write would fail; block the
  // editing controls and guide the user to close it first.
  const editingBlocked = ccRunning === true

  return (
    <SectionShell title={c.menuTitle} help={<HelpTip text={t.help.ccswitch} />}>
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

        {/* App control. Only once it's installed — there's nothing to open or
            quit otherwise, and the buttons would just be dead weight. */}
        {isTauri() && detected ? (
          <div className="flex flex-row flex-wrap items-center gap-3 border-t pt-3">
            <div className="flex-1">
              <div className="font-medium">{c.appTitle}</div>
              <div className="mt-1 flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-2 rounded-full",
                    ccRunning === null
                      ? "bg-muted-foreground/40"
                      : ccRunning
                        ? "bg-emerald-500"
                        : "bg-muted-foreground/40"
                  )}
                />
                <span className="text-xs text-muted-foreground">
                  {ccRunning === null ? c.checking : ccRunning ? c.appRunning : c.appStopped}
                </span>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={() => void openApp()}
              disabled={appBusy !== null}
            >
              {appBusy === "open" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <ExternalLink className="size-3.5" />
              )}
              {c.appOpen}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={() => void quitApp()}
              disabled={appBusy !== null || ccRunning === false}
            >
              {appBusy === "quit" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Power className="size-3.5" />
              )}
              {c.appQuit}
            </Button>
          </div>
        ) : null}

        {needsMigration ? (
          <Alert className="mt-3">
            <AlertTriangle />
            <AlertTitle>{c.initDb}</AlertTitle>
            <AlertDescription>
              <span>{c.schemaStale(staleColumns.join(", "))}</span>
              <Button
                variant="outline"
                size="sm"
                className="mt-1"
                onClick={() => void launchCcSwitch().catch(() => toast.error(c.initFailed))}
              >
                {c.launchCcSwitch}
              </Button>
            </AlertDescription>
          </Alert>
        ) : needsDb ? (
          <div className="flex flex-row items-center gap-3 border-t pt-3">
            <div className="flex-1">
              <div className="flex items-center gap-1.5 font-medium">
                <Database className="size-4" />
                {c.initDb}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {initializing ? c.initializing : c.initDbHint}
              </p>
            </div>
            <Button variant="outline" onClick={() => void initDb()} disabled={initializing}>
              {c.initDb}
            </Button>
          </div>
        ) : dbReady === true ? (
          <p className="border-t pt-3 text-xs text-muted-foreground">{c.dbReady}</p>
        ) : null}
      </Card>

      <VisibleAppsCard
        visible={visible}
        disabled={editingBlocked}
        onChange={setVisible}
        onApply={applyVisible}
      />

      <LoginsCard login={login} loading={loading} />

      {/* Providers */}
      <Card className="gap-3 p-4">
        {editingBlocked ? (
          <Alert>
            <AlertTriangle />
            <AlertTitle>{c.runningTitle}</AlertTitle>
            <AlertDescription>
              <span>{c.runningHint}</span>
              {/* The fix, right where the problem is stated — no hunting for the
                  app in the dock just to unblock editing here. */}
              <div className="mt-1 flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  onClick={() => void quitApp()}
                  disabled={appBusy !== null}
                >
                  {appBusy === "quit" ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Power className="size-3.5" />
                  )}
                  {c.appQuit}
                </Button>
                <Button variant="ghost" size="sm" className="gap-1" onClick={() => void reload()}>
                  <RefreshCw className="size-3.5" />
                  {c.refresh}
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="flex items-center justify-between">
          <div className="font-medium">{c.providersTitle}</div>
          <div className="flex flex-wrap gap-2">
            {missingOfficial.map((app) => (
              <Button
                key={`official-${app}`}
                variant="ghost"
                size="sm"
                className="gap-1"
                disabled={editingBlocked}
                onClick={() => openAdd(officialForm(app, c.officialName))}
              >
                <KeyRound className="size-3.5" />
                {c.addOfficial(app)}
              </Button>
            ))}
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

        {unmanaged.length > 0 && !editingBlocked ? (
          <Alert>
            <Download />
            <AlertTitle>{c.unmanagedTitle(unmanaged.length)}</AlertTitle>
            <AlertDescription>
              <span>{c.unmanagedHint}</span>
              <div className="mt-1 flex flex-wrap gap-2">
                {unmanaged.map((u) => (
                  <Button key={u.key} variant="outline" size="sm" onClick={() => openAdd(u.form)}>
                    {c.importOne(u.app, u.form.baseUrl ?? "")}
                  </Button>
                ))}
              </div>
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {hasCurrent ? c.setCurrentNote : c.syncNoCurrent}
          </p>
          <div className="flex gap-1">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm" disabled={!providers?.length}>
                  {c.exportProviders}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{c.exportProviders}</AlertDialogTitle>
                  <AlertDialogDescription>{c.exportTokensAsk}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t.shell.cancel}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void exportProviderBundle(false)}>
                    {c.exportWithoutTokens}
                  </AlertDialogAction>
                  <AlertDialogAction onClick={() => void exportProviderBundle(true)}>
                    {c.exportWithTokens}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button
              variant="ghost"
              size="sm"
              disabled={editingBlocked}
              onClick={() => void pickImportFile()}
            >
              {c.importProviders}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={syncCurrent}
              disabled={!hasCurrent || editingBlocked}
            >
              {c.syncCurrent}
            </Button>
          </div>
        </div>

        <AlertDialog open={!!importPlan} onOpenChange={(o) => !o && setImportPlan(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{c.importProviders}</AlertDialogTitle>
              <AlertDialogDescription>
                {c.importConflicts(
                  importPlan?.fresh.length ?? 0,
                  importPlan?.conflicts.map((x) => x.entry.name).join(", ") ?? ""
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t.shell.cancel}</AlertDialogCancel>
              <AlertDialogAction onClick={() => importPlan && runImport(importPlan, false)}>
                {c.importFreshOnly}
              </AlertDialogAction>
              <AlertDialogAction onClick={() => importPlan && runImport(importPlan, true)}>
                {c.importOverwrite}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

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
                    {isOfficial(p) ? (
                      <Badge variant="outline" className="ml-2 font-normal">
                        {c.officialBadge}
                      </Badge>
                    ) : null}
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
          <LoadingLine />
        ) : (
          <p className="text-sm text-muted-foreground">
            {providers ? c.empty : isTauri() ? c.noDb : t.shell.notInTauri}
          </p>
        )}
      </Card>

      <AccountsCard
        accounts={accounts}
        providers={providers}
        newAccount={newAccount}
        hasCurrent={hasCurrent}
        editingBlocked={editingBlocked}
        onNewAccountChange={setNewAccount}
        onSave={saveAccount}
        onApply={applyAccount}
        onDelete={(a) => void writeAccounts(accounts.filter((x) => x.id !== a.id))}
      />

      <BackupsCard backups={backups} loading={loading} onRestore={(id) => void doRestore(id)} />

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
