"use client"

import { useState } from "react"
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
import { CapabilityMetric, CapabilityTile, CapabilityWorkbench } from "../capability-workbench"

/**
 * MCP manager: browse the built-in catalog, manage everything configured on disk
 * across Claude Code / Codex / OpenCode, and add custom servers. Prop-driven like
 * Skills / History — `ShellBody` owns the shared dashboard scan, so this section
 * and the dashboard never disagree about what's installed.
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
  const [detail, setDetail] = useState<"installed" | "matrix" | "add" | null>(null)

  const total = MCP_SERVERS.length
  const rows = installedRows(scan)
  const installed = scan ? rows.length : null
  const needsKey = MCP_SERVERS.filter((s) => s.keyEnv).length

  const loadingPanel = (
    <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
      <Spinner className="size-4" />
      {m.loading}
    </div>
  )

  const primary = !tauri ? (
    <DesktopOnlyNote>{m.notTauri}</DesktopOnlyNote>
  ) : (
    <section aria-label={m.catalogPanel} className="min-w-0">
      <h3 className="mb-3 font-medium">{m.tabCatalog}</h3>
      {scan === null && loading ? loadingPanel : <CatalogTab scan={scan} refresh={refresh} />}
    </section>
  )

  const detailPanel =
    tauri && detail ? (
      <section aria-label={m.detailPanel} className="min-w-0 border-t pt-5">
        <h3 className="mb-4 text-lg font-medium">
          {detail === "installed" ? m.tabInstalled : detail === "matrix" ? m.tabMatrix : m.tabAdd}
        </h3>
        {scan === null && loading ? (
          loadingPanel
        ) : detail === "installed" ? (
          <InstalledTab scan={scan} refresh={refresh} />
        ) : detail === "matrix" ? (
          <MatrixTab scan={scan} refresh={refresh} />
        ) : (
          <AddCustomTab scan={scan} refresh={refresh} />
        )}
      </section>
    ) : null

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
      summaryLabel={m.summaryLabel}
      actionsLabel={m.actionsLabel}
      metrics={
        <>
          <CapabilityMetric label={m.statTotal} value={total} />
          <CapabilityMetric label={m.statInstalled} value={installed ?? "—"} />
          <CapabilityMetric label={m.statNeedsKey} value={needsKey} />
          <CapabilityMetric
            label={m.targets.claude}
            value={scan ? rows.filter((row) => row.presence.claude).length : "—"}
          />
          <CapabilityMetric
            label={m.targets.codex}
            value={scan ? rows.filter((row) => row.presence.codex).length : "—"}
          />
          <CapabilityMetric
            label={m.targets.opencode}
            value={scan ? rows.filter((row) => row.presence.opencode).length : "—"}
          />
        </>
      }
      primary={primary}
      aside={
        tauri ? (
          <>
            <CapabilityTile
              title={m.tabInstalled}
              description={m.installedActionHint}
              active={detail === "installed"}
              action={
                <Button variant="outline" size="sm" onClick={() => setDetail("installed")}>
                  {m.tabInstalled}
                </Button>
              }
            />
            <CapabilityTile
              title={m.tabMatrix}
              description={m.matrixActionHint}
              active={detail === "matrix"}
              action={
                <Button variant="outline" size="sm" onClick={() => setDetail("matrix")}>
                  {m.tabMatrix}
                </Button>
              }
            />
            <CapabilityTile
              title={m.tabAdd}
              description={m.addActionHint}
              active={detail === "add"}
              action={
                <Button variant="outline" size="sm" onClick={() => setDetail("add")}>
                  {m.tabAdd}
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
