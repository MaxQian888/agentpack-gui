"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { isTauri } from "@/lib/tauri"
import { normalizeProxyUrl } from "@/lib/agentpack/network/proxy"
import {
  discoverProxies,
  type DiscoveryResult,
  type ProxyCandidate,
} from "@/lib/agentpack/network/discovery"
import type { ProxyMode } from "@/lib/agentpack/types"
import {
  probePort,
  proxyEnvSnapshot,
  systemProxySnapshot,
  toolProxySnapshot,
} from "@/lib/tauri/commands"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { SectionShell } from "../section-shell"
import { HelpTip } from "../../help-tip"
import { DiscoveryCard } from "./discovery-card"
import { ProxyCard } from "./proxy-card"
import { MirrorsCard } from "./mirrors-card"
import { RelayCard } from "./relay-card"

/**
 * Network section: find a proxy, configure it in as much detail as the network
 * demands, apply it everywhere it's needed, then mirrors and the API endpoint.
 * Ordered by how often each is the thing standing between the user and a working
 * install.
 *
 * The scan lives here rather than in the discovery card because the proxy card
 * needs it too: switching to "Follow system" adopts what discovery found, which
 * is the only way that mode can mean anything (the CLIs never read the OS proxy
 * panel themselves).
 */
export function NetworkSection() {
  const t = useT()
  const setProxy = useAppStore((s) => s.setProxy)
  const [result, setResult] = useState<DiscoveryResult | null>(null)
  const [scanning, setScanning] = useState(false)
  const scannedRef = useRef(false)

  const scan = useCallback(async () => {
    setScanning(true)
    try {
      setResult(
        await discoverProxies({
          envSnapshot: proxyEnvSnapshot,
          systemSnapshot: systemProxySnapshot,
          toolSnapshot: toolProxySnapshot,
          probePort,
        })
      )
    } finally {
      setScanning(false)
    }
  }, [])

  useEffect(() => {
    if (!isTauri() || scannedRef.current) return
    scannedRef.current = true
    void scan()
  }, [scan])

  // Adopt a discovered proxy. A SOCKS candidate goes to ALL_PROXY; anything else
  // fills both HTTP and HTTPS, which is what a single-endpoint proxy wants.
  const adopt = useCallback(
    (candidate: ProxyCandidate, mode?: ProxyMode) => {
      const parsed = normalizeProxyUrl(candidate.url)
      if (!parsed) return
      const socks = parsed.scheme.startsWith("socks")
      const noProxy = result?.noProxy
      setProxy({
        mode:
          mode ??
          (candidate.source === "env" || candidate.source === "system" ? "system" : "manual"),
        httpUrl: socks ? undefined : parsed.url,
        httpsUrl: socks ? undefined : parsed.url,
        allUrl: socks ? parsed.url : undefined,
        ...(noProxy ? { noProxy } : {}),
      })
    },
    [result, setProxy]
  )

  return (
    <SectionShell
      title={t.network.title}
      subtitle={t.network.ask}
      help={<HelpTip text={t.help.network} />}
    >
      <DiscoveryCard result={result} scanning={scanning} onScan={() => void scan()} onUse={adopt} />
      <ProxyCard discovered={result?.candidates[0] ?? null} onAdopt={adopt} />
      <MirrorsCard />
      <RelayCard />
    </SectionShell>
  )
}
