"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  ExternalLink,
  FolderOpen,
  Loader2,
  PanelsTopLeft,
  Play,
  RefreshCw,
  Square,
} from "lucide-react"
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
import {
  CC_CONNECT_BRIDGE_PORT,
  CC_CONNECT_MANAGEMENT_PORT,
  CC_CONNECT_WEBHOOK_PORT,
  countProjects,
  dashboardUrl,
  ensureWebAdmin,
  getConfigValue,
  isSectionEnabled,
  parseBridgePort,
  parseConfigDoc,
  parseManagementPort,
  parseWebhookPort,
  projectCount,
  serializeConfigDoc,
} from "@/lib/agentpack/ccconnect"
import {
  detectCli,
  isProcessRunning,
  pathExists,
  probePort,
  readTextFile,
  startCcConnect,
  stopCcConnect,
  writeTextFile,
} from "@/lib/tauri/commands"
import { openUrl, revealPath } from "@/lib/tauri/system"
import { isTauri } from "@/lib/tauri"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { SectionShell } from "./section-shell"
import { CcConnectConfigEditor } from "./ccconnect-config"
import { CcConnectDashboardFrame } from "./ccconnect-dashboard"
import { HelpTip } from "../help-tip"
import { useRunnerCtx } from "../run/runner-context"
import { DesktopOnlyNote } from "../desktop-only-note"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Whether the bridge is up: process-name match OR either service port
 * answering. npm installs run the bridge under a `node` wrapper, so the
 * process-name check alone reports "stopped" for a perfectly healthy service.
 */
async function serviceUp(mgmt: number, bridge: number): Promise<boolean> {
  const checks = await Promise.all([
    isProcessRunning("cc-connect"),
    probePort(mgmt),
    probePort(bridge),
  ])
  return checks.some(Boolean)
}

/** A URL-safe random token for the management dashboard (mirrors `cc-connect web`). */
function generateToken(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}

/**
 * Management and bridge get independent tokens, as they do in `cc-connect web`:
 * the management one is handed to a browser via the URL, so it must not double
 * as the credential external bridge adapters authenticate with.
 */
function generateWebAdminTokens() {
  return { management: generateToken(), bridge: generateToken() }
}

export function CcConnectSection() {
  const t = useT()
  const c = t.ccconnect
  const paths = useAppStore((s) => s.paths)
  const effectiveOS = useAppStore((s) => s.effectiveOS)
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
  const [mgmtPort, setMgmtPort] = useState(CC_CONNECT_MANAGEMENT_PORT)
  const [bridgePort, setBridgePort] = useState(CC_CONNECT_BRIDGE_PORT)
  const [webhookPort, setWebhookPort] = useState(CC_CONNECT_WEBHOOK_PORT)
  const [mgmtEnabled, setMgmtEnabled] = useState(false)
  // cc-connect exits during config validation when no project is declared, so
  // this — not "is web admin on" — is what decides whether the service can run
  // at all. Null until the first scan lands.
  const [projects, setProjects] = useState<number | null>(null)
  // Start/stop in flight — the buttons stay disabled until the state flip is
  // confirmed (or the poll gives up), so a double-click can't race the service.
  const [busy, setBusy] = useState(false)
  const [webBusy, setWebBusy] = useState(false)
  // The embedded dashboard, once a prepared URL exists. Holding the URL (rather
  // than a bare open flag) is what keeps the token out of every other render and
  // lets the panel's own "open in browser" reuse the exact page on screen.
  const [embed, setEmbed] = useState<{ url: string; port: number } | null>(null)

  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // Refresh every slice: detection (mirrored into the shared store so the
  // dashboard agrees), config presence/ports/state, and service liveness.
  const scan = useCallback(async () => {
    if (!isTauri()) return
    // Ports first — the liveness probe needs them. read_text_file returns ""
    // for a missing file, so a fresh install simply uses the defaults.
    let mgmt = CC_CONNECT_MANAGEMENT_PORT
    let bridge = CC_CONNECT_BRIDGE_PORT
    if (paths) {
      const [cfgExists, cfg] = await Promise.all([
        pathExists(paths.ccConnectConfig),
        readTextFile(paths.ccConnectConfig),
      ])
      if (!mounted.current) return
      mgmt = parseManagementPort(cfg)
      bridge = parseBridgePort(cfg)
      setConfigExists(cfgExists)
      setMgmtPort(mgmt)
      setBridgePort(bridge)
      setWebhookPort(parseWebhookPort(cfg))
      setMgmtEnabled(isSectionEnabled(cfg, "management"))
      setProjects(countProjects(cfg))
    }
    const [d, proc, mUp, bUp] = await Promise.all([
      detectCli("cc-connect", false),
      isProcessRunning("cc-connect"),
      probePort(mgmt),
      probePort(bridge),
    ])
    if (!mounted.current) return
    setDetected(d.installed)
    setVersion(d.version)
    useAppStore.getState().setDetection("cc-connect", d)
    setRunning(proc || mUp || bUp)
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

  // Start/stop the bridge process, then poll until the service state confirms
  // the flip (spawn/kill return before the ports open/close). If the poll gives
  // up, the state didn't change — surface that as a failure.
  const setService = async (start: boolean) => {
    if (busy) return
    // A projectless config can't produce a running service — cc-connect rejects
    // it before binding anything. Say that instead of spending six seconds
    // polling for a process that already exited.
    if (start && projects === 0) {
      toast.error(c.needsProject)
      return
    }
    setBusy(true)
    try {
      await (start
        ? startCcConnect(paths?.ccConnectConfig)
        : stopCcConnect([mgmtPort, bridgePort, webhookPort]))
      for (let i = 0; i < 10 && mounted.current; i++) {
        await sleep(500)
        if ((await serviceUp(mgmtPort, bridgePort)) === start) {
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

  // Everything both open paths need, in the order cc-connect needs it: guarantee
  // management and bridge are enabled with login tokens (what `cc-connect web`'s
  // EnableWebAdmin does: enabled + port + token + cors), then make sure the
  // service is really serving that port. Resolves to the `/login?token=` URL, or
  // null when something stopped us — having already said what.
  const prepareDashboard = async (): Promise<{ url: string; port: number } | null> => {
    if (!paths) return null
    const text = await readTextFile(paths.ccConnectConfig)
    if (text.trim() && !parseConfigDoc(text)) {
      toast.error(c.invalidToml)
      return null
    }
    const { doc, token, changed } = ensureWebAdmin(
      parseConfigDoc(text) ?? {},
      generateWebAdminTokens()
    )
    const portVal = getConfigValue(doc, ["management", "port"])
    const port = typeof portVal === "number" ? portVal : CC_CONNECT_MANAGEMENT_PORT
    if (changed) {
      await writeTextFile(paths.ccConnectConfig, `${serializeConfigDoc(doc)}\n`)
    }
    // If the dashboard port isn't answering, (re)start the service so it picks
    // up the config. A stale bridge-only instance is bounced first, otherwise
    // the fresh `cc-connect` can't bind its ports.
    if (!(await probePort(port))) {
      // Web admin is enabled and saved by now either way — but a projectless
      // config makes cc-connect exit during validation, so there is nothing to
      // start and clicking again won't help. Name the actual missing piece.
      if (projectCount(doc) === 0) {
        if (mounted.current) toast.error(c.needsProject)
        return null
      }
      if (await serviceUp(port, bridgePort)) {
        await stopCcConnect([port, bridgePort, webhookPort])
        for (let i = 0; i < 10 && (await serviceUp(port, bridgePort)); i++) await sleep(400)
      }
      await startCcConnect(paths.ccConnectConfig)
      let up = false
      for (let i = 0; i < 12 && mounted.current; i++) {
        await sleep(500)
        if (await probePort(port)) {
          up = true
          break
        }
      }
      if (!up) {
        if (mounted.current) toast.error(c.startFailed)
        return null
      }
    }
    return { url: dashboardUrl(port, token), port }
  }

  // One click, dashboard open and already logged in — in a panel here, or handed
  // to the user's browser. Both fold the old enable → start → open steps into one.
  const openDashboard = async (target: "embed" | "browser") => {
    if (!paths || webBusy) return
    setWebBusy(true)
    try {
      const ready = await prepareDashboard()
      if (!ready || !mounted.current) return
      if (target === "browser") {
        await openUrl(ready.url)
      } else {
        setEmbed(ready)
      }
    } catch {
      if (mounted.current) toast.error(c.webAdminFailed)
    } finally {
      if (mounted.current) setWebBusy(false)
      await reload()
    }
  }

  // Hands the page the panel is already showing to the real browser, without
  // re-running the prepare dance (the service is up by definition here).
  const openEmbeddedExternally = () => {
    if (embed) void openUrl(embed.url)
  }

  // Shown in the hint without the token (localhost-only, but no need to leak it).
  const url = dashboardUrl(mgmtPort)

  if (!isTauri()) {
    return (
      <SectionShell title={c.menuTitle} help={<HelpTip text={t.help.ccconnect} />}>
        <DesktopOnlyNote>{t.shell.notInTauri}</DesktopOnlyNote>
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
          {projects === 0 ? (
            <Badge variant="outline" className="font-normal text-muted-foreground">
              {c.noProjects}
            </Badge>
          ) : null}
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
              disabled={busy}
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
              disabled={busy || detected !== true}
              onClick={() => void setService(true)}
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
              {c.start}
            </Button>
          )}
        </div>
        <p className="border-t pt-3 text-xs text-muted-foreground">
          {projects === 0 ? c.needsProject : c.daemonNote}
        </p>
      </Card>

      {/* Web dashboard */}
      <Card className="gap-3 p-4">
        <div className="flex flex-row items-center gap-3">
          <div className="flex-1">
            <div className="font-medium">{c.webTitle}</div>
            <p className="mt-1 text-xs text-muted-foreground">{c.webUrl(url)}</p>
            {configExists !== null ? (
              <Badge
                variant={mgmtEnabled ? "secondary" : "outline"}
                className="mt-1 font-normal text-muted-foreground"
              >
                {mgmtEnabled ? c.managementEnabled : c.managementDisabled}
              </Badge>
            ) : null}
          </div>
          <Button
            size="sm"
            className="gap-1"
            disabled={webBusy || detected !== true || !paths}
            onClick={() => void openDashboard("embed")}
          >
            {webBusy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <PanelsTopLeft className="size-3.5" />
            )}
            {mgmtEnabled ? c.openWeb : c.enableAndOpen}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1"
            disabled={webBusy || detected !== true || !paths}
            onClick={() => void openDashboard("browser")}
          >
            <ExternalLink className="size-3.5" />
            {c.openInBrowser}
          </Button>
        </div>
        <p className="border-t pt-3 text-xs text-muted-foreground">
          {mgmtEnabled ? c.webReadyHint : c.webAdminHint}
        </p>
      </Card>

      {embed ? (
        <CcConnectDashboardFrame
          open
          onOpenChange={(o) => {
            // Dropping the URL on close unmounts the frame, which is what stops
            // the dashboard's polling instead of leaving it running behind a
            // hidden panel.
            if (!o) setEmbed(null)
          }}
          url={embed.url}
          displayUrl={dashboardUrl(embed.port)}
          onOpenExternal={openEmbeddedExternally}
        />
      ) : null}

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
          {paths ? (
            <CcConnectConfigEditor
              path={paths.ccConnectConfig}
              exists={configExists === true}
              onSaved={() => void reload()}
            />
          ) : null}
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
