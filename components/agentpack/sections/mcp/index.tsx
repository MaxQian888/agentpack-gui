"use client"

import { useMemo, useState } from "react"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { isTauri } from "@/lib/tauri"
import { useT } from "@/lib/i18n/provider"
import { MCP_SERVERS } from "@/lib/agentpack/registry"
import { HelpTip } from "../../help-tip"
import type { DashboardScan } from "../dashboard"
import { installedRows } from "./helpers"
import { CatalogTab } from "./catalog"
import { InstalledTab } from "./installed"
import { MatrixTab } from "./matrix"
import { AddCustomTab } from "./add-custom"
import { DesktopOnlyNote } from "../../desktop-only-note"
import { CapabilityWorkbench } from "../capability-workbench"
import { SectionNav } from "../section-nav"
import { SectionView } from "../section-view"
import { SectionStatus } from "../section-status"

/**
 * MCP manager: what's configured on disk across Claude Code / Codex / OpenCode
 * first, then the built-in catalog, the per-agent overview and custom servers.
 * Prop-driven like Skills / History — `ShellBody` owns the shared dashboard scan,
 * so this section and the dashboard never disagree about what's installed.
 *
 * The primary panel is the inventory, not the catalog. It used to be the other
 * way round, which meant opening the section showed fifteen things you could
 * install and hid the ones you already had behind a nav item — the reverse of
 * the order design.md § 1 fixes ("reads the machine's state, proposes changes").
 * It also matches Skills, so the two capability workspaces now read the same way.
 */
export interface McpSectionProps {
  scan: DashboardScan | null
  loading: boolean
  refresh: () => void
}

export function McpSection({ scan, loading, refresh }: McpSectionProps) {
  const t = useT()
  const m = t.mcp
  const tauri = isTauri()
  /* One view at a time in the primary column, chosen from the aside — not the
     inventory plus whatever else you opened underneath it. */
  const [view, setView] = useState<"installed" | "catalog" | "matrix" | "add">("installed")

  const total = MCP_SERVERS.length
  const rows = useMemo(() => installedRows(scan), [scan])
  const installed = scan ? rows.length : null
  const needsKey = MCP_SERVERS.filter((s) => s.keyEnv).length

  const loadingPanel = (
    <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
      <Spinner className="size-4" />
      {m.loading}
    </div>
  )

  const viewTitle =
    view === "installed"
      ? m.tabInstalled
      : view === "catalog"
        ? m.tabCatalog
        : view === "matrix"
          ? m.tabMatrix
          : m.tabAdd

  const primary = !tauri ? (
    <DesktopOnlyNote>{m.notTauri}</DesktopOnlyNote>
  ) : (
    <SectionView
      label={view === "installed" ? m.installedPanel : m.detailPanel}
      title={viewTitle}
      choice={view}
    >
      {scan === null && loading ? (
        loadingPanel
      ) : view === "installed" ? (
        <InstalledTab scan={scan} refresh={refresh} onBrowseCatalog={() => setView("catalog")} />
      ) : view === "catalog" ? (
        <CatalogTab scan={scan} refresh={refresh} />
      ) : view === "matrix" ? (
        <MatrixTab scan={scan} refresh={refresh} />
      ) : (
        <AddCustomTab scan={scan} refresh={refresh} />
      )}
    </SectionView>
  )

  return (
    <CapabilityWorkbench
      title={m.title}
      subtitle={m.subtitle}
      help={<HelpTip text={t.help.mcp} />}
      actions={
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 gap-2"
          onClick={refresh}
          disabled={loading || !tauri}
        >
          <RefreshCw className={cn("size-4", loading && "animate-spin")} />
          {m.refresh}
        </Button>
      }
      actionsLabel={m.actionsLabel}
      lead={
        /* Three facts, not six. The per-agent counts that used to sit here are
           on the inventory's own scope chips, where they also filter — the same
           number stated once, on the control that acts on it. */
        <SectionStatus
          label={m.summaryLabel}
          facts={[
            { label: m.statInstalled, value: installed ?? "—" },
            { label: m.statTotal, value: total },
            { label: m.statNeedsKey, value: needsKey },
          ]}
          notes={[scan ? null : m.statPending]}
        />
      }
      primary={primary}
      aside={
        tauri ? (
          <SectionNav
            className="min-[768px]:max-[1099px]:col-span-2"
            choices={[
              {
                id: "mcp-installed",
                title: m.tabInstalled,
                description: m.installedActionHint,
                active: view === "installed",
                onSelect: () => setView("installed"),
              },
              {
                id: "mcp-catalog",
                title: m.tabCatalog,
                description: m.catalogActionHint,
                active: view === "catalog",
                onSelect: () => setView("catalog"),
              },
              {
                id: "mcp-matrix",
                title: m.tabMatrix,
                description: m.matrixActionHint,
                active: view === "matrix",
                onSelect: () => setView("matrix"),
              },
              {
                id: "mcp-add",
                title: m.tabAdd,
                description: m.addActionHint,
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
