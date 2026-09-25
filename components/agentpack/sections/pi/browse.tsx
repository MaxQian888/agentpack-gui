"use client"

import { ExternalLink, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { useT } from "@/lib/i18n/provider"
import { isSafePiPackageSource } from "@/lib/pi/management"
import { openUrl } from "@/lib/tauri/system"
import type { PiManagementController } from "../../pi-controller"
import { CapabilityEmpty, CapabilityList, CapabilityRow, RowChip } from "../capability-list"

const GALLERY_URL = "https://pi.dev/packages"

/**
 * Two ways to add a package: name a source, or search npm for one.
 *
 * The source field now judges what it is given before the permission dialog
 * opens. `buildPiPackageSteps` has always refused a URL carrying credentials,
 * but it refused it after the user had approved "run this with my full
 * permissions", which is consent collected for something that was never going
 * to happen.
 */
export function PiBrowseView({ controller }: { controller: PiManagementController }) {
  const m = useT().pi
  const {
    source,
    setSource,
    query,
    setQuery,
    results,
    searching,
    searched,
    installedSources,
    installBlockedReason,
    scopeKind,
    setPending,
    searchPackages,
  } = controller

  const trimmed = source.trim()
  const unsafe = trimmed.length > 0 && !isSafePiPackageSource(trimmed)
  // In Project scope with no folder read yet, an install had nowhere to go:
  // it ran with an empty cwd, i.e. in whatever folder the app started in.
  const blocked = installBlockedReason !== undefined
  const blockedId = blocked ? "pi-install-blocked" : undefined

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {blocked ? (
        <p id="pi-install-blocked" className="text-xs text-muted-foreground">
          {installBlockedReason}
        </p>
      ) : null}
      <div className="flex min-w-0 flex-col gap-2 rounded-lg border p-4">
        <h4 className="font-medium">{m.addSourceTitle}</h4>
        <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{m.addSourceHint}</p>
        <div className="flex min-w-0 flex-wrap gap-2">
          <Input
            aria-label={m.addSource}
            aria-invalid={unsafe}
            value={source}
            onChange={(event) => setSource(event.target.value)}
            placeholder={m.addSource}
            className="min-w-0 flex-1 basis-64 font-mono text-xs"
          />
          <Button
            className="shrink-0"
            disabled={trimmed.length === 0 || unsafe || blocked}
            aria-describedby={blockedId}
            onClick={() =>
              setPending({
                action: { kind: "install", source: trimmed },
                source: trimmed,
                scope: scopeKind,
              })
            }
          >
            {m.install}
          </Button>
        </div>
        {unsafe ? <p className="text-xs text-[var(--hm-danger)]">{m.sourceUnsafe}</p> : null}
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-56">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query}
            aria-label={m.browse}
            placeholder={m.browse}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void searchPackages()
            }}
            className="w-full pl-8"
          />
        </div>
        <Button
          variant="outline"
          className="shrink-0 gap-2"
          onClick={() => void searchPackages()}
          disabled={searching || query.trim().length === 0}
        >
          {searching ? <Spinner className="size-4" /> : <Search className="size-4" />}
          {searching ? m.searching : m.search}
        </Button>
        <Button
          variant="ghost"
          className="shrink-0 gap-2"
          onClick={() => void openUrl(GALLERY_URL)}
        >
          <ExternalLink className="size-4" />
          {m.gallery}
        </Button>
      </div>

      {results.length === 0 ? (
        <CapabilityEmpty message={searched && !searching ? m.noResults : m.searchPrompt} />
      ) : (
        <CapabilityList label={m.resultsLabel}>
          {results.map((item) => {
            const already = installedSources.has(item.source)
            return (
              <CapabilityRow
                key={item.source}
                title={item.name}
                tags={
                  <>
                    <span className="font-mono">{item.version}</span>
                    <span>{item.publisher}</span>
                    <span>{item.license || "—"}</span>
                    {item.publishedAt ? (
                      <span>
                        {m.published} {new Date(item.publishedAt).toLocaleDateString()}
                      </span>
                    ) : null}
                  </>
                }
                description={item.description}
                status={already ? <RowChip>{m.alreadyInstalled}</RowChip> : null}
                actions={
                  /* Outline on every row: a list of primary buttons is as many
                     primaries as results. The one primary here is the named-
                     source Install above. */
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={already || blocked}
                    aria-describedby={already ? undefined : blockedId}
                    title={already ? m.alreadyInstalled : undefined}
                    onClick={() =>
                      setPending({
                        action: { kind: "install", source: item.source },
                        source: item.source,
                        scope: scopeKind,
                      })
                    }
                  >
                    {m.install}
                  </Button>
                }
              >
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    {item.resources.map((kind) => m.resources[kind] ?? kind).join(" · ") || "—"}
                  </span>
                  {item.repository ? (
                    <button
                      type="button"
                      onClick={() => void openUrl(item.repository!)}
                      className="min-w-0 rounded-sm underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none [overflow-wrap:anywhere]"
                    >
                      {item.repository}
                    </button>
                  ) : null}
                </div>
              </CapabilityRow>
            )
          })}
        </CapabilityList>
      )}
    </div>
  )
}
