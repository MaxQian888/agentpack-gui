"use client"

import { RefreshCw } from "lucide-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { isTauri } from "@/lib/tauri"
import { useT } from "@/lib/i18n/provider"
import { redactPiPackageSource } from "@/lib/pi/management"
import { DesktopOnlyNote } from "../../desktop-only-note"
import { HelpTip } from "../../help-tip"
import type { PiManagementController, PiView } from "../../pi-controller"
import { CapabilityEmpty } from "../capability-list"
import { CapabilityTile, CapabilityWorkbench } from "../capability-workbench"
import { SectionNav } from "../section-nav"
import { SectionStatus, type StatusFact } from "../section-status"
import { SectionView } from "../section-view"
import { PiAuthView } from "./auth"
import { PiBrowseView } from "./browse"
import { PiPackagesView } from "./packages"
import { PiScopeBar } from "./scope-bar"
import { PiSessionsView } from "./sessions"

/**
 * Pi management, on the shell's shared workbench.
 *
 * It used to be a page of its own: an `h1` at a width no other section used, a
 * `Tabs` strip nothing else in the app has, then six stacked `Card`s of near
 * identical weight, one of them a standing red alert. The information is the
 * same. The frame is now the one Skills and MCP use, so the heading, the
 * summary band and the aside behave the way they do everywhere else, and the
 * four things you can actually do here are four destinations instead of two
 * tabs with unrelated panels crammed into the first one.
 */
export function PiSection({
  controller,
  onOpenClis,
}: {
  controller: PiManagementController
  onOpenClis: () => void
}) {
  const t = useT()
  const m = t.pi
  const tauri = isTauri()
  const {
    installed,
    view,
    setView,
    scopeKind,
    scopeReady,
    snapshot,
    scanPending,
    scanError,
    projectMissing,
    settingsPath,
    resourcesOn,
    auth,
    loading,
    scan,
    loadAuth,
  } = controller

  /**
   * One meaning for one button: re-read what this page is showing. The auth
   * panel keeps its own control because `--refresh` there is a different act
   * (it can go to the network), not a second name for this one.
   */
  const rescan = () => {
    void scan()
    if (auth) void loadAuth(false)
  }

  const project = scopeKind === "project"
  const trustState = snapshot?.scope === "project" ? snapshot.trust.state : null
  const untrusted = trustState !== null && trustState !== "trusted"

  const facts: StatusFact[] = [
    { label: m.statScope, value: project ? m.projectScope : m.globalScope },
    { label: m.statPackages, value: snapshot ? snapshot.packages.length : "—" },
    { label: m.statResources, value: snapshot ? resourcesOn : "—" },
    ...(trustState ? [{ label: m.statTrust, value: m.trustStates[trustState] ?? trustState }] : []),
  ]

  const viewTitle: Record<PiView, string> = {
    packages: m.tabPackages,
    browse: m.tabBrowse,
    auth: m.tabAuth,
    sessions: m.tabSessions,
  }

  const primary = !tauri ? (
    <DesktopOnlyNote>{m.notTauri}</DesktopOnlyNote>
  ) : !installed ? (
    <CapabilityEmpty
      message={m.notInstalled}
      action={<Button onClick={onOpenClis}>{m.installPi}</Button>}
    />
  ) : (
    <SectionView label={m.detailPanel} title={viewTitle[view]} choice={view}>
      {view === "packages" ? (
        scanPending ? (
          <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            {m.loading}
          </div>
        ) : (
          <PiPackagesView controller={controller} onFindPackages={() => setView("browse")} />
        )
      ) : view === "browse" ? (
        <PiBrowseView controller={controller} />
      ) : view === "auth" ? (
        <PiAuthView controller={controller} />
      ) : (
        <PiSessionsView controller={controller} />
      )}
    </SectionView>
  )

  return (
    <>
      <CapabilityWorkbench
        title={m.title}
        subtitle={m.subtitle}
        help={<HelpTip text={t.help.pi} />}
        actions={
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 gap-2"
            onClick={rescan}
            disabled={loading || !tauri || !installed}
          >
            <RefreshCw className={cn("size-4", loading && "animate-spin")} />
            {m.refresh}
          </Button>
        }
        actionsLabel={m.actionsLabel}
        lead={
          tauri && installed ? (
            <div className="flex min-w-0 flex-col gap-3">
              <PiScopeBar controller={controller} />
              <SectionStatus
                label={m.summaryLabel}
                facts={facts}
                notes={[
                  !scopeReady ? m.projectNeeded : null,
                  scanPending ? m.statPending : null,
                  scanError !== null && !projectMissing ? m.statFailed : null,
                  settingsPath ? m.statTarget(settingsPath) : null,
                  untrusted ? m.trustUnapproved : null,
                ]}
              />
            </div>
          ) : null
        }
        primary={primary}
        aside={
          tauri && installed ? (
            <>
              <SectionNav
                className="min-[768px]:max-[1099px]:col-span-2"
                choices={[
                  {
                    id: "pi-packages",
                    title: m.tabPackages,
                    description: m.packagesActionHint,
                    active: view === "packages",
                    onSelect: () => setView("packages"),
                  },
                  {
                    id: "pi-browse",
                    title: m.tabBrowse,
                    description: m.browseActionHint,
                    active: view === "browse",
                    onSelect: () => setView("browse"),
                  },
                  {
                    id: "pi-auth",
                    title: m.tabAuth,
                    description: m.authActionHint,
                    active: view === "auth",
                    onSelect: () => setView("auth"),
                  },
                  {
                    id: "pi-sessions",
                    title: m.tabSessions,
                    description: m.sessionsActionHint,
                    active: view === "sessions",
                    onSelect: () => setView("sessions"),
                  },
                ]}
              />
              {/* Said once, quietly, and read against both the installed list and
                the search results. It used to be a standing destructive Alert
                in the middle of the page, which is a wall of red that stops
                meaning anything long before the one dialog that matters. */}
              <CapabilityTile title={m.communityWarning} description={m.communityBody} />
            </>
          ) : null
        }
      />
      <PiPermissionDialog controller={controller} />
    </>
  )
}

/** The one gate every Pi package command passes through before it is staged. */
export function PiPermissionDialog({ controller }: { controller: PiManagementController }) {
  const m = useT().pi
  const { pending, setPending, pendingTargetPath, snapshot, stagePackageAction } = controller
  const untrusted =
    pending?.scope === "project" &&
    snapshot?.scope === "project" &&
    snapshot.trust.state !== "trusted"
  return (
    <AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{m.permissionTitle}</AlertDialogTitle>
          <AlertDialogDescription>
            {pending
              ? m.permissionBody(redactPiPackageSource(pending.source), pendingTargetPath)
              : ""}
          </AlertDialogDescription>
          <p className="text-xs text-muted-foreground">
            {m.permissionScope(pending?.scope === "project" ? m.projectScope : m.globalScope)}
          </p>
          {untrusted ? <p className="text-xs text-[var(--hm-warn)]">{m.trustUnapproved}</p> : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{m.cancel}</AlertDialogCancel>
          <AlertDialogAction onClick={() => void stagePackageAction()}>
            {m.approve}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
