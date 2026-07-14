"use client"

import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { isTauri } from "@/lib/tauri"
import { useT } from "@/lib/i18n/provider"
import { MCP_SERVERS } from "@/lib/agentpack/registry"
import { HelpTip } from "../../help-tip"
import type { DashboardScan } from "../dashboard"
import { anyPresent, presenceOf, StatTile } from "./helpers"
import { CatalogTab } from "./catalog"
import { InstalledTab } from "./installed"
import { AddCustomTab } from "./add-custom"

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

  const total = MCP_SERVERS.length
  const installed = MCP_SERVERS.filter((s) => anyPresent(presenceOf(scan, s.id))).length
  const needsKey = MCP_SERVERS.filter((s) => s.keyEnv).length

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div data-tour="section-heading">
          <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            {m.title}
            <HelpTip text={t.help.mcp} />
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{m.subtitle}</p>
        </div>
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
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatTile label={m.statTotal} value={total} />
        <StatTile label={m.statInstalled} value={installed} />
        <StatTile label={m.statNeedsKey} value={needsKey} />
      </div>

      {!tauri ? (
        <p className="text-sm text-muted-foreground">{m.notTauri}</p>
      ) : (
        <Tabs defaultValue="catalog">
          <TabsList>
            <TabsTrigger value="catalog">{m.tabCatalog}</TabsTrigger>
            <TabsTrigger value="installed">{m.tabInstalled}</TabsTrigger>
            <TabsTrigger value="add">{m.tabAdd}</TabsTrigger>
          </TabsList>
          <TabsContent value="catalog" className="mt-4">
            {scan === null && loading ? (
              <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
                <Spinner className="size-4" />
                {m.loading}
              </div>
            ) : (
              <CatalogTab scan={scan} refresh={refresh} />
            )}
          </TabsContent>
          <TabsContent value="installed" className="mt-4">
            {scan === null && loading ? (
              <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
                <Spinner className="size-4" />
                {m.loading}
              </div>
            ) : (
              <InstalledTab scan={scan} refresh={refresh} />
            )}
          </TabsContent>
          <TabsContent value="add" className="mt-4">
            <AddCustomTab scan={scan} refresh={refresh} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}
