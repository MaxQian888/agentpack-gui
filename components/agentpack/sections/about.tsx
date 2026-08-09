"use client"

import { useEffect, useState } from "react"
import { CheckCircle2, Download, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Kbd } from "@/components/ui/kbd"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Progress } from "@/components/ui/progress"
import { Switch } from "@/components/ui/switch"
import { Spinner } from "@/components/ui/spinner"
import { isTauri } from "@/lib/tauri"
import {
  checkForUpdate,
  downloadAndInstallUpdate,
  getAppVersion,
  restartApp,
} from "@/lib/tauri/updater"
import { saveSettings } from "@/lib/tauri/settings"
import { osSummary } from "@/lib/tauri/os"
import {
  DEFAULT_SUMMON_SHORTCUT,
  registerSummonShortcut,
  unregisterSummonShortcut,
} from "@/lib/tauri/shortcut"
import { openUrl, revealPath } from "@/lib/tauri/system"
import { useLocale, useT } from "@/lib/i18n/provider"
import type { Lang } from "@/lib/i18n/types"
import type { OS } from "@/lib/agentpack/types"
import { useAppStore } from "@/store/app-store"
import { CapabilityMetric, CapabilityTile, CapabilityWorkbench } from "./capability-workbench"
import { DesktopOnlyNote } from "../desktop-only-note"

const RELEASES_URL = "https://github.com/Arxtect/agentpack-gui/releases"

const OS_OPTIONS: OS[] = ["win", "mac", "linux"]

export function AboutSection() {
  const t = useT()
  const { lang, setLang } = useLocale()
  const osOverride = useAppStore((s) => s.osOverride)
  const setOsOverride = useAppStore((s) => s.setOsOverride)
  const appVersion = useAppStore((s) => s.appVersion)
  const updateState = useAppStore((s) => s.updateState)
  const updateInfo = useAppStore((s) => s.updateInfo)
  const downloadProgress = useAppStore((s) => s.downloadProgress)
  const settings = useAppStore((s) => s.settings)
  const paths = useAppStore((s) => s.paths)
  const setAppVersion = useAppStore((s) => s.setAppVersion)
  const setUpdateState = useAppStore((s) => s.setUpdateState)
  const setUpdateInfo = useAppStore((s) => s.setUpdateInfo)
  const setDownloadProgress = useAppStore((s) => s.setDownloadProgress)
  const setSettings = useAppStore((s) => s.setSettings)
  const setOnboardingOpen = useAppStore((s) => s.setOnboardingOpen)
  const setTourActive = useAppStore((s) => s.setTourActive)

  // Host OS/arch line ("macOS 15.3 · aarch64"), from @tauri-apps/plugin-os.
  // Null in web mode, where the row is simply not rendered.
  const [system, setSystem] = useState<string | null>(null)
  const [systemResolved, setSystemResolved] = useState(false)
  const [updateError, setUpdateError] = useState<string | null>(null)

  // Resolve the app version if the startup effect hasn't already (e.g. the user
  // lands here first). No-op in web mode (returns null).
  useEffect(() => {
    if (appVersion !== null) return
    getAppVersion()
      .then((v) => {
        if (v) setAppVersion(v)
      })
      .catch(() => {})
  }, [appVersion, setAppVersion])

  useEffect(() => {
    void osSummary().then((summary) => {
      setSystem(summary)
      setSystemResolved(true)
    })
  }, [])

  const checking = updateState === "checking"
  const downloading = updateState === "downloading" || updateState === "ready"
  const showUpdate =
    (updateState === "available" || updateState === "downloading" || updateState === "ready") &&
    !!updateInfo

  const onCheck = async () => {
    setUpdateError(null)
    setUpdateState("checking")
    const checkedAt = Date.now()
    setSettings({ lastCheckAt: checkedAt })
    void saveSettings({ lastCheckAt: checkedAt })
    try {
      const info = await checkForUpdate()
      if (info) {
        setUpdateInfo(info)
        setUpdateState("available")
      } else {
        setUpdateInfo(null)
        setUpdateState("upToDate")
      }
    } catch (error) {
      setUpdateError(error instanceof Error ? error.message : String(error))
      setUpdateState("error")
      toast.error(t.about.checkFailed)
    }
  }

  const onInstall = async () => {
    setUpdateError(null)
    setUpdateState("downloading")
    setDownloadProgress(0)
    try {
      await downloadAndInstallUpdate((pct) => setDownloadProgress(pct))
      setUpdateState("ready")
      await restartApp()
    } catch (error) {
      setUpdateError(error instanceof Error ? error.message : String(error))
      setUpdateState("error")
      toast.error(t.about.checkFailed)
    }
  }

  const onSkip = () => {
    const version = updateInfo?.version
    if (!version) return
    setSettings({ skippedVersion: version })
    void saveSettings({ skippedVersion: version })
    setUpdateInfo(null)
    setUpdateError(null)
    setUpdateState("idle")
  }

  const onToggleAutoCheck = (checked: boolean) => {
    setSettings({ autoCheckUpdates: checked })
    void saveSettings({ autoCheckUpdates: checked })
  }

  /**
   * Claim (or release) the global accelerator. Only persist it once the OS has
   * actually granted it — another app may already own the combination, and a
   * switch left on for a hotkey that does nothing is worse than an honest error.
   */
  const onToggleSummonShortcut = async (checked: boolean) => {
    if (!checked) {
      if (settings.summonShortcut) await unregisterSummonShortcut(settings.summonShortcut)
      setSettings({ summonShortcut: null })
      await saveSettings({ summonShortcut: null })
      return
    }
    if (await registerSummonShortcut(DEFAULT_SUMMON_SHORTCUT)) {
      setSettings({ summonShortcut: DEFAULT_SUMMON_SHORTCUT })
      await saveSettings({ summonShortcut: DEFAULT_SUMMON_SHORTCUT })
    } else {
      toast.error(t.about.shortcutTaken(DEFAULT_SUMMON_SHORTCUT))
    }
  }

  const lastChecked = settings.lastCheckAt
    ? new Date(settings.lastCheckAt).toLocaleString()
    : t.about.never
  const updateLabel = checking
    ? t.about.checking
    : showUpdate && updateInfo
      ? updateInfo.version
      : updateState === "upToDate"
        ? t.about.updateCurrent
        : updateState === "error"
          ? t.about.updateFailed
          : t.about.updateNotChecked

  return (
    <CapabilityWorkbench
      title={t.about.title}
      subtitle={t.about.subtitle}
      summaryLabel={t.about.summaryLabel}
      actionsLabel={t.about.actionsLabel}
      metrics={
        <>
          <CapabilityMetric
            label={t.about.metricVersion}
            value={appVersion ?? "—"}
            detail={appVersion ? undefined : t.about.versionUnknown}
          />
          <CapabilityMetric
            label={t.about.metricSystem}
            value={system?.split(" · ")[0] ?? "—"}
            detail={
              system
                ? undefined
                : systemResolved
                  ? t.about.systemUnavailable
                  : t.about.systemLoading
            }
          />
          <CapabilityMetric label={t.about.metricUpdate} value={updateLabel} />
          <CapabilityMetric label={t.about.metricLanguage} value={lang} />
        </>
      }
      primary={
        <section aria-label={t.about.settingsPanel} className="min-w-0">
          <Card className="gap-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">
                  {appVersion ? t.about.currentVersion(appVersion) : t.about.versionUnknown}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t.about.lastChecked(lastChecked)}
                </p>
                {system ? <p className="mt-0.5 text-xs text-muted-foreground">{system}</p> : null}
              </div>
              <Button
                variant="outline"
                onClick={onCheck}
                disabled={!isTauri() || checking || downloading}
                className="gap-2"
              >
                {checking ? <Spinner className="size-4" /> : <RefreshCw className="size-4" />}
                {checking ? t.about.checking : t.about.checkNow}
              </Button>
            </div>

            {updateState === "upToDate" ? (
              <div className="flex items-center gap-2 text-sm text-[var(--hm-ok)]">
                <CheckCircle2 className="size-4" />
                {t.about.upToDate}
              </div>
            ) : null}

            {updateState === "error" ? (
              <p role="alert" className="text-sm text-[var(--hm-danger)]">
                {t.about.updateError(updateError ?? t.about.unknownError)}
              </p>
            ) : null}

            {showUpdate && updateInfo ? (
              <div className="flex flex-col gap-3 border-t pt-4">
                <div className="flex items-center gap-2">
                  <Badge className="font-normal">
                    {t.about.updateAvailable(updateInfo.version)}
                  </Badge>
                </div>

                {updateInfo.body ? (
                  <div>
                    <div className="mb-1 text-xs font-medium text-muted-foreground">
                      {t.about.releaseNotes}
                    </div>
                    <p className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted/50 p-3 text-xs">
                      {updateInfo.body}
                    </p>
                  </div>
                ) : null}

                {downloading ? (
                  <div className="flex items-center gap-3">
                    <Progress value={downloadProgress} className="h-1.5 flex-1" />
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {downloadProgress}%
                    </span>
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  <Button onClick={onInstall} disabled={downloading} className="gap-2">
                    {downloading ? <Spinner className="size-4" /> : <Download className="size-4" />}
                    {downloading ? t.about.installing : t.about.installAndRestart}
                  </Button>
                  <Button variant="outline" onClick={onSkip} disabled={downloading}>
                    {t.about.skipVersion}
                  </Button>
                  <Button variant="ghost" onClick={() => void openUrl(RELEASES_URL)}>
                    {t.about.viewOnGitHub}
                  </Button>
                </div>
              </div>
            ) : null}

            {/* Language and the OS override moved here out of the header: they are
            set once and then never again, and the title bar's job is to say
            where you are, not to hold every preference the app has. */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              <Label htmlFor="app-language" className="cursor-pointer text-sm">
                {t.shell.language}
              </Label>
              <NativeSelect
                id="app-language"
                size="sm"
                value={lang}
                onChange={(e) => setLang(e.target.value as Lang)}
              >
                <NativeSelectOption value="en">EN</NativeSelectOption>
                <NativeSelectOption value="zh-CN">中文</NativeSelectOption>
              </NativeSelect>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              <div className="min-w-0">
                <Label htmlFor="os-override" className="cursor-pointer text-sm">
                  {t.shell.osOverride}
                </Label>
                <p className="mt-0.5 text-xs text-muted-foreground">{t.about.osOverrideHint}</p>
              </div>
              <NativeSelect
                id="os-override"
                size="sm"
                value={osOverride ?? "auto"}
                onChange={(e) =>
                  setOsOverride(e.target.value === "auto" ? null : (e.target.value as OS))
                }
              >
                <NativeSelectOption value="auto">{t.shell.osAuto}</NativeSelectOption>
                {OS_OPTIONS.map((os) => (
                  <NativeSelectOption key={os} value={os}>
                    {os}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>

            <div className="flex items-center justify-between gap-3 border-t pt-4">
              <Label htmlFor="auto-check" className="cursor-pointer text-sm">
                {t.about.autoCheckLabel}
              </Label>
              <Switch
                id="auto-check"
                checked={settings.autoCheckUpdates}
                onCheckedChange={onToggleAutoCheck}
              />
            </div>
            <div className="flex items-center justify-between gap-3 border-t pt-4">
              <div>
                <Label htmlFor="summon-shortcut" className="cursor-pointer text-sm">
                  {t.about.summonShortcutLabel}
                </Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t.about.summonShortcutHint} <Kbd>{DEFAULT_SUMMON_SHORTCUT}</Kbd>
                </p>
              </div>
              <Switch
                id="summon-shortcut"
                disabled={!isTauri()}
                checked={settings.summonShortcut !== null}
                onCheckedChange={(checked) => void onToggleSummonShortcut(checked)}
              />
            </div>
            {!isTauri() ? <DesktopOnlyNote>{t.about.shortcutDesktopOnly}</DesktopOnlyNote> : null}

            <div className="flex items-center justify-between gap-3 border-t pt-4">
              <span className="text-sm">{t.welcome.title}</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setTourActive(true)}>
                  {t.tour.start}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setOnboardingOpen(true)}>
                  {t.welcome.reopen}
                </Button>
              </div>
            </div>
          </Card>
        </section>
      }
      aside={
        <CapabilityTile title={t.about.locationsTitle} description={t.about.locationsHint}>
          {paths ? (
            <div className="flex flex-col gap-2">
              <Button variant="outline" onClick={() => void revealPath(paths.claudeSettings)}>
                {t.about.openClaudeFolder}
              </Button>
              <Button variant="outline" onClick={() => void revealPath(paths.codexConfig)}>
                {t.about.openCodexFolder}
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{t.about.locationsUnavailable}</p>
          )}
        </CapabilityTile>
      }
    />
  )
}
