"use client"

import { useState } from "react"
import { RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"
import { isTauri } from "@/lib/tauri"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import {
  PROXY_TEST_URLS,
  type DiscoveryResult,
  type ProxyCandidate,
} from "@/lib/agentpack/network/discovery"
import { proxyCheck, type ProxyCheckResult } from "@/lib/tauri/commands"
import { useT } from "@/lib/i18n/provider"

/**
 * The auto-discovery panel. Presentational: the section owns the scan, because
 * the proxy card needs its result too (picking "Follow system" adopts whatever
 * was found). Each row can be verified before it's adopted, so a stale entry in
 * npm config is visibly distinguishable from a proxy that actually works.
 */
export function DiscoveryCard({
  result,
  scanning,
  onScan,
  onUse,
}: {
  result: DiscoveryResult | null
  scanning: boolean
  onScan: () => void
  onUse: (candidate: ProxyCandidate) => void
}) {
  const t = useT()
  const d = t.network.discovery
  const tauri = isTauri()
  const [checks, setChecks] = useState<Record<string, ProxyCheckResult | "pending">>({})

  const test = async (c: ProxyCandidate) => {
    setChecks((prev) => ({ ...prev, [c.id]: "pending" }))
    const outcome = await proxyCheck(c.url, PROXY_TEST_URLS[0].url).catch(() => ({
      ok: false,
      reason: "failed",
    }))
    setChecks((prev) => ({ ...prev, [c.id]: outcome }))
  }

  const candidates = result?.candidates ?? []
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
      ) : scanning && !result ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="size-4" />
          {d.scanning}
        </div>
      ) : candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground">{d.empty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {candidates.map((c) => {
            const check = checks[c.id]
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

      {result?.pacUrl ? (
        <p className="text-xs text-muted-foreground">{d.pacNote(result.pacUrl)}</p>
      ) : null}
    </Card>
  )
}
