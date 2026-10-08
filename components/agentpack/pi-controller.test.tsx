jest.mock("@/lib/tauri", () => ({ isTauri: jest.fn(() => true) }))
jest.mock("@/lib/tauri/commands", () => ({
  launchPiInteractive: jest.fn(async () => undefined),
  piAuthStatus: jest.fn(async () => ({ installed: true, providers: [] })),
  piManagementScan: jest.fn(async () => null),
  piPackageSearch: jest.fn(async () => []),
  piSessionDirsGet: jest.fn(async () => []),
  piSessionDirsSet: jest.fn(async (dirs: string[]) => dirs),
  pathExists: jest.fn(async () => true),
  readTextFile: jest.fn(async () => '{"packages":[]}'),
}))
jest.mock("@/lib/tauri/dialog", () => ({ pickFolder: jest.fn(async () => null) }))
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), message: jest.fn() },
}))
jest.mock("./run/runner-context", () => ({ useRunnerCtx: () => ({ run, onAfterRun }) }))

import type { ReactNode } from "react"
import { act, renderHook, waitFor } from "@testing-library/react"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import { useAppStore } from "@/store/app-store"
import type { Paths, StepDescriptor } from "@/lib/agentpack/types"
import type { PiPackageRecord, PiPackageSnapshot, PiResourceState } from "@/lib/pi/types"
import {
  launchPiInteractive,
  pathExists,
  piAuthStatus,
  piManagementScan,
  piPackageSearch,
  piSessionDirsGet,
  piSessionDirsSet,
  readTextFile,
} from "@/lib/tauri/commands"
import { pickFolder } from "@/lib/tauri/dialog"
import { toast } from "sonner"
import { usePiManagementController } from "./pi-controller"

const onAfterRun = jest.fn(() => () => undefined)
const run = jest.fn(async (steps: StepDescriptor[]) =>
  steps.map((step) => ({ id: step.id, label: step.label, status: "done", output: [] }))
)

const m = en.pi
const MANUAL_PROJECTS_KEY = "agentpack.pi.projects"

const paths = { piSettings: "/h/.pi/agent/settings.json", os: "mac" } as Paths

const resource = (over: Partial<PiResourceState> = {}): PiResourceState => ({
  enabled: true,
  configured: false,
  filters: [],
  declared: ["skills/a.md"],
  ...over,
})

const pkg = (over: Partial<PiPackageRecord> = {}): PiPackageRecord => ({
  source: "npm:demo",
  identity: "demo",
  sourceKind: "npm",
  pinned: false,
  autoload: true,
  scope: "global",
  inherited: false,
  overridden: false,
  installed: true,
  resources: {
    extensions: resource({ declared: [] }),
    skills: resource(),
    prompts: resource({ declared: [] }),
    themes: resource({ declared: [] }),
  },
  ...over,
})

const snapshot = (over: Partial<PiPackageSnapshot> = {}): PiPackageSnapshot => ({
  installed: true,
  scope: "global",
  settingsPath: "/h/.pi/agent/settings.json",
  packages: [],
  trust: { state: "ask", source: "default" },
  errors: [],
  ...over,
})

const wrapper = ({ children }: { children: ReactNode }) => <I18nProvider>{children}</I18nProvider>

function renderController(projectCwds: string[] = []) {
  return renderHook(() => usePiManagementController(projectCwds), { wrapper })
}

/** Let the mount-time reads (scan, session folders) land inside act. */
const settle = () => act(async () => undefined)

/** Installed, with the global scope already read. */
async function renderReady(value: PiPackageSnapshot = snapshot()) {
  ;(piManagementScan as jest.Mock).mockResolvedValue(value)
  const hook = renderController()
  await waitFor(() => expect(hook.result.current.snapshot).not.toBeNull())
  return hook
}

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard")

beforeEach(() => {
  jest.clearAllMocks()
  localStorage.clear()
  ;(piManagementScan as jest.Mock).mockResolvedValue(snapshot())
  ;(pathExists as jest.Mock).mockResolvedValue(true)
  ;(piSessionDirsGet as jest.Mock).mockResolvedValue([])
  ;(pickFolder as jest.Mock).mockResolvedValue(null)
  useAppStore.setState({ paths, detections: { pi: { installed: true, version: "0.84.4" } } })
})

afterEach(() => {
  if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard)
  else delete (navigator as { clipboard?: unknown }).clipboard
})

describe("manual project list in localStorage", () => {
  it("ignores a stored value that is not an array of strings", async () => {
    localStorage.setItem(MANUAL_PROJECTS_KEY, JSON.stringify({ a: "/x" }))
    const { result } = renderController(["/history"])
    await settle()
    expect(result.current.projects).toEqual(["/history"])
  })

  it("survives unparseable storage rather than throwing on mount", async () => {
    localStorage.setItem(MANUAL_PROJECTS_KEY, "{not json")
    const { result } = renderController()
    await settle()
    expect(result.current.projects).toEqual([])
  })

  it("keeps only the string entries, trimmed and de-duplicated with history", async () => {
    localStorage.setItem(MANUAL_PROJECTS_KEY, JSON.stringify(["/a ", 3, null, "/b", "  "]))
    const { result } = renderController(["/a", "/c"])
    await settle()
    expect(result.current.projects).toEqual(["/a", "/c", "/b"])
  })
})

describe("not installed", () => {
  beforeEach(() => useAppStore.setState({ detections: { pi: { installed: false } } }))

  it("never scans, reads auth or lists session folders", async () => {
    const { result } = renderController()
    await act(async () => {
      await result.current.scan()
      await result.current.loadAuth(true)
    })
    expect(piManagementScan).not.toHaveBeenCalled()
    expect(piAuthStatus).not.toHaveBeenCalled()
    expect(piSessionDirsGet).not.toHaveBeenCalled()
    // Not installed is not "pending": nothing is going to be read.
    expect(result.current.scanPending).toBe(false)
  })
})

describe("scope stamping", () => {
  it("project scope with no folder is not ready, pending nothing, and scans nothing", async () => {
    const { result } = await renderReady()
    ;(piManagementScan as jest.Mock).mockClear()
    await act(async () => result.current.setScopeKind("project"))
    expect(result.current.scopeReady).toBe(false)
    // The global answer must not be shown under the Project heading.
    expect(result.current.snapshot).toBeNull()
    expect(result.current.scanPending).toBe(false)
    expect(result.current.installBlockedReason).toBe(m.projectNeeded)
    expect(result.current.settingsPath).toBe("")
    await act(async () => {
      await result.current.scan()
    })
    expect(piManagementScan).not.toHaveBeenCalled()
  })

  it("a project folder that is gone says so, and names no settings file", async () => {
    ;(piManagementScan as jest.Mock).mockImplementation(async (scope: { kind: string }) => {
      if (scope.kind === "project") throw new Error("ENOENT")
      return snapshot()
    })
    ;(pathExists as jest.Mock).mockResolvedValue(false)
    const { result } = renderController()
    await act(async () => {
      result.current.setScopeKind("project")
      result.current.setCwd("/gone")
    })
    await waitFor(() => expect(result.current.projectMissing).toBe(true))
    expect(result.current.scanError).toBe(m.projectFolderMissing("/gone"))
    expect(result.current.settingsPath).toBe("")
    expect(result.current.installBlockedReason).toBe(m.projectNeeded)
  })

  it("a project read that failed for another reason blocks installs until it succeeds", async () => {
    ;(piManagementScan as jest.Mock).mockImplementation(async (scope: { kind: string }) => {
      if (scope.kind === "project") throw new Error("boom")
      return snapshot()
    })
    const { result } = renderController()
    await act(async () => {
      result.current.setScopeKind("project")
      result.current.setCwd("/repo")
    })
    await waitFor(() => expect(result.current.scanError).toBe("Error: boom"))
    expect(result.current.projectMissing).toBe(false)
    expect(result.current.settingsPath).toBe("/repo/.pi/settings.json")
    expect(result.current.installBlockedReason).toBe(m.installNeedsReading)
  })

  it("a folder whose existence can't be checked is reported as a plain scan failure", async () => {
    ;(piManagementScan as jest.Mock).mockRejectedValue(new Error("boom"))
    ;(pathExists as jest.Mock).mockRejectedValue(new Error("no fs"))
    const { result } = renderController()
    await act(async () => {
      result.current.setScopeKind("project")
      result.current.setCwd("/repo")
    })
    await waitFor(() => expect(result.current.scanError).toBe("Error: boom"))
    expect(result.current.projectMissing).toBe(false)
  })
})

describe("auth", () => {
  it("records a failed refresh as an error, apart from an empty provider list", async () => {
    const { result } = await renderReady()
    ;(piAuthStatus as jest.Mock).mockRejectedValueOnce(new Error("denied"))
    await act(async () => {
      await result.current.loadAuth(true)
    })
    expect(result.current.authError).toBe("Error: denied")
    expect(result.current.auth).toBeNull()
    expect(result.current.authLoading).toBe(false)
    // A failed first read is not "still loading".
    await act(async () => result.current.setView("auth"))
    expect(result.current.authPending).toBe(false)
  })
})

describe("search", () => {
  it("does nothing for a blank query", async () => {
    const { result } = await renderReady()
    await act(async () => result.current.setQuery("   "))
    await act(async () => {
      await result.current.searchPackages()
    })
    expect(piPackageSearch).not.toHaveBeenCalled()
  })

  it("toasts a failed search and leaves it un-searched", async () => {
    const { result } = await renderReady()
    ;(piPackageSearch as jest.Mock).mockRejectedValueOnce(new Error("offline"))
    await act(async () => result.current.setQuery("theme"))
    await act(async () => {
      await result.current.searchPackages()
    })
    expect(toast.error).toHaveBeenCalledWith("Error: offline")
    expect(result.current.searched).toBe(false)
    expect(result.current.searching).toBe(false)
  })
})

describe("session folders", () => {
  it("adding does nothing when the picker is cancelled", async () => {
    const { result } = await renderReady()
    await act(async () => {
      await result.current.addSessionDir()
    })
    expect(piSessionDirsSet).not.toHaveBeenCalled()
  })

  it("toasts a failed add or remove and keeps the list as it was", async () => {
    ;(piSessionDirsGet as jest.Mock).mockResolvedValue(["/old"])
    const { result } = await renderReady()
    await waitFor(() => expect(result.current.sessionDirs).toEqual(["/old"]))
    ;(pickFolder as jest.Mock).mockResolvedValueOnce("/new")
    ;(piSessionDirsSet as jest.Mock).mockRejectedValueOnce(new Error("disk full"))
    await act(async () => {
      await result.current.addSessionDir()
    })
    expect(piSessionDirsSet).toHaveBeenLastCalledWith(["/old", "/new"])
    ;(piSessionDirsSet as jest.Mock).mockRejectedValueOnce(new Error("locked"))
    await act(async () => {
      await result.current.removeSessionDir("/old")
    })
    expect(piSessionDirsSet).toHaveBeenLastCalledWith([])
    expect(toast.error).toHaveBeenNthCalledWith(1, "Error: disk full")
    expect(toast.error).toHaveBeenNthCalledWith(2, "Error: locked")
    expect(result.current.sessionDirs).toEqual(["/old"])
  })
})

describe("staging a package action", () => {
  it("does nothing with no pending action", async () => {
    const { result } = await renderReady()
    await act(async () => {
      await result.current.stagePackageAction()
    })
    expect(run).not.toHaveBeenCalled()
  })

  it("refuses a project action with no folder instead of running in the app's cwd", async () => {
    const { result } = await renderReady()
    await act(async () =>
      result.current.setPending({
        action: { kind: "install", source: "npm:demo" },
        source: "npm:demo",
        scope: "project",
      })
    )
    expect(result.current.pendingTargetPath).toBe("")
    await act(async () => {
      await result.current.stagePackageAction()
    })
    expect(run).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith(m.projectNeeded)
    expect(result.current.pending).toBeNull()
  })

  it("toasts an unsafe source instead of staging it", async () => {
    const { result } = await renderReady()
    await act(async () =>
      result.current.setPending({
        action: { kind: "install", source: "https://token@host/repo" },
        source: "https://token@host/repo",
        scope: "global",
      })
    )
    await act(async () => {
      await result.current.stagePackageAction()
    })
    expect(run).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining(m.errors.PI_PACKAGE_SOURCE_UNSAFE)
    )
  })

  it("stages a project action with approval and the trimmed folder", async () => {
    const { result } = await renderReady()
    await act(async () => {
      result.current.setScopeKind("project")
      result.current.setCwd(" /repo ")
    })
    await act(async () =>
      result.current.setPending({
        action: { kind: "remove", source: "npm:demo" },
        source: "npm:demo",
        scope: "project",
      })
    )
    await act(async () => {
      await result.current.stagePackageAction()
    })
    const [steps] = run.mock.calls[0] as [StepDescriptor[]]
    expect(steps[0]).toMatchObject({
      kind: "command",
      command: { args: ["remove", "npm:demo", "-l", "--approve"], cwd: "/repo" },
    })
  })
})

describe("which file a staged action names", () => {
  it("quotes the global settings for a global row even while a project is selected", async () => {
    const { result } = await renderReady()
    await act(async () => {
      result.current.setScopeKind("project")
      result.current.setCwd("/repo")
      result.current.setPending({
        action: { kind: "update", source: "npm:demo" },
        source: "npm:demo",
        scope: "global",
      })
    })
    expect(result.current.pendingTargetPath).toBe(paths.piSettings)
  })

  it("quotes the project snapshot's own path once the project has been read", async () => {
    ;(piManagementScan as jest.Mock).mockImplementation(async (scope: { kind: string }) =>
      scope.kind === "project"
        ? snapshot({ scope: "project", cwd: "/repo", settingsPath: "/repo/.pi/settings.json" })
        : snapshot()
    )
    const { result } = renderController()
    await act(async () => {
      result.current.setScopeKind("project")
      result.current.setCwd("/repo")
    })
    await waitFor(() => expect(result.current.snapshot?.scope).toBe("project"))
    await act(async () =>
      result.current.setPending({
        action: { kind: "install", source: "npm:x" },
        source: "npm:x",
        scope: "project",
      })
    )
    expect(result.current.pendingTargetPath).toBe("/repo/.pi/settings.json")
    expect(result.current.installBlockedReason).toBeUndefined()
  })

  it("names no global file when the paths are not resolved yet", async () => {
    useAppStore.setState({ paths: null })
    const { result } = renderController()
    await act(async () =>
      result.current.setPending({
        action: { kind: "updateAll" },
        source: "",
        scope: "global",
      })
    )
    expect(result.current.pendingTargetPath).toBe("")
    // And staging without paths is a no-op rather than a half-built step.
    await act(async () => {
      await result.current.stagePackageAction()
    })
    expect(run).not.toHaveBeenCalled()
  })
})

describe("resource toggles", () => {
  it("do nothing before a scan has answered", async () => {
    ;(piManagementScan as jest.Mock).mockReturnValue(new Promise(() => undefined))
    const { result } = renderController()
    await act(async () => {
      await result.current.toggleResource(pkg(), "skills", false)
      await result.current.toggleResourcePath(pkg(), "skills", "skills/a.md", false)
    })
    expect(run).not.toHaveBeenCalled()
  })

  it("refuse a package the project overrides, and say why", async () => {
    const { result } = await renderReady()
    const overridden = pkg({ overridden: true })
    await act(async () => {
      await result.current.toggleResource(overridden, "skills", false)
      await result.current.toggleResourcePath(overridden, "skills", "skills/a.md", false)
    })
    expect(run).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledTimes(2)
    expect(toast.error).toHaveBeenCalledWith(m.overriddenResourceHint)
  })

  it("review against an empty file when the settings file does not exist yet", async () => {
    const { result } = await renderReady()
    ;(pathExists as jest.Mock).mockResolvedValue(false)
    await act(async () => {
      await result.current.toggleResource(pkg(), "skills", false)
    })
    expect(readTextFile).not.toHaveBeenCalled()
    const [[step]] = run.mock.calls[0] as [StepDescriptor[]]
    if (step.kind !== "mergeFile") throw new Error("expected a merge step")
    expect(JSON.parse(step.merge("")).packages).toEqual([{ source: "npm:demo", skills: [] }])
  })

  it("toast a failed read instead of staging against a guess", async () => {
    const { result } = await renderReady()
    ;(readTextFile as jest.Mock).mockRejectedValueOnce(new Error("EACCES"))
    await act(async () => {
      await result.current.toggleResource(pkg(), "skills", true)
    })
    ;(readTextFile as jest.Mock).mockRejectedValueOnce(new Error("EACCES"))
    await act(async () => {
      await result.current.toggleResourcePath(pkg(), "skills", "skills/a.md", true)
    })
    expect(run).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledTimes(2)
    expect(toast.error).toHaveBeenCalledWith("Error: EACCES")
  })
})

describe("interactive login hand-off", () => {
  const setClipboard = (writeText: jest.Mock) =>
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })

  it("says the command was copied only when the clipboard took it", async () => {
    const writeText = jest.fn(async () => undefined)
    setClipboard(writeText)
    const { result } = await renderReady()
    await act(async () => {
      await result.current.openInteractive("/login")
    })
    expect(writeText).toHaveBeenCalledWith("/login")
    expect(launchPiInteractive).toHaveBeenCalledWith(null)
    expect(toast.info).toHaveBeenCalledWith(m.copied("/login"), {
      description: m.interactiveHint("/login"),
    })
  })

  it("still opens the terminal when the clipboard refuses, and says to type it", async () => {
    setClipboard(jest.fn(async () => Promise.reject(new Error("no focus"))))
    const { result } = await renderReady()
    await act(async () => {
      result.current.setScopeKind("project")
      result.current.setCwd(" /repo ")
    })
    await act(async () => {
      await result.current.openInteractive("/logout")
    })
    expect(launchPiInteractive).toHaveBeenCalledWith("/repo")
    expect(toast.info).toHaveBeenCalledWith(m.typeCommand("/logout"), expect.anything())
  })

  it("never promises a terminal that failed to open", async () => {
    ;(launchPiInteractive as jest.Mock).mockRejectedValueOnce(new Error("no terminal"))
    const { result } = await renderReady()
    await act(async () => {
      await result.current.openInteractive("/login")
    })
    expect(toast.error).toHaveBeenCalledWith(m.launchFailed("Error: no terminal"))
    expect(toast.info).not.toHaveBeenCalled()
  })
})
