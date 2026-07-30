"use client"

import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { CONFIG_FILES } from "@/lib/agentpack/config-editor/files"
import { useT } from "@/lib/i18n/provider"
import { isTauri } from "@/lib/tauri"
import { pathExists } from "@/lib/tauri/commands"
import { useAppStore } from "@/store/app-store"
import { ConfigFileEditor } from "./config-file-editor"

/**
 * The agent CLIs' own config files, with an editor per file. Presence is probed
 * rather than assumed: a file that doesn't exist yet is still worth offering to
 * create, and the badge is what tells the user which of the two they're doing.
 */
export function ConfigFilesCard({ onOpenMcp }: { onOpenMcp?: () => void }) {
  const t = useT().configFiles
  const paths = useAppStore((s) => s.paths)
  const [present, setPresent] = useState<Record<string, boolean>>({})
  // Bumped after a save so the presence badges pick up a file that was created.
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!paths || !isTauri()) return
    let cancelled = false
    void (async () => {
      const found = await Promise.all(
        CONFIG_FILES.map((f) => pathExists(paths[f.pathKey]).catch(() => false))
      )
      if (cancelled) return
      setPresent(Object.fromEntries(CONFIG_FILES.map((f, i) => [f.id, found[i]])))
    })()
    return () => {
      cancelled = true
    }
  }, [paths, tick])

  if (!paths) return null

  return (
    <Card className="gap-4 p-5">
      <div>
        <div className="text-sm font-medium">{t.title}</div>
        <p className="text-xs text-muted-foreground">{t.subtitle}</p>
      </div>
      <div className="flex flex-col gap-2">
        {CONFIG_FILES.map((def) => {
          const path = paths[def.pathKey]
          const exists = present[def.id] ?? false
          return (
            <div
              key={def.id}
              className="flex items-center justify-between gap-3 rounded-md border p-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {t.files[def.id].title}
                  <Badge variant={exists ? "secondary" : "outline"} className="font-normal">
                    {exists ? t.present : t.missing}
                  </Badge>
                </div>
                <p className="truncate font-mono text-xs text-muted-foreground">{path}</p>
              </div>
              <ConfigFileEditor
                def={def}
                path={path}
                exists={exists}
                onSaved={() => setTick((n) => n + 1)}
                onOpenMcp={onOpenMcp}
              />
            </div>
          )
        })}
      </div>
    </Card>
  )
}
