"use client"

import { Download, Upload } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { isTauri } from "@/lib/tauri"
import { readTextFile, writeTextFile } from "@/lib/tauri/commands"
import { parseConfig, serializePlan } from "@/lib/agentpack/config"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { SectionShell } from "./sections/section-shell"

export function ConfigIO() {
  const t = useT()
  const plan = useAppStore((s) => s.plan)
  const loadPlan = useAppStore((s) => s.loadPlan)

  const save = async () => {
    if (!isTauri()) return toast.error(t.shell.notInTauri)
    const { save: saveDialog } = await import("@tauri-apps/plugin-dialog")
    const path = await saveDialog({ defaultPath: "agentpack.config.json" })
    if (!path) return
    await writeTextFile(path, serializePlan(plan))
    toast.success(t.shell.configSaved(path))
  }

  const load = async () => {
    if (!isTauri()) return toast.error(t.shell.notInTauri)
    const { open } = await import("@tauri-apps/plugin-dialog")
    const path = await open({ filters: [{ name: "json", extensions: ["json"] }] })
    if (!path || typeof path !== "string") return
    try {
      loadPlan(parseConfig(await readTextFile(path), t))
      toast.success(t.shell.configLoaded)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.errors.invalidJson)
    }
  }

  return (
    <SectionShell title={t.menu.saveConfig}>
      <Card className="flex-row flex-wrap gap-3 p-5">
        <Button onClick={save} className="gap-2">
          <Download className="size-4" />
          {t.shell.saveConfigBtn}
        </Button>
        <Button variant="outline" onClick={load} className="gap-2">
          <Upload className="size-4" />
          {t.shell.loadConfig}
        </Button>
      </Card>
    </SectionShell>
  )
}
