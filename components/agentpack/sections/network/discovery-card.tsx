"use client"

import { useState } from "react"
import { RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"
import { isTauri } from "@/lib/tauri"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { PROXY_TEST_URLS, type ProxyCandidate } from "@/lib/agentpack/network/discovery"
import type { NetworkProbeResult } from "@/lib/agentpack/network/probe"
import { proxyCheck, type ProxyCheckResult } from "@/lib/tauri/commands"
import { useT } from "@/lib/i18n/provider"

/**
 * The auto-discovery panel. Presentational: the store owns the scan, because
 * three surfaces share its result (this card, the proxy card's "Follow system",
 * and the install-failure recovery ladder).
 *
 * Rows arrive already measured and sorted best-first, so the fastest working
 * proxy is simply the top one — a stale entry in npm config no longer looks
 * identical to a proxy that actually works. The Test button re-measures, for
 * when the network changed since the scan.
 */
export function DiscoveryCard({
  probe,
  scanning,
  onScan,
  onUse,
}: {
  probe: NetworkProbeResult | null
  scanning: boolean
  onScan: () => void
  onUse: (candidate: ProxyCandidate) => void
}) {
  const t = useT()
  const d = t.network.discovery
  const tauri = isTauri()
  const [rechecks, setRechecks] = useState<Record<string, ProxyCheckResult | "pending">>({})

  const test = async (c: ProxyCandidate) => {
    setRechecks((prev) => ({ ...prev, [c.id]: "pending" }))
    const outcome = await proxyCheck(c.url, PROXY_TEST_URLS[0].url).catch(() => ({
      ok: false,
      reason: "failed",
    }))
    setRechecks((prev) => ({ ...prev, [c.id]: outcome }))
  }

  const candidates = probe?.proxies ?? []
  // A manual re-test wins over the scan's measurement; otherwise show the scan's.
  const resultFor = (c: ProxyCandidate): ProxyCheckResult | "pending" | undefined =>
    rechecks[c.id] ?? probe?.proxies.find((p) => p.id === c.id)?.result ?? undefined
  return (
    <Card className="gap-3 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-medium">{d.title}</h3>
          <p className="text-sm text-muted-foreground">{d.subtitle}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 gap-2"
          onClick={onScan}
          disabled={scanning || !tauri}
        >
          <RefreshCw className={cn("size-4", scanning && "animate-spin")} />
          {scanning ? d.scanning : d.scan}
        </Button>
      </div>

      {!tauri ? (
        <p className="text-sm text-muted-foreground">{t.network.desktopOnly}</p>
      ) : scanning && !probe ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="size-4" />
          {d.scanning}
        </div>
      ) : candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground">{d.empty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {candidates.map((c) => {
            const check = resultFor(c)
            return (
              <li
                key={c.id}
                className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2"
              >
                <Badge variant="secondary" className="shrink-0 font-normal">
                  {d.source[c.source] ?? c.source}
                </Badge>
                <code className="font-mono text-sm">{c.url}</code>
                <span className="text-xs text-muted-foreground">{c.detail}</span>
                {check && check !== "pending" ? (
                  <span
                    className={cn(
                      "text-xs",
                      check.ok ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"
                    )}
                  >
                    {check.ok
                      ? t.network.proxy.testOk(check.status ?? 0, check.latencyMs ?? 0)
                      : t.network.proxy.testFail(
                          t.network.proxy.reason[check.reason] ?? check.reason
                        )}
                  </span>
                ) : null}
                <div className="ml-auto flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void test(c)}
                    disabled={check === "pending"}
                  >
                    {check === "pending" ? d.scanning : d.test}
                  </Button>
                  <Button size="sm" onClick={() => onUse(c)}>
                    {d.use}
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {probe?.pacUrl ? (
        <p className="text-xs text-muted-foreground">{d.pacNote(probe.pacUrl)}</p>
      ) : null}
    </Card>
  )
}
