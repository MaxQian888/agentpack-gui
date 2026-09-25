"use client"

import { useState } from "react"
import { FolderOpen } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useT } from "@/lib/i18n/provider"
import { scopeChipClass } from "../filter-bar"
import type { PiManagementController } from "../../pi-controller"

/**
 * Which Pi settings file the whole page is about.
 *
 * It sits above the status band rather than inside the packages panel because
 * it changes what the band reports: the package count, the resource count and
 * the trust state are all properties of the chosen scope, and a control that
 * rewrites the summary cannot read as one of the summary's own refinements. It
 * used to be a `Card` titled "Scope" whose description quietly carried the
 * trust state, so the one fact that decides whether a write will be accepted
 * was set as a caption on a control panel.
 */
export function PiScopeBar({ controller }: { controller: PiManagementController }) {
  const m = useT().pi
  const { scopeKind, setScopeKind, cwd, setCwd, projects, chooseProject, projectMissing } =
    controller
  /**
   * What is being typed, apart from the folder the page is about. The field
   * used to write straight into the scope, so every keystroke of a path was a
   * scan of a folder that did not exist yet — and an error toast for each one.
   * It now applies on blur, on Enter, or when a remembered folder is picked.
   */
  const [draft, setDraft] = useState(cwd)
  // Follow the scope when it changes from outside the field (Choose folder…).
  const [shown, setShown] = useState(cwd)
  if (cwd !== shown) {
    setShown(cwd)
    setDraft(cwd)
  }
  const commit = (value: string) => {
    const next = value.trim()
    if (next !== cwd.trim()) setCwd(next)
  }
  return (
    // One named group for the whole control, chips and folder picker together.
    // Naming only the chips left the folder field and its button outside any
    // group, which is also how two "Choose folder" buttons could end up on one
    // screen with nothing distinguishing them.
    <div
      role="group"
      aria-label={m.scopeLabel}
      className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2"
    >
      <span className="shrink-0 text-sm text-muted-foreground">{m.scopeLabel}</span>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          aria-pressed={scopeKind === "global"}
          onClick={() => setScopeKind("global")}
          className={scopeChipClass(scopeKind === "global")}
        >
          {m.globalScope}
        </button>
        <button
          type="button"
          aria-pressed={scopeKind === "project"}
          onClick={() => setScopeKind("project")}
          className={scopeChipClass(scopeKind === "project")}
        >
          {m.projectScope}
        </button>
      </div>
      {scopeKind === "project" ? (
        <>
          <Input
            aria-label={m.projectFolder}
            aria-invalid={projectMissing}
            aria-describedby={projectMissing ? "pi-project-missing" : undefined}
            list="pi-project-folders"
            value={draft}
            onChange={(event) => {
              const value = event.target.value
              setDraft(value)
              // A datalist pick arrives as one replacement rather than typed
              // characters; it names a folder that was read before, so it
              // applies at once.
              const inputType = (event.nativeEvent as InputEvent).inputType ?? ""
              const typed = /^(insertText|delete)/.test(inputType)
              if (!typed && projects.includes(value.trim())) commit(value)
            }}
            onBlur={() => commit(draft)}
            onKeyDown={(event) => {
              if (event.key === "Enter") commit(draft)
            }}
            className="h-8 min-w-0 flex-1 basis-56 font-mono text-xs"
            placeholder={m.projectFolder}
          />
          <datalist id="pi-project-folders">
            {projects.map((project) => (
              <option key={project} value={project} />
            ))}
          </datalist>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 gap-2"
            onClick={() => void chooseProject()}
          >
            <FolderOpen className="size-4" />
            {m.chooseFolder}
          </Button>
          {projectMissing ? (
            <p
              id="pi-project-missing"
              role="status"
              className="min-w-0 basis-full text-xs text-[var(--hm-danger)] [overflow-wrap:anywhere]"
            >
              {m.projectFolderMissing(cwd)}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
