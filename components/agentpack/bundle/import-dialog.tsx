"use client"

import { useEffect, useMemo, useState } from "react"
import { TriangleAlert, Upload } from "lucide-react"
import { toast } from "sonner"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"
import {
  describeSettingsChange,
  diffFiles,
  diffPlan,
  diffProfiles,
  diffSettings,
  keepLocalSecrets,
  keepLocalSettingsSecrets,
  mergePlan,
  mergeProfiles,
  retargetPlanOs,
  type FileDiff,
  type PlanMode,
  type ProfilesMode,
} from "@/lib/agentpack/bundle/apply"
import { parseBundle } from "@/lib/agentpack/bundle/format"
import type { BundleFileKey } from "@/lib/agentpack/bundle/secrets"
import { planImport } from "@/lib/agentpack/ccswitch/transfer"
import type { Provider } from "@/lib/agentpack/ccswitch/types"
import {
  BACKUP_SUFFIX,
  bundleFileStep,
  providerImportStep,
  snapshotStep,
} from "@/lib/agentpack/plan"
import {
  profilesPath,
  serializeProfiles,
  PROFILE_VERSION,
  type Profile,
} from "@/lib/agentpack/profile"
import { pendingCredentials } from "@/lib/agentpack/migrate"
import { effectiveProxy } from "@/lib/agentpack/network/proxy"
import { runApplied } from "@/lib/agentpack/report"
import type { StepDescriptor, StepReport } from "@/lib/agentpack/types"
import { useMounted } from "@/hooks/use-mounted"
import { useT } from "@/lib/i18n/provider"
import { isTauri } from "@/lib/tauri"
import { readTextFromClipboard } from "@/lib/tauri/clipboard"
import { isProcessRunning, providerLoad, readTextFile, setProcessProxy } from "@/lib/tauri/commands"
import { pickFile } from "@/lib/tauri/dialog"
import { saveSettings, type AppSettings } from "@/lib/tauri/settings"
import { registerSummonShortcut, unregisterSummonShortcut } from "@/lib/tauri/shortcut"
import { useAppStore } from "@/store/app-store"
import { DesktopOnlyNote } from "../desktop-only-note"
import { useRunnerCtx } from "../run/runner-context"
import { readBundleFiles } from "./files"

/** Step ids the dialog reads back out of the reports to keep the store in step with the disk. */
const PROFILES_KEEP_STEP = "import-profiles-keep"
const PROFILES_STEP = "import-profiles"
const SETTINGS_STEP = "import-settings"

/** Whether one step of a run actually happened. */
const landed = (reports: readonly StepReport[], id: string) =>
  reports.some((r) => r.id === id && (r.status === "done" || r.status === "warning"))

/** One toggleable group in the preview. */
function PartCard({
  id,
  label,
  checked,
  disabled,
  onToggle,
  children,
}: {
  id: string
  label: string
  checked: boolean
  disabled?: boolean
  onToggle: (on: boolean) => void
  children?: React.ReactNode
}) {
  return (
    <Card className="gap-2 p-3">
      <div className="flex items-center gap-2">
        <Checkbox
          id={id}
          checked={checked}
          disabled={disabled}
          onCheckedChange={(v) => onToggle(v === true)}
        />
        <Label htmlFor={id} className="font-normal">
          {label}
        </Label>
      </div>
      {children}
    </Card>
  )
}

/** Two-way mode switch rendered as a pair of small buttons. */
function ModeToggle<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="flex gap-1">
      {options.map((o) => (
        <Button
          key={o.value}
          size="sm"
          variant={value === o.value ? "secondary" : "ghost"}
          className="h-7 text-xs"
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </Button>
      ))}
    </div>
  )
}

export function ImportBundleDialog({ onImported }: { onImported?: () => void }) {
  const t = useT()
  const b = t.bundle
  const plan = useAppStore((s) => s.plan)
  const paths = useAppStore((s) => s.paths)
  const profiles = useAppStore((s) => s.profiles)
  const settings = useAppStore((s) => s.settings)
  const effectiveOS = useAppStore((s) => s.effectiveOS)
  const loadPlan = useAppStore((s) => s.loadPlan)
  const setProfiles = useAppStore((s) => s.setProfiles)
  const setSettings = useAppStore((s) => s.setSettings)

  const mounted = useMounted()
  // Web mode can read a pasted backup but has nothing to write it to — say so
  // rather than leaving Choose file and Import as buttons that do nothing.
  const webOnly = mounted && !isTauri()

  const [open, setOpen] = useState(false)
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const [localFiles, setLocalFiles] = useState<Partial<Record<BundleFileKey, string>>>({})
  const [providers, setProviders] = useState<Provider[]>([])
  const [ccRunning, setCcRunning] = useState(false)

  const [want, setWant] = useState({
    plan: true,
    profiles: true,
    providers: true,
    settings: true,
  })
  const [planMode, setPlanMode] = useState<PlanMode>("merge")
  const [profilesMode, setProfilesMode] = useState<ProfilesMode>("merge")
  const [overwriteProviders, setOverwriteProviders] = useState(false)
  /** Explicit per-file choices; a key that's absent falls back to the default below. */
  const [fileOverride, setFileOverride] = useState<Record<string, boolean>>({})

  const parsed = useMemo(() => (text.trim() ? parseBundle(text, t) : null), [text, t])
  const bundle = parsed?.ok ? parsed.bundle : null
  // Provider rows and the persisted backend choice form one portable unit. If
  // settings are not being imported, keep the machine's current store instead.
  const targetBackend =
    want.settings && bundle?.settings?.providerBackend
      ? bundle.settings.providerBackend
      : settings.providerBackend

  // Local state the preview diffs against, loaded once the dialog opens.
  useEffect(() => {
    if (!open || !isTauri() || !paths) return
    let cancelled = false
    void readBundleFiles(paths).then((files) => {
      if (!cancelled) setLocalFiles(files)
    })
    void providerLoad(targetBackend)
      .then((nextProviders) => {
        if (!cancelled) setProviders(nextProviders)
      })
      .catch(() => {
        if (!cancelled) setProviders([])
      })
    const running =
      targetBackend === "ccswitch" ? isProcessRunning("cc-switch") : Promise.resolve(false)
    void running
      .then((isRunning) => {
        if (!cancelled) setCcRunning(isRunning)
      })
      .catch(() => {
        if (!cancelled) setCcRunning(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, paths, targetBackend])

  /**
   * What this file deliberately refused to carry. Informational rather than a
   * choice — there is nothing to tick, only something to do afterwards — and it
   * is read from the bundle itself, so it names exactly what was blanked rather
   * than what a second copy of the redaction rule thinks should have been.
   */
  const credentials = useMemo(
    () => (bundle?.plan ? pendingCredentials({ plan: bundle.plan, files: bundle.files }) : []),
    [bundle]
  )

  const planDiff = bundle?.plan ? diffPlan(plan, bundle.plan, planMode) : null
  const profilesDiff = bundle?.profiles ? diffProfiles(profiles, bundle.profiles) : null
  const providerPlan = bundle?.providers ? planImport(bundle.providers, providers) : null
  const fileDiffs = useMemo(
    () => (bundle?.files ? diffFiles(bundle.files, localFiles) : []),
    [bundle, localFiles]
  )
  // The proxy credentials a redacted bundle blanked are put back before the diff,
  // so "your own go back where a blank arrives" is what the preview shows too.
  const incomingSettings = bundle?.settings
    ? keepLocalSettingsSecrets(bundle.settings, settings)
    : null
  const settingsChanges = incomingSettings ? diffSettings(settings, incomingSettings) : []

  // Files default to on, except one whose local copy can't be parsed — there we
  // couldn't preserve the machine's credentials, so importing it is opt-in.
  // Derived rather than synced through an effect, with the user's own choices
  // layered on top; a freshly pasted bundle drops those choices.
  const [prevText, setPrevText] = useState(text)
  if (text !== prevText) {
    setPrevText(text)
    setFileOverride({})
  }
  const fileChecked = (d: FileDiff) => fileOverride[d.key] ?? !d.localUnreadable
  const selectedFiles = fileDiffs.filter(fileChecked)
  // One answer per part, read by the checkbox, the Import button and the step
  // builder alike. Providers drawn unticked-and-disabled while cc-switch holds
  // the database used to be staged anyway, and failed in front of everything
  // after them.
  const importProviders = !!bundle?.providers && want.providers && !ccRunning
  const importProfiles = !!bundle?.profiles && want.profiles && profilesMode !== "skip"
  const importSettings = want.settings && settingsChanges.length > 0
  const anySelected =
    (bundle?.plan && want.plan) ||
    importProfiles ||
    importProviders ||
    selectedFiles.length > 0 ||
    importSettings

  const { run } = useRunnerCtx()

  /**
   * The two imported settings that act outside React. Everything else in
   * `AppSettings` is read from the store as it renders, so `setSettings` is
   * enough; these were only ever applied at startup, which left an import that
   * looked finished while the hotkey and agentpack's own proxy behaved as before.
   */
  const applySettingsLive = async (before: AppSettings, next: Partial<AppSettings>) => {
    if ("summonShortcut" in next && next.summonShortcut !== before.summonShortcut) {
      if (before.summonShortcut) await unregisterSummonShortcut(before.summonShortcut)
      const accel = next.summonShortcut
      if (accel && !(await registerSummonShortcut(accel))) {
        // The startup rule: a switch left on for a hotkey another app owns is
        // worse than an honest "off".
        setSettings({ summonShortcut: null })
        void saveSettings({ summonShortcut: null })
        toast.error(t.preferences.hotkeyTaken(accel))
      }
    }
    if ("proxy" in next && JSON.stringify(next.proxy) !== JSON.stringify(before.proxy)) {
      const eff = effectiveProxy(next.proxy ?? undefined)
      await setProcessProxy({
        http: eff.http,
        https: eff.https,
        all: eff.all,
        noProxy: eff.noProxy,
      }).catch(() => {})
    }
  }

  const doImport = async () => {
    if (!bundle || !paths || !isTauri()) return
    setBusy(true)
    try {
      // A snapshot always goes first: everything after this point overwrites a
      // file or a DB row the user didn't author.
      const steps: StepDescriptor[] = [snapshotStep("import", t, targetBackend)]
      if (importProviders && providerPlan) {
        for (const entry of providerPlan.fresh)
          steps.push(providerImportStep(entry, undefined, t, targetBackend))
        if (overwriteProviders) {
          for (const c of providerPlan.conflicts)
            steps.push(providerImportStep(c.entry, c.existing.id, t, targetBackend))
        }
      }
      for (const d of selectedFiles) {
        steps.push(bundleFileStep(d.key, paths[d.key], bundle.files![d.key]!, t))
      }

      // Profiles and settings are writes too, so they are steps: listed in the
      // panel, gated by it, and left alone by a run that is discarded or stopped.
      // What gets written is what the preview above was computed from.
      let mergedProfiles: Profile[] | null = null
      if (importProfiles) {
        mergedProfiles = mergeProfiles(profiles, bundle.profiles!, profilesMode)
        const path = profilesPath(paths.home)
        // backup.rs doesn't cover profiles.json, so keep a sidecar of what is
        // there immediately before this import — the one way back from a
        // Replace. A plain copy, which is exactly what a file restore does.
        const before = await readTextFile(path).catch(() => "")
        const keep = before.trim().length > 0
        if (keep) {
          steps.push({
            kind: "fileRestore",
            id: PROFILES_KEEP_STEP,
            label: b.stepProfilesKeep(path),
            path: `${path}${BACKUP_SUFFIX}`,
            backupPath: path,
          })
        }
        const serialized = serializeProfiles({ version: PROFILE_VERSION, profiles: mergedProfiles })
        steps.push({
          kind: "mergeFile",
          id: PROFILES_STEP,
          label: b.stepProfilesWrite(path),
          path,
          merge: () => serialized,
          writtenNote: b.profilesWritten(mergedProfiles.length),
          // Never replace the list without the copy that undoes it.
          ...(keep ? { dependsOn: [PROFILES_KEEP_STEP] } : {}),
        })
      }
      if (importSettings && incomingSettings) {
        steps.push({
          kind: "appSettings",
          id: SETTINGS_STEP,
          label: b.stepSettings(settingsChanges.length),
          patch: incomingSettings,
          lines: settingsChanges.map(describeSettingsChange),
        })
      }

      const reports = await run(steps, { activity: { title: b.importTitle, source: "section" } })
      // Walked away from the review panel: nothing ran. The dialog stays open
      // with the same choices, so changing one and trying again is one click.
      if (reports.length === 0) {
        toast.message(b.importDiscarded)
        return
      }
      // Whatever did reach the disk, the store has to agree with — otherwise the
      // next profile save writes the old list straight back over the new one.
      if (mergedProfiles && landed(reports, PROFILES_STEP)) setProfiles(mergedProfiles)
      if (incomingSettings && landed(reports, SETTINGS_STEP)) {
        setSettings(incomingSettings)
        await applySettingsLive(settings, incomingSettings)
      }
      // A failed or stopped run leaves the machine somewhere we didn't intend;
      // don't compound it by moving the selection somewhere else too. A failure
      // is explained in the panel; a stop has nothing on screen saying so.
      if (!runApplied(reports)) {
        if (!reports.some((r) => r.status === "error")) toast.message(b.importStopped)
        return
      }

      if (bundle.plan && want.plan) {
        const next = planMode === "merge" ? mergePlan(plan, bundle.plan) : bundle.plan
        loadPlan(keepLocalSecrets(retargetPlanOs(next, effectiveOS()), plan))
      }
      toast.success(b.importDone)
      setOpen(false)
      setText("")
      onImported?.()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Upload className="size-4" />
          {b.importOpen}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{b.importTitle}</DialogTitle>
          <DialogDescription>{b.importHint}</DialogDescription>
        </DialogHeader>

        {webOnly ? <DesktopOnlyNote>{b.importWebNote}</DesktopOnlyNote> : null}

        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={webOnly}
            onClick={async () => {
              const path = await pickFile([{ name: "json", extensions: ["json"] }])
              if (path) setText(await readTextFile(path).catch(() => ""))
            }}
          >
            {b.chooseFile}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={async () => setText((await readTextFromClipboard()) ?? "")}
          >
            {b.pasteClipboard}
          </Button>
        </div>

        <Textarea
          aria-label={b.importTitle}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={b.importPlaceholder}
          className="min-h-24 font-mono text-xs"
        />

        {parsed && !parsed.ok ? <p className="text-sm text-destructive">{parsed.error}</p> : null}

        {bundle ? (
          <ScrollArea className="max-h-[50vh]">
            <div className="flex flex-col gap-3 pr-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {bundle.app.version ? <Badge variant="outline">{bundle.app.version}</Badge> : null}
                <Badge variant="outline">{bundle.app.os}</Badge>
                {parsed?.ok && parsed.legacy ? <Badge>{b.legacyDetected}</Badge> : null}
                {parsed?.ok && parsed.skipped.length > 0 ? (
                  <span className="text-destructive">
                    {b.skippedParts(parsed.skipped.join(", "))}
                  </span>
                ) : null}
              </div>

              {bundle.secrets ? (
                <Alert variant="destructive">
                  <TriangleAlert className="size-4" />
                  <AlertDescription>{b.secretsPresent}</AlertDescription>
                </Alert>
              ) : null}

              {bundle.plan && planDiff ? (
                <PartCard
                  id="imp-plan"
                  label={b.partPlan}
                  checked={want.plan}
                  onToggle={(v) => setWant((w) => ({ ...w, plan: v }))}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      {b.diffAdded(
                        planDiff.clis.added.length +
                          planDiff.skills.added.length +
                          planDiff.mcps.added.length
                      )}{" "}
                      {b.diffRemoved(
                        planDiff.clis.removed.length +
                          planDiff.skills.removed.length +
                          planDiff.mcps.removed.length
                      )}
                      {planDiff.networkChanged ? ` · ${b.diffNetwork}` : ""}
                    </span>
                    <ModeToggle
                      value={planMode}
                      onChange={setPlanMode}
                      options={[
                        { value: "merge", label: b.planMerge },
                        { value: "replace", label: b.planReplace },
                      ]}
                    />
                  </div>
                </PartCard>
              ) : null}

              {bundle.profiles && profilesDiff ? (
                <PartCard
                  id="imp-profiles"
                  label={b.partProfiles}
                  checked={want.profiles}
                  onToggle={(v) => setWant((w) => ({ ...w, profiles: v }))}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      {b.diffProfiles(profilesDiff.fresh, profilesDiff.updated)}
                    </span>
                    <ModeToggle
                      value={profilesMode}
                      onChange={setProfilesMode}
                      options={[
                        { value: "merge", label: b.profilesMerge },
                        { value: "replace", label: b.profilesReplace },
                        { value: "skip", label: b.profilesSkip },
                      ]}
                    />
                  </div>
                  {want.profiles && profilesMode === "replace" && profilesDiff.dropped > 0 ? (
                    <p className="text-xs text-destructive">
                      {b.profilesDropped(profilesDiff.dropped)}
                    </p>
                  ) : null}
                </PartCard>
              ) : null}

              {bundle.providers && providerPlan ? (
                <PartCard
                  id="imp-providers"
                  label={b.partProviders}
                  checked={importProviders}
                  disabled={ccRunning}
                  onToggle={(v) => setWant((w) => ({ ...w, providers: v }))}
                >
                  <span className="text-xs text-muted-foreground">
                    {b.diffProviders(providerPlan.fresh.length, providerPlan.conflicts.length)}
                  </span>
                  {ccRunning ? (
                    <p className="text-xs text-destructive">{b.ccSwitchRunning}</p>
                  ) : providerPlan.conflicts.length > 0 ? (
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="imp-overwrite"
                        checked={overwriteProviders}
                        onCheckedChange={(v) => setOverwriteProviders(v === true)}
                      />
                      <Label htmlFor="imp-overwrite" className="text-xs font-normal">
                        {b.overwriteConflicts}
                      </Label>
                    </div>
                  ) : null}
                </PartCard>
              ) : null}

              {fileDiffs.length > 0 ? (
                <Card className="gap-2 p-3">
                  <div className="text-sm">{b.partFiles}</div>
                  {fileDiffs.map((d) => (
                    <div key={d.key} className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id={`imp-file-${d.key}`}
                          checked={fileChecked(d)}
                          onCheckedChange={(v) =>
                            setFileOverride((f) => ({ ...f, [d.key]: v === true }))
                          }
                        />
                        <Label
                          htmlFor={`imp-file-${d.key}`}
                          className="font-mono text-xs font-normal"
                        >
                          {d.key}
                        </Label>
                        <Badge variant="secondary" className="font-normal">
                          {d.status === "new"
                            ? b.fileNew
                            : d.status === "same"
                              ? b.fileSame
                              : b.fileDiffers}
                        </Badge>
                      </div>
                      {d.localUnreadable ? (
                        <p className="pl-6 text-xs text-destructive">{b.fileLocalUnreadable}</p>
                      ) : d.changedKeys.length > 0 ? (
                        <p className="truncate pl-6 font-mono text-xs text-muted-foreground">
                          {d.changedKeys.join(", ")}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </Card>
              ) : null}

              {credentials.length > 0 ? (
                <Card className="gap-2 p-3">
                  <div className="text-sm">{b.partCredentials}</div>
                  <p className="text-xs text-muted-foreground">{b.credentialsHint}</p>
                  {credentials.map((c) => (
                    <p
                      key={`${c.kind}-${c.owner}-${c.field ?? ""}`}
                      className="font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]"
                    >
                      {c.kind === "mcpKey"
                        ? b.credentialMcpKey(c.owner, c.field ?? "")
                        : c.kind === "proxyPassword"
                          ? b.credentialProxy(c.field ?? "")
                          : b.credentialConfigField(c.owner, c.field ?? "")}
                    </p>
                  ))}
                </Card>
              ) : null}

              {bundle.settings && settingsChanges.length > 0 ? (
                <PartCard
                  id="imp-settings"
                  label={b.partSettings}
                  checked={want.settings}
                  onToggle={(v) => setWant((w) => ({ ...w, settings: v }))}
                >
                  {settingsChanges.map((c) => (
                    <p
                      key={String(c.key)}
                      className="font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]"
                    >
                      {describeSettingsChange(c)}
                    </p>
                  ))}
                </PartCard>
              ) : null}
            </div>
          </ScrollArea>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {t.configFiles.cancel}
          </Button>
          <Button disabled={busy || !anySelected || webOnly} onClick={() => void doImport()}>
            {b.importOpen}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
