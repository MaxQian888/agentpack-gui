"use client"

import { useMemo, useState } from "react"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { isTauri } from "@/lib/tauri"
import { useT } from "@/lib/i18n/provider"
import { SKILL_REGISTRY_IDS } from "@/lib/agentpack/scan"
import { countsBySource, groupSkills } from "@/lib/skills/browse"
import { isManaged } from "@/lib/skills/updates"
import type { SkillsScanResult } from "@/lib/skills/types"
import { HelpTip } from "../../help-tip"
import { InstalledSkillsTab } from "./installed"
import { CatalogTab } from "./catalog"
import { AddSkillsTab } from "./add"
import { DesktopOnlyNote } from "../../desktop-only-note"
import { CapabilityMetric, CapabilityTile, CapabilityWorkbench } from "../capability-workbench"

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
  const [detail, setDetail] = useState<"catalog" | "add" | null>(null)
  const [updateCount, setUpdateCount] = useState(0)

  const stats = useMemo(() => {
    if (!scan) return null
    const rows = groupSkills(scan.skills)
    const counts = countsBySource(scan.skills)
    return {
      total: rows.length,
      counts,
      bundled: rows.filter((r) => SKILL_REGISTRY_IDS.includes(r.dirName)).length,
      managed: rows.filter(isManaged).length,
    }
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
    <section aria-label={sb.installedPanel} className="min-w-0">
      <h3 className="mb-3 font-medium">{sb.tabInstalled}</h3>
      <InstalledSkillsTab scan={scan} refresh={refresh} onUpdateCountChange={setUpdateCount} />
    </section>
  )

  const detailPanel =
    tauri && detail ? (
      <section aria-label={sb.detailPanel} className="min-w-0 border-t pt-5">
        <h3 className="mb-4 text-lg font-medium">
          {detail === "catalog" ? sb.tabCatalog : sb.tabAdd}
        </h3>
        {detail === "catalog" ? (
          <CatalogTab scan={scan} refresh={refresh} />
        ) : (
          <AddSkillsTab installed={scan} refresh={refresh} />
        )}
      </section>
    ) : null

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
      summaryLabel={sb.summaryLabel}
      actionsLabel={sb.actionsLabel}
      metrics={
        stats ? (
          <>
            <CapabilityMetric label={sb.statTotal} value={stats.total} />
            <CapabilityMetric
              label={sb.statSources}
              value={Object.values(stats.counts).filter((count) => count > 0).length}
              detail={Object.entries(stats.counts)
                .map(([source, count]) => `${sb.sources[source]} ${count}`)
                .join(" · ")}
            />
            <CapabilityMetric label={sb.statManaged} value={stats.managed} />
            <CapabilityMetric label={sb.statUpdates} value={updateCount} />
            <CapabilityMetric label={sb.statScanIssues} value={scan?.errors.length ?? 0} />
            <CapabilityMetric label={sb.statBundled} value={stats.bundled} />
          </>
        ) : null
      }
      primary={primary}
      aside={
        tauri ? (
          <>
            <CapabilityTile
              title={sb.tabCatalog}
              description={sb.catalogActionHint}
              active={detail === "catalog"}
              action={
                <Button variant="outline" size="sm" onClick={() => setDetail("catalog")}>
                  {sb.tabCatalog}
                </Button>
              }
            />
            <CapabilityTile
              title={sb.tabAdd}
              description={sb.addActionHint}
              active={detail === "add"}
              action={
                <Button variant="outline" size="sm" onClick={() => setDetail("add")}>
                  {sb.tabAdd}
                </Button>
              }
            />
          </>
        ) : null
      }
      detail={detailPanel}
    />
  )
}
