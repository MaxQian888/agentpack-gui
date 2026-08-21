"use client"

import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { CONFIG_FILES } from "@/lib/agentpack/config-editor/files"
import { useT } from "@/lib/i18n/provider"
import { isTauri } from "@/lib/tauri"
import { pathExists } from "@/lib/tauri/commands"
import { useAppStore } from "@/store/app-store"
import { ConfigFileEditor } from "./config-file-editor"
import { DesktopOnlyNote } from "../desktop-only-note"

/**
 * The agent CLIs' own config files, with an editor per file. Presence is probed
 * rather than assumed: a file that doesn't exist yet is still worth offering to
 * create, and the badge is what tells the user which of the two they're doing.
 *
 * One panel of ruled rows, not a card of eight bordered boxes. Each row was its
 * own `rounded-md border` inside a card inside the section — three nested frames
 * around a filename and a button, which is the box-in-a-box design.md § 5 rules
 * out. The rules carry the separation now, and the path stays in mono because
 * it is a value read off the machine.
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

  return (
    <section aria-label={t.title} className="min-w-0 rounded-lg border">
      <div className="bg-muted/30 px-4 py-3">
        <h3 className="font-mono text-[var(--hm-text-2xs)] tracking-[var(--hm-tracking-mono)] text-muted-foreground uppercase">
          {t.title}
        </h3>
        <p className="mt-1 max-w-prose text-xs text-muted-foreground">{t.subtitle}</p>
      </div>
      {/* Without paths there are no files to point at. Returning null here made
          the whole editor — eight files and their presence badges — disappear
          without a word, which reads as a missing feature rather than a limit. */}
      {!paths ? (
        <div className="p-4">
          <DesktopOnlyNote>{t.notTauri}</DesktopOnlyNote>
        </div>
      ) : null}
      <div className="divide-y">
        {(paths ? CONFIG_FILES : []).map((def) => {
          const path = paths![def.pathKey]
          const exists = present[def.id] ?? false
          return (
            <div
              key={def.id}
              className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3"
            >
              <div className="min-w-0 flex-1 basis-64">
                <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-medium">
                  {t.files[def.id].title}
                  <Badge variant={exists ? "secondary" : "outline"} className="font-normal">
                    {exists ? t.present : t.missing}
                  </Badge>
                </div>
                <p className="mt-0.5 truncate font-mono text-[var(--hm-text-2xs)] text-muted-foreground">
                  {path}
                </p>
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
    </section>
  )
}
