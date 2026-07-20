"use client"

import { useCallback, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useT } from "@/lib/i18n/provider"
import {
  findConflicts,
  pruneSkipped,
  type InstallRequest,
  type SkillConflict,
} from "@/lib/skills/conflicts"
import type { InstalledSkill, SkillSource } from "@/lib/skills/types"

const ckey = (source: SkillSource, dirName: string) => `${source} ${dirName}`

interface Pending {
  conflicts: SkillConflict[]
  requests: InstallRequest[]
  resolve: (result: InstallRequest[] | null) => void
}

/**
 * Guards every skill-install entry point (bundled catalog, GitHub/local/create,
 * batch/single copy) against silently overwriting an existing skill. `guard`
 * returns the installs that should proceed: the input unchanged when nothing
 * conflicts, the user-resolved subset after the dialog, `[]` when everything was
 * skipped, or `null` when cancelled. Render `dialog` once in the component.
 */
export function useInstallGuard() {
  const [pending, setPending] = useState<Pending | null>(null)

  const guard = useCallback(
    (requests: InstallRequest[], skills: InstalledSkill[]): Promise<InstallRequest[] | null> => {
      const cleaned = requests.filter((r) => r.targets.length > 0)
      if (cleaned.length === 0) return Promise.resolve([])
      const conflicts = findConflicts(cleaned, skills)
      if (conflicts.length === 0) return Promise.resolve(cleaned)
      return new Promise((resolve) => setPending({ conflicts, requests: cleaned, resolve }))
    },
    []
  )

  const done = useCallback(
    (result: InstallRequest[] | null) => {
      pending?.resolve(result)
      setPending(null)
    },
    [pending]
  )

  const dialog = <ConflictDialog pending={pending} onDone={done} />
  return { guard, dialog }
}

function ConflictDialog({
  pending,
  onDone,
}: {
  pending: Pending | null
  onDone: (result: InstallRequest[] | null) => void
}) {
  const sb = useT().skillsBrowser
  const c = sb.conflict
  // Skipped (source, dirName) keys. Default empty = overwrite everything.
  const [skip, setSkip] = useState<Set<string>>(new Set())

  // Fresh dialog each time a new set of conflicts opens — reset during render
  // (React's "reset on prop change" pattern) rather than in an effect.
  const [shownPending, setShownPending] = useState(pending)
  if (pending !== shownPending) {
    setShownPending(pending)
    setSkip(new Set())
  }

  const byDir = useMemo(() => {
    const m = new Map<string, SkillSource[]>()
    for (const cf of pending?.conflicts ?? []) {
      const arr = m.get(cf.dirName) ?? []
      arr.push(cf.source)
      m.set(cf.dirName, arr)
    }
    return [...m.entries()]
  }, [pending])

  const allKeys = useMemo(
    () => (pending?.conflicts ?? []).map((cf) => ckey(cf.source, cf.dirName)),
    [pending]
  )

  const toggle = (source: SkillSource, dirName: string) =>
    setSkip((prev) => {
      const next = new Set(prev)
      const k = ckey(source, dirName)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })

  const confirm = () => {
    if (!pending) return
    const skipped = pending.conflicts.filter((cf) => skip.has(ckey(cf.source, cf.dirName)))
    onDone(pruneSkipped(pending.requests, skipped))
  }

  return (
    <Dialog open={!!pending} onOpenChange={(open) => !open && onDone(null)}>
      <DialogContent className="flex max-h-[80vh] max-w-lg flex-col gap-4">
        <DialogHeader>
          <DialogTitle>{c.title}</DialogTitle>
          <DialogDescription>{c.body}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setSkip(new Set())}>
            {c.overwriteAll}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setSkip(new Set(allKeys))}>
            {c.keepAll}
          </Button>
        </div>

        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
          {byDir.map(([dirName, sources]) => (
            <div key={dirName} className="rounded-md border p-3">
              <div className="mb-2 truncate text-sm font-medium">{dirName}</div>
              <div className="flex flex-col gap-1.5">
                {sources.map((source) => {
                  const overwrite = !skip.has(ckey(source, dirName))
                  return (
                    <label
                      key={source}
                      className="flex cursor-pointer items-center justify-between gap-3 text-sm"
                    >
                      <span className="min-w-0 truncate text-muted-foreground">
                        {sb.sources[source] ?? source}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className={overwrite ? "text-foreground" : "text-muted-foreground"}>
                          {overwrite ? c.overwrite : c.skip}
                        </span>
                        <Checkbox
                          checked={overwrite}
                          onCheckedChange={() => toggle(source, dirName)}
                        />
                      </span>
                    </label>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        {skip.size >= allKeys.length && byDir.length > 0 ? (
          <p className="text-xs text-muted-foreground">{c.allSkipped}</p>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onDone(null)}>
            {c.cancel}
          </Button>
          <Button onClick={confirm} disabled={skip.size >= allKeys.length && byDir.length > 0}>
            {c.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
