"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { pickFolder } from "@/lib/tauri/dialog"
import {
  launchPiInteractive,
  piAuthStatus,
  piManagementScan,
  piPackageSearch,
  piSessionDirsGet,
  piSessionDirsSet,
  pathExists,
  readTextFile,
} from "@/lib/tauri/commands"
import {
  buildPiPackageSteps,
  buildPiResourcePathToggleStep,
  buildPiResourceToggleStep,
  piResourcesOnCount,
  type PiPackageAction,
} from "@/lib/pi/management"
import type {
  PiAuthReport,
  PiPackageRecord,
  PiPackageSearchItem,
  PiPackageSnapshot,
  PiResourceKind,
  PiScanScope,
} from "@/lib/pi/types"
import { isTauri } from "@/lib/tauri"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { useRunnerCtx } from "./run/runner-context"

const MANUAL_PROJECTS_KEY = "agentpack.pi.projects"

/** The four destinations in the section's aside. Only `auth` loads lazily. */
export type PiView = "packages" | "browse" | "auth" | "sessions"

export const PI_RESOURCE_KINDS: PiResourceKind[] = ["extensions", "skills", "prompts", "themes"]

export type PiPendingAction = {
  action: PiPackageAction
  source: string
  scope: "global" | "project"
}

/**
 * One scope's answer: the snapshot, or why there isn't one. A failure keeps its
 * reason so the page can say it where the list would have been, and a project
 * folder that does not exist is told apart because its fix is a different one.
 */
type PiReading = { snapshot: PiPackageSnapshot } | { error: string; missingFolder?: boolean }

function loadManualProjects(): string[] {
  if (typeof window === "undefined") return []
  try {
    const value = JSON.parse(localStorage.getItem(MANUAL_PROJECTS_KEY) ?? "[]")
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : []
  } catch {
    return []
  }
}

function saveManualProjects(projects: string[]) {
  localStorage.setItem(MANUAL_PROJECTS_KEY, JSON.stringify(projects))
}

/**
 * Read one scope. Never rejects: a failure becomes a reading that carries its
 * reason. Whether a project folder exists is asked only once the scan has
 * failed, so the common path costs no extra round trip.
 */
async function readScope(
  scope: PiScanScope,
  missingFolder: (cwd: string) => string
): Promise<PiReading> {
  try {
    return { snapshot: await piManagementScan(scope) }
  } catch (error) {
    if (scope.kind === "project" && !(await pathExists(scope.cwd).catch(() => true))) {
      return { error: missingFolder(scope.cwd), missingFolder: true }
    }
    return { error: String(error) }
  }
}

/** Shell-owned Pi scans and mutations. The section only renders this controller. */
export function usePiManagementController(projectCwds: string[] = []) {
  const m = useT().pi
  const managementCopy = useMemo(
    () => ({
      packageAction: m.packageAction,
      resourceAction: m.resourceAction,
      errors: m.errors,
    }),
    [m]
  )
  const paths = useAppStore((state) => state.paths)
  const detection = useAppStore((state) => state.detections.pi)
  const { run, onAfterRun } = useRunnerCtx()
  const [view, setView] = useState<PiView>("packages")
  const [scopeKind, setScopeKind] = useState<"global" | "project">("global")
  const [cwd, setCwd] = useState("")
  const [manualProjects, setManualProjects] = useState<string[]>(loadManualProjects)
  const [scanned, setScanned] = useState<Map<string, PiReading>>(() => new Map())
  const [auth, setAuth] = useState<PiAuthReport | null>(null)
  // The last authentication read failed. Kept apart from "no providers": an
  // empty list is Pi's answer, a failure is the absence of one.
  const [authError, setAuthError] = useState<string | null>(null)
  const [authLoading, setAuthLoading] = useState(false)
  const [loading, setLoading] = useState(false)
  const [source, setSource] = useState("")
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<PiPackageSearchItem[]>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [pending, setPending] = useState<PiPendingAction | null>(null)
  const [sessionDirs, setSessionDirs] = useState<string[]>([])

  const projects = useMemo(
    () => [
      ...new Set([...projectCwds, ...manualProjects].map((path) => path.trim()).filter(Boolean)),
    ],
    [manualProjects, projectCwds]
  )
  const scope = useMemo<PiScanScope>(
    () => (scopeKind === "project" ? { kind: "project", cwd } : { kind: "global" }),
    [cwd, scopeKind]
  )
  /**
   * Web mode has no Rust behind it, so a scan there is not a degraded reading,
   * it is an invoke that throws and an error toast on a page that was never
   * going to work. The section says so with a `DesktopOnlyNote`, and nothing
   * below this line runs.
   */
  const installed = isTauri() && detection?.installed === true
  /**
   * Project scope with no folder chosen yet is a real state, not a no-op. The
   * scan used to bail silently and leave the previous scope's snapshot on
   * screen, so picking "Project" showed the *global* packages under a heading
   * that said Project. The section is now told to render a prompt instead.
   */
  const scopeReady = scope.kind === "global" || scope.cwd.trim().length > 0
  /**
   * A reading is stamped with the scope it was taken for, and only shown while
   * that stamp still matches. That covers the gap the old code could not: the
   * moment after a scope change, when the previous scope's answer is the only
   * one in hand and would otherwise be read as this one's.
   */
  const scopeKey = scopeKind === "project" ? `project:${cwd.trim()}` : "global"
  const reading = scanned.get(scopeKey)
  const snapshot = reading && "snapshot" in reading ? reading.snapshot : null
  /**
   * The read for this scope failed. Rendered where the list would be, with
   * Rescan beside it: the list used to fall through to "no packages are
   * configured in this scope", which states as fact what nothing had read.
   */
  const scanError = reading && "error" in reading ? reading.error : null
  const projectMissing = !!reading && "error" in reading && reading.missingFolder === true
  /**
   * No reading for this scope yet, so a scan is in flight or about to start.
   * The list used to render its "nothing is configured here" empty state during
   * that gap, which states as fact the one thing the app has not looked at yet.
   * A failed scan records its error as the reading rather than nothing at all,
   * so this clears even when the answer was an error.
   */
  const scanPending = installed && scopeReady && !scanned.has(scopeKey)

  const scan = useCallback(async () => {
    if (!installed || !scopeReady) return
    setLoading(true)
    try {
      const value = await readScope(scope, m.projectFolderMissing)
      setScanned((current) => new Map(current).set(scopeKey, value))
    } finally {
      setLoading(false)
    }
  }, [installed, m.projectFolderMissing, scope, scopeKey, scopeReady])

  useEffect(() => {
    if (!installed || !scopeReady) return
    let cancelled = false
    void readScope(scope, m.projectFolderMissing).then((value) => {
      if (!cancelled) setScanned((current) => new Map(current).set(scopeKey, value))
    })
    return () => {
      cancelled = true
    }
  }, [installed, m.projectFolderMissing, scope, scopeKey, scopeReady])

  /**
   * Every real run re-reads the scope on screen — a retry in the review panel
   * included. A retry never resolves the `run()` its caller awaited, so a
   * rescan chained onto that promise left the list describing the machine as
   * it was before the retry fixed it.
   */
  useEffect(() => onAfterRun(() => void scan()), [onAfterRun, scan])

  const loadAuth = useCallback(
    async (refresh: boolean) => {
      if (!installed) return
      setAuthLoading(true)
      setAuthError(null)
      try {
        setAuth(await piAuthStatus(refresh))
      } catch (error) {
        setAuthError(String(error))
      } finally {
        setAuthLoading(false)
      }
    },
    [installed]
  )

  useEffect(() => {
    // A failed first read waits for the Retry beside its message, rather than
    // retrying itself in a loop every time this effect re-runs.
    if (!installed || view !== "auth" || auth || authError) return
    let cancelled = false
    void piAuthStatus(false)
      .then((value) => {
        if (!cancelled) setAuth(value)
      })
      .catch((error) => {
        if (!cancelled) setAuthError(String(error))
      })
    return () => {
      cancelled = true
    }
  }, [auth, authError, installed, view])

  /**
   * The first automatic read is in flight. Not state set by the effect, because
   * it is exactly "on the auth view, nothing read yet, nothing failed yet" — and
   * the empty-providers sentence used to render through that whole wait.
   */
  const authPending = installed && view === "auth" && auth === null && authError === null

  useEffect(() => {
    if (!installed) return
    void piSessionDirsGet()
      .then(setSessionDirs)
      .catch(() => undefined)
  }, [installed])

  const chooseProject = async () => {
    const selected = await pickFolder()
    if (!selected) return
    const next = [...new Set([...manualProjects, selected])]
    setManualProjects(next)
    saveManualProjects(next)
    setCwd(selected)
    setScopeKind("project")
  }

  const searchPackages = async () => {
    // Enter in the field reaches here too, and the button's own disabled state
    // does not guard a key press.
    if (searching || query.trim().length === 0) return
    setSearching(true)
    try {
      setResults(await piPackageSearch(query))
      setSearched(true)
    } catch (error) {
      toast.error(String(error))
    } finally {
      setSearching(false)
    }
  }

  const addSessionDir = async () => {
    const selected = await pickFolder()
    if (!selected) return
    try {
      setSessionDirs(await piSessionDirsSet([...new Set([...sessionDirs, selected])]))
    } catch (error) {
      toast.error(String(error))
    }
  }

  const removeSessionDir = async (dir: string) => {
    try {
      setSessionDirs(await piSessionDirsSet(sessionDirs.filter((candidate) => candidate !== dir)))
    } catch (error) {
      toast.error(String(error))
    }
  }

  const readSettingsForToggle = async () =>
    (await pathExists(snapshot?.settingsPath ?? "")) ? readTextFile(snapshot!.settingsPath) : ""

  const stagePackageAction = async () => {
    if (!pending || !paths) return
    const projectCwd = cwd.trim()
    // A project command with no folder would run with an empty cwd, which the
    // backend drops — so it would run in whatever folder the app started in,
    // against settings nobody chose. Refused here as the last line; the install
    // buttons already say why they are off.
    if (pending.scope === "project" && !projectCwd) {
      setPending(null)
      toast.error(m.projectNeeded)
      return
    }
    const selectedScope =
      pending.scope === "project"
        ? ({ kind: "project", cwd: projectCwd, approved: true } as const)
        : ({ kind: "global" } as const)
    try {
      const steps = buildPiPackageSteps(pending.action, selectedScope, paths, managementCopy)
      setPending(null)
      // The re-read after it rides `onAfterRun`, which also covers a retry.
      await run(steps, { activity: { title: m.packageActivity, source: "section" } })
    } catch (error) {
      toast.error(String(error))
    }
  }

  const toggleResource = async (pkg: PiPackageRecord, kind: PiResourceKind, enabled: boolean) => {
    if (!snapshot) return
    if (pkg.overridden) {
      toast.error(m.overriddenResourceHint)
      return
    }
    try {
      const reviewed = await readSettingsForToggle()
      await run([
        buildPiResourceToggleStep(
          snapshot.settingsPath,
          reviewed,
          pkg.source,
          kind,
          enabled,
          managementCopy,
          pkg.inherited,
          pkg.resources[kind].declared
        ),
      ])
    } catch (error) {
      toast.error(String(error))
    }
  }

  const toggleResourcePath = async (
    pkg: PiPackageRecord,
    kind: PiResourceKind,
    resourcePath: string,
    enabled: boolean
  ) => {
    if (!snapshot) return
    if (pkg.overridden) {
      toast.error(m.overriddenResourceHint)
      return
    }
    try {
      const reviewed = await readSettingsForToggle()
      await run([
        buildPiResourcePathToggleStep(
          snapshot.settingsPath,
          reviewed,
          pkg.source,
          kind,
          resourcePath,
          enabled,
          managementCopy,
          pkg.inherited
        ),
      ])
    } catch (error) {
      toast.error(String(error))
    }
  }

  /**
   * Hand log in / log out to Pi's own flow in a terminal. The clipboard is a
   * convenience: when it refuses (no permission, no focus) the terminal still
   * opens and the toast says to type the command. The toast comes after the
   * launch, so it never promises a terminal that failed to open.
   */
  const openInteractive = async (command: "/login" | "/logout") => {
    let copied = false
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(command)
        copied = true
      }
    } catch {
      copied = false
    }
    try {
      await launchPiInteractive(scopeKind === "project" && cwd.trim() ? cwd.trim() : null)
    } catch (error) {
      toast.error(m.launchFailed(String(error)))
      return
    }
    toast.info(copied ? m.copied(command) : m.typeCommand(command), {
      description: m.interactiveHint(command),
    })
  }

  /**
   * The file every write on this page lands in. `snapshot` is authoritative once
   * a scan has answered. Before that the app still has to be able to name the
   * target, because the permission dialog quotes it.
   */
  const settingsPath = useMemo(() => {
    if (snapshot) return snapshot.settingsPath
    if (scopeKind === "project") {
      // A folder that isn't there has no settings file to name.
      return cwd.trim() && !projectMissing ? `${cwd.trim()}/.pi/settings.json` : ""
    }
    return paths?.piSettings ?? ""
  }, [cwd, paths, projectMissing, scopeKind, snapshot])

  /**
   * Which file the staged action writes. A global row acted on while a project
   * is selected still writes globally, so the dialog cannot quote the project's
   * settings for it.
   */
  const pendingTargetPath = useMemo(() => {
    if (!pending) return ""
    if (pending.scope === "global") return paths?.piSettings ?? ""
    if (snapshot?.scope === "project") return snapshot.settingsPath
    // No folder, no file: "/.pi/settings.json" named a path at the filesystem
    // root that nothing was ever going to write.
    return cwd.trim() ? `${cwd.trim()}/.pi/settings.json` : ""
  }, [cwd, paths, pending, snapshot])

  /**
   * Why an install from Find packages can't be staged in this scope, if it
   * can't. Global always can. Project needs a folder and a reading of it that
   * succeeded — the folder exists, and what is installed there is known.
   */
  const installBlockedReason =
    scopeKind === "global"
      ? undefined
      : !scopeReady || projectMissing
        ? m.projectNeeded
        : snapshot?.scope === "project"
          ? undefined
          : m.installNeedsReading

  /** Sources already configured here, so the browse list can refuse a second install. */
  const installedSources = useMemo(
    () => new Set((snapshot?.packages ?? []).map((pkg) => pkg.source)),
    [snapshot]
  )

  const resourcesOn = useMemo(
    () => (snapshot?.packages ?? []).reduce((total, pkg) => total + piResourcesOnCount(pkg), 0),
    [snapshot]
  )

  return {
    paths,
    installed,
    view,
    setView,
    scopeKind,
    setScopeKind,
    scopeReady,
    cwd,
    setCwd,
    projects,
    snapshot,
    scanPending,
    scanError,
    projectMissing,
    installBlockedReason,
    settingsPath,
    installedSources,
    resourcesOn,
    auth,
    authPending,
    authLoading,
    authError,
    loading,
    source,
    setSource,
    query,
    setQuery,
    results,
    searching,
    searched,
    pending,
    setPending,
    pendingTargetPath,
    sessionDirs,
    scan,
    loadAuth,
    chooseProject,
    searchPackages,
    addSessionDir,
    removeSessionDir,
    stagePackageAction,
    toggleResource,
    toggleResourcePath,
    openInteractive,
  }
}

export type PiManagementController = ReturnType<typeof usePiManagementController>
