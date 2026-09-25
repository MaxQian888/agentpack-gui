"use client"

import { useState } from "react"
import { Download, TriangleAlert } from "lucide-react"
import { toast } from "sonner"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { useMounted } from "@/hooks/use-mounted"
import { buildBundle, serializeBundle } from "@/lib/agentpack/bundle/format"
import { BUNDLE_FILE_KEYS, type BundleFileKey } from "@/lib/agentpack/bundle/secrets"
import { useT } from "@/lib/i18n/provider"
import { isTauri } from "@/lib/tauri"
import { copyText } from "@/lib/tauri/clipboard"
import { providerLoad, writeTextFile } from "@/lib/tauri/commands"
import { pickSavePath } from "@/lib/tauri/dialog"
import { useAppStore } from "@/store/app-store"
import { DesktopOnlyNote } from "../desktop-only-note"
import { readBundleFiles } from "./files"

type Part = "plan" | "profiles" | "providers" | "files" | "settings"

/** The parts only the desktop app can read — web mode has no provider store and no files. */
const DESKTOP_PARTS: readonly Part[] = ["providers", "files"]

/** What a rejected promise said, as the system said it. */
const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function ExportBundleDialog() {
  const t = useT()
  const b = t.bundle
  const plan = useAppStore((s) => s.plan)
  const profiles = useAppStore((s) => s.profiles)
  const paths = useAppStore((s) => s.paths)
  const settings = useAppStore((s) => s.settings)
  const appVersion = useAppStore((s) => s.appVersion)
  const effectiveOS = useAppStore((s) => s.effectiveOS)

  const mounted = useMounted()
  // Web mode can still copy what this window holds, but can neither save a file
  // nor read the provider store and config files. Those controls say so and
  // stand down, rather than ticking parts the copy then silently leaves out.
  const webOnly = mounted && !isTauri()

  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [parts, setParts] = useState<Record<Part, boolean>>({
    plan: true,
    profiles: true,
    providers: true,
    files: true,
    settings: true,
  })
  const [fileKeys, setFileKeys] = useState<Record<BundleFileKey, boolean>>(
    () =>
      Object.fromEntries(BUNDLE_FILE_KEYS.map((k) => [k, true])) as Record<BundleFileKey, boolean>
  )
  const [includeSecrets, setIncludeSecrets] = useState(false)

  const selectedFileKeys = BUNDLE_FILE_KEYS.filter((k) => fileKeys[k])
  const included = (key: Part) => parts[key] && !(webOnly && DESKTOP_PARTS.includes(key))
  const anySelected = (Object.keys(parts) as Part[]).some(included)

  /**
   * Assemble the bundle text. `secrets` is forced off for the clipboard path.
   *
   * A provider store that can't be read rejects rather than exporting as an
   * empty list: a backup that silently has no providers in it is found out on
   * the other machine, after the one it came from is gone.
   */
  const compose = async (secrets: boolean) => {
    const providers =
      included("providers") && isTauri()
        ? await providerLoad(settings.providerBackend).catch((error: unknown) => {
            throw new Error(b.providersUnreadable(reasonOf(error)))
          })
        : undefined
    const files =
      included("files") && paths ? await readBundleFiles(paths, selectedFileKeys) : undefined
    return serializeBundle(
      buildBundle(
        {
          createdAt: Date.now(),
          app: { version: appVersion ?? "", os: effectiveOS() },
          ...(parts.plan ? { plan } : {}),
          ...(parts.profiles ? { profiles } : {}),
          ...(providers ? { providers } : {}),
          ...(files ? { files } : {}),
          ...(parts.settings ? { settings } : {}),
        },
        { includeSecrets: secrets }
      )
    )
  }

  const onSave = async () => {
    if (!anySelected) return toast.error(b.nothingToExport)
    setBusy(true)
    try {
      const text = await compose(includeSecrets)
      const path = await pickSavePath({
        defaultPath: includeSecrets ? "agentpack.bundle.secrets.json" : "agentpack.bundle.json",
        filters: [{ name: "json", extensions: ["json"] }],
      })
      if (!path) return
      await writeTextFile(path, text)
      toast.success(b.exported(path))
      setOpen(false)
    } catch (error) {
      // The dialog stays open with the same choices, so trying again is one click.
      toast.error(b.exportFailed(reasonOf(error)))
    } finally {
      setBusy(false)
    }
  }

  const onCopy = async () => {
    if (!anySelected) return toast.error(b.nothingToExport)
    setBusy(true)
    try {
      // Always redacted, whatever the switch says: the clipboard's most likely
      // destination is a chat window, and a toggle there is a foot-gun.
      const ok = await copyText(await compose(false))
      if (ok) {
        toast.success(b.copied)
        setOpen(false)
      } else {
        toast.error(b.copyFailed)
      }
    } catch (error) {
      toast.error(b.exportFailed(reasonOf(error)))
    } finally {
      setBusy(false)
    }
  }

  // The badge sits outside the Label on purpose: inside, its text would become
  // part of the checkbox's accessible name ("Plan 3 CLIs · 1 skills · …").
  const part = (key: Part, label: string, badge?: string) => (
    <div className="flex items-center gap-2 text-sm">
      <Checkbox
        id={`bundle-part-${key}`}
        checked={included(key)}
        disabled={webOnly && DESKTOP_PARTS.includes(key)}
        onCheckedChange={(v) => setParts((p) => ({ ...p, [key]: v === true }))}
      />
      <Label htmlFor={`bundle-part-${key}`} className="font-normal">
        {label}
      </Label>
      {badge ? (
        <Badge variant="secondary" className="font-normal">
          {badge}
        </Badge>
      ) : null}
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {/* Outline, not filled: the page's one primary action is saving a
            profile — see design.md's 5% rule. */}
        <Button variant="outline" size="sm" className="gap-2">
          <Download className="size-4" />
          {b.exportOpen}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{b.exportTitle}</DialogTitle>
          <DialogDescription>{b.exportHint}</DialogDescription>
        </DialogHeader>

        {webOnly ? <DesktopOnlyNote>{b.exportWebNote}</DesktopOnlyNote> : null}

        <div className="flex flex-col gap-3">
          {part(
            "plan",
            b.partPlan,
            b.planSummary(plan.clis.length, plan.skills.length, plan.mcps.length)
          )}
          {part("profiles", b.partProfiles, b.countProfiles(profiles.length))}
          {part("providers", b.partProviders)}
          {part("files", b.partFiles)}
          {included("files") ? (
            <div className="flex flex-col gap-2 pl-6">
              {BUNDLE_FILE_KEYS.map((k) => (
                <div key={k} className="flex items-center gap-2 text-xs">
                  <Checkbox
                    id={`bundle-file-${k}`}
                    checked={fileKeys[k]}
                    onCheckedChange={(v) => setFileKeys((f) => ({ ...f, [k]: v === true }))}
                  />
                  <Label htmlFor={`bundle-file-${k}`} className="font-mono font-normal">
                    {k}
                  </Label>
                </div>
              ))}
            </div>
          ) : null}
          {part("settings", b.partSettings)}

          <Separator />

          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="bundle-secrets" className="text-sm font-normal">
              {b.includeSecrets}
            </Label>
            <Switch
              id="bundle-secrets"
              checked={includeSecrets}
              onCheckedChange={setIncludeSecrets}
            />
          </div>
          <p className="text-xs text-muted-foreground">{b.secretsHint}</p>
          {includeSecrets ? (
            <Alert variant="destructive">
              <TriangleAlert className="size-4" />
              <AlertDescription>{b.secretsWarning}</AlertDescription>
            </Alert>
          ) : null}
          <p className="text-xs text-muted-foreground">{b.tomlReformatHint}</p>
        </div>

        <DialogFooter className="sm:flex-col sm:items-stretch sm:gap-2">
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={busy} onClick={() => void onCopy()}>
              {b.copyToClipboard}
            </Button>
            <Button disabled={busy || webOnly} onClick={() => void onSave()}>
              {b.saveFile}
            </Button>
          </div>
          <p className="text-right text-xs text-muted-foreground">{b.clipboardAlwaysRedacts}</p>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
