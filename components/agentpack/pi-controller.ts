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
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { useRunnerCtx } from "./run/runner-context"

const MANUAL_PROJECTS_KEY = "agentpack.pi.projects"

export type PiPendingAction = {
  action: PiPackageAction
  source: string
  scope: "global" | "project"
}

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

/** Shell-owned Pi scans and mutations; the section only renders this controller. */
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
  const { run } = useRunnerCtx()
  const [tab, setTab] = useState("packages")
  const [scopeKind, setScopeKind] = useState<"global" | "project">("global")
  const [cwd, setCwd] = useState("")
  const [manualProjects, setManualProjects] = useState<string[]>(loadManualProjects)
  const [snapshot, setSnapshot] = useState<PiPackageSnapshot | null>(null)
  const [auth, setAuth] = useState<PiAuthReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [source, setSource] = useState("")
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<PiPackageSearchItem[]>([])
  const [searching, setSearching] = useState(false)
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
  const installed = detection?.installed === true

  const scan = useCallback(async () => {
    if (!installed || (scope.kind === "project" && !scope.cwd)) return
    setLoading(true)
    try {
      setSnapshot(await piManagementScan(scope))
    } catch (error) {
      toast.error(String(error))
    } finally {
      setLoading(false)
    }
  }, [installed, scope])

  useEffect(() => {
    if (!installed || (scope.kind === "project" && !scope.cwd)) return
    let cancelled = false
    void piManagementScan(scope)
      .then((value) => {
        if (!cancelled) setSnapshot(value)
      })
      .catch((error) => {
        if (!cancelled) toast.error(String(error))
      })
    return () => {
      cancelled = true
    }
  }, [installed, scope])

  const loadAuth = useCallback(
    async (refresh: boolean) => {
      if (!installed) return
      setLoading(true)
      try {
        setAuth(await piAuthStatus(refresh))
      } catch (error) {
        toast.error(String(error))
      } finally {
        setLoading(false)
      }
    },
    [installed]
  )

  useEffect(() => {
    if (!installed || tab !== "authentication" || auth) return
    let cancelled = false
    void piAuthStatus(false)
      .then((value) => {
        if (!cancelled) setAuth(value)
      })
      .catch((error) => {
        if (!cancelled) toast.error(String(error))
      })
    return () => {
      cancelled = true
    }
  }, [auth, installed, tab])

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
    setSearching(true)
    try {
      setResults(await piPackageSearch(query))
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
    const selectedScope =
      pending.scope === "project"
        ? ({ kind: "project", cwd, approved: true } as const)
        : ({ kind: "global" } as const)
    try {
      const steps = buildPiPackageSteps(pending.action, selectedScope, paths, managementCopy)
      setPending(null)
      await run(steps, { activity: { title: m.packageActivity, source: "section" } })
      await scan()
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
      await scan()
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
      await scan()
    } catch (error) {
      toast.error(String(error))
    }
  }

  const openInteractive = async (command: "/login" | "/logout") => {
    await navigator.clipboard?.writeText(command)
    toast.info(m.copied(command), { description: m.interactiveHint(command) })
    await launchPiInteractive(scopeKind === "project" ? cwd : null)
  }

  return {
    paths,
    installed,
    tab,
    setTab,
    scopeKind,
    setScopeKind,
    cwd,
    setCwd,
    projects,
    snapshot,
    auth,
    loading,
    source,
    setSource,
    query,
    setQuery,
    results,
    searching,
    pending,
    setPending,
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
