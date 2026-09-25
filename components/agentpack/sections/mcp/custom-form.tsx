"use client"

import { useMemo, useState } from "react"
import { Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/provider"
import { MCP_REGISTRY_IDS } from "@/lib/agentpack/scan"
import type { McpSpec } from "@/lib/agentpack/merge/mcp"
import type { McpTarget } from "@/lib/agentpack/types"
import { MCP_TARGETS, TargetDot } from "./helpers"

export interface CustomFormValue {
  id: string
  spec: McpSpec
  targets: McpTarget[]
}

/** `ref` = the value names a host env var to reference (envRefs) rather than a literal (env). */
type EnvRow = { key: string; value: string; ref: boolean }
type HeaderRow = { key: string; value: string }

const BEARER = /^Bearer\s+/i
const isAuthorization = (name: string) => name.trim().toLowerCase() === "authorization"

/**
 * Split a remote spec's headers into the bearer token the form edits on its own
 * and every other header, kept as rows.
 *
 * The form used to read `Authorization` alone, minus a literal "Bearer " — so
 * editing a server dropped every other header it had, and a `Basic …` value
 * came back as the token and was saved as `Bearer Basic …`. Only a bearer value
 * is a token; anything else stays a header, verbatim.
 */
function splitHeaders(headers: Record<string, string>): { token: string; rows: HeaderRow[] } {
  let token = ""
  const rows: HeaderRow[] = []
  for (const [key, value] of Object.entries(headers)) {
    if (!token && isAuthorization(key) && BEARER.test(value)) token = value.replace(BEARER, "")
    else rows.push({ key, value })
  }
  return { token, rows }
}

function argsToText(args: string[]): string {
  return args.join("\n")
}
function textToArgs(text: string): string[] {
  return text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
}
function envToRows(env: Record<string, string>, envRefs: Record<string, string> = {}): EnvRow[] {
  const rows: EnvRow[] = [
    ...Object.entries(env).map(([key, value]) => ({ key, value, ref: false })),
    ...Object.entries(envRefs).map(([key, value]) => ({ key, value, ref: true })),
  ]
  return rows.length ? rows : [{ key: "", value: "", ref: false }]
}
function rowsToEnvSplit(rows: EnvRow[]): {
  env: Record<string, string>
  envRefs: Record<string, string>
} {
  const env: Record<string, string> = {}
  const envRefs: Record<string, string> = {}
  for (const r of rows) {
    const k = r.key.trim()
    if (!k) continue
    if (r.ref) {
      if (r.value.trim()) envRefs[k] = r.value.trim()
    } else {
      env[k] = r.value
    }
  }
  return { env, envRefs }
}

/**
 * The add / edit form for a custom MCP server. Emits a validated
 * `{ id, spec, targets }`; the caller turns it into runner steps. In edit mode
 * the id is locked and the fields are prefilled from the existing spec.
 */
export function CustomServerForm({
  mode,
  initial,
  takenIds,
  disabledTargets,
  submitting,
  onSubmit,
  onCancel,
}: {
  mode: "add" | "edit"
  initial?: CustomFormValue
  /** Ids already configured (add mode rejects a collision). */
  takenIds: Set<string>
  /**
   * Targets this machine can't write, each with the reason shown on its
   * checkbox — Claude when neither Claude Code nor the desktop app is installed.
   */
  disabledTargets?: Partial<Record<McpTarget, string>>
  submitting?: boolean
  onSubmit: (value: CustomFormValue) => void
  onCancel?: () => void
}) {
  const m = useT().mcp

  const init = initial?.spec
  const [id, setId] = useState(initial?.id ?? "")
  const [transport, setTransport] = useState<"stdio" | "http" | "sse">(init?.transport ?? "stdio")
  const [command, setCommand] = useState(init?.transport === "stdio" ? init.command : "npx")
  const [argsText, setArgsText] = useState(init?.transport === "stdio" ? argsToText(init.args) : "")
  const [envRows, setEnvRows] = useState<EnvRow[]>(
    envToRows(
      init?.transport === "stdio" ? init.env : {},
      init?.transport === "stdio" ? (init.envRefs ?? {}) : {}
    )
  )
  const [url, setUrl] = useState(init && init.transport !== "stdio" ? init.url : "")
  const [initHeaders] = useState(() =>
    splitHeaders(init && init.transport !== "stdio" ? init.headers : {})
  )
  const [token, setToken] = useState(initHeaders.token)
  const [headerRows, setHeaderRows] = useState<HeaderRow[]>(initHeaders.rows)
  const [tokenEnvVar, setTokenEnvVar] = useState(
    init && init.transport !== "stdio" ? (init.bearerTokenEnvVar ?? "") : ""
  )
  const [targets, setTargets] = useState<Set<McpTarget>>(
    new Set((initial?.targets ?? ["claude"]).filter((tg) => !disabledTargets?.[tg]))
  )
  const [error, setError] = useState<string | null>(null)

  const toggleTarget = (t: McpTarget) =>
    setTargets((prev) => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })

  const idError = useMemo(() => {
    // The id is locked and trusted (read from disk) in edit mode.
    if (mode === "edit") return null
    const trimmed = id.trim()
    if (!trimmed) return m.errIdRequired
    if (!/^[a-z0-9-]+$/.test(trimmed)) return m.errIdFormat
    if (MCP_REGISTRY_IDS.includes(trimmed)) return m.errIdReserved
    if (takenIds.has(trimmed)) return m.errIdExists
    return null
  }, [id, mode, takenIds, m])

  const buildSpec = (): McpSpec => {
    if (transport !== "stdio") {
      const headers: Record<string, string> = {}
      for (const row of headerRows) if (row.key.trim()) headers[row.key.trim()] = row.value
      if (token.trim()) headers.Authorization = `Bearer ${token.trim()}`
      const remote = {
        url: url.trim(),
        headers,
        bearerTokenEnvVar: tokenEnvVar.trim() || undefined,
      }
      return transport === "sse"
        ? { transport: "sse", ...remote }
        : { transport: "http", ...remote }
    }
    const { env, envRefs } = rowsToEnvSplit(envRows)
    return {
      transport: "stdio",
      command: command.trim(),
      args: textToArgs(argsText),
      env,
      ...(Object.keys(envRefs).length ? { envRefs } : {}),
    }
  }

  const submit = () => {
    // Only what can actually be written: a target that became unavailable after
    // it was ticked (a re-detect, a switch to SSE) is not a target.
    const chosen = [...targets].filter(
      (tg) => !disabledTargets?.[tg] && !(transport === "sse" && tg === "codex")
    )
    if (idError) return setError(idError)
    if (transport === "stdio" && !command.trim()) return setError(m.errCommandRequired)
    if (transport !== "stdio" && !url.trim()) return setError(m.errUrlRequired)
    if (chosen.length === 0) return setError(m.errTargetRequired)
    if (transport !== "stdio" && token.trim() && chosen.includes("codex") && !tokenEnvVar.trim()) {
      return setError(m.errCodexTokenEnv)
    }
    if (
      transport !== "stdio" &&
      token.trim() &&
      headerRows.some((row) => isAuthorization(row.key))
    ) {
      return setError(m.errAuthorizationTwice)
    }
    setError(null)
    onSubmit({ id: id.trim(), spec: buildSpec(), targets: chosen })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="mcp-id">{m.fieldId}</Label>
        <Input
          id="mcp-id"
          value={id}
          disabled={mode === "edit"}
          onChange={(e) => setId(e.target.value)}
          placeholder="my-server"
        />
        <p className="text-xs text-muted-foreground">{m.fieldIdHint}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>{m.fieldTransport}</Label>
        <div className="flex flex-wrap gap-2">
          {(["stdio", "http", "sse"] as const).map((tr) => (
            <button
              key={tr}
              type="button"
              onClick={() => {
                setTransport(tr)
                // Codex has no standalone SSE transport — drop it when switching to sse.
                if (tr === "sse")
                  setTargets((prev) => {
                    const next = new Set(prev)
                    next.delete("codex")
                    return next
                  })
              }}
              className={cn(
                // A control, so the control radius — design.md § 5 keeps pills
                // for status dots and count bubbles.
                "rounded-md border px-3 py-1 text-xs",
                "transition-colors duration-(--hm-dur-fast) ease-(--hm-ease-out)",
                transport === tr
                  ? "border-primary bg-primary/10 font-medium"
                  : "text-muted-foreground hover:bg-accent/40"
              )}
            >
              {tr === "stdio" ? m.transportStdio : tr === "http" ? m.transportHttp : m.transportSse}
            </button>
          ))}
        </div>
      </div>

      {transport === "stdio" ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mcp-cmd">{m.fieldCommand}</Label>
              <Input
                id="mcp-cmd"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="npx"
              />
              <p className="text-xs text-muted-foreground">{m.fieldCommandHint}</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mcp-args">{m.fieldArgs}</Label>
              <Textarea
                id="mcp-args"
                value={argsText}
                onChange={(e) => setArgsText(e.target.value)}
                placeholder={"-y\n@scope/package"}
                className="min-h-20 font-mono text-xs"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{m.fieldEnv}</Label>
            <div className="flex flex-col gap-2">
              {envRows.map((row, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_auto_auto] gap-2">
                  <Input
                    value={row.key}
                    onChange={(e) =>
                      setEnvRows((rows) =>
                        rows.map((r, j) => (j === i ? { ...r, key: e.target.value } : r))
                      )
                    }
                    placeholder={m.envKeyPlaceholder}
                    className="font-mono text-xs"
                  />
                  <Input
                    value={row.value}
                    type={row.ref ? "text" : "password"}
                    onChange={(e) =>
                      setEnvRows((rows) =>
                        rows.map((r, j) => (j === i ? { ...r, value: e.target.value } : r))
                      )
                    }
                    placeholder={row.ref ? m.envRefPlaceholder : m.envValuePlaceholder}
                    className="font-mono text-xs"
                  />
                  <button
                    type="button"
                    title={row.ref ? m.envRefOn : m.envRefOff}
                    onClick={() =>
                      setEnvRows((rows) =>
                        rows.map((r, j) => (j === i ? { ...r, ref: !r.ref } : r))
                      )
                    }
                    className={cn(
                      "rounded-md border px-2 text-xs",
                      "transition-colors duration-(--hm-dur-fast) ease-(--hm-ease-out)",
                      row.ref
                        ? "border-primary bg-primary/10 font-medium"
                        : "text-muted-foreground hover:bg-accent/40"
                    )}
                  >
                    {m.envRefLabel}
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-9"
                    aria-label={m.removeRow}
                    onClick={() => setEnvRows((rows) => rows.filter((_, j) => j !== i))}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit gap-1"
                onClick={() => setEnvRows((rows) => [...rows, { key: "", value: "", ref: false }])}
              >
                <Plus className="size-3.5" />
                {m.addRow}
              </Button>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mcp-url">{m.fieldUrl}</Label>
            <Input
              id="mcp-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://my-mcp-server.com/mcp"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mcp-token">{m.fieldToken}</Label>
              <Input
                id="mcp-token"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{m.fieldTokenHint}</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mcp-tokenenv">{m.fieldTokenEnvVar}</Label>
              <Input
                id="mcp-tokenenv"
                value={tokenEnvVar}
                onChange={(e) => setTokenEnvVar(e.target.value)}
                placeholder="MY_TOKEN"
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">{m.fieldTokenEnvVarHint}</p>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{m.fieldExtraHeaders}</Label>
            <div className="flex flex-col gap-2">
              {headerRows.map((row, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                  <Input
                    value={row.key}
                    aria-label={`${m.fieldExtraHeaders} ${i + 1}`}
                    onChange={(e) =>
                      setHeaderRows((rows) =>
                        rows.map((r, j) => (j === i ? { ...r, key: e.target.value } : r))
                      )
                    }
                    placeholder={m.headerNamePlaceholder}
                    className="font-mono text-xs"
                  />
                  <Input
                    value={row.value}
                    type="password"
                    aria-label={`${row.key || m.fieldExtraHeaders} ${m.envValuePlaceholder}`}
                    onChange={(e) =>
                      setHeaderRows((rows) =>
                        rows.map((r, j) => (j === i ? { ...r, value: e.target.value } : r))
                      )
                    }
                    placeholder={m.envValuePlaceholder}
                    className="font-mono text-xs"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-9"
                    aria-label={m.removeRow}
                    onClick={() => setHeaderRows((rows) => rows.filter((_, j) => j !== i))}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit gap-1"
                onClick={() => setHeaderRows((rows) => [...rows, { key: "", value: "" }])}
              >
                <Plus className="size-3.5" />
                {m.addHeader}
              </Button>
              <p className="text-xs text-muted-foreground">{m.fieldExtraHeadersHint}</p>
            </div>
          </div>
        </>
      )}

      <div className="flex flex-col gap-1.5">
        <Label>{m.selectTargets}</Label>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          {MCP_TARGETS.map((target) => {
            // Codex has no standalone SSE transport — gate it out of an sse spec.
            const reason =
              disabledTargets?.[target] ??
              (transport === "sse" && target === "codex" ? m.capCodexNoSse : undefined)
            const disabled = !!reason
            return (
              <label
                key={target}
                title={reason}
                className={cn(
                  "flex items-center gap-2",
                  disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
                )}
              >
                <Checkbox
                  checked={targets.has(target) && !disabled}
                  disabled={disabled}
                  onCheckedChange={() => toggleTarget(target)}
                />
                <TargetDot target={target} on={targets.has(target) && !disabled} />
                {m.targets[target]}
              </label>
            )
          })}
        </div>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex items-center gap-2">
        <Button onClick={submit} disabled={submitting}>
          {mode === "edit" ? m.saveChanges : m.addServer}
        </Button>
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel} disabled={submitting}>
            {m.cancel}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
