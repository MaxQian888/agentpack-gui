"use client"

import { CheckCircle2, Loader2, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  isDefaultBrew,
  isDefaultMirror,
  pickMirror,
  probeSuggestsChange,
  type NetworkProbeResult,
} from "@/lib/agentpack/network/probe"
import { saveSettings } from "@/lib/tauri/settings"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"

/**
 * The wizard's network self-check.
 *
 * This step exists because a blocked network is the single most common reason a
 * first install fails, and until now nothing told the user that before they hit
 * it. It reports what the startup probe measured — is the direct route usable,
 * is there a working proxy, which mirrors are fastest — and offers to adopt the
 * lot in one click.
 *
 * "Suggest" mode, not "repair": nothing has failed yet, so a working default is
 * left alone rather than swapped for a mirror that merely benchmarks faster.
 */
export function OnboardingNetworkStep({
  probe,
  probing,
}: {
  probe: NetworkProbeResult | null
  probing: boolean
}) {
  const t = useT()
  const p = t.network.probe
  const setNetwork = useAppStore((s) => s.setNetwork)
  const setProxy = useAppStore((s) => s.setProxy)
  const setSettings = useAppStore((s) => s.setSettings)
  const npmRegistry = useAppStore((s) => s.plan.network.npmRegistry)
  const proxyMode = useAppStore((s) => s.plan.network.proxy?.mode)
  const ghMirrorPrefix = useAppStore((s) => s.settings.ghMirrorPrefix)

  if (probing || !probe) {
    return (
      <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        {p.running}
      </div>
    )
  }

  const npm = pickMirror(probe.npm, "suggest", isDefaultMirror)
  const gh = pickMirror(probe.gh, "suggest", isDefaultMirror)
  const pypi = pickMirror(probe.pypi, "suggest", isDefaultMirror)
  const brew = pickMirror(probe.brew, "suggest", isDefaultBrew)
  const proxy = probe.bestProxy

  // Only offer a change when there is one. A healthy machine gets told so and
  // moves on, rather than being nudged into settings it doesn't need.
  const suggestsProxy = !probe.directOk && !!proxy
  const suggestsNpm = !!npm?.preset.url
  const suggestsGh = !!gh?.preset.url
  // Same predicate the wizard uses to skip this step, so "nothing to do" and
  // "don't show the page at all" can never disagree.
  const nothingToDo = !probeSuggestsChange(probe)
  // "Adopted" means every suggestion has landed, not just one of them. Checking
  // npm and proxy alone left the button live forever when a GitHub mirror was
  // the only suggestion, so it never read as done and each further click
  // silently re-applied it.
  const applied =
    (!suggestsProxy || proxyMode === "manual") &&
    (!suggestsNpm || npmRegistry === npm.preset.url) &&
    (!suggestsGh || ghMirrorPrefix === gh.preset.url)

  const adopt = () => {
    if (suggestsProxy && proxy) {
      const socks = proxy.url.startsWith("socks")
      setProxy({
        mode: "manual",
        httpUrl: socks ? undefined : proxy.url,
        httpsUrl: socks ? undefined : proxy.url,
        allUrl: socks ? proxy.url : undefined,
      })
    }
    if (suggestsNpm) setNetwork({ npmRegistry: npm.preset.url! })
    if (suggestsGh) {
      setSettings({ ghMirrorPrefix: gh.preset.url })
      void saveSettings({ ghMirrorPrefix: gh.preset.url })
    }
  }

  /**
   * `note` marks a line Adopt cannot act on. PyPI and Homebrew mirrors are env
   * vars agentpack injects only into a failed step's retry — there is no setting
   * to write — so listing all four the same way under one button put two of them
   * in a promise the button doesn't keep.
   */
  type Line = { ok: boolean; text: string; note?: string }
  const lines: Line[] = [
    probe.directOk ? { ok: true, text: p.directOk } : { ok: false, text: p.directBlocked },
    proxy?.result?.latencyMs !== undefined
      ? { ok: true, text: p.proxyFound(hostOf(proxy.url), proxy.result.latencyMs) }
      : probe.directOk
        ? null
        : { ok: false, text: p.noProxyFound },
    npm?.preset.url ? { ok: true, text: p.fastestMirror("npm", npm.preset.label) } : null,
    gh?.preset.url ? { ok: true, text: p.fastestMirror("GitHub", gh.preset.label) } : null,
    pypi?.preset.url
      ? { ok: true, text: p.fastestMirror("PyPI", pypi.preset.label), note: p.retryOnly }
      : null,
    brew?.preset.apiDomain
      ? { ok: true, text: p.fastestMirror("Homebrew", brew.preset.label), note: p.retryOnly }
      : null,
  ].filter((l): l is Line => l !== null)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5 rounded-lg border bg-muted/30 p-3">
        {lines.map((line) => (
          <div key={line.text} className="flex items-start gap-2 text-sm">
            {line.ok ? (
              <CheckCircle2
                className="mt-0.5 size-4 shrink-0 text-[var(--hm-ok)]"
                aria-hidden="true"
              />
            ) : (
              <TriangleAlert
                className="mt-0.5 size-4 shrink-0 text-[var(--hm-warn)]"
                aria-hidden="true"
              />
            )}
            <span>
              {line.text}
              {line.note ? <span className="text-muted-foreground"> — {line.note}</span> : null}
            </span>
          </div>
        ))}
      </div>

      {nothingToDo ? (
        <p className="text-sm text-muted-foreground">{p.nothingToDo}</p>
      ) : (
        <Button variant="outline" onClick={adopt} disabled={applied} className="self-start">
          {applied ? p.adopted : p.adopt}
        </Button>
      )}
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
