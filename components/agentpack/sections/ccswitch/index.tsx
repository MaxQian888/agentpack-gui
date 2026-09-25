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
import {
  DEFAULT_VISIBLE_APPS,
  VISIBLE_APP_KEYS,
  readVisibleApps,
} from "@/lib/agentpack/ccswitch/settings"
import { runApplied } from "@/lib/agentpack/report"
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
  const { run, onAfterRun } = useRunnerCtx()

  // Read from the store the scan writes into, never copied at mount: a copy
  // went stale the moment anything else re-detected (a retry in the review
  // panel, the shell's post-run rescan) and the checklist kept the old answer.
  const detected = storeDetected ? storeDetected.installed : null
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
  // The provider read itself failed, as opposed to being skipped for an
  // outdated schema — the empty list says which, instead of "not found".
  const [listFailed, setListFailed] = useState(false)
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
  // What cc-switch's settings file says, and the user's unapplied edit of it.
  // Two slices, because a rescan (every run triggers one) used to overwrite the
  // switches with the file and silently discard toggles nobody had applied.
  const [visibleSaved, setVisibleSaved] = useState<VisibleApps>(DEFAULT_VISIBLE_APPS)
  const [visibleDraft, setVisibleDraft] = useState<VisibleApps | null>(null)
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
  //
  // Every read is settled on its own. They used to share one Promise.all, so an
  // outdated DB — whose provider read rejects by design — took the schema
  // status, the logins and the backups down with it: the checklist said
  // "Checking…" forever and the list blamed a database that was right there.
  const scan = useCallback(async () => {
    if (!isTauri()) return undefined
    const epoch = ++scanEpoch.current
    const current = () => mounted.current && epoch === scanEpoch.current
    const cc = backend === "ccswitch"
    try {
      const [d, schema] = await Promise.allSettled([
        cc ? detectCli("cc-switch", true) : Promise.resolve(null),
        cc
          ? ccSchemaStatus()
          : Promise.resolve({ exists: false, userVersion: 0, missingColumns: [] as string[] }),
      ])
      // Schema before providers: `cc_load_providers` refuses a DB missing the
      // columns it SELECTs, so asking would only produce the same verdict as a
      // raw error. Skipped, the list can say why it is empty.
      const stale =
        cc && schema.status === "fulfilled" && schema.value.exists
          ? schema.value.missingColumns
          : []
      const [list] = await Promise.allSettled([
        stale.length > 0 ? Promise.resolve(null) : cc ? ccLoadProviders() : providerLoad("native"),
      ])
      if (!current()) return undefined
      if (d.status === "fulfilled" && d.value) {
        useAppStore.getState().setDetection("cc-switch", d.value)
      }
      if (schema.status === "fulfilled") {
        setDbReady(!cc || (schema.value.exists && stale.length === 0))
        setStaleColumns(stale)
      }
      const loaded = list.status === "fulfilled" ? list.value : null
      setProviders(loaded)
      setListFailed(list.status === "rejected")
      let failed = [d, schema, list].some((result) => result.status === "rejected")
      if (paths) {
        const [settingsJson, bks, running, claudeJson, codexToml, who, opencodeJson, accountsJson] =
          await Promise.allSettled([
            cc ? readTextFile(paths.ccSwitchSettings) : Promise.resolve(""),
            backupList(),
            // Not `isProcessRunning("cc-switch")`: on macOS the process name is the
            // binary inside the .app bundle, which the backend resolves for us.
            cc ? ccSwitchRunning() : Promise.resolve(false),
            readTextFile(paths.claudeSettings),
            readTextFile(paths.codexConfig),
            loginStatus(),
            readTextFile(paths.opencodeConfig),
            readTextFile(accountsPath(paths.home)),
          ])
        if (!current()) return undefined
        const value = <T,>(result: PromiseSettledResult<T>): T | undefined =>
          result.status === "fulfilled" ? result.value : undefined
        setLogin(value(who) ?? null)
        const accountsText = value(accountsJson)
        if (accountsText !== undefined) setAccounts(parseAccounts(accountsText).profiles)
        const settingsText = value(settingsJson)
        if (settingsText !== undefined) setVisibleSaved(readVisibleApps(settingsText))
        const backupsNow = value(bks)
        if (backupsNow !== undefined) setBackups(backupsNow)
        setCcRunning(cc ? (value(running) ?? null) : false)
        // Without a provider list every live endpoint would read as unmanaged,
        // which is an offer to import what may well already be stored.
        setUnmanaged(
          loaded
            ? detectUnmanagedProviders({
                claudeSettings: value(claudeJson) ?? "",
                codexConfig: value(codexToml) ?? "",
                opencodeConfig: value(opencodeJson) ?? "",
                providers: loaded,
              })
            : []
        )
        failed ||= [
          settingsJson,
          bks,
          running,
          claudeJson,
          codexToml,
          who,
          opencodeJson,
          accountsJson,
        ].some((result) => result.status === "rejected")
      }
      return { providers: loaded, failed }
    } finally {
      // A failed scan must never wedge the UI in a permanent loading state; the
      // user can retry via Refresh.
      if (current()) setLoading(false)
    }
  }, [backend, paths])

  // Surface a failed read instead of leaving an unhandled rejection — the user
  // retries via Refresh. (Handled here rather than a catch inside `scan`: a
  // catch block makes the React Compiler bail out of memoizing it.) Resolves to
  // the provider list the scan read, for the one caller that needs to look.
  const reload = useCallback(
    () =>
      scan().then(
        (result) => {
          if (result?.failed && mounted.current) toast.error(c.loadFailed)
          return result?.providers ?? null
        },
        () => {
          if (mounted.current) toast.error(c.loadFailed)
          return null
        }
      ),
    [scan, c.loadFailed]
  )

  useEffect(() => {
    void reload()
  }, [reload])

  /**
   * A failed add re-opens its form, and the review panel's Retry can still land
   * that very add afterwards. The form would then be a duplicate one Save away,
   * so it remembers which row it is waiting for and closes once that row shows
   * up. (An update is idempotent; saving it twice rewrites the same values.)
   */
  const reopenedAdd = useRef<{ app: ProviderApp; name: string; known: Set<string> } | null>(null)

  // Every real run re-reads the page, retries in the review panel included —
  // they never resolve a caller's `run()`, so a re-read chained onto that
  // promise left the list describing the machine before the retry.
  useEffect(
    () =>
      onAfterRun(() => {
        void reload().then((list) => {
          const add = reopenedAdd.current
          if (!add || !list) return
          const landed = list.some(
            (p) => p.app_type === add.app && p.name === add.name && !add.known.has(p.id)
          )
          if (!landed) return
          reopenedAdd.current = null
          setFormOpen(false)
        })
      }),
    [onAfterRun, reload]
  )

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
    void run([cliInstallStep("cc-switch", cmd, false, t)])
  }

  // Create the SQLite DB ourselves rather than launching cc-switch and polling
  // for the file it writes on first run. A real step, not an `info` line with
  // the write done afterwards: the preview names the file, and the report is
  // the outcome of `cc_init_db` itself rather than of a line that always passes.
  const initInFlight = useRef(false)
  const initDb = useCallback(async () => {
    if (initInFlight.current || !paths) return
    initInFlight.current = true
    setInitializing(true)
    try {
      const reports = await run([
        { kind: "ccInitDb", id: "ccswitch-init-db", label: c.initDb, path: paths.ccSwitchDb },
      ])
      if (reports.some((report) => report.id === "ccswitch-init-db" && report.status === "error")) {
        toast.error(c.initFailed)
      }
    } finally {
      initInFlight.current = false
      if (mounted.current) setInitializing(false)
    }
  }, [paths, run, c.initDb, c.initFailed])

  const visible = visibleDraft ?? visibleSaved
  const visibleChanged =
    visibleDraft !== null && VISIBLE_APP_KEYS.some((key) => visibleDraft[key] !== visibleSaved[key])

  const applyVisible = async () => {
    if (!paths || !visibleChanged) return
    const reports = await run([visibleAppsStep(paths.ccSwitchSettings, visible, t)])
    // Written, so the file is the truth again. Anything short of that keeps the
    // draft on screen to apply once whatever stopped it is fixed.
    if (runApplied(reports) && mounted.current) setVisibleDraft(null)
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
    void run(setCurrentSteps(p, paths))
  }

  // Manually push each app's current provider into the live config.
  const syncCurrent = () => {
    if (!paths || !providers) return
    const current = providers.filter((p) => p.is_current)
    if (!current.length) return
    void run([
      snapshotStep("manual sync", t, backend),
      ...current.flatMap((p) => syncLiveConfigSteps(p, paths, t)),
    ])
  }

  const openAdd = (initial: Partial<ProviderFormData> = {}) => {
    reopenedAdd.current = null
    setEditingId(undefined)
    setFormInitial(initial)
    setFormKey((k) => k + 1)
    setFormOpen(true)
  }

  const openEdit = (p: Provider) => {
    reopenedAdd.current = null
    setEditingId(p.id)
    setFormInitial({
      name: p.name,
      app: p.app_type,
      websiteUrl: p.website_url ?? undefined,
      notes: p.notes ?? undefined,
      ...parseSettingsConfig(p.app_type, p.settings_config),
      // The fields merge into what is stored rather than replacing it — see
      // `buildSettingsConfig`.
      baseSettingsConfig: p.settings_config,
    })
    setFormKey((k) => k + 1)
    setFormOpen(true)
  }

  const submitForm = async (form: ProviderFormData) => {
    reopenedAdd.current = null
    const id = editingId
    const op = id ? ("update" as const) : ("add" as const)
    const writeId = providerStepId(op, form.app, backend)
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
      steps.push(...syncLiveConfigSteps(saved, paths, t, [writeId]))
    }
    const reports = await run(steps)
    // The form closed itself on submit. Unless the row write actually landed,
    // re-open it carrying the exact values the user tried: a failed write
    // (cc-switch running, a stale row…) and a review they walked away from ([])
    // both saved nothing, and neither may throw away what they typed — a pasted
    // token included. A landed write whose live sync failed is not re-opened;
    // the row exists, and saving the form again would add it twice.
    if (reports.some((r) => r.id === writeId && (r.status === "done" || r.status === "warning"))) {
      return
    }
    if (!mounted.current) return
    if (op === "add") {
      reopenedAdd.current = {
        app: form.app,
        name: form.name,
        known: new Set((providers ?? []).map((p) => p.id)),
      }
    }
    setEditingId(id)
    setFormInitial(form)
    setFormKey((k) => k + 1)
    setFormOpen(true)
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
    // The card disables Apply, with the reason, when this comes back empty.
    const targets = resolveAccount(profile, providers)
    if (!targets.length) return
    void run(targets.flatMap((p) => setCurrentSteps(p, paths)))
  }

  const exportProviderBundle = async (includeTokens: boolean) => {
    if (!providers?.length) return
    let path: string | null = null
    try {
      path = await pickSavePath({ defaultPath: "agentpack.providers.json" })
      if (!path) return
      await writeTextFile(path, exportProviders(providers, { includeTokens }))
    } catch (error) {
      toast.error(c.exportFailed(path ?? "agentpack.providers.json", String(error)))
      return
    }
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
    // "New only" on a file whose every entry already exists here would
    // otherwise close the dialog and do nothing, which reads as a lost click.
    if (!steps.length) {
      toast.message(c.importNothingNew)
      return
    }
    void run(steps)
  }

  const pickImportFile = async () => {
    let path: string | null = null
    let text: string
    try {
      path = await pickFile([{ name: "json", extensions: ["json"] }])
      if (!path) return
      text = await readTextFile(path)
    } catch (error) {
      toast.error(c.importReadFailed(path ?? "", String(error)))
      return
    }
    const entries = parseProviderBundle(text)
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
    // A walked-away or stopped restore wrote nothing; a failed one is
    // explained in the panel and also here, since the list behind it is stale.
    // Success needs no toast — the panel it went through says "All set".
    if (!runApplied(reports) && reports.some((r) => r.status === "error")) {
      toast.error(c.restoreFailed)
    }
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
  // Adding a row needs somewhere to put it. Without this the form opened, the
  // review ran, and the write failed with a raw error from Rust.
  const addBlockedReason = needsMigration ? c.addNeedsMigration : needsDb ? c.addNeedsDb : undefined
  // Why there is no list, when there is none. "Not found" was the answer for
  // every cause, including a database that was right there but too old to read.
  const listUnavailable =
    providers !== null
      ? undefined
      : needsMigration
        ? c.listOutdated
        : listFailed
          ? c.loadFailed
          : undefined
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
            note:
              detected === null
                ? loading
                  ? c.checking
                  : c.loadFailed
                : detected
                  ? c.detected
                  : c.notDetected,
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
              /* The same launch the app card does: it settles, re-reads the
                 schema once cc-switch has migrated it, and names a failed
                 launch as one — not as a failed database creation. */
              <Button
                variant="outline"
                size="sm"
                disabled={appBusy !== null}
                onClick={() => void openApp()}
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
      /* Its precondition is the database. Accenting it while that is missing
         put a third "do this now" on the page for a step whose every control
         would fail. */
      status:
        providers === null || addBlockedReason ? "waiting" : providerCount > 0 ? "done" : "current",
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
      disabled={editingBlocked || !tauri || !!addBlockedReason}
      disabledReason={addBlockedReason}
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
                {/* One primary, and it is the safe one: replacing rows is the
                    choice that can lose something, so it must not look like
                    the default. */}
                <AlertDialogFooter>
                  <AlertDialogCancel>{t.shell.cancel}</AlertDialogCancel>
                  <AlertDialogAction
                    variant="outline"
                    onClick={() => importPlan && runImport(importPlan, true)}
                  >
                    {c.importOverwrite}
                  </AlertDialogAction>
                  <AlertDialogAction onClick={() => importPlan && runImport(importPlan, false)}>
                    {c.importFreshOnly}
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
                changed={visibleChanged}
                disabled={editingBlocked || !tauri}
                onChange={setVisibleDraft}
                onApply={() => void applyVisible()}
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
              addBlockedReason={addBlockedReason}
              unavailable={listUnavailable}
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
                void run([providerStep("delete", p.app_type, p.name, undefined, p.id, t, backend)])
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
                  writeAccounts(
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
        onOpenChange={(open) => {
          // Closed by hand: nothing is waiting on a retry any more.
          if (!open) reopenedAdd.current = null
          setFormOpen(open)
        }}
        initial={formInitial}
        editing={!!editingId}
        onSubmit={submitForm}
      />
    </>
  )
}
