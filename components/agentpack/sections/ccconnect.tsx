"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ExternalLink, FolderOpen, Loader2, Play, RefreshCw, Square } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
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
import { findCli, installMethodsFor, upgradeCommandFor } from "@/lib/agentpack/registry"
import { cliInstallStep, cliUninstallStep } from "@/lib/agentpack/plan"
import { isUpgradeAvailable } from "@/lib/agentpack/version"
import { parseManagementPort, webUiUrl } from "@/lib/agentpack/ccconnect"
import {
  detectCli,
  isProcessRunning,
  pathExists,
  readTextFile,
  startCcConnect,
  stopCcConnect,
} from "@/lib/tauri/commands"
import { openUrl, revealPath } from "@/lib/tauri/system"
import { isTauri } from "@/lib/tauri"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { SectionShell } from "./section-shell"
import { HelpTip } from "../help-tip"
import { useRunnerCtx } from "../run/runner-context"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function CcConnectSection() {
  const t = useT()
  const c = t.ccconnect
  const paths = useAppStore((s) => s.paths)
  const effectiveOS = useAppStore((s) => s.effectiveOS)
  const dryRun = useAppStore((s) => s.dryRun)
  const latestVersions = useAppStore((s) => s.latestVersions)
  const cliManagers = useAppStore((s) => s.cliManagers)
  const storeDetected = useAppStore((s) => s.detections["cc-connect"])
  const { run } = useRunnerCtx()

  const [detected, setDetected] = useState<boolean | null>(
    storeDetected ? storeDetected.installed : null
  )
  const [version, setVersion] = useState<string | undefined>(storeDetected?.version)
  const [running, setRunning] = useState<boolean | null>(null)
  const [configExists, setConfigExists] = useState<boolean | null>(null)
  const [port, setPort] = useState<number | null>(null)
  // Start/stop in flight — the buttons stay disabled until the state flip is
  // confirmed (or the poll gives up), so a double-click can't race the service.
  const [busy, setBusy] = useState(false)

  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // Refresh every slice: detection (mirrored into the shared store so the
  // dashboard agrees), process state, and config presence/port.
  const scan = useCallback(async () => {
    if (!isTauri()) return
    const [d, isRunning] = await Promise.all([
      detectCli("cc-connect", false),
      isProcessRunning("cc-connect"),
    ])
    if (!mounted.current) return
    setDetected(d.installed)
    setVersion(d.version)
    useAppStore.getState().setDetection("cc-connect", d)
    setRunning(isRunning)
    if (paths) {
      // read_text_file returns "" for a missing file, so a fresh install
      // simply falls back to the default port.
      const [cfgExists, cfg] = await Promise.all([
        pathExists(paths.ccConnectConfig),
        readTextFile(paths.ccConnectConfig),
      ])
      if (!mounted.current) return
      setConfigExists(cfgExists)
      setPort(parseManagementPort(cfg))
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

  const tool = findCli("cc-connect")!
  const os = effectiveOS()
  const installMethod = installMethodsFor(tool, os)[0]
  const upgradeCmd = upgradeCommandFor(tool, os, cliManagers["cc-connect"])
  const hasUpdate = isUpgradeAvailable(version, latestVersions["cc-connect"])

  const install = () => {
    if (!installMethod) return
    void runThen([cliInstallStep("cc-connect", installMethod.command, false, t)])
  }

  const upgrade = () => {
    if (!upgradeCmd) return
    void runThen([cliInstallStep("cc-connect", upgradeCmd, true, t)])
  }

  const uninstall = () => {
    void runThen([cliUninstallStep("cc-connect", tool.uninstall?.[os], t)])
  }

  // Start/stop the bridge process, then poll until tasklist/pgrep confirms the
  // flip (spawn/kill return before the OS process table catches up). If the poll
  // gives up, the state didn't change — surface that as a failure.
  const setService = async (start: boolean) => {
    if (dryRun || busy) return
    setBusy(true)
    try {
      await (start ? startCcConnect() : stopCcConnect())
      for (let i = 0; i < 10 && mounted.current; i++) {
        await sleep(500)
        if ((await isProcessRunning("cc-connect")) === start) {
          if (mounted.current) setRunning(start)
          return
        }
      }
      if (mounted.current) toast.error(start ? c.startFailed : c.stopFailed)
    } catch {
      if (mounted.current) toast.error(start ? c.startFailed : c.stopFailed)
    } finally {
      if (mounted.current) setBusy(false)
      await reload()
    }
  }

  const url = webUiUrl(port ?? parseManagementPort(""))

  if (!isTauri()) {
    return (
      <SectionShell title={c.menuTitle} help={<HelpTip text={t.help.ccconnect} />}>
        <p className="text-sm text-muted-foreground">{t.shell.notInTauri}</p>
      </SectionShell>
    )
  }

  return (
    <SectionShell title={c.menuTitle} help={<HelpTip text={t.help.ccconnect} />}>
      {/* Install / check */}
      <Card className="gap-3 p-4">
        <div className="flex flex-row items-center gap-3">
          <div className="flex-1">
            <div className="font-medium">{c.install}</div>
            {detected !== null ? (
              <Badge
                variant={detected ? "secondary" : "outline"}
                className="mt-1 font-normal text-muted-foreground"
              >
                {detected ? `${c.detected}${version ? ` · ${version}` : ""}` : c.notDetected}
              </Badge>
            ) : (
              <Badge variant="outline" className="mt-1 gap-1 font-normal text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                {c.checking}
              </Badge>
            )}
          </div>
          <Button variant="ghost" size="sm" className="gap-1" onClick={() => void reload()}>
            <RefreshCw className="size-3.5" />
            {c.refresh}
          </Button>
          {detected === false && installMethod ? (
            <Button variant="outline" onClick={install}>
              {c.install}
            </Button>
          ) : null}
          {detected === true && hasUpdate && upgradeCmd ? (
            <Button variant="outline" onClick={upgrade}>
              {t.shell.upgrade}
            </Button>
          ) : null}
          {detected === true ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm" className="text-red-500">
                  {c.uninstall}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{c.uninstall}</AlertDialogTitle>
                  <AlertDialogDescription>{c.uninstallConfirm}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t.shell.cancel}</AlertDialogCancel>
                  <AlertDialogAction onClick={uninstall}>{c.uninstall}</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
        </div>
      </Card>

      {/* Bridge service */}
      <Card className="gap-3 p-4">
        <div className="flex flex-row items-center gap-3">
          <div className="flex-1">
            <div className="font-medium">{c.serviceTitle}</div>
            <p className="mt-1 text-xs text-muted-foreground">{c.serviceHint}</p>
          </div>
          {running !== null ? (
            <Badge variant={running ? "secondary" : "outline"} className="font-normal">
              {running ? c.running : c.stopped}
            </Badge>
          ) : null}
          {running ? (
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              disabled={busy || dryRun}
              onClick={() => void setService(false)}
            >
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Square className="size-3.5" />
              )}
              {c.stop}
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              disabled={busy || dryRun || detected !== true}
              onClick={() => void setService(true)}
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
              {c.start}
            </Button>
          )}
        </div>
        <p className="border-t pt-3 text-xs text-muted-foreground">
          {dryRun ? c.dryRunBlocked : c.daemonNote}
        </p>
      </Card>

      {/* Web management UI */}
      <Card className="gap-3 p-4">
        <div className="flex flex-row items-center gap-3">
          <div className="flex-1">
            <div className="font-medium">{c.webTitle}</div>
            <p className="mt-1 text-xs text-muted-foreground">{c.webUrl(url)}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1"
            disabled={running !== true}
            onClick={() => void openUrl(url)}
          >
            <ExternalLink className="size-3.5" />
            {c.openWeb}
          </Button>
        </div>
      </Card>

      {/* Configuration */}
      <Card className="gap-3 p-4">
        <div className="flex flex-row items-center gap-3">
          <div className="flex-1">
            <div className="font-medium">{c.configTitle}</div>
            {paths ? (
              <p className="mt-1 font-mono text-xs text-muted-foreground">
                {paths.ccConnectConfig}
              </p>
            ) : null}
            {configExists !== null ? (
              <Badge
                variant={configExists ? "secondary" : "outline"}
                className="mt-1 font-normal text-muted-foreground"
              >
                {configExists ? c.configInitialized : c.configMissing}
              </Badge>
            ) : null}
          </div>
          {paths && configExists ? (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1"
              onClick={() => void revealPath(paths.ccConnectConfig)}
            >
              <FolderOpen className="size-3.5" />
              {c.reveal}
            </Button>
          ) : null}
        </div>
      </Card>
    </SectionShell>
  )
}
