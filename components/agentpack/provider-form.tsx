"use client"

import { useState } from "react"
import { Eye, EyeOff, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { ProviderApp, ProviderForm as ProviderFormData } from "@/lib/agentpack/ccswitch/types"
import { buildSettingsConfig, parseSettingsConfig } from "@/lib/agentpack/ccswitch/provider"
import { probeRequest, readProbe, type ProbeOutcome } from "@/lib/agentpack/ccswitch/probe"
import { httpGet } from "@/lib/tauri/commands"
import { isTauri } from "@/lib/tauri"
import { useT } from "@/lib/i18n/provider"

export interface ProviderFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Pre-filled defaults (recommended preset or edit). */
  initial?: Partial<ProviderFormData>
  editing?: boolean
  onSubmit: (form: ProviderFormData) => void
}

export function ProviderForm({
  open,
  onOpenChange,
  initial,
  editing,
  onSubmit,
}: ProviderFormProps) {
  const t = useT()
  const c = t.ccswitch
  const [name, setName] = useState(initial?.name ?? "")
  const [app, setApp] = useState<ProviderApp>(initial?.app ?? "claude")
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? "")
  const [token, setToken] = useState(initial?.token ?? "")
  const [authKind, setAuthKind] = useState(initial?.claudeAuthKind ?? "auth_token")
  const [model, setModel] = useState(initial?.model ?? "")
  const [notes, setNotes] = useState(initial?.notes ?? "")
  const [website, setWebsite] = useState(initial?.websiteUrl ?? "")
  const [revealed, setRevealed] = useState(false)
  const [probing, setProbing] = useState(false)
  const [probe, setProbe] = useState<ProbeOutcome | null>(null)
  // The raw tab's text. `null` means it was never opened or was invalidated by a
  // form edit, and the fields above remain the source of truth.
  const [raw, setRaw] = useState<string | null>(initial?.rawSettingsConfig ?? null)
  const [rawValid, setRawValid] = useState(true)
  // The row's stored config, which the fields merge into. Only while the app is
  // still the one it was stored for: a claude `env` is meaningless to codex.
  const base = app === initial?.app ? initial?.baseSettingsConfig : undefined

  const formFields = (): ProviderFormData => ({
    name,
    app,
    baseUrl,
    token,
    claudeAuthKind: authKind,
    model: model || undefined,
    notes: notes || undefined,
    websiteUrl: website || undefined,
    baseSettingsConfig: base,
  })

  /**
   * A connection-test result describes the endpoint and token it was run
   * against. Kept across an edit of either, it vouches for values nobody has
   * tested — so any change to what the probe sends clears it.
   */
  const resetProbe = () => setProbe(null)

  /**
   * Any form-field edit drops a hand-written config: the two surfaces follow a
   * last-edited-wins rule, so the user never saves a config that silently
   * contradicts the fields in front of them.
   */
  const clearRaw = () => {
    setRaw(null)
    setRawValid(true)
  }

  // Opening the raw tab seeds it from what the form currently describes — the
  // stored config with the fields merged in — so the user edits the real row
  // rather than a four-field reconstruction of it.
  const openRaw = () => {
    if (raw !== null) return
    try {
      setRaw(JSON.stringify(JSON.parse(buildSettingsConfig(formFields())), null, 2))
    } catch {
      setRaw(buildSettingsConfig(formFields()))
    }
  }

  // The other half of the rule: a raw edit pushes back into the fields both
  // surfaces understand, so the form tab never shows stale values.
  const editRaw = (text: string) => {
    setRaw(text)
    try {
      JSON.parse(text)
    } catch {
      setRawValid(false)
      return
    }
    setRawValid(true)
    const back = parseSettingsConfig(app, text)
    resetProbe()
    setBaseUrl(back.baseUrl)
    setToken(back.token)
    setAuthKind(back.claudeAuthKind)
    setModel(back.model ?? "")
  }

  // One authenticated GET of the model list: it proves reachability, the base
  // URL's path and the token in a single request that costs no tokens.
  const testConnection = async () => {
    const req = probeRequest({ app, baseUrl, token, claudeAuthKind: authKind })
    if (!req) return
    setProbing(true)
    setProbe(null)
    try {
      setProbe(readProbe(await httpGet(req.url, req.headers)))
    } catch {
      setProbe({ ok: false, models: [], reason: "unreachable" })
    } finally {
      setProbing(false)
    }
  }

  const probeMessage = (p: ProbeOutcome) => {
    if (p.ok) return c.probeOk(p.latencyMs ?? 0, p.models.length)
    switch (p.reason) {
      case "unauthorized":
        return c.probeUnauthorized
      case "not-found":
        return c.probeNotFound
      case "unreachable":
        return c.probeUnreachable
      default:
        return c.probeHttpError(p.status ?? 0)
    }
  }

  const submit = () => {
    onSubmit({ ...formFields(), rawSettingsConfig: raw ?? undefined })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? c.formEditTitle : c.formAddTitle}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          {/* Identity fields describe the row itself, so they sit outside the
              form/raw split — the raw tab only owns `settings_config`. */}
          <div className="grid gap-1.5">
            <Label htmlFor="pf-name">{c.fieldName}</Label>
            <Input id="pf-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="grid gap-1.5">
            <Label>{c.fieldApp}</Label>
            <RadioGroup
              className="flex gap-4"
              value={app}
              onValueChange={(v) => {
                clearRaw()
                resetProbe()
                setApp(v as ProviderApp)
              }}
            >
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="claude" /> Claude
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="codex" /> Codex
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="opencode" /> OpenCode
              </label>
            </RadioGroup>
          </div>

          <Tabs defaultValue="form" onValueChange={(v) => v === "raw" && openRaw()}>
            <TabsList>
              <TabsTrigger value="form">{c.tabForm}</TabsTrigger>
              <TabsTrigger value="raw">{c.tabRaw}</TabsTrigger>
            </TabsList>

            <TabsContent value="form" className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="pf-base">{c.fieldBaseUrl}</Label>
                <Input
                  id="pf-base"
                  value={baseUrl}
                  onChange={(e) => {
                    clearRaw()
                    resetProbe()
                    setBaseUrl(e.target.value)
                  }}
                />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="pf-token">{c.fieldToken}</Label>
                <div className="flex gap-2">
                  <Input
                    id="pf-token"
                    type={revealed ? "text" : "password"}
                    value={token}
                    // Tokens are almost always pasted, and a trailing newline or
                    // space from the copy is an authentication failure that looks
                    // exactly like a wrong key.
                    onChange={(e) => {
                      clearRaw()
                      resetProbe()
                      setToken(e.target.value.trim())
                    }}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={revealed ? c.hideToken : c.showToken}
                    onClick={() => setRevealed((v) => !v)}
                  >
                    {revealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </Button>
                </div>
              </div>

              {isTauri() ? (
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!baseUrl.trim() || probing}
                    onClick={() => void testConnection()}
                  >
                    {probing ? <Loader2 className="size-3.5 animate-spin" /> : null}
                    {c.testConnection}
                  </Button>
                  {probe ? (
                    <span
                      className={
                        probe.ok ? "text-xs text-[var(--hm-ok)]" : "text-xs text-destructive"
                      }
                      role="status"
                    >
                      {probeMessage(probe)}
                    </span>
                  ) : null}
                </div>
              ) : null}

              {app === "claude" ? (
                <div className="grid gap-1.5">
                  <Label>{c.fieldAuthKind}</Label>
                  <RadioGroup
                    value={authKind}
                    onValueChange={(v) => {
                      clearRaw()
                      resetProbe()
                      setAuthKind(v as typeof authKind)
                    }}
                  >
                    <label className="flex items-center gap-2 text-sm">
                      <RadioGroupItem value="auth_token" /> {c.authTokenLabel}
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <RadioGroupItem value="api_key" /> {c.apiKeyLabel}
                    </label>
                  </RadioGroup>
                </div>
              ) : null}

              <div className="grid gap-1.5">
                <Label htmlFor="pf-model">{c.fieldModel}</Label>
                <Input
                  id="pf-model"
                  list={probe?.ok && probe.models.length > 0 ? "pf-model-options" : undefined}
                  value={model}
                  onChange={(e) => {
                    clearRaw()
                    setModel(e.target.value)
                  }}
                />
                {probe?.ok && probe.models.length > 0 ? (
                  <datalist id="pf-model-options">
                    {probe.models.map((modelId) => (
                      <option key={modelId} value={modelId}>
                        {modelId}
                      </option>
                    ))}
                  </datalist>
                ) : null}
              </div>
            </TabsContent>

            <TabsContent value="raw" className="grid gap-1.5">
              <Label htmlFor="pf-raw">{c.rawLabel}</Label>
              <p className="text-xs text-muted-foreground">{c.rawHint}</p>
              <Textarea
                id="pf-raw"
                className="min-h-48 font-mono text-xs"
                value={raw ?? ""}
                onChange={(e) => editRaw(e.target.value)}
              />
              {!rawValid ? <p className="text-xs text-destructive">{c.rawInvalid}</p> : null}
            </TabsContent>
          </Tabs>

          <div className="grid gap-1.5">
            <Label htmlFor="pf-notes">{c.fieldNotes}</Label>
            <Input id="pf-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="pf-website">{c.fieldWebsite}</Label>
            <Input id="pf-website" value={website} onChange={(e) => setWebsite(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          {/* An unparseable hand-written config would be stored verbatim and
              break the next switch, so saving waits for valid JSON. */}
          <Button onClick={submit} disabled={!name.trim() || !rawValid}>
            {t.shell.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
