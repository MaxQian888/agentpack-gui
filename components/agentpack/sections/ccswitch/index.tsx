"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
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
import { detectUnmanagedProviders, type UnmanagedProvider } from "@/lib/agentpack/ccswitch/import"
import { appsMissingOfficial } from "@/lib/agentpack/ccswitch/official"
import {
  ACCOUNTS_VERSION,
  accountsPath,
  accountsForBackend,
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
import {
  PROVIDER_APPS,
  type Provider,
  type ProviderApp,
  type ProviderBackend,
  type ProviderForm as ProviderFormData,
  type VisibleApps,
} from "@/lib/agentpack/ccswitch/types"
import {
  backupList,
  ccInitDb,
  ccLoadProviders,
  ccSchemaStatus,
  detectCli,
  ccSwitchRunning,
  launchCcSwitch,
  quitCcSwitch,
  loginStatus,
  providerLoad,
  readTextFile,
  writeTextFile,
  type BackupEntry,
  type LoginReport,
} from "@/lib/tauri/commands"
import { saveSettings } from "@/lib/tauri/settings"

import { isTauri } from "@/lib/tauri"
import { pickFile, pickSavePath } from "@/lib/tauri/dialog"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { CapabilityWorkbench } from "../capability-workbench"
import { SectionStatus } from "../section-status"
import { SetupSteps, type SetupStep } from "../setup-steps"
import { HelpTip } from "../../help-tip"
import { ProviderForm } from "../../provider-form"
import { useRunnerCtx } from "../../run/runner-context"
import { DesktopOnlyNote } from "../../desktop-only-note"
import { AccountsCard } from "./accounts-card"
import { AppCard } from "./app-card"
import { BackendCard } from "./backend-card"
import { BackupsCard } from "./backups-card"
import { LoginsCard } from "./logins-card"
import { ProvidersCard, type ProviderFilters } from "./providers-card"
import { QuickAddCard } from "./quick-add-card"
import { VisibleAppsCard } from "./visible-apps-card"

export function CcSwitchSection() {
  const t = useT()
  const c = t.ccswitch
  const tauri = isTauri()
  const paths = useAppStore((s) => s.paths)
  const effectiveOS = useAppStore((s) => s.effectiveOS)
  const storeDetected = useAppStore((s) => s.detections["cc-switch"])
  const backend = useAppStore((s) => s.settings.providerBackend)
  const setSettings = useAppStore((s) => s.setSettings)
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
  const [loading, setLoading] = useState(tauri)
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
  const [providerQuery, setProviderQuery] = useState("")
  const [providerApp, setProviderApp] = useState<ProviderApp | "all">("all")
  const [providerStatus, setProviderStatus] = useState<"all" | "official" | "custom" | "current">(
    "all"
  )
  const [providerSort, setProviderSort] = useState<"name" | "app" | "current">("name")

  // Guards the DB-init polling loop from setting state after unmount.
  const mounted = useRef(true)
  // Invalidates an older backend scan as soon as the user switches stores. A
  // slow SQLite read must never overwrite a newer native result (or vice versa).
  const scanEpoch = useRef(0)
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
    const epoch = ++scanEpoch.current
    try {
      const [d, list] = await Promise.all([
        backend === "ccswitch" ? detectCli("cc-switch", true) : Promise.resolve(null),
        backend === "native" ? providerLoad("native") : ccLoadProviders(),
      ])
      if (!mounted.current || epoch !== scanEpoch.current) return
      if (d) {
        setDetected(d.installed)
        useAppStore.getState().setDetection("cc-switch", d)
      }
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
          backend === "ccswitch"
            ? ccSchemaStatus()
            : Promise.resolve({ exists: false, userVersion: 0, missingColumns: [] }),
          backend === "ccswitch" ? readTextFile(paths.ccSwitchSettings) : Promise.resolve(""),
          backupList(),
          // Not `isProcessRunning("cc-switch")`: on macOS the process name is the
          // binary inside the .app bundle, which the backend resolves for us.
          backend === "ccswitch" ? ccSwitchRunning() : Promise.resolve(false),
          readTextFile(paths.claudeSettings),
          readTextFile(paths.codexConfig),
          loginStatus(),
          readTextFile(paths.opencodeConfig),
          readTextFile(accountsPath(paths.home)),
        ])
        if (!mounted.current || epoch !== scanEpoch.current) return
        setLogin(who)
        setAccounts(parseAccounts(accountsJson).profiles)
        setDbReady(backend === "native" || (schema.exists && schema.missingColumns.length === 0))
        setStaleColumns(backend === "ccswitch" && schema.exists ? schema.missingColumns : [])
        setVisible(readVisibleApps(settingsJson))
        setBackups(bks)
        setCcRunning(backend === "ccswitch" ? running : false)
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
      if (mounted.current && epoch === scanEpoch.current) setLoading(false)
    }
  }, [backend, paths])

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

  const selectBackend = (value: string) => {
    if (value !== "native" && value !== "ccswitch") return
    const next = value as ProviderBackend
    scanEpoch.current += 1
    setSettings({ providerBackend: next })
    void saveSettings({ providerBackend: next })
    setProviders(null)
    setLoading(true)
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
  // for the file it writes on first run. The info step keeps this write inside
  // the same review flow as every other persisted capability change.
  const initInFlight = useRef(false)
  const initDb = useCallback(async () => {
    if (initInFlight.current) return
    initInFlight.current = true
    setInitializing(true)
    try {
      const reports = await run([
        {
          kind: "info",
          id: "ccswitch-init-db",
          label: c.initDb,
          lines: [c.initDbHint],
        },
      ])
      if (!reports.some((report) => report.id === "ccswitch-init-db" && report.status === "done")) {
        return
      }
      await ccInitDb()
    } catch {
      if (mounted.current) toast.error(c.initFailed)
    } finally {
      initInFlight.current = false
      if (mounted.current) setInitializing(false)
      await reload()
    }
  }, [reload, run, c.initDb, c.initDbHint, c.initFailed])

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
    providerStep("setCurrent", p.app_type, p.name, undefined, p.id, t, backend),
    ...syncLiveConfigSteps(p, ps, t, [providerStepId("setCurrent", p.app_type, backend)]),
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
      snapshotStep("manual sync", t, backend),
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
    const steps = [providerStep(op, form.app, form.name, form, id, t, backend)]
    if (landsOnCurrent && paths) {
      const saved: Provider = {
        id: id ?? "",
        app_type: form.app,
        name: form.name,
        settings_config: buildSettingsConfig(form),
        is_current: true,
      }
      // dependsOn the DB write: a failed save must not rewrite live configs.
      steps.push(...syncLiveConfigSteps(saved, paths, t, [providerStepId(op, form.app, backend)]))
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

  const writeAccounts = async (profiles: AccountProfile[]): Promise<boolean> => {
    if (!paths) return false
    const previous = accounts
    let failed = false
    setAccounts(profiles)
    try {
      const reports = await run([
        {
          kind: "mergeFile",
          id: "ccswitch-account-profiles",
          label: c.accountsTitle,
          path: accountsPath(paths.home),
          merge: () => serializeAccounts({ version: ACCOUNTS_VERSION, profiles }),
          writtenNote: c.accountsTitle,
        },
      ])
      if (
        reports.some(
          (report) => report.id === "ccswitch-account-profiles" && report.status === "done"
        )
      ) {
        return true
      }
      failed = reports.some((report) => report.status === "error")
    } catch {
      failed = true
    }
    setAccounts(previous)
    if (failed) toast.error(c.accountWriteFailed)
    return false
  }

  const saveAccount = async () => {
    const name = newAccount.trim()
    if (!name || !providers) return
    // Stamped here rather than in the pure module so it stays free of clock reads.
    const id = `acct-${Date.now().toString(36)}`
    const saved = await writeAccounts([...accounts, captureAccount(id, name, backend, providers)])
    if (saved) setNewAccount("")
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
      ...plan.fresh.map((e) => providerImportStep(e, undefined, t, backend)),
      ...(overwrite
        ? plan.conflicts.map((c) => providerImportStep(c.entry, c.existing.id, t, backend))
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

  /**
   * A restore overwrites the live config of every agent at once — the single
   * most consequential thing this app can do — so it goes through the same
   * review panel as everything else rather than firing on a confirm dialog.
   * The step records the safety snapshot it takes on the way through, which is
   * what lets the activity log offer a way back out of the way back.
   */
  const doRestore = async (id: string) => {
    const reports = await run(
      [
        {
          kind: "snapshotRestore",
          id: `snapshot-restore-${id}`,
          label: t.steps.snapshotRestore(id),
          snapshotId: id,
        },
      ],
      { activity: { title: t.steps.snapshotRestore(id), source: "restore" } }
    )
    if (reports.length === 0) return
    if (reports.some((r) => r.status === "error")) toast.error(c.restoreFailed)
    else toast.success(c.restored)
    await reload()
  }

  const tool = CLI_TOOLS.find((x) => x.id === "cc-switch")!
  const canInstall = !!tool.install[effectiveOS()]
  const hasCurrent = !!providers?.some((p) => p.is_current)
  // Providers can only be managed once the DB exists. An out-of-date DB is a
  // different problem: agentpack must not migrate someone else's schema, so it
  // points at cc-switch instead of offering to create anything.
  const needsDb = backend === "ccswitch" && dbReady === false && staleColumns.length === 0
  const needsMigration = backend === "ccswitch" && staleColumns.length > 0
  // Apps with no "official login" row yet: without one there's no way back from a
  // relay to the CLI's own account.
  const missingOfficial = appsMissingOfficial(providers ?? [], PROVIDER_APPS)
  // cc-switch locks its SQLite DB while open, so every write would fail; block the
  // editing controls and guide the user to close it first.
  const editingBlocked = backend === "ccswitch" && ccRunning === true
  const activeAccounts = accountsForBackend(accounts, backend)
  const currentProviderCount = providers?.filter((provider) => provider.is_current).length ?? 0
  const providerCount = providers?.length ?? 0
  const filters: ProviderFilters = {
    query: providerQuery,
    app: providerApp,
    status: providerStatus,
    sort: providerSort,
  }
  const setFilters = (next: Partial<ProviderFilters>) => {
    if (next.query !== undefined) setProviderQuery(next.query)
    if (next.app !== undefined) setProviderApp(next.app)
    if (next.status !== undefined) setProviderStatus(next.status)
    if (next.sort !== undefined) setProviderSort(next.sort)
  }

  /**
   * The first-run path, in the order it has to happen.
   *
   * Which steps exist depends on the storage backend, and that is the point:
   * the native store has no app to install and no database to create, so those
   * rows are absent rather than present-and-ticked. The last two rows carry no
   * button — the verbs they name live on the list below and on its rows, and a
   * second "Add provider" would be a second primary for the same action.
   */
  const steps: SetupStep[] = [
    ...(backend === "ccswitch"
      ? ([
          {
            id: "install",
            title: c.stepInstallTitle,
            description: canInstall ? c.stepInstallDesc : tool.manualNote,
            note: detected === null ? c.checking : detected ? c.detected : c.notDetected,
            status: detected === null ? "waiting" : detected ? "done" : "current",
            action:
              tauri && !detected && canInstall ? (
                <Button variant="outline" size="sm" onClick={installCcSwitch}>
                  {c.install}
                </Button>
              ) : undefined,
          },
          {
            id: "database",
            title: c.stepDatabaseTitle,
            description: needsMigration
              ? c.schemaStale(staleColumns.join(", "))
              : initializing
                ? c.initializing
                : c.stepDatabaseDesc,
            note: dbReady === true && !needsMigration ? c.dbReady : undefined,
            /* `dbReady === null` means the scan hasn't answered yet. Calling
               that "current" put the accent on a row with nothing to click,
               which reads as stuck rather than as still measuring. */
            status: needsMigration
              ? "blocked"
              : dbReady === true
                ? "done"
                : dbReady === null || detected === null
                  ? "waiting"
                  : "current",
            action: needsMigration ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void launchCcSwitch().catch(() => toast.error(c.initFailed))}
              >
                {c.launchCcSwitch}
              </Button>
            ) : needsDb ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void initDb()}
                disabled={initializing}
              >
                {c.initDb}
              </Button>
            ) : undefined,
          },
        ] satisfies SetupStep[])
      : []),
    {
      id: "provider",
      title: c.stepProviderTitle,
      description: c.stepProviderDesc,
      note: providerCount > 0 ? c.stepProviderDone(providerCount) : undefined,
      status: providers === null ? "waiting" : providerCount > 0 ? "done" : "current",
    },
    {
      id: "current",
      title: c.stepCurrentTitle,
      description: c.stepCurrentDesc,
      note: hasCurrent ? c.stepCurrentDone(currentProviderCount) : undefined,
      status: hasCurrent ? "done" : providerCount > 0 ? "current" : "waiting",
    },
  ]

  /* Quick add has exactly one home at a time: inside the empty list, where a
     first provider is actually chosen, and in the aside once the list has rows.
     Rendering it in both would put every preset button on screen twice. */
  const quickAdd = (flat: boolean) => (
    <QuickAddCard
      missingOfficial={missingOfficial}
      disabled={editingBlocked || !tauri}
      flat={flat}
      onPick={openAdd}
    />
  )
  const listIsEmpty = providerCount === 0

  return (
    <>
      <CapabilityWorkbench
        title={c.menuTitle}
        help={<HelpTip text={t.help.ccswitch} />}
        actionsLabel={c.actionsLabel}
        actions={
          tauri ? (
            <Button variant="ghost" size="sm" className="gap-1" onClick={() => void reload()}>
              <RefreshCw className="size-3.5" />
              {c.refresh}
            </Button>
          ) : undefined
        }
        lead={
          /* Storage backend and the login tally are deliberately absent: the
             backend picker states the first at the top of this very page, and
             the logins tile in the aside lists the second per app. A summary
             that repeats both is the third copy of each. */
          <SectionStatus
            label={c.summaryLabel}
            facts={[
              { label: c.metricProviders, value: providers?.length ?? "—" },
              { label: c.metricCurrent, value: currentProviderCount },
              { label: c.metricAccounts, value: activeAccounts.length },
              {
                label: c.metricCcSwitch,
                value:
                  backend === "native"
                    ? c.metricNotUsed
                    : detected === null
                      ? c.loading
                      : detected
                        ? t.envcheck.installed
                        : t.envcheck.notFound,
              },
            ]}
          />
        }
        primary={
          <div className="flex min-w-0 flex-col gap-4">
            {!tauri ? <DesktopOnlyNote>{t.shell.notInTauri}</DesktopOnlyNote> : null}

            <BackendCard backend={backend} disabled={!tauri} onSelect={selectBackend} />

            <SetupSteps
              title={c.guideTitle}
              hint={c.guideHint}
              steps={steps}
              progressLabel={c.guideProgress}
              statusLabels={{
                done: t.shell.setupDone,
                current: t.shell.setupCurrent,
                waiting: t.shell.setupWaiting,
                blocked: t.shell.setupBlocked,
              }}
            />

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
          </div>
        }
        aside={
          <>
            {listIsEmpty ? null : quickAdd(false)}
            <LoginsCard login={login} loading={loading} />
            {backend === "ccswitch" && tauri && detected ? (
              <AppCard
                running={ccRunning}
                busy={appBusy}
                onOpen={() => void openApp()}
                onQuit={() => void quitApp()}
              />
            ) : null}
            {backend === "ccswitch" ? (
              <VisibleAppsCard
                visible={visible}
                disabled={editingBlocked || !tauri}
                onChange={setVisible}
                onApply={applyVisible}
              />
            ) : null}
          </>
        }
        detail={
          /* The provider list is the largest object on the page and the one a
             row is read across — name, app, endpoint, three verbs. In the
             8-column primary its last column fell off the panel; here it has
             the whole width, and the two columns above stay short enough to
             read as one decision plus its checklist. */
          <div className="flex min-w-0 flex-col gap-4">
            <ProvidersCard
              providers={providers}
              loading={loading}
              unmanaged={unmanaged}
              editingBlocked={editingBlocked}
              tauri={tauri}
              hasCurrent={hasCurrent}
              filters={filters}
              appBusy={appBusy}
              quickAdd={listIsEmpty ? quickAdd(true) : undefined}
              onFilters={setFilters}
              onAdd={openAdd}
              onEdit={openEdit}
              onSetCurrent={setCurrent}
              onDelete={(p) =>
                void runThen([
                  providerStep("delete", p.app_type, p.name, undefined, p.id, t, backend),
                ])
              }
              onSync={syncCurrent}
              onExport={(withTokens) => void exportProviderBundle(withTokens)}
              onImport={() => void pickImportFile()}
              onQuitApp={() => void quitApp()}
              onRefresh={() => void reload()}
            />

            <div className="grid min-w-0 gap-4 lg:grid-cols-2">
              <AccountsCard
                accounts={activeAccounts}
                providers={providers}
                newAccount={newAccount}
                hasCurrent={hasCurrent}
                editingBlocked={editingBlocked}
                onNewAccountChange={setNewAccount}
                onSave={saveAccount}
                onUpdate={(profile) =>
                  void writeAccounts(
                    accounts.map((account) => (account.id === profile.id ? profile : account))
                  )
                }
                onApply={applyAccount}
                onDelete={(a) => void writeAccounts(accounts.filter((x) => x.id !== a.id))}
              />

              <BackupsCard
                backups={backups}
                loading={loading}
                onRestore={(id) => void doRestore(id)}
              />
            </div>
          </div>
        }
      />
      <ProviderForm
        key={formKey}
        open={formOpen}
        onOpenChange={setFormOpen}
        initial={formInitial}
        editing={!!editingId}
        onSubmit={submitForm}
      />
    </>
  )
}
