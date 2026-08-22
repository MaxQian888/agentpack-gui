"use client"

import { useMemo, useState } from "react"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { isTauri } from "@/lib/tauri"
import { useT } from "@/lib/i18n/provider"
import { groupSkills } from "@/lib/skills/browse"
import { isManaged } from "@/lib/skills/updates"
import type { SkillsScanResult } from "@/lib/skills/types"
import { HelpTip } from "../../help-tip"
import { InstalledSkillsTab } from "./installed"
import { CatalogTab } from "./catalog"
import { AddSkillsTab } from "./add"
import { DesktopOnlyNote } from "../../desktop-only-note"
import { CapabilityWorkbench } from "../capability-workbench"
import { SectionNav } from "../section-nav"
import { SectionView } from "../section-view"
import { SectionStatus } from "../section-status"

/**
 * Skills manager: browse everything installed across the four global skills
 * roots, view/configure each skill, install the bundled catalog, and add new
 * skills (GitHub / local folder / skills CLI). Prop-driven like History:
 * `ShellBody` owns the lazy, cached scan.
 */
export interface SkillsSectionProps {
  scan: SkillsScanResult | null
  loading: boolean
  refresh: () => void
}

export function SkillsSection({ scan, loading, refresh }: SkillsSectionProps) {
  const t = useT()
  const sb = t.skillsBrowser
  const tauri = isTauri()
  /* One view at a time in the primary column, chosen from the aside — not the
     installed list plus whatever else you opened underneath it. */
  const [view, setView] = useState<"installed" | "catalog" | "add">("installed")
  const [updateCount, setUpdateCount] = useState(0)

  const stats = useMemo(() => {
    if (!scan) return null
    const rows = groupSkills(scan.skills)
    return { total: rows.length, managed: rows.filter(isManaged).length }
  }, [scan])

  const notTauri = <DesktopOnlyNote>{sb.notTauri}</DesktopOnlyNote>
  const spinner = (
    <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
      <Spinner className="size-4" />
      {sb.loading}
    </div>
  )

  const primary = !tauri ? (
    notTauri
  ) : scan === null ? (
    spinner
  ) : (
    <SectionView
      label={view === "installed" ? sb.installedPanel : sb.detailPanel}
      title={
        view === "installed" ? sb.tabInstalled : view === "catalog" ? sb.tabCatalog : sb.tabAdd
      }
      choice={view}
    >
      {view === "installed" ? (
        <InstalledSkillsTab
          scan={scan}
          refresh={refresh}
          onUpdateCountChange={setUpdateCount}
          onBrowseCatalog={() => setView("catalog")}
        />
      ) : view === "catalog" ? (
        <CatalogTab scan={scan} refresh={refresh} />
      ) : (
        <AddSkillsTab installed={scan} refresh={refresh} />
      )}
    </SectionView>
  )

  return (
    <CapabilityWorkbench
      title={sb.title}
      subtitle={sb.subtitle}
      help={<HelpTip text={t.help.skills} />}
      actions={
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 gap-2"
          onClick={refresh}
          disabled={loading || !tauri}
        >
          <RefreshCw className={cn("size-4", loading && "animate-spin")} />
          {sb.refresh}
        </Button>
      }
      actionsLabel={sb.actionsLabel}
      lead={
        /* Three facts, not six with a seventh line of per-root counts under
           them. "Sources 2" and its breakdown said nothing the scope chips
           below don't say while also filtering; "Bundled" is a tag on the rows
           that have it. Scan issues appear only when there are some — a fact
           worth a headline exactly when it isn't zero. */
        stats ? (
          <SectionStatus
            label={sb.summaryLabel}
            facts={[
              { label: sb.statTotal, value: stats.total },
              { label: sb.statManaged, value: stats.managed },
              { label: sb.statUpdates, value: updateCount },
              ...(scan && scan.errors.length > 0
                ? [{ label: sb.statScanIssues, value: scan.errors.length }]
                : []),
            ]}
          />
        ) : undefined
      }
      primary={primary}
      aside={
        tauri ? (
          <SectionNav
            className="min-[768px]:max-[1099px]:col-span-2"
            choices={[
              {
                id: "skills-installed",
                title: sb.tabInstalled,
                description: sb.installedActionHint,
                active: view === "installed",
                onSelect: () => setView("installed"),
              },
              {
                id: "skills-catalog",
                title: sb.tabCatalog,
                description: sb.catalogActionHint,
                active: view === "catalog",
                onSelect: () => setView("catalog"),
              },
              {
                id: "skills-add",
                title: sb.tabAdd,
                description: sb.addActionHint,
                active: view === "add",
                onSelect: () => setView("add"),
              },
            ]}
          />
        ) : null
      }
    />
  )
}
