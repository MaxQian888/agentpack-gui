"use client"

import { FolderOpen } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useT } from "@/lib/i18n/provider"
import type { PiManagementController } from "../../pi-controller"
import { CapabilityEmpty, CapabilityList, CapabilityRow } from "../capability-list"

/**
 * Extra folders the history scan reads for Pi transcripts.
 *
 * This used to sit inside the Packages tab, between the scope control and the
 * package list, where it read as something a package install would touch. It
 * has nothing to do with packages: it is a scan setting, and it is global,
 * which is also why it does not move when the scope chips do.
 */
export function PiSessionsView({ controller }: { controller: PiManagementController }) {
  const m = useT().pi
  const { sessionDirs, addSessionDir, removeSessionDir } = controller
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="text-xs text-muted-foreground">{m.sessionFoldersHint}</p>
      {sessionDirs.length === 0 ? (
        <CapabilityEmpty message={m.noSessionFolders} />
      ) : (
        <CapabilityList label={m.sessionFoldersLabel}>
          {sessionDirs.map((dir) => (
            <CapabilityRow
              key={dir}
              title={<span className="font-mono text-xs">{dir}</span>}
              actions={
                <Button variant="ghost" size="sm" onClick={() => void removeSessionDir(dir)}>
                  {m.remove}
                </Button>
              }
            />
          ))}
        </CapabilityList>
      )}
      <Button
        variant="outline"
        size="sm"
        className="gap-2 self-start"
        onClick={() => void addSessionDir()}
      >
        <FolderOpen className="size-4" />
        {m.addSessionFolder}
      </Button>
    </div>
  )
}
