import { discoverProxies } from "./discovery"
import { probeNetwork, type NetworkProbeResult } from "./probe"
import {
  probePort,
  proxyCheck,
  proxyEnvSnapshot,
  systemProxySnapshot,
  toolProxySnapshot,
} from "@/lib/tauri/commands"

/**
 * The one place discovery and measurement are wired to real IPC.
 *
 * `discovery.ts` and `probe.ts` stay pure and injectable for testing; this is
 * the thin seam that hands them the actual Tauri commands. Everything that needs
 * a network answer — the startup probe, the Network section's rescan button, the
 * first-run wizard's self-check — goes through here, so they can't drift into
 * probing different things and reporting different results.
 */
export async function scanNetwork(): Promise<NetworkProbeResult> {
  const discovery = await discoverProxies({
    envSnapshot: proxyEnvSnapshot,
    systemSnapshot: systemProxySnapshot,
    toolSnapshot: toolProxySnapshot,
    probePort,
  })
  return probeNetwork(discovery, {
    check: (proxyUrl, testUrl, timeoutMs) => proxyCheck(proxyUrl, testUrl, timeoutMs),
  })
}
