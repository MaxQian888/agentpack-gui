"use client"

import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { isTauri } from "@/lib/tauri"
import { useT } from "@/lib/i18n/provider"
import type { ListResult } from "@/lib/history/types"
import { SessionBrowser } from "./session-browser"
import { UsageDashboard } from "./usage-dashboard"

/**
 * Chat-history browser + usage dashboard. Prop-driven like `DashboardSection`:
 * `ShellBody` owns the (lazy, cached) scan so leaving and returning to History
 * doesn't re-read every JSONL and the OpenCode DB.
 */
export interface HistorySectionProps {
  result: ListResult | null
  loading: boolean
  refresh: () => void
}

export function HistorySection({ result, loading, refresh }: HistorySectionProps) {
  const h = useT().history
  const tauri = isTauri()

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{h.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{h.subtitle}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 gap-2"
          onClick={refresh}
          disabled={loading || !tauri}
        >
          <RefreshCw className={cn("size-4", loading && "animate-spin")} />
          {h.refresh}
        </Button>
      </div>

      {!tauri ? (
        <p className="text-sm text-muted-foreground">{h.notTauri}</p>
      ) : result === null ? (
        <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
          <Spinner className="size-4" />
          {h.loading}
        </div>
      ) : (
        <>
          {result.errors.map((e) => (
            <p key={e.source} className="text-xs text-destructive">
              {h.scanError(h.sources[e.source] ?? e.source, e.message)}
            </p>
          ))}
          <Tabs defaultValue="sessions">
            <TabsList>
              <TabsTrigger value="sessions">{h.tabSessions}</TabsTrigger>
              <TabsTrigger value="usage">{h.tabUsage}</TabsTrigger>
            </TabsList>
            <TabsContent value="sessions" className="mt-4">
              <SessionBrowser sessions={result.sessions} />
            </TabsContent>
            <TabsContent value="usage" className="mt-4">
              <UsageDashboard sessions={result.sessions} />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  )
}
