"use client"

import { useMemo, useState } from "react"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { isTauri } from "@/lib/tauri"
import { useMounted } from "@/hooks/use-mounted"
import { useT } from "@/lib/i18n/provider"
import { groupSkills } from "@/lib/skills/browse"
import { isManaged, rowUpdateTargets } from "@/lib/skills/updates"
import type { SkillsScanResult } from "@/lib/skills/types"
import { HelpTip } from "../../help-tip"
import { InstalledSkillsTab, type SkillUpdates } from "./installed"
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
  /**
   * Why the last scan produced nothing at all, when it threw. Without it a
   * failed `skills_scan` reads as "no skills anywhere" — a claim about the disk
   * the app never checked.
   */
  error?: string | null
  /** Arrive with the backups dialog open (Recovery's hand-off for a skill backup). */
  landing?: "backups" | null
}

export function SkillsSection({
  scan,
  loading,
  refresh,
  error,
  landing = null,
}: SkillsSectionProps) {
  const t = useT()
  const sb = t.skillsBrowser
  // Gated on mount: isTauri() is false in the pre-rendered HTML, so reading it
  // on the first render hydration-mismatches in the desktop build. Until then
  // the spinner stands in — not the desktop-only note, which would flash there.
  const mounted = useMounted()
  const tauri = mounted && isTauri()
  /* One view at a time in the primary column, chosen from the aside — not the
     installed list plus whatever else you opened underneath it. */
  const [view, setView] = useState<"installed" | "catalog" | "add">("installed")
  // Consumed once: the installed tab remounts whenever it is chosen again, and
  // a hand-off from Recovery should not reopen the backups every time.
  const [landingBackups, setLandingBackups] = useState(landing === "backups")
  const show = (next: "installed" | "catalog" | "add") => {
    setLandingBackups(false)
    setView(next)
  }
  // Lives here, not in the installed tab: that tab unmounts whenever another
  // view is chosen, and the answer it held was a network check per skill.
  const [updates, setUpdates] = useState<SkillUpdates>(null)

  const stats = useMemo(() => {
    if (!scan) return null
    const rows = groupSkills(scan.skills)
    const pending = updates
      ? rows.filter((r) => rowUpdateTargets(r, updates).length > 0).length
      : null
    return { total: rows.length, managed: rows.filter(isManaged).length, updates: pending }
  }, [scan, updates])

  const notTauri = <DesktopOnlyNote>{sb.notTauri}</DesktopOnlyNote>
  const spinner = (
    <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
      <Spinner className="size-4" />
      {sb.loading}
    </div>
  )

  const failed = (
    <div className="flex flex-col items-start gap-3 p-6 text-sm">
      <p className="text-destructive">{sb.scanFailed(error ?? "")}</p>
      <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
        {sb.retry}
      </Button>
    </div>
  )

  const primary = !mounted ? (
    spinner
  ) : !tauri ? (
    notTauri
  ) : error && !loading ? (
    failed
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
          updates={updates}
          onUpdatesChange={setUpdates}
          onBrowseCatalog={() => show("catalog")}
          openBackups={landingBackups}
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
              /* Nothing managed means nothing can be out of date — a measured
                 zero. Otherwise it is unknown until someone checks, and a zero
                 there would claim everything is current. */
              {
                label: sb.statUpdates,
                value: stats.managed === 0 ? 0 : (stats.updates ?? "—"),
              },
              ...(scan && scan.errors.length > 0
                ? [{ label: sb.statScanIssues, value: scan.errors.length }]
                : []),
            ]}
            notes={[stats.managed > 0 && stats.updates === null ? sb.statUpdatesPending : null]}
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
                onSelect: () => show("installed"),
              },
              {
                id: "skills-catalog",
                title: sb.tabCatalog,
                description: sb.catalogActionHint,
                active: view === "catalog",
                onSelect: () => show("catalog"),
              },
              {
                id: "skills-add",
                title: sb.tabAdd,
                description: sb.addActionHint,
                active: view === "add",
                onSelect: () => show("add"),
              },
            ]}
          />
        ) : null
      }
    />
  )
}
