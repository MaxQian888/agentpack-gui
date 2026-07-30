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
  diffFiles,
  diffPlan,
  diffProfiles,
  diffSettings,
  keepLocalSecrets,
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
import { profilesPath, serializeProfiles, PROFILE_VERSION } from "@/lib/agentpack/profile"
import type { StepDescriptor } from "@/lib/agentpack/types"
import { useT } from "@/lib/i18n/provider"
import { isTauri } from "@/lib/tauri"
import { readTextFromClipboard } from "@/lib/tauri/clipboard"
import {
  ccLoadProviders,
  isProcessRunning,
  readTextFile,
  writeTextFile,
} from "@/lib/tauri/commands"
import { pickFile } from "@/lib/tauri/dialog"
import { saveSettings } from "@/lib/tauri/settings"
import { useAppStore } from "@/store/app-store"
import { useRunnerCtx } from "../run/runner-context"
import { readBundleFiles } from "./files"

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
  const dryRun = useAppStore((s) => s.dryRun)
  const effectiveOS = useAppStore((s) => s.effectiveOS)
  const loadPlan = useAppStore((s) => s.loadPlan)
  const setProfiles = useAppStore((s) => s.setProfiles)
  const setSettings = useAppStore((s) => s.setSettings)

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

  // Local state the preview diffs against, loaded once the dialog opens.
  useEffect(() => {
    if (!open || !isTauri() || !paths) return
    void readBundleFiles(paths).then(setLocalFiles)
    void ccLoadProviders()
      .then(setProviders)
      .catch(() => setProviders([]))
    void isProcessRunning("cc-switch")
      .then(setCcRunning)
      .catch(() => setCcRunning(false))
  }, [open, paths])

  const planDiff = bundle?.plan ? diffPlan(plan, bundle.plan, planMode) : null
  const profilesDiff = bundle?.profiles ? diffProfiles(profiles, bundle.profiles) : null
  const providerPlan = bundle?.providers ? planImport(bundle.providers, providers) : null
  const fileDiffs = useMemo(
    () => (bundle?.files ? diffFiles(bundle.files, localFiles) : []),
    [bundle, localFiles]
  )
  const settingsChanges = bundle?.settings ? diffSettings(settings, bundle.settings) : []

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
  const anySelected =
    (bundle?.plan && want.plan) ||
    (bundle?.profiles && want.profiles && profilesMode !== "skip") ||
    (bundle?.providers && want.providers) ||
    selectedFiles.length > 0 ||
    (bundle?.settings && want.settings)

  const { run } = useRunnerCtx()

  const doImport = async () => {
    if (!bundle || !paths) return
    setBusy(true)
    try {
      // A snapshot always goes first: everything after this point overwrites a
      // file or a DB row the user didn't author.
      const steps: StepDescriptor[] = [snapshotStep("import", t)]
      if (bundle.providers && want.providers && providerPlan) {
        for (const entry of providerPlan.fresh) steps.push(providerImportStep(entry, undefined, t))
        if (overwriteProviders) {
          for (const c of providerPlan.conflicts)
            steps.push(providerImportStep(c.entry, c.existing.id, t))
        }
      }
      for (const d of selectedFiles) {
        steps.push(bundleFileStep(d.key, paths[d.key], bundle.files![d.key]!, t))
      }

      const reports = await run(steps)
      // A failed write means the machine is in a state we didn't intend; don't
      // compound it by moving the in-memory store somewhere else too.
      if (reports.some((r) => r.status === "error")) return
      // Dry-run must mean dry-run: the runner honours it for steps, but these
      // store writes are ours and would otherwise land for real.
      if (dryRun) {
        toast.message(b.dryRunSkipped)
        setOpen(false)
        return
      }

      if (bundle.plan && want.plan) {
        const next = planMode === "merge" ? mergePlan(plan, bundle.plan) : bundle.plan
        loadPlan(keepLocalSecrets(retargetPlanOs(next, effectiveOS()), plan))
      }
      if (bundle.profiles && want.profiles && profilesMode !== "skip") {
        const merged = mergeProfiles(profiles, bundle.profiles, profilesMode)
        // backup.rs doesn't cover profiles.json, so keep a sidecar of what was
        // there immediately before this import.
        const path = profilesPath(paths.home)
        const before = await readTextFile(path).catch(() => "")
        if (before.trim()) await writeTextFile(`${path}${BACKUP_SUFFIX}`, before)
        setProfiles(merged)
        await writeTextFile(path, serializeProfiles({ version: PROFILE_VERSION, profiles: merged }))
      }
      if (bundle.settings && want.settings) {
        setSettings(bundle.settings)
        await saveSettings(bundle.settings)
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
        <Button variant="outline" className="gap-2">
          <Upload className="size-4" />
          {b.importOpen}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{b.importTitle}</DialogTitle>
          <DialogDescription>{b.importHint}</DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
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
                </PartCard>
              ) : null}

              {bundle.providers && providerPlan ? (
                <PartCard
                  id="imp-providers"
                  label={b.partProviders}
                  checked={want.providers && !ccRunning}
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

              {bundle.settings && settingsChanges.length > 0 ? (
                <PartCard
                  id="imp-settings"
                  label={b.partSettings}
                  checked={want.settings}
                  onToggle={(v) => setWant((w) => ({ ...w, settings: v }))}
                >
                  {settingsChanges.map((c) => (
                    <p key={String(c.key)} className="font-mono text-xs text-muted-foreground">
                      {`${String(c.key)}: ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`}
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
          <Button disabled={busy || !anySelected} onClick={() => void doImport()}>
            {b.importOpen}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
