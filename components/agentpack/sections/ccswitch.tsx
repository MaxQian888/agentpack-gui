"use client"

import { useCallback, useEffect, useState } from "react"
import { Plus, Star } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { CLI_TOOLS } from "@/lib/agentpack/registry"
import { cliInstallStep, providerStep, visibleAppsStep } from "@/lib/agentpack/plan"
import { DEFAULT_VISIBLE_APPS, VISIBLE_APP_KEYS } from "@/lib/agentpack/ccswitch/settings"
import { RECOMMENDED_PROVIDERS } from "@/lib/agentpack/ccswitch/preset"
import type {
  Provider,
  ProviderForm as ProviderFormData,
  VisibleApps,
} from "@/lib/agentpack/ccswitch/types"
import { ccLoadProviders, detectCli } from "@/lib/tauri/commands"
import { isTauri } from "@/lib/tauri"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { SectionShell } from "./section-shell"
import { ProviderForm } from "../provider-form"
import { useRunnerCtx } from "../run/runner-context"

export function CcSwitchSection() {
  const t = useT()
  const c = t.ccswitch
  const paths = useAppStore((s) => s.paths)
  const effectiveOS = useAppStore((s) => s.effectiveOS)
  const { run } = useRunnerCtx()

  const [detected, setDetected] = useState<boolean | null>(null)
  const [providers, setProviders] = useState<Provider[] | null>(null)
  const [visible, setVisible] = useState<VisibleApps>(DEFAULT_VISIBLE_APPS)
  const [formOpen, setFormOpen] = useState(false)
  const [formInitial, setFormInitial] = useState<Partial<ProviderFormData>>({})
  const [editingId, setEditingId] = useState<string | undefined>(undefined)

  const reload = useCallback(async () => {
    if (!isTauri()) return
    const [d, list] = await Promise.all([detectCli("cc-switch", true), ccLoadProviders()])
    setDetected(d.installed)
    setProviders(list)
  }, [])

  useEffect(() => {
    if (!isTauri()) return
    let cancelled = false
    Promise.all([detectCli("cc-switch", true), ccLoadProviders()]).then(([d, list]) => {
      if (cancelled) return
      setDetected(d.installed)
      setProviders(list)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const runThen = async (steps: Parameters<typeof run>[0]) => {
    await run(steps)
    await reload()
  }

  const installCcSwitch = () => {
    const tool = CLI_TOOLS.find((x) => x.id === "cc-switch")!
    const cmd = tool.install[effectiveOS()]
    if (!cmd) return
    void runThen([cliInstallStep("cc-switch", cmd, false, t)])
  }

  const applyVisible = () => {
    if (!paths) return
    void run([visibleAppsStep(paths.ccSwitchSettings, visible, t)])
  }

  const openAdd = (initial: Partial<ProviderFormData> = {}) => {
    setEditingId(undefined)
    setFormInitial(initial)
    setFormOpen(true)
  }

  const openEdit = (p: Provider) => {
    setEditingId(p.id)
    setFormInitial({
      name: p.name,
      app: p.app_type,
      websiteUrl: p.website_url ?? undefined,
      notes: p.notes ?? undefined,
    })
    setFormOpen(true)
  }

  const submitForm = (form: ProviderFormData) => {
    void runThen([
      providerStep(editingId ? "update" : "add", form.app, form.name, form, editingId, t),
    ])
  }

  const tool = CLI_TOOLS.find((x) => x.id === "cc-switch")!
  const canInstall = !!tool.install[effectiveOS()]

  return (
    <SectionShell title={c.menuTitle}>
      {/* Install / check */}
      <Card className="flex-row items-center gap-3 p-4">
        <div className="flex-1">
          <div className="font-medium">{c.install}</div>
          {detected !== null ? (
            <Badge
              variant={detected ? "secondary" : "outline"}
              className="mt-1 font-normal text-muted-foreground"
            >
              {detected ? c.detected : c.notDetected}
            </Badge>
          ) : null}
        </div>
        {!detected && canInstall ? (
          <Button variant="outline" onClick={installCcSwitch}>
            {c.install}
          </Button>
        ) : null}
        {!canInstall ? (
          <span className="text-xs text-muted-foreground">{tool.manualNote}</span>
        ) : null}
      </Card>

      {/* Visible apps */}
      <Card className="gap-3 p-4">
        <div className="font-medium">{c.visibleTitle}</div>
        <div className="grid grid-cols-2 gap-3">
          {VISIBLE_APP_KEYS.map((key) => (
            <div key={key} className="flex items-center justify-between gap-2">
              <Label htmlFor={`va-${key}`} className="cursor-pointer text-sm font-normal">
                {c.appLabels[key]}
              </Label>
              <Switch
                id={`va-${key}`}
                checked={visible[key]}
                onCheckedChange={(v) => setVisible((prev) => ({ ...prev, [key]: v }))}
              />
            </div>
          ))}
        </div>
        <div>
          <Button variant="outline" size="sm" onClick={applyVisible}>
            {t.shell.apply}
          </Button>
        </div>
      </Card>

      {/* Providers */}
      <Card className="gap-3 p-4">
        <div className="flex items-center justify-between">
          <div className="font-medium">{c.providersTitle}</div>
          <div className="flex flex-wrap gap-2">
            {RECOMMENDED_PROVIDERS.map((preset) => (
              <Button
                key={preset.key}
                variant="ghost"
                size="sm"
                className="gap-1"
                onClick={() => openAdd(preset.form)}
              >
                <Star className="size-3.5" />
                {preset.label}
              </Button>
            ))}
            <Button size="sm" className="gap-1" onClick={() => openAdd()}>
              <Plus className="size-4" />
              {c.addProvider}
            </Button>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">{c.setCurrentNote}</p>

        {providers && providers.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{c.fieldName.replace(":", "")}</TableHead>
                <TableHead>{c.fieldApp}</TableHead>
                <TableHead className="text-right">{c.rowActionEdit}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {providers.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">
                    {p.name}
                    {p.is_current ? (
                      <Badge variant="secondary" className="ml-2 font-normal">
                        {c.current}
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="capitalize text-muted-foreground">{p.app_type}</TableCell>
                  <TableCell className="space-x-1 text-right">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(p)}>
                      {c.rowActionEdit}
                    </Button>
                    {!p.is_current ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          void runThen([
                            providerStep("setCurrent", p.app_type, p.name, undefined, p.id, t),
                          ])
                        }
                      >
                        {c.rowActionSetCurrent}
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-500"
                      disabled={p.is_current}
                      onClick={() =>
                        void runThen([
                          providerStep("delete", p.app_type, p.name, undefined, p.id, t),
                        ])
                      }
                    >
                      {c.rowActionDelete}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">
            {providers ? c.empty : isTauri() ? c.noDb : t.shell.notInTauri}
          </p>
        )}
      </Card>

      <ProviderForm
        open={formOpen}
        onOpenChange={setFormOpen}
        initial={formInitial}
        editing={!!editingId}
        onSubmit={submitForm}
      />
    </SectionShell>
  )
}
