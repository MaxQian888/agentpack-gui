"use client"

import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { isTauri } from "@/lib/tauri"
import { useT } from "@/lib/i18n/provider"
import type { SkillsScanResult } from "@/lib/skills/types"
import { HelpTip } from "../../help-tip"
import { InstalledSkillsTab } from "./installed"
import { CatalogTab } from "./catalog"
import { AddSkillsTab } from "./add"

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

  const notTauri = <p className="text-sm text-muted-foreground">{sb.notTauri}</p>
  const spinner = (
    <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
      <Spinner className="size-4" />
      {sb.loading}
    </div>
  )

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div data-tour="section-heading">
          <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            {sb.title}
            <HelpTip text={t.help.skills} />
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{sb.subtitle}</p>
        </div>
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
      </div>

      <Tabs defaultValue="installed">
        <TabsList>
          <TabsTrigger value="installed">{sb.tabInstalled}</TabsTrigger>
          <TabsTrigger value="catalog">{sb.tabCatalog}</TabsTrigger>
          <TabsTrigger value="add">{sb.tabAdd}</TabsTrigger>
        </TabsList>
        <TabsContent value="installed" className="mt-4">
          {!tauri ? (
            notTauri
          ) : scan === null ? (
            spinner
          ) : (
            <>
              {scan.errors.map((e) => (
                <p key={e.source} className="mb-2 text-xs text-destructive">
                  {sb.scanError(sb.sources[e.source] ?? e.source, e.message)}
                </p>
              ))}
              <InstalledSkillsTab scan={scan} refresh={refresh} />
            </>
          )}
        </TabsContent>
        <TabsContent value="catalog" className="mt-4">
          <CatalogTab />
        </TabsContent>
        <TabsContent value="add" className="mt-4">
          {tauri ? <AddSkillsTab refresh={refresh} /> : notTauri}
        </TabsContent>
      </Tabs>
    </div>
  )
}
