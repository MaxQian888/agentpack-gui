"use client"

import { useState } from "react"
import { RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"
import { isTauri } from "@/lib/tauri"
import { useMounted } from "@/hooks/use-mounted"
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
  failed = false,
  onScan,
  onUse,
}: {
  probe: NetworkProbeResult | null
  scanning: boolean
  /** The last scan threw, which is why `probe` is null — not "nothing found". */
  failed?: boolean
  onScan: () => void
  onUse: (candidate: ProxyCandidate) => void
}) {
  const t = useT()
  const d = t.network.discovery
  // Gated on mount: isTauri() is false in the pre-rendered HTML, so reading it
  // during the first render would hydration-mismatch in the desktop build.
  const mounted = useMounted()
  const tauri = mounted && isTauri()
  // Re-tests are corrections to one scan's reading, so they are kept against
  // the probe they were taken on: a new scan supersedes them, and a row must
  // not keep a "Failed" from before the network changed under a fresh result.
  const [rechecked, setRechecked] = useState<{
    probe: NetworkProbeResult | null
    byId: Record<string, ProxyCheckResult | "pending">
  }>({ probe, byId: {} })
  const rechecks = rechecked.probe === probe ? rechecked.byId : {}

  const test = async (c: ProxyCandidate) => {
    const against = probe
    setRechecked((prev) => ({
      probe: against,
      byId: { ...(prev.probe === against ? prev.byId : {}), [c.id]: "pending" },
    }))
    const outcome = await proxyCheck(c.url, PROXY_TEST_URLS[0].url).catch(() => ({
      ok: false,
      reason: "failed",
    }))
    setRechecked((prev) =>
      prev.probe === against ? { probe: against, byId: { ...prev.byId, [c.id]: outcome } } : prev
    )
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

      {mounted && !tauri ? (
        <p className="text-sm text-muted-foreground">{t.network.desktopOnly}</p>
      ) : scanning && !probe ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="size-4" />
          {d.scanning}
        </div>
      ) : !probe ? (
        // No reading is not an empty reading: "no proxy found" here would state
        // as fact the one thing nothing has looked at.
        <p className="text-sm text-muted-foreground">{failed ? d.failed : d.unmeasured}</p>
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
                      check.ok ? "text-[var(--hm-ok)]" : "text-[var(--hm-danger)]"
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
                  {/* Outlined: Apply proxy is this section's one primary, and a
                      filled button per row would put several beside it. */}
                  <Button variant="outline" size="sm" onClick={() => onUse(c)}>
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
