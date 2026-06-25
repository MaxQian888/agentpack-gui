"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { ProviderApp, ProviderForm as ProviderFormData } from "@/lib/agentpack/ccswitch/types"
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
  const [token, setToken] = useState("")
  const [authKind, setAuthKind] = useState(initial?.claudeAuthKind ?? "auth_token")
  const [model, setModel] = useState(initial?.model ?? "")
  const [notes, setNotes] = useState(initial?.notes ?? "")
  const [website, setWebsite] = useState(initial?.websiteUrl ?? "")

  const submit = () => {
    onSubmit({
      name,
      app,
      baseUrl,
      token,
      claudeAuthKind: authKind,
      model: model || undefined,
      notes: notes || undefined,
      websiteUrl: website || undefined,
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? c.formEditTitle : c.formAddTitle}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="pf-name">{c.fieldName}</Label>
            <Input id="pf-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="grid gap-1.5">
            <Label>{c.fieldApp}</Label>
            <RadioGroup
              className="flex gap-4"
              value={app}
              onValueChange={(v) => setApp(v as ProviderApp)}
            >
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="claude" /> Claude
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="codex" /> Codex
              </label>
            </RadioGroup>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="pf-base">{c.fieldBaseUrl}</Label>
            <Input id="pf-base" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="pf-token">{c.fieldToken}</Label>
            <Input
              id="pf-token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </div>

          {app === "claude" ? (
            <div className="grid gap-1.5">
              <Label>{c.fieldAuthKind}</Label>
              <RadioGroup value={authKind} onValueChange={(v) => setAuthKind(v as typeof authKind)}>
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
            <Input id="pf-model" value={model} onChange={(e) => setModel(e.target.value)} />
          </div>

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
          <Button onClick={submit} disabled={!name.trim()}>
            {t.shell.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
