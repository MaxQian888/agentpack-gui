"use client"

/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V5 */
/* Hallmark · genre: modern-minimal · macrostructure: asymmetric settings workbench · theme: inherited Cobalt · contrast: pass (40–41) · slop: pass (42–49) · mobile: pass (34, 49, 50–57) */

import { useEffect, useState } from "react"
import { CheckCircle2, Download, ExternalLink, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
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
import { openUrl, revealPath } from "@/lib/tauri/system"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { CapabilityTile, CapabilityWorkbench } from "./capability-workbench"
import { SectionStatus } from "./section-status"

const RELEASES_URL = "https://github.com/Arxtect/agentpack-gui/releases"

/**
 * Which build this is, and how it gets the next one. That is the whole section.
 *
 * It used to be that plus every preference the app had — language, the target
 * OS, a system-wide hotkey and the two guidance entry points — stacked under the
 * update panel as identical `border-t` rows. Those now live in Preferences, one
 * tab to the left, where they can be grouped and explained. What is left here
 * answers a single question, so the update state gets the whole column instead
 * of the top third of it.
 */
export function AboutSection() {
  const t = useT()
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

  // Host OS/arch line ("macOS 15.3 · aarch64"), from @tauri-apps/plugin-os.
  // Null in web mode, where the fact reads "—" with the reason.
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

  // Two states, not one: `null` before the call lands means "still reading",
  // and `null` after it means "web mode can't tell you". The summary strip says
  // which — a bare `—` with no reason is what design.md § 2 rules out.
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
      actionsLabel={t.about.actionsLabel}
      actions={
        <Button
          variant="outline"
          onClick={() => void onCheck()}
          disabled={!isTauri() || checking || downloading}
          className="gap-2"
        >
          {checking ? <Spinner className="size-4" /> : <RefreshCw className="size-4" />}
          {checking ? t.about.checking : t.about.checkNow}
        </Button>
      }
      lead={
        <SectionStatus
          label={t.about.summaryLabel}
          facts={[
            { label: t.about.metricVersion, value: appVersion ?? "—" },
            { label: t.about.metricSystem, value: system?.split(" · ")[0] ?? "—" },
            { label: t.about.metricUpdate, value: updateLabel },
            { label: t.about.metricChecked, value: lastChecked },
          ]}
          notes={[
            appVersion ? null : t.about.versionUnknown,
            system ? null : systemResolved ? t.about.systemUnavailable : t.about.systemLoading,
          ]}
        />
      }
      primary={
        <section
          aria-label={t.about.updatePanel}
          className="flex min-w-0 flex-col gap-4 rounded-lg border p-5"
        >
          <div className="min-w-0">
            <div className="text-sm font-medium">
              {appVersion ? t.about.currentVersion(appVersion) : t.about.versionUnknown}
            </div>
            <p className="mt-0.5 font-mono text-[var(--hm-text-2xs)] text-muted-foreground [overflow-wrap:anywhere]">
              {t.about.lastChecked(lastChecked)}
              {system ? ` · ${system}` : ""}
            </p>
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
                <Badge className="font-normal">{t.about.updateAvailable(updateInfo.version)}</Badge>
              </div>

              {updateInfo.body ? (
                <div>
                  <div className="mb-1 font-mono text-[var(--hm-text-2xs)] tracking-[var(--hm-tracking-mono)] text-muted-foreground uppercase">
                    {t.about.releaseNotes}
                  </div>
                  <p className="max-h-40 overflow-auto whitespace-pre-wrap rounded-[var(--hm-radius-surface)] bg-muted/50 p-3 text-xs">
                    {updateInfo.body}
                  </p>
                </div>
              ) : null}

              {downloading ? (
                <div className="flex items-center gap-3">
                  <Progress value={downloadProgress} className="h-1.5 flex-1" />
                  <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                    {downloadProgress}%
                  </span>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void onInstall()} disabled={downloading} className="gap-2">
                  {downloading ? <Spinner className="size-4" /> : <Download className="size-4" />}
                  {downloading ? t.about.installing : t.about.installAndRestart}
                </Button>
                <Button variant="outline" onClick={onSkip} disabled={downloading}>
                  {t.about.skipVersion}
                </Button>
              </div>
            </div>
          ) : null}
        </section>
      }
      aside={
        <>
          <CapabilityTile title={t.about.locationsTitle} description={t.about.locationsHint}>
            {paths ? (
              <div className="flex flex-col gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void revealPath(paths.claudeSettings)}
                >
                  {t.about.openClaudeFolder}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void revealPath(paths.codexConfig)}
                >
                  {t.about.openCodexFolder}
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">{t.about.locationsUnavailable}</p>
            )}
          </CapabilityTile>
          <CapabilityTile title={t.about.sourceTitle} description={t.about.sourceHint}>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => void openUrl(RELEASES_URL)}
            >
              <ExternalLink className="size-4" />
              {t.about.viewOnGitHub}
            </Button>
          </CapabilityTile>
        </>
      }
    />
  )
}
