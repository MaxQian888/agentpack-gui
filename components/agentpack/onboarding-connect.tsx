"use client"

import { useEffect, useState } from "react"
import { CheckCircle2, Copy, Loader2, Terminal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { probeRequest, readProbe, type ProbeOutcome } from "@/lib/agentpack/ccswitch/probe"
import {
  connectionComplete,
  CUSTOM_RELAY,
  LOGIN_COMMAND,
  probeFormFor,
  relayPresets,
  type AgentConnection,
  type ConnectApp,
  type ConnectKind,
} from "@/lib/agentpack/onboarding"
import { isTauri } from "@/lib/tauri"
import { httpGet, launchAgentLogin, loginStatus } from "@/lib/tauri/commands"
import { copyText } from "@/lib/tauri/clipboard"
import { useT } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import { KeyInput } from "./sections/mcp/helpers"

const KINDS: readonly ConnectKind[] = ["official", "apiKey", "relay"]

/** The agent's display name, from the wizard's own copy. */
function useAgentTitle() {
  const w = useT().welcome
  return (app: ConnectApp) => (app === "claude" ? w.agentClaude : w.agentCodex)
}

/**
 * The wizard's "how does each agent reach a model?" step: one block per agent
 * being installed. Asked before the install, so that once Install now is
 * pressed nobody is pulled back halfway through to answer a question.
 *
 * Only the fields a choice needs are drawn. The auth variable is never asked —
 * it follows from the choice (`connectionForm`) — and the connection test runs
 * by itself once the fields are filled. It informs; it never blocks Continue,
 * because some relays refuse the `/models` call it makes.
 */
export function ConnectStep({
  apps,
  connections,
  onChange,
}: {
  apps: readonly ConnectApp[]
  connections: Partial<Record<ConnectApp, AgentConnection>>
  onChange: (app: ConnectApp, next: AgentConnection) => void
}) {
  return (
    <div className="flex flex-col gap-5">
      {apps.map((app) => (
        <AgentConnectBlock
          key={app}
          app={app}
          connection={connections[app]!}
          onChange={(next) => onChange(app, next)}
          showTitle={apps.length > 1}
        />
      ))}
    </div>
  )
}

function AgentConnectBlock({
  app,
  connection: c,
  onChange,
  showTitle,
}: {
  app: ConnectApp
  connection: AgentConnection
  onChange: (next: AgentConnection) => void
  showTitle: boolean
}) {
  const t = useT()
  const w = t.welcome
  const title = useAgentTitle()
  const presets = relayPresets(app)
  const kindMeta: Record<ConnectKind, { title: string; hint: string }> = {
    official: { title: w.connectOfficial, hint: w.connectOfficialHint[app] },
    apiKey: { title: w.connectApiKey, hint: w.connectApiKeyHint[app] },
    relay: { title: w.connectRelay, hint: w.connectRelayHint },
  }
  const pick = (kind: ConnectKind) =>
    onChange({
      kind,
      // A relay starts on the first named preset, so its URL is already there.
      preset: kind === "relay" ? (presets[0]?.key ?? CUSTOM_RELAY) : undefined,
      baseUrl: kind === "relay" ? (presets[0]?.form.baseUrl ?? "") : "",
      token: c.token,
    })

  return (
    <fieldset className="flex flex-col gap-2">
      {showTitle ? (
        <legend className="mb-1 text-sm font-medium">{w.connectFor(title(app))}</legend>
      ) : null}
      <RadioGroup value={c.kind} onValueChange={(v) => pick(v as ConnectKind)} className="gap-2">
        {KINDS.map((kind) => (
          <Label
            key={kind}
            htmlFor={`connect-${app}-${kind}`}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal transition-colors hover:border-primary/50",
              c.kind === kind && "border-primary ring-1 ring-primary"
            )}
          >
            <RadioGroupItem id={`connect-${app}-${kind}`} value={kind} className="mt-0.5" />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">{kindMeta[kind].title}</span>
              <span className="text-xs text-muted-foreground">{kindMeta[kind].hint}</span>
            </span>
          </Label>
        ))}
      </RadioGroup>

      {c.kind === "relay" ? (
        <div className="flex flex-col gap-2 pl-1">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={w.connectRelay}>
            {[
              ...presets.map((p) => ({ key: p.key, label: p.label })),
              { key: CUSTOM_RELAY, label: w.relayCustom },
            ].map((p) => (
              <Button
                key={p.key}
                type="button"
                size="sm"
                variant={c.preset === p.key ? "default" : "outline"}
                aria-pressed={c.preset === p.key}
                onClick={() =>
                  onChange({
                    ...c,
                    preset: p.key,
                    baseUrl:
                      p.key === CUSTOM_RELAY
                        ? ""
                        : (presets.find((x) => x.key === p.key)?.form.baseUrl ?? ""),
                  })
                }
              >
                {p.label}
              </Button>
            ))}
          </div>
          {c.preset === CUSTOM_RELAY ? (
            <div className="flex flex-col gap-1">
              <Label htmlFor={`connect-${app}-url`} className="text-xs font-normal">
                {w.fieldBaseUrl}
              </Label>
              <Input
                id={`connect-${app}-url`}
                value={c.baseUrl}
                placeholder="https://"
                onChange={(e) => onChange({ ...c, baseUrl: e.target.value })}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {c.kind !== "official" ? (
        <div className="flex flex-col gap-1 pl-1">
          <Label className="text-xs font-normal">{w.fieldKey}</Label>
          <KeyInput
            ariaLabel={`${title(app)} ${w.fieldKey}`}
            value={c.token}
            onChange={(token) => onChange({ ...c, token })}
          />
          <ConnectionTest app={app} connection={c} />
        </div>
      ) : null}
    </fieldset>
  )
}

/**
 * Tests the connection once its fields have settled for a moment. Desktop
 * only: web mode has nothing to send the request with, and a test that can't
 * run says nothing rather than something false.
 */
function ConnectionTest({ app, connection }: { app: ConnectApp; connection: AgentConnection }) {
  const t = useT()
  const c = t.ccswitch
  // Stamped with the fields it was measured for: a result for a key that has
  // since been edited is simply not shown, rather than reset in the effect.
  const [stamped, setStamped] = useState<{ key: string; outcome: ProbeOutcome | "testing" } | null>(
    null
  )
  const ready = connectionComplete(connection)
  const key = JSON.stringify([app, connection.kind, connection.baseUrl, connection.token])

  useEffect(() => {
    if (!ready || !isTauri()) return
    const form = probeFormFor(app, connection)
    const req = form ? probeRequest(form) : null
    if (!req) return
    let live = true
    const timer = setTimeout(() => {
      setStamped({ key, outcome: "testing" })
      httpGet(req.url, req.headers)
        .then((r) => live && setStamped({ key, outcome: readProbe(r) }))
        .catch(
          () =>
            live && setStamped({ key, outcome: { ok: false, models: [], reason: "unreachable" } })
        )
    }, 600)
    return () => {
      live = false
      clearTimeout(timer)
    }
    // `key` stands for the connection's fields; the object itself is new each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, key])

  const result = ready && stamped?.key === key ? stamped.outcome : null
  if (!result) return null
  if (result === "testing") {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" aria-hidden="true" />
        {t.welcome.testing}
      </p>
    )
  }
  const message = result.ok
    ? c.probeOk(result.latencyMs ?? 0, result.models.length)
    : result.reason === "unauthorized"
      ? c.probeUnauthorized
      : result.reason === "not-found"
        ? c.probeNotFound
        : result.reason === "unreachable"
          ? c.probeUnreachable
          : c.probeHttpError(result.status ?? 0)
  return (
    <p
      role="status"
      className={cn("text-xs", result.ok ? "text-[var(--hm-ok)]" : "text-[var(--hm-warn)]")}
    >
      {message}
      {result.ok ? null : (
        <span className="text-muted-foreground"> {t.welcome.testNotBlocking}</span>
      )}
    </p>
  )
}

/**
 * After the install: each agent connected through its official subscription
 * signs in with its own command, in a terminal, and this ticks it off by
 * watching `loginStatus` — which reads presence only, never a credential, and
 * never prompts. Where no terminal can be opened (Linux has no single
 * answer), the command is offered to copy instead.
 */
export function SignInPanel({ apps }: { apps: readonly ConnectApp[] }) {
  const t = useT()
  const w = t.welcome
  const title = useAgentTitle()
  const [signedIn, setSignedIn] = useState<Partial<Record<ConnectApp, boolean>>>({})
  const [opened, setOpened] = useState<Partial<Record<ConnectApp, boolean>>>({})
  const [manual, setManual] = useState<Partial<Record<ConnectApp, boolean>>>({})
  const [copied, setCopied] = useState<ConnectApp | null>(null)
  const waiting = apps.some((app) => !signedIn[app])

  useEffect(() => {
    if (!waiting) return
    let live = true
    const read = () =>
      loginStatus()
        .then((r) => live && setSignedIn({ claude: r.claude.signedIn, codex: r.codex.signedIn }))
        .catch(() => undefined)
    void read()
    const timer = setInterval(read, 2000)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [waiting])

  const open = (app: ConnectApp) => {
    setOpened((o) => ({ ...o, [app]: true }))
    launchAgentLogin(app).catch(() => setManual((m) => ({ ...m, [app]: true })))
  }

  if (apps.length === 0) return null
  return (
    <section
      aria-labelledby="signin-title"
      className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3"
    >
      <div>
        <h3 id="signin-title" className="text-sm font-medium">
          {w.signInTitle}
        </h3>
        <p className="text-xs text-muted-foreground">{w.signInHint}</p>
      </div>
      {apps.map((app) => (
        <div key={app} className="flex flex-wrap items-center gap-2 text-sm">
          <span className="min-w-28 font-medium">{title(app)}</span>
          {signedIn[app] ? (
            <span className="flex items-center gap-1.5 text-[var(--hm-ok)]">
              <CheckCircle2 className="size-4" aria-hidden="true" />
              {w.signedIn}
            </span>
          ) : manual[app] ? (
            <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {w.signInManual}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{LOGIN_COMMAND[app]}</code>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void copyText(LOGIN_COMMAND[app]).then((ok) => ok && setCopied(app))}
              >
                <Copy className="size-3.5" />
                {copied === app ? t.completion.copied : w.copy}
              </Button>
            </span>
          ) : (
            <>
              <Button
                size="sm"
                variant={opened[app] ? "outline" : "default"}
                onClick={() => open(app)}
              >
                <Terminal className="size-3.5" />
                {w.signInOpen}
              </Button>
              {opened[app] ? (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                  {w.signInWaiting}
                </span>
              ) : null}
            </>
          )}
        </div>
      ))}
    </section>
  )
}
