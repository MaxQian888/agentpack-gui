"use client"

import { useState } from "react"
import { ChevronDown } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { isTauri } from "@/lib/tauri"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { proxyApplySteps, proxyClearSteps } from "@/lib/agentpack/plan"
import {
  DEFAULT_PROXY,
  effectiveProxy,
  isProxyActive,
  socksUnsupported,
} from "@/lib/agentpack/network/proxy"
import { PROXY_TEST_URLS, type ProxyCandidate } from "@/lib/agentpack/network/discovery"
import {
  PROXY_TARGETS,
  type ProxyMode,
  type ProxyTarget,
  type StepReport,
} from "@/lib/agentpack/types"
import { proxyCheck, setProcessProxy, type ProxyCheckResult } from "@/lib/tauri/commands"
import { saveSettings } from "@/lib/tauri/settings"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { useMounted } from "@/hooks/use-mounted"
import { DesktopOnlyNote } from "../../desktop-only-note"
import { useRunnerCtx } from "../../run/runner-context"

const MODES: ProxyMode[] = ["off", "system", "manual"]

/**
 * Whether a run actually put its change in place. Empty means the review panel
 * was closed without applying; a cancelled run leaves `skipped` rows; an
 * `error` means at least one surface still holds the old value. None of those
 * is a proxy that was applied (or cleared), so the caller must not go on to
 * repoint agentpack's own traffic or save the setting as if it had been.
 */
const ranInFull = (reports: readonly StepReport[]) =>
  reports.length > 0 && reports.every((r) => r.status === "done" || r.status === "warning")

/**
 * The proxy control panel: mode, per-scheme addresses, credentials, enterprise
 * TLS, and which config surfaces to write.
 *
 * Applying goes through the runner like every other mutation, so preview mode
 * shows exactly what would be written and touches nothing. Only a real run
 * persists the config and points agentpack's own traffic at the proxy.
 */
export function ProxyCard({
  discovered,
  onAdopt,
}: {
  /** Best proxy the section's scan found, adopted when picking "Follow system". */
  discovered: ProxyCandidate | null
  onAdopt: (candidate: ProxyCandidate, mode?: ProxyMode) => void
}) {
  const t = useT()
  const p = t.network.proxy
  const proxy = useAppStore((s) => s.plan.network.proxy) ?? DEFAULT_PROXY
  const setProxy = useAppStore((s) => s.setProxy)
  const setSettings = useAppStore((s) => s.setSettings)
  // What was last applied and saved, as opposed to what the form holds now.
  const savedProxy = useAppStore((s) => s.settings.proxy)
  const paths = useAppStore((s) => s.paths)
  const effectiveOS = useAppStore((s) => s.effectiveOS)
  const { run } = useRunnerCtx()
  // isTauri() is false in the pre-rendered HTML, so the note waits for mount.
  const mounted = useMounted()
  const desktop = isTauri()
  const [testUrl, setTestUrl] = useState(PROXY_TEST_URLS[0].url)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<ProxyCheckResult | null>(null)

  const active = isProxyActive(proxy)
  const eff = effectiveProxy(proxy)

  // "Follow system" only means something if it actually adopts what the machine
  // advertises — the CLIs never read the OS proxy panel themselves. Fields the
  // user already filled in win, so switching modes never discards their input.
  const changeMode = (mode: ProxyMode) => {
    const empty = !proxy.httpUrl && !proxy.httpsUrl && !proxy.allUrl
    if (mode === "system" && discovered && empty) onAdopt(discovered, "system")
    else setProxy({ mode })
  }

  const toggleTarget = (target: ProxyTarget, on: boolean) =>
    setProxy({
      targets: on ? [...proxy.targets, target] : proxy.targets.filter((x) => x !== target),
    })

  const apply = async () => {
    if (!paths) return
    if (!active) {
      toast.message(p.needsUrl)
      return
    }
    const reports = await run(proxyApplySteps(proxy, paths, effectiveOS(), t))
    if (!ranInFull(reports)) return
    // Make it real for agentpack itself (skill downloads, the MCP registry, every
    // spawned CLI) and keep it across restarts.
    await setProcessProxy({
      http: eff.http,
      https: eff.https,
      all: eff.all,
      noProxy: eff.noProxy,
    })
    setSettings(await saveSettings({ proxy }))
  }

  const clear = async () => {
    if (!paths) return
    // Where the form points now plus where the saved proxy was written: a
    // target unticked since the last apply still holds that proxy.
    const named = [...new Set([...proxy.targets, ...(savedProxy?.targets ?? [])])]
    const targets = named.length ? named : PROXY_TARGETS
    const reports = await run(proxyClearSteps(targets, paths, effectiveOS(), t))
    // A clear that failed somewhere leaves that proxy in place, so the saved
    // setting (and Clear with it) stays until one actually finishes.
    if (!ranInFull(reports)) return
    setProxy({ mode: "off" })
    await setProcessProxy({})
    setSettings(await saveSettings({ proxy: null }))
  }

  const runTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const url = eff.https ?? eff.http ?? null
      setTestResult(await proxyCheck(url, testUrl))
    } catch {
      setTestResult({ ok: false, reason: "failed" })
    } finally {
      setTesting(false)
    }
  }

  const field = (
    id: string,
    label: string,
    value: string | undefined,
    onChange: (v: string | undefined) => void,
    opts: { placeholder?: string; type?: string; hint?: string } = {}
  ) => (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={opts.type}
        placeholder={opts.placeholder}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || undefined)}
      />
      {opts.hint ? <p className="text-xs text-muted-foreground">{opts.hint}</p> : null}
    </div>
  )

  return (
    <Card className="gap-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 font-medium">
            {p.title}
            <Badge variant={active ? "default" : "outline"} className="font-normal">
              {active ? p.active : p.inactive}
            </Badge>
          </h3>
          <p className="text-sm text-muted-foreground">{p.subtitle}</p>
        </div>
      </div>

      {!desktop && mounted ? <DesktopOnlyNote>{p.notTauri}</DesktopOnlyNote> : null}

      <ToggleGroup
        type="single"
        variant="outline"
        value={proxy.mode}
        onValueChange={(v) => v && changeMode(v as ProxyMode)}
      >
        {MODES.map((mode) => (
          <ToggleGroupItem key={mode} value={mode} className="px-4">
            {p.mode[mode]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <p className="-mt-2 text-xs text-muted-foreground">{p.modeHint[proxy.mode]}</p>

      {/* Off writes nothing and removes nothing, so a proxy applied earlier is
          still on disk — and Clear is the only way to take it back out. */}
      {proxy.mode === "off" && savedProxy ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-xs text-muted-foreground">{p.stillApplied}</p>
          <Button variant="outline" onClick={() => void clear()} disabled={!desktop}>
            {p.clear}
          </Button>
        </div>
      ) : null}

      {proxy.mode !== "off" ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            {field("proxy-http", p.httpLabel, proxy.httpUrl, (v) => setProxy({ httpUrl: v }), {
              placeholder: "http://127.0.0.1:7890",
            })}
            {field("proxy-https", p.httpsLabel, proxy.httpsUrl, (v) => setProxy({ httpsUrl: v }), {
              placeholder: "http://127.0.0.1:7890",
              hint: p.httpsHint,
            })}
            {field("proxy-all", p.allLabel, proxy.allUrl, (v) => setProxy({ allUrl: v }), {
              placeholder: "socks5://127.0.0.1:1080",
              hint: p.allHint,
            })}
            {field(
              "proxy-noproxy",
              p.noProxyLabel,
              proxy.noProxy,
              (v) => setProxy({ noProxy: v }),
              {
                placeholder: "localhost,127.0.0.1,.internal",
                hint: p.noProxyHint,
              }
            )}
          </div>

          {/* A hairline panel with a warn dot, not a tinted one: status colour
              is a mark, never a background (design.md § 3). */}
          {socksUnsupported(proxy) ? (
            <p className="flex items-start gap-2 rounded-md border px-3 py-2 text-xs">
              <span
                aria-hidden="true"
                className="mt-1 size-1.5 shrink-0 rounded-[var(--hm-radius-dot)] bg-[var(--hm-warn)]"
              />
              <span>{p.socksWarning}</span>
            </p>
          ) : null}

          <Collapsible>
            <CollapsibleTrigger className="group flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
              <ChevronDown className="size-4 transition-transform duration-(--hm-dur-fast) ease-(--hm-ease-out) group-data-[state=open]:rotate-180" />
              {p.advanced}
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3 grid gap-4 sm:grid-cols-2">
              {field("proxy-user", p.username, proxy.username, (v) => setProxy({ username: v }))}
              {field(
                "proxy-password",
                p.password,
                proxy.password,
                (v) => setProxy({ password: v }),
                { type: "password", hint: p.passwordHint }
              )}
              {field("proxy-ca", p.caCert, proxy.caCertPath, (v) => setProxy({ caCertPath: v }), {
                placeholder: "/etc/ssl/corp-root.pem",
                hint: p.caCertHint,
              })}
              {field(
                "proxy-client-cert",
                p.clientCert,
                proxy.clientCertPath,
                (v) => setProxy({ clientCertPath: v }),
                { placeholder: "/path/to/client-cert.pem" }
              )}
              {field(
                "proxy-client-key",
                p.clientKey,
                proxy.clientKeyPath,
                (v) => setProxy({ clientKeyPath: v }),
                { placeholder: "/path/to/client-key.pem" }
              )}
              {field(
                "proxy-client-passphrase",
                p.clientKeyPassphrase,
                proxy.clientKeyPassphrase,
                (v) => setProxy({ clientKeyPassphrase: v }),
                { type: "password" }
              )}
              <div className="flex items-start gap-3 sm:col-span-2">
                <Switch
                  id="proxy-insecure"
                  checked={!!proxy.insecureTls}
                  onCheckedChange={(on) => setProxy({ insecureTls: on })}
                />
                <div className="grid gap-1">
                  <Label htmlFor="proxy-insecure">{p.insecure}</Label>
                  <p className="text-xs text-muted-foreground">{p.insecureHint}</p>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>

          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium">{p.targets}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {PROXY_TARGETS.map((target) => (
                <label key={target} className="flex items-start gap-2.5">
                  <Checkbox
                    id={`proxy-target-${target}`}
                    className="mt-0.5"
                    checked={proxy.targets.includes(target)}
                    onCheckedChange={(on) => toggleTarget(target, on === true)}
                  />
                  <span className="grid gap-0.5">
                    <span className="text-sm leading-none">{p.target[target]}</span>
                    <span className="text-xs text-muted-foreground">{p.targetHint[target]}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void apply()} disabled={!desktop}>
              {p.apply}
            </Button>
            <Button variant="outline" onClick={() => void clear()} disabled={!desktop}>
              {p.clear}
            </Button>
          </div>

          <div className="grid gap-2 rounded-md border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{p.testTitle}</span>
              <Select value={testUrl} onValueChange={setTestUrl}>
                <SelectTrigger className="h-8 w-[260px]" aria-label={p.testTargetLabel}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROXY_TEST_URLS.map((target) => (
                    <SelectItem key={target.id} value={target.url}>
                      {target.url}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void runTest()}
                disabled={testing || !desktop}
              >
                {testing ? p.testing : p.testRun}
              </Button>
              {!active ? (
                <span className="text-xs text-muted-foreground">{p.testDirect}</span>
              ) : null}
            </div>
            {testResult ? (
              <p
                className={cn(
                  "text-sm",
                  testResult.ok ? "text-[var(--hm-ok)]" : "text-[var(--hm-danger)]"
                )}
              >
                {testResult.ok
                  ? p.testOk(testResult.status ?? 0, testResult.latencyMs ?? 0)
                  : p.testFail(p.reason[testResult.reason] ?? testResult.reason)}
              </p>
            ) : null}
          </div>
        </>
      ) : null}
    </Card>
  )
}
