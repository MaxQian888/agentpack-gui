"use client"

import { useCallback, useState } from "react"
import { isTauri } from "@/lib/tauri"
import { normalizeProxyUrl } from "@/lib/agentpack/network/proxy"
import type { ProxyCandidate } from "@/lib/agentpack/network/discovery"
import { scanNetwork } from "@/lib/agentpack/network/scan"
import type { ProxyMode } from "@/lib/agentpack/types"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { CapabilityWorkbench } from "../capability-workbench"
import { SectionStatus } from "../section-status"
import { HelpTip } from "../../help-tip"
import { DiscoveryCard } from "./discovery-card"
import { ProxyCard } from "./proxy-card"
import { MirrorsCard } from "./mirrors-card"

/**
 * Network section: find a proxy, configure it in as much detail as the network
 * demands, apply it everywhere it's needed, then mirrors. Ordered by how often
 * each is the thing standing between the user and a working install.
 *
 * The API endpoint is deliberately absent: relay endpoints are provider rows
 * managed from the cc-switch section, so there is exactly one writer for them.
 *
 * The scan itself lives in the store, not here: it runs once at startup so that
 * a user who never opens this section still gets working mirrors when an install
 * fails, and so this section, the first-run wizard and the recovery ladder all
 * read the same measured answer instead of each scanning separately.
 */
export function NetworkSection() {
  const t = useT()
  const setProxy = useAppStore((s) => s.setProxy)
  const probe = useAppStore((s) => s.networkProbe)
  const scanning = useAppStore((s) => s.networkProbing)
  const setNetworkProbe = useAppStore((s) => s.setNetworkProbe)
  const setNetworkProbing = useAppStore((s) => s.setNetworkProbing)
  const [scanError, setScanError] = useState<string | null>(null)
  const reachableMirrors = probe
    ? [...probe.npm, ...probe.gh, ...probe.pypi, ...probe.brew].filter((item) => item.result?.ok)
        .length
    : null

  const rescan = useCallback(async () => {
    if (!isTauri()) return
    setScanError(null)
    setNetworkProbing(true)
    try {
      setNetworkProbe(await scanNetwork())
    } catch (error) {
      setNetworkProbe(null)
      setScanError(error instanceof Error ? error.message : String(error))
    } finally {
      setNetworkProbing(false)
    }
  }, [setNetworkProbe, setNetworkProbing])

  const scanStatus = scanning
    ? t.network.discovery.scanning
    : scanError
      ? t.network.scanFailed
      : probe
        ? t.network.scanReady
        : t.network.scanPending

  // Adopt a discovered proxy. A SOCKS candidate goes to ALL_PROXY; anything else
  // fills both HTTP and HTTPS, which is what a single-endpoint proxy wants.
  const adopt = useCallback(
    (candidate: ProxyCandidate, mode?: ProxyMode) => {
      const parsed = normalizeProxyUrl(candidate.url)
      if (!parsed) return
      const socks = parsed.scheme.startsWith("socks")
      setProxy({
        mode:
          mode ??
          (candidate.source === "env" || candidate.source === "system" ? "system" : "manual"),
        httpUrl: socks ? undefined : parsed.url,
        httpsUrl: socks ? undefined : parsed.url,
        allUrl: socks ? parsed.url : undefined,
      })
    },
    [setProxy]
  )

  return (
    <CapabilityWorkbench
      title={t.network.title}
      subtitle={t.network.ask}
      help={<HelpTip text={t.help.network} />}
      actionsLabel={t.network.actionsLabel}
      lead={
        /* Proxy mode is deliberately absent: the ProxyCard directly below states
           it in its own badge, and a summary that repeats the panel under it is
           the habit this line replaced. */
        <SectionStatus
          label={t.network.summaryLabel}
          facts={[
            { label: t.network.metricCandidates, value: probe?.proxies.length ?? "—" },
            { label: t.network.metricReachable, value: reachableMirrors ?? "—" },
            { label: t.network.metricScan, value: scanStatus },
          ]}
          notes={[scanError ? t.network.scanError(scanError) : null]}
        />
      }
      primary={
        <section aria-label={t.network.proxyPanel} className="min-w-0">
          <ProxyCard discovered={probe?.bestProxy ?? probe?.proxies[0] ?? null} onAdopt={adopt} />
        </section>
      }
      aside={
        <DiscoveryCard
          probe={probe}
          scanning={scanning}
          onScan={() => void rescan()}
          onUse={adopt}
        />
      }
      detail={
        <section aria-label={t.network.mirrorsPanel} className="min-w-0">
          <MirrorsCard />
        </section>
      }
    />
  )
}
