/* Hallmark · genre: modern-minimal · macrostructure: ordered checklist band · design-system: design.md · contrast: pass · mobile: pass */
"use client"

import { useEffect, useRef, useState } from "react"
import { Copy, Terminal } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { ChecklistId, ChecklistRow } from "@/lib/agentpack/getting-started"
import { LOGIN_COMMAND, type ConnectApp } from "@/lib/agentpack/onboarding"
import type { SectionKey } from "@/lib/agentpack/workspaces"
import { launchAgent, launchAgentLogin, loginStatus } from "@/lib/tauri/commands"
import { copyText } from "@/lib/tauri/clipboard"
import { useT } from "@/lib/i18n/provider"
import { SetupSteps, type SetupStep } from "./setup-steps"

/** What each agent is opened with for a conversation — mirrors `login.rs`'s `agent_command`. */
const AGENT_COMMAND: Record<ConnectApp, string> = { claude: "claude", codex: "codex" }

/** Where each extra is done. */
const DESTINATION: Partial<Record<ChecklistId, SectionKey>> = {
  keyedServer: "mcp",
  skills: "skills",
  desktopApp: "clis",
}

/**
 * Each agent's own sign-in, as `login_status` reports it — presence only,
 * never a credential, and never a Keychain prompt.
 *
 * Read when the overview opens and whenever the window regains focus (the
 * sign-in happens in a terminal, so focus coming back is the moment it may
 * have finished), and every two seconds while `watch` names an agent — after
 * a Sign in click, until that agent reports signed in. Null until the first read lands, which the
 * checklist treats as unmeasured rather than as signed out.
 */
export function useLoginReport(
  enabled: boolean,
  watch: ConnectApp | null
): Partial<Record<ConnectApp, boolean>> | null {
  const [report, setReport] = useState<Partial<Record<ConnectApp, boolean>> | null>(null)
  // Polling stops by itself once the agent being watched reports signed in.
  const polling = !!watch && report?.[watch] !== true

  useEffect(() => {
    if (!enabled) return
    let live = true
    // Through a resolved promise so a bridge that throws synchronously lands
    // in the catch too: an unreadable status stays unmeasured, never "signed out".
    const read = () =>
      Promise.resolve()
        .then(loginStatus)
        .then((r) => live && setReport({ claude: r.claude.signedIn, codex: r.codex.signedIn }))
        .catch(() => undefined)
    void read()
    window.addEventListener("focus", read)
    const timer = polling ? setInterval(read, 2000) : undefined
    return () => {
      live = false
      window.removeEventListener("focus", read)
      if (timer) clearInterval(timer)
    }
  }, [enabled, polling])

  return report
}

/**
 * The Overview's Getting started checklist: what stands between this machine
 * and an agent that answers, then the extras worth adding. Rows and ticks come
 * from `checklistRows` (lib/agentpack/getting-started); this only draws them
 * and wires each row's one control.
 *
 * Two of those controls leave the app on purpose. Signing in is the CLI's own
 * flow and the first message is typed into the agent, so both open the user's
 * terminal (`launch_agent_login` / `launch_agent`) — and where none opens, the
 * command is offered to copy, because a button that silently did nothing is
 * the one outcome a newcomer can't recover from.
 */
export function GettingStarted({
  rows,
  desktop,
  networkBlocked,
  agentTitle,
  onOpenGuide,
  onNavigate,
  onStartTour,
  onSignInStarted,
  onDismiss,
}: {
  rows: readonly ChecklistRow[]
  /** There is a machine behind the window to open a terminal on. */
  desktop: boolean
  /** The startup probe reached nothing directly and found no proxy. */
  networkBlocked: boolean
  agentTitle: (app: ConnectApp) => string
  onOpenGuide: () => void
  onNavigate: (section: SectionKey) => void
  onStartTour: () => void
  /** A sign-in terminal was opened for `app`; the caller watches `login_status` until it lands. */
  onSignInStarted: (app: ConnectApp) => void
  onDismiss: () => void
}) {
  const t = useT()
  const g = t.gettingStarted
  const [signingIn, setSigningIn] = useState<ConnectApp | null>(null)
  // The command to copy, once opening a terminal for it has failed.
  const [manual, setManual] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => void (copiedTimer.current && clearTimeout(copiedTimer.current)), [])

  const openTerminal = (launch: Promise<void>, command: string) =>
    launch.then(
      () => setManual((m) => (m === command ? null : m)),
      () => setManual(command)
    )

  const names = (apps: readonly ConnectApp[]) => apps.map(agentTitle).join(", ")

  const step = (row: ChecklistRow): SetupStep => {
    const live = row.status === "current" || row.status === "todo"
    const quiet = row.status !== "current"
    const copy = g[row.id]
    const base: SetupStep = {
      id: row.id,
      title: copy.title,
      description: copy.body,
      status: row.status,
      note:
        // Only where something is actually looking: in web mode nothing ever
        // will, and "Checking…" would sit there for good.
        row.tick === "unknown" && live && desktop
          ? g.checking
          : row.tick === "todo" && row.id === "connect" && row.pending.length
            ? g.pendingFor(names(row.pending))
            : undefined,
    }
    if (!live) return base

    switch (row.id) {
      case "install":
        return {
          ...base,
          action: (
            <Button size="sm" variant={quiet ? "outline" : "default"} onClick={onOpenGuide}>
              {g.install.action}
            </Button>
          ),
        }
      case "connect": {
        const app = row.pending[0]
        const useKey = (
          <Button size="sm" variant="ghost" onClick={() => onNavigate("ccswitch")}>
            {g.connect.useKey}
          </Button>
        )
        if (!desktop || !app) return { ...base, action: useKey }
        return {
          ...base,
          note: signingIn === app ? g.connect.waiting : base.note,
          action: (
            <Button
              size="sm"
              variant={quiet ? "outline" : "default"}
              onClick={() => {
                setSigningIn(app)
                onSignInStarted(app)
                void openTerminal(launchAgentLogin(app), LOGIN_COMMAND[app])
              }}
            >
              <Terminal className="size-3.5" aria-hidden="true" />
              {g.connect.signIn(agentTitle(app))}
            </Button>
          ),
          secondaryAction: useKey,
        }
      }
      case "firstMessage": {
        const app = row.pending[0]
        if (!desktop || !app) return base
        return {
          ...base,
          action: (
            <Button
              size="sm"
              variant={quiet ? "outline" : "default"}
              onClick={() => void openTerminal(launchAgent(app), AGENT_COMMAND[app])}
            >
              <Terminal className="size-3.5" aria-hidden="true" />
              {g.firstMessage.open(AGENT_COMMAND[app])}
            </Button>
          ),
        }
      }
      case "tour":
        return {
          ...base,
          action: (
            <Button size="sm" variant={quiet ? "outline" : "default"} onClick={onStartTour}>
              {g.tour.action}
            </Button>
          ),
        }
      default: {
        const to = DESTINATION[row.id]
        return to
          ? {
              ...base,
              action: (
                <Button
                  size="sm"
                  variant={quiet ? "outline" : "default"}
                  onClick={() => onNavigate(to)}
                >
                  {g[row.id as "keyedServer" | "skills" | "desktopApp"].action}
                </Button>
              ),
            }
          : base
      }
    }
  }

  const installPending = rows.some((r) => r.id === "install" && r.status !== "done")

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <SetupSteps
        title={g.title}
        hint={g.hint}
        steps={rows.map(step)}
        progressLabel={g.progress}
        statusLabels={{
          done: t.shell.setupDone,
          current: t.shell.setupCurrent,
          todo: t.shell.setupTodo,
          waiting: t.shell.setupWaiting,
          blocked: t.shell.setupBlocked,
        }}
        actions={
          <Button variant="ghost" size="sm" className="h-7 px-2" onClick={onDismiss}>
            {g.hide}
          </Button>
        }
      />
      {/* Point a blocked machine at the fix before it watches an install fail. */}
      {networkBlocked && installPending ? (
        <button
          type="button"
          onClick={() => onNavigate("network")}
          className="self-start rounded-sm text-left text-sm text-[var(--hm-warn)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {g.networkBlocked}
        </button>
      ) : null}
      {manual ? (
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {g.manual}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{manual}</code>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              void copyText(manual).then((ok) => {
                if (!ok) return
                setCopied(true)
                if (copiedTimer.current) clearTimeout(copiedTimer.current)
                copiedTimer.current = setTimeout(() => setCopied(false), 2000)
              })
            }
          >
            <Copy className="size-3.5" aria-hidden="true" />
            {copied ? t.completion.copied : g.copy}
          </Button>
        </p>
      ) : null}
    </div>
  )
}
