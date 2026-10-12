"use client"

import { Loader2, TriangleAlert } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import type { NetworkProbeResult } from "@/lib/agentpack/network/probe"
import { useT } from "@/lib/i18n/provider"

/**
 * The wizard's proxy step — shown only when the direct route fails and the
 * startup probe found a proxy that works (`needsProxyStep`).
 *
 * The suggestion is kept by default: someone whose network can't reach the
 * agents' servers needs the proxy for the install to work at all, and making
 * them find a button to say so was how a Continue press used to leave every
 * download going direct. Unchecking keeps the direct connection.
 *
 * Mirrors are not here. A faster mirror is one line in the review, beside the
 * steps it changes — it doesn't route traffic through this machine, so it
 * doesn't earn a page of its own.
 */
export function OnboardingNetworkStep({
  probe,
  probing,
  adopt,
  onAdoptChange,
}: {
  probe: NetworkProbeResult | null
  probing: boolean
  adopt: boolean
  onAdoptChange: (adopt: boolean) => void
}) {
  const t = useT()
  const p = t.network.probe
  const w = t.welcome

  const proxy = probe?.bestProxy
  if (probing || !proxy) {
    return (
      <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        {p.running}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5 rounded-lg border bg-muted/30 p-3 text-sm">
        <div className="flex items-start gap-2">
          <TriangleAlert
            className="mt-0.5 size-4 shrink-0 text-[var(--hm-warn)]"
            aria-hidden="true"
          />
          <span>{p.directBlocked}</span>
        </div>
        {proxy.result?.latencyMs !== undefined ? (
          <p className="pl-6 font-mono text-xs text-muted-foreground">
            {p.proxyFound(hostOf(proxy.url), proxy.result.latencyMs)}
          </p>
        ) : null}
      </div>
      <Label
        htmlFor="onboarding-proxy"
        className="flex cursor-pointer items-start gap-3 font-normal"
      >
        <Checkbox
          id="onboarding-proxy"
          checked={adopt}
          onCheckedChange={(v) => onAdoptChange(v === true)}
          className="mt-0.5"
        />
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">{w.proxyAdopt}</span>
          <span className="text-xs text-muted-foreground">{w.proxyAdoptHint}</span>
        </span>
      </Label>
    </div>
  )
}

/** Host of a proxy URL, for a compact one-line summary. */
function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
