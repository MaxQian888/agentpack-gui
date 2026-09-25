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
jest.mock("@/lib/tauri/system", () => ({ openUrl: jest.fn(async () => undefined) }))
jest.mock("../../run/runner-context", () => ({ useRunnerCtx: () => ({ run, onAfterRun }) }))

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import { isTauri } from "@/lib/tauri"
import { useAppStore } from "@/store/app-store"
import type { Paths, StepDescriptor } from "@/lib/agentpack/types"
import type {
  PiPackageRecord,
  PiPackageSearchItem,
  PiPackageSnapshot,
  PiResourceState,
} from "@/lib/pi/types"
import { PiSection } from "./index"
import { usePiManagementController } from "../../pi-controller"
import {
  launchPiInteractive,
  pathExists,
  piAuthStatus,
  piManagementScan,
  piPackageSearch,
  piSessionDirsGet,
  piSessionDirsSet,
} from "@/lib/tauri/commands"
import { pickFolder } from "@/lib/tauri/dialog"
import { toast } from "sonner"

/**
 * Stands in for the real runner: stages, "applies", then fires the after-run
 * subscribers the way a real (non-preview) run does — which is what re-reads
 * the scope now, retries included.
 */
const afterRun = new Set<() => void>()
const onAfterRun = (fn: () => void) => {
  afterRun.add(fn)
  return () => {
    afterRun.delete(fn)
  }
}
const run = jest.fn(async (steps: StepDescriptor[]) => {
  staged.push(steps)
  afterRun.forEach((fn) => fn())
  return steps.map((step) => ({ id: step.id, label: step.label, status: "done", output: [] }))
})
let staged: StepDescriptor[][] = []

const m = en.pi

const paths: Paths = {
  home: "/h",
  claudeSettings: "/h/.claude/settings.json",
  claudeConfig: "/h/.claude.json",
  claudeSkillsDir: "/h/.claude/skills",
  codexConfig: "/h/.codex/config.toml",
  codexAuth: "/h/.codex/auth.json",
  codexSkillsDir: "/h/.codex/skills",
  opencodeConfig: "/h/.config/opencode/opencode.json",
  opencodeSkillsDir: "/h/.config/opencode/skills",
  piSettings: "/h/.pi/agent/settings.json",
  piAuth: "/h/.pi/agent/auth.json",
  piTrust: "/h/.pi/agent/trust.json",
  piSessionsDir: "/h/.pi/agent/sessions",
  piNpmDir: "/h/.pi/agent/npm",
  piGitDir: "/h/.pi/agent/git",
  piSkillsDir: "/h/.pi/agent/skills",
  agentsSkillsDir: "/h/.agents/skills",
  ccSwitchSettings: "/h/.cc-switch/settings.json",
  ccSwitchDb: "/h/.cc-switch/db.sqlite",
  ccConnectDir: "/h/.cc-connect",
  ccConnectConfig: "/h/.cc-connect/config.toml",
  mcpDisabledStore: "/h/.agentpack/mcp-disabled.json",
  shellProfile: "/h/.zshrc",
  os: "mac",
}

const resource = (over: Partial<PiResourceState> = {}): PiResourceState => ({
  enabled: true,
  configured: false,
  filters: [],
  declared: [],
  ...over,
})

function pkg(over: Partial<PiPackageRecord> = {}): PiPackageRecord {
  return {
    source: "demo-pkg@1.2.0",
    identity: "demo-pkg",
    sourceKind: "npm",
    pinned: false,
    autoload: true,
    scope: "global",
    inherited: false,
    overridden: false,
    installed: true,
    version: "1.2.0",
    resources: {
      extensions: resource({ declared: ["ext/one.js"] }),
      skills: resource({ declared: ["skills/a.md", "skills/b.md"] }),
      prompts: resource(),
      themes: resource(),
    },
    ...over,
  }
}

function snapshot(over: Partial<PiPackageSnapshot> = {}): PiPackageSnapshot {
  return {
    installed: true,
    scope: "global",
    settingsPath: "/h/.pi/agent/settings.json",
    packages: [],
    trust: { state: "ask", source: "default" },
    errors: [],
    ...over,
  }
}

function renderPi(onOpenClis = jest.fn()) {
  function Harness() {
    const controller = usePiManagementController(["/history/project"])
    return <PiSection controller={controller} onOpenClis={onOpenClis} />
  }
  return render(
    <I18nProvider>
      <Harness />
    </I18nProvider>
  )
}

/** Render with Pi installed and one scan already answered. */
async function renderReady(value: PiPackageSnapshot = snapshot()) {
  useAppStore.setState({ detections: { pi: { installed: true, version: "0.84.4" } } })
  ;(piManagementScan as jest.Mock).mockResolvedValue(value)
  const utils = renderPi()
  await waitFor(() => expect(screen.queryByText(m.statPending)).not.toBeInTheDocument())
  return utils
}

const openView = (name: string) =>
  userEvent.click(
    within(screen.getByRole("complementary", { name: m.actionsLabel })).getByRole("button", {
      name,
    })
  )

/** A staged action re-reads the scope, which is the last thing every run does. */
const rescanned = () => waitFor(() => expect(piManagementScan).toHaveBeenCalledTimes(2))

const scopeBar = () => within(screen.getByRole("group", { name: m.scopeLabel }))

/** The resource-kind filter chips, which share their labels with the row toggles. */
const kindChip = (name: string | RegExp) =>
  within(screen.getByRole("group", { name: m.kindFilter })).getByRole("button", { name })

beforeEach(() => {
  jest.clearAllMocks()
  staged = []
  localStorage.clear()
  ;(isTauri as jest.Mock).mockReturnValue(true)
  ;(piSessionDirsGet as jest.Mock).mockResolvedValue([])
  ;(piAuthStatus as jest.Mock).mockResolvedValue({ installed: true, providers: [] })
  ;(pathExists as jest.Mock).mockResolvedValue(true)
  ;(launchPiInteractive as jest.Mock).mockResolvedValue(undefined)
  useAppStore.setState({ paths, detections: {} })
})

// --- frame ------------------------------------------------------------------

it("says web mode cannot read the machine instead of claiming Pi is missing", async () => {
  ;(isTauri as jest.Mock).mockReturnValue(false)
  useAppStore.setState({ detections: { pi: { installed: true } } })
  renderPi()
  expect(screen.getByText(m.notTauri)).toBeInTheDocument()
  expect(screen.queryByText(m.notInstalled)).not.toBeInTheDocument()
})

it("shows the CLIs install CTA without invoking Pi when it is missing", async () => {
  const onOpenClis = jest.fn()
  useAppStore.setState({ detections: { pi: { installed: false } } })
  renderPi(onOpenClis)
  await userEvent.click(screen.getByRole("button", { name: m.installPi }))
  expect(onOpenClis).toHaveBeenCalled()
  expect(piManagementScan).not.toHaveBeenCalled()
  expect(piAuthStatus).not.toHaveBeenCalled()
  expect(screen.getByRole("button", { name: m.refresh })).toBeDisabled()
})

it("summarises the scanned scope and names the file every change writes to", async () => {
  await renderReady(snapshot({ packages: [pkg()] }))
  const summary = screen.getByRole("region", { name: m.summaryLabel })
  expect(within(summary).getByText(m.statScope)).toBeInTheDocument()
  expect(within(summary).getByText(m.globalScope)).toBeInTheDocument()
  expect(within(summary).getByText(m.statTarget("/h/.pi/agent/settings.json"))).toBeInTheDocument()
  // Trust belongs to a project, so a global scope states no trust at all.
  expect(within(summary).queryByText(m.statTrust)).not.toBeInTheDocument()
})

it("reports the project's trust state and warns that approving passes --approve", async () => {
  await renderReady()
  ;(piManagementScan as jest.Mock).mockResolvedValue(
    snapshot({
      scope: "project",
      cwd: "/picked",
      settingsPath: "/picked/.pi/settings.json",
      trust: { state: "untrusted", source: "saved" },
    })
  )
  ;(pickFolder as jest.Mock).mockResolvedValue("/picked")
  await userEvent.click(scopeBar().getByRole("button", { name: m.projectScope }))
  await userEvent.click(scopeBar().getByRole("button", { name: m.chooseFolder }))
  await waitFor(() =>
    expect(piManagementScan).toHaveBeenCalledWith({ kind: "project", cwd: "/picked" })
  )
  const summary = screen.getByRole("region", { name: m.summaryLabel })
  expect(within(summary).getByText(m.trustStates.untrusted)).toBeInTheDocument()
  expect(within(summary).getByText(m.trustUnapproved)).toBeInTheDocument()
  expect(localStorage.getItem("agentpack.pi.projects")).toContain("/picked")
})

it("asks for a folder rather than showing the global packages under a project heading", async () => {
  await renderReady(snapshot({ packages: [pkg()] }))
  expect(screen.getByText("demo-pkg")).toBeInTheDocument()
  await userEvent.click(scopeBar().getByRole("button", { name: m.projectScope }))
  expect(screen.getByText(m.projectNeeded)).toBeInTheDocument()
  expect(screen.getByText(m.noProjectChosen)).toBeInTheDocument()
  expect(screen.queryByText("demo-pkg")).not.toBeInTheDocument()
})

it("ignores a stale manual scan after another scope has finished loading", async () => {
  await renderReady(snapshot({ packages: [pkg()] }))
  let finishGlobalScan!: (value: PiPackageSnapshot) => void
  let finishProjectScan!: (value: PiPackageSnapshot) => void
  ;(piManagementScan as jest.Mock).mockImplementation((scope) => {
    return new Promise<PiPackageSnapshot>((resolve) => {
      if (scope.kind === "global") finishGlobalScan = resolve
      else finishProjectScan = resolve
    })
  })
  ;(pickFolder as jest.Mock).mockResolvedValue("/picked")

  fireEvent.click(screen.getByRole("button", { name: m.refresh }))
  fireEvent.click(scopeBar().getByRole("button", { name: m.projectScope }))
  await act(async () => {
    fireEvent.click(scopeBar().getByRole("button", { name: m.chooseFolder }))
    await Promise.resolve()
  })
  expect(piManagementScan).toHaveBeenCalledWith({ kind: "project", cwd: "/picked" })

  await act(async () => {
    finishProjectScan(
      snapshot({
        scope: "project",
        cwd: "/picked",
        settingsPath: "/picked/.pi/settings.json",
        packages: [pkg({ source: "project-pkg", identity: "project-pkg", scope: "project" })],
      })
    )
    await Promise.resolve()
    finishGlobalScan(snapshot({ packages: [pkg()] }))
    await Promise.resolve()
  })

  expect(screen.getByRole("button", { name: m.openPackage("project-pkg") })).toBeInTheDocument()
  expect(screen.queryByText(m.loading)).not.toBeInTheDocument()
})

it("rescans the settings and any authentication already read", async () => {
  await renderReady()
  await openView(m.tabAuth)
  await waitFor(() => expect(piAuthStatus).toHaveBeenCalledWith(false))
  ;(piManagementScan as jest.Mock).mockClear()
  ;(piAuthStatus as jest.Mock).mockClear()
  await userEvent.click(screen.getByRole("button", { name: m.refresh }))
  await waitFor(() => expect(piManagementScan).toHaveBeenCalled())
  expect(piAuthStatus).toHaveBeenCalledWith(false)
})

// --- packages ---------------------------------------------------------------

it("lists a package's facts as tags and only exceptional state as a chip", async () => {
  await renderReady(
    snapshot({
      packages: [
        pkg(),
        pkg({ source: "gone@0.1.0", identity: "gone", version: "0.1.0", installed: false }),
        pkg({ source: "shadowed@0.2.0", identity: "shadowed", version: "0.2.0", overridden: true }),
      ],
    })
  )
  const list = screen.getByRole("list", { name: m.packagesListLabel })
  expect(within(list).getByText("1.2.0")).toBeInTheDocument()
  expect(within(list).getByText(m.missing)).toBeInTheDocument()
  expect(within(list).getByText(m.missingHint)).toBeInTheDocument()
  expect(within(list).getByText(m.overridden)).toBeInTheDocument()
  // "installed" and "npm" are facts, so they never draw a status chip.
  expect(within(list).queryByText(m.installedState)).not.toBeInTheDocument()
})

it("stages one settings merge when a resource kind is switched off", async () => {
  await renderReady(snapshot({ packages: [pkg()] }))
  const group = screen.getByRole("group", { name: "demo-pkg" })
  const skills = within(group).getByRole("button", { name: /Skills/ })
  expect(skills).toHaveAttribute("aria-pressed", "true")
  await userEvent.click(skills)
  await waitFor(() => expect(run).toHaveBeenCalled())
  expect(staged[0][0]).toMatchObject({ kind: "mergeFile", path: "/h/.pi/agent/settings.json" })
  await rescanned()
})

it("counts a narrowed resource as a subset rather than as fully on", async () => {
  await renderReady(
    snapshot({
      packages: [
        pkg({
          resources: {
            extensions: resource({ declared: [] }),
            skills: resource({
              configured: true,
              filters: ["skills/a.md"],
              declared: ["skills/a.md", "skills/b.md"],
            }),
            prompts: resource(),
            themes: resource(),
          },
        }),
      ],
    })
  )
  const group = screen.getByRole("group", { name: "demo-pkg" })
  expect(within(group).getByRole("button", { name: "Skills 1/2" })).toBeInTheDocument()
  const resourceFact = within(screen.getByRole("region", { name: m.summaryLabel })).getByText(
    m.statResources
  ).parentElement
  expect(resourceFact).toHaveTextContent(`${m.statResources}1`)
  // The kind with nothing declared gets no chip at all.
  expect(within(group).queryByRole("button", { name: /Themes/ })).not.toBeInTheDocument()
})

it("enables a resource kind in one click when its filters currently load no files", async () => {
  await renderReady(
    snapshot({
      packages: [
        pkg({
          resources: {
            extensions: resource({ declared: [] }),
            skills: resource({
              configured: true,
              filters: ["!**"],
              declared: ["skills/a.md", "skills/b.md"],
            }),
            prompts: resource(),
            themes: resource(),
          },
        }),
      ],
    })
  )
  const skills = within(screen.getByRole("group", { name: "demo-pkg" })).getByRole("button", {
    name: "Skills 0/2",
  })
  expect(skills).toHaveAttribute("aria-pressed", "false")

  await userEvent.click(skills)

  await waitFor(() => expect(run).toHaveBeenCalled())
  expect(staged[0][0]).toMatchObject({
    label: m.resourceAction(true, "skills", "demo-pkg@1.2.0"),
  })
})

it("explains why an overridden package's resources cannot be pressed", async () => {
  await renderReady(snapshot({ packages: [pkg({ overridden: true })] }))
  const group = screen.getByRole("group", { name: "demo-pkg" })
  const skills = within(group).getByRole("button", { name: /Skills/ })
  expect(skills).toBeDisabled()
  expect(skills).toHaveAttribute("title", m.overriddenResourceHint)
  expect(screen.getByText(m.overriddenResourceHint)).toBeInTheDocument()
})

it("filters the list by resource kind and by search text", async () => {
  await renderReady(
    snapshot({
      packages: [
        pkg(),
        pkg({
          source: "themes-only@1.0.0",
          identity: "themes-only",
          resources: {
            extensions: resource(),
            skills: resource(),
            prompts: resource(),
            themes: resource({ declared: ["themes/dark.json"] }),
          },
        }),
      ],
    })
  )
  await userEvent.click(kindChip("Themes 1"))
  expect(screen.queryByText("demo-pkg")).not.toBeInTheDocument()
  expect(screen.getByText("themes-only")).toBeInTheDocument()
  await userEvent.click(kindChip(`${m.filterAll} 2`))
  await userEvent.type(screen.getByRole("textbox", { name: m.searchPlaceholder }), "nothing")
  expect(screen.getByText(m.noMatches)).toBeInTheDocument()
})

it("offers the search when a scope has no packages at all", async () => {
  await renderReady()
  expect(screen.getByText(m.noPackages)).toBeInTheDocument()
  await userEvent.click(
    within(screen.getByRole("region", { name: m.detailPanel })).getByRole("button", {
      name: m.findPackages,
    })
  )
  expect(screen.getByText(m.addSourceTitle)).toBeInTheDocument()
})

it("surfaces a scan error instead of an empty list", async () => {
  await renderReady(snapshot({ packages: [pkg()], errors: ["settings.json: unexpected token"] }))
  expect(screen.getByText("settings.json: unexpected token")).toBeInTheDocument()
})

it("gates update-all behind the permission dialog and stages the official command", async () => {
  await renderReady(snapshot({ packages: [pkg()] }))
  await userEvent.click(screen.getByRole("button", { name: m.updateAll }))
  expect(screen.getByText(m.permissionScope(m.globalScope))).toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: m.approve }))
  await waitFor(() => expect(run).toHaveBeenCalled())
  expect(staged[0][0]).toMatchObject({
    kind: "command",
    command: { file: "pi", args: ["update", "--extensions"] },
  })
  await rescanned()
})

it("removes a package from the row menu, through the same gate", async () => {
  await renderReady(snapshot({ packages: [pkg()] }))
  await userEvent.click(screen.getByRole("button", { name: m.actions }))
  await userEvent.click(await screen.findByRole("menuitem", { name: m.remove }))
  await userEvent.click(screen.getByRole("button", { name: m.approve }))
  await waitFor(() => expect(run).toHaveBeenCalled())
  expect(staged[0][0]).toMatchObject({
    command: { file: "pi", args: ["remove", "demo-pkg@1.2.0"] },
  })
  await rescanned()
})

it("lets any package be repinned, not only one that is already pinned", async () => {
  await renderReady(snapshot({ packages: [pkg()] }))
  await userEvent.click(screen.getByRole("button", { name: m.actions }))
  await userEvent.click(await screen.findByRole("menuitem", { name: m.changePin }))
  const field = screen.getByRole("textbox", { name: m.changePin })
  expect(field).toHaveValue("demo-pkg@1.2.0")
  expect(screen.getByRole("button", { name: m.changePinApply })).toBeDisabled()
  await userEvent.clear(field)
  expect(field).toHaveValue("")
  await userEvent.type(field, "demo-pkg@2.0.0")
  await userEvent.click(screen.getByRole("button", { name: m.changePinApply }))
  await userEvent.click(screen.getByRole("button", { name: m.approve }))
  await waitFor(() => expect(run).toHaveBeenCalled())
  expect(staged[0][0]).toMatchObject({
    command: { file: "pi", args: ["install", "demo-pkg@2.0.0"] },
  })
  await rescanned()
})

it("refuses an unsafe replacement source before asking for package permission", async () => {
  await renderReady(snapshot({ packages: [pkg()] }))
  await userEvent.click(screen.getByRole("button", { name: m.actions }))
  await userEvent.click(await screen.findByRole("menuitem", { name: m.changePin }))
  const field = screen.getByRole("textbox", { name: m.changePin })

  await userEvent.clear(field)
  await userEvent.type(field, "https://user:token@github.com/o/r.git")

  expect(field).toHaveAttribute("aria-invalid", "true")
  expect(screen.getByText(m.sourceUnsafe)).toBeInTheDocument()
  expect(screen.getByRole("button", { name: m.changePinApply })).toBeDisabled()
  expect(screen.queryByText(m.permissionTitle)).not.toBeInTheDocument()
})

it("hides Update on a pinned package and keeps the repin route open", async () => {
  await renderReady(snapshot({ packages: [pkg({ pinned: true })] }))
  await userEvent.click(screen.getByRole("button", { name: m.actions }))
  expect(await screen.findByRole("menuitem", { name: m.changePin })).toBeInTheDocument()
  expect(screen.queryByRole("menuitem", { name: m.update })).not.toBeInTheDocument()
})

it("switches a single resource path from the package dialog", async () => {
  await renderReady(snapshot({ packages: [pkg()] }))
  await userEvent.click(screen.getByRole("button", { name: m.openPackage("demo-pkg") }))
  const dialog = await screen.findByRole("dialog")
  expect(within(dialog).getByText(m.detailSource)).toBeInTheDocument()
  await userEvent.click(within(dialog).getByRole("switch", { name: "skills/a.md" }))
  await waitFor(() => expect(run).toHaveBeenCalled())
  expect(staged[0][0]).toMatchObject({ kind: "mergeFile" })
  await rescanned()
})

it("says a declared glob cannot be switched rather than rendering a dead control", async () => {
  await renderReady(
    snapshot({
      packages: [
        pkg({
          resources: {
            extensions: resource({ declared: ["ext/*.js"] }),
            skills: resource(),
            prompts: resource(),
            themes: resource(),
          },
        }),
      ],
    })
  )
  await userEvent.click(screen.getByRole("button", { name: m.openPackage("demo-pkg") }))
  const dialog = await screen.findByRole("dialog")
  expect(within(dialog).getByText(m.detailGlobOnly)).toBeInTheDocument()
  expect(within(dialog).queryByRole("switch", { name: "ext/*.js" })).not.toBeInTheDocument()
})

it("still opens a package that declares no resources at all", async () => {
  await renderReady(
    snapshot({
      packages: [
        pkg({
          resources: {
            extensions: resource(),
            skills: resource(),
            prompts: resource(),
            themes: resource(),
          },
        }),
      ],
    })
  )
  expect(screen.queryByRole("group", { name: "demo-pkg" })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: m.openPackage("demo-pkg") }))
  const dialog = await screen.findByRole("dialog")
  expect(within(dialog).getAllByText(m.detailNoPaths)).toHaveLength(4)
})

// --- find packages ----------------------------------------------------------

it("refuses a credential-bearing source before the permission dialog opens", async () => {
  await renderReady()
  await openView(m.tabBrowse)
  const field = screen.getByRole("textbox", { name: m.addSource })
  await userEvent.type(field, "https://user:token@github.com/o/r.git")
  expect(screen.getByText(m.sourceUnsafe)).toBeInTheDocument()
  expect(screen.getByRole("button", { name: m.install })).toBeDisabled()
})

it("installs a named source through the gate", async () => {
  await renderReady()
  await openView(m.tabBrowse)
  await userEvent.type(screen.getByRole("textbox", { name: m.addSource }), "demo-pkg")
  await userEvent.click(screen.getByRole("button", { name: m.install }))
  await userEvent.click(screen.getByRole("button", { name: m.approve }))
  await waitFor(() => expect(run).toHaveBeenCalled())
  expect(staged[0][0]).toMatchObject({ command: { file: "pi", args: ["install", "demo-pkg"] } })
  await rescanned()
})

it("marks a search result that this scope already has", async () => {
  const item: PiPackageSearchItem = {
    source: "demo-pkg",
    name: "demo-pkg",
    version: "1.2.0",
    description: "A demo package",
    publisher: "someone",
    license: "MIT",
    resources: ["skills"],
  }
  ;(piPackageSearch as jest.Mock).mockResolvedValue([
    item,
    { ...item, source: "other-pkg", name: "other-pkg" },
  ])
  await renderReady(snapshot({ packages: [pkg({ source: "demo-pkg" })] }))
  await openView(m.tabBrowse)
  expect(screen.getByText(m.searchPrompt)).toBeInTheDocument()
  await userEvent.type(screen.getByRole("textbox", { name: m.browse }), "demo{Enter}")
  await waitFor(() => expect(piPackageSearch).toHaveBeenCalledWith("demo"))
  const results = screen.getByRole("list", { name: m.resultsLabel })
  expect(within(results).getByText(m.alreadyInstalled)).toBeInTheDocument()
  const buttons = within(results).getAllByRole("button", { name: m.install })
  expect(buttons[0]).toBeDisabled()
  expect(buttons[1]).toBeEnabled()
})

it("reports an empty npm search as empty only after one has run", async () => {
  ;(piPackageSearch as jest.Mock).mockResolvedValue([])
  await renderReady()
  await openView(m.tabBrowse)
  await userEvent.type(screen.getByRole("textbox", { name: m.browse }), "zzz")
  await userEvent.click(screen.getByRole("button", { name: m.search }))
  await waitFor(() => expect(screen.getByText(m.noResults)).toBeInTheDocument())
})

// --- authentication ---------------------------------------------------------

it("uses no-refresh for automatic auth status and refreshes only on click", async () => {
  ;(piAuthStatus as jest.Mock).mockResolvedValue({
    installed: true,
    providers: [{ provider: "anthropic", status: "valid", source: "authFile", authType: "oauth" }],
  })
  await renderReady()
  await openView(m.tabAuth)
  await waitFor(() => expect(piAuthStatus).toHaveBeenCalledWith(false))
  const list = screen.getByRole("list", { name: m.providersLabel })
  expect(within(list).getByText("anthropic")).toBeInTheDocument()
  expect(within(list).getByText(m.authStatuses.valid)).toBeInTheDocument()
  expect(within(list).getByText(m.authTypes.oauth)).toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: m.refreshAuth }))
  await waitFor(() => expect(piAuthStatus).toHaveBeenCalledWith(true))
  expect(piPackageSearch).not.toHaveBeenCalled()
})

it("tells someone with no providers what to do instead of an empty header row", async () => {
  await renderReady()
  await openView(m.tabAuth)
  await waitFor(() => expect(piAuthStatus).toHaveBeenCalled())
  expect(screen.getByText(m.noProviders)).toBeInTheDocument()
})

it("hands log in and log out to Pi's own flow", async () => {
  const { launchPiInteractive } = jest.requireMock("@/lib/tauri/commands")
  await renderReady()
  await openView(m.tabAuth)
  await userEvent.click(screen.getByRole("button", { name: m.login }))
  await waitFor(() => expect(launchPiInteractive).toHaveBeenCalledWith(null))
})

// --- session folders --------------------------------------------------------

it("persists an explicitly selected additional Pi session folder", async () => {
  ;(pickFolder as jest.Mock).mockResolvedValue("/history/pi-extra")
  await renderReady()
  await openView(m.tabSessions)
  expect(screen.getByText(m.noSessionFolders)).toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: m.addSessionFolder }))
  await waitFor(() => expect(piSessionDirsSet).toHaveBeenCalledWith(["/history/pi-extra"]))
})

it("removes a session folder it was given", async () => {
  ;(piSessionDirsGet as jest.Mock).mockResolvedValue(["/history/pi-extra"])
  await renderReady()
  await openView(m.tabSessions)
  const list = await screen.findByRole("list", { name: m.sessionFoldersLabel })
  await userEvent.click(within(list).getByRole("button", { name: m.remove }))
  await waitFor(() => expect(piSessionDirsSet).toHaveBeenCalledWith([]))
})

it("says it is still reading rather than that the scope is empty", async () => {
  useAppStore.setState({ detections: { pi: { installed: true, version: "0.84.4" } } })
  ;(piManagementScan as jest.Mock).mockReturnValue(new Promise(() => {}))
  renderPi()
  expect(await screen.findByText(m.loading)).toBeInTheDocument()
  expect(screen.getByText(m.statPending)).toBeInTheDocument()
  expect(screen.queryByText(m.noPackages)).not.toBeInTheDocument()
})

it("says a failed scan failed, with a rescan, rather than that the scope is empty", async () => {
  useAppStore.setState({ detections: { pi: { installed: true, version: "0.84.4" } } })
  ;(piManagementScan as jest.Mock).mockRejectedValueOnce(new Error("pi: permission denied"))
  renderPi()
  const detail = within(await screen.findByRole("region", { name: m.detailPanel }))
  expect(await detail.findByText(m.scanFailed("Error: pi: permission denied"))).toBeInTheDocument()
  expect(screen.queryByText(m.loading)).not.toBeInTheDocument()
  // Nothing was read, so nothing may be stated about what is configured.
  expect(screen.queryByText(m.noPackages)).not.toBeInTheDocument()

  ;(piManagementScan as jest.Mock).mockResolvedValue(snapshot({ packages: [pkg()] }))
  await userEvent.click(detail.getByRole("button", { name: m.refresh }))
  expect(await screen.findByText("demo-pkg")).toBeInTheDocument()
})

it("scans a typed project folder once it is entered, not on every keystroke", async () => {
  await renderReady()
  ;(piManagementScan as jest.Mock).mockClear()
  await userEvent.click(scopeBar().getByRole("button", { name: m.projectScope }))
  const field = scopeBar().getByRole("combobox", { name: m.projectFolder })
  await userEvent.type(field, "/typed")
  // "/t", "/ty", … are not folders anyone chose.
  expect(piManagementScan).not.toHaveBeenCalled()
  await userEvent.keyboard("{Enter}")
  await waitFor(() =>
    expect(piManagementScan).toHaveBeenCalledWith({ kind: "project", cwd: "/typed" })
  )
  expect(piManagementScan).toHaveBeenCalledTimes(1)
})

it("says a typed folder is not there, beside the field, without a toast", async () => {
  await renderReady()
  ;(piManagementScan as jest.Mock).mockImplementation(async (scope: { kind: string }) => {
    if (scope.kind === "project") throw "project directory does not exist: /nope"
    return snapshot()
  })
  ;(pathExists as jest.Mock).mockResolvedValue(false)
  await userEvent.click(scopeBar().getByRole("button", { name: m.projectScope }))
  const field = scopeBar().getByRole("combobox", { name: m.projectFolder })
  await userEvent.type(field, "/nope")
  fireEvent.blur(field)
  expect(await scopeBar().findByText(m.projectFolderMissing("/nope"))).toBeInTheDocument()
  expect(field).toHaveAttribute("aria-invalid", "true")
  expect(screen.getByText(m.noProjectChosen)).toBeInTheDocument()
  expect(toast.error).not.toHaveBeenCalled()
})

it("keeps installs off in Project scope until the folder has been read", async () => {
  const item: PiPackageSearchItem = {
    source: "demo-pkg",
    name: "demo-pkg",
    version: "1.2.0",
    description: "",
    publisher: "someone",
    license: "MIT",
    resources: ["skills"],
  }
  ;(piPackageSearch as jest.Mock).mockResolvedValue([item])
  await renderReady()
  await userEvent.click(scopeBar().getByRole("button", { name: m.projectScope }))
  await openView(m.tabBrowse)
  const detail = within(screen.getByRole("region", { name: m.detailPanel }))
  // With no folder an install ran with an empty cwd — in whatever folder the
  // app was started from — and the dialog quoted "/.pi/settings.json".
  expect(detail.getByText(m.projectNeeded)).toBeInTheDocument()
  await userEvent.type(screen.getByRole("textbox", { name: m.addSource }), "demo-pkg")
  expect(detail.getByRole("button", { name: m.install })).toBeDisabled()
  await userEvent.type(screen.getByRole("textbox", { name: m.browse }), "demo{Enter}")
  const results = await screen.findByRole("list", { name: m.resultsLabel })
  expect(within(results).getByRole("button", { name: m.install })).toBeDisabled()

  // A folder that reads unlocks it, and the gate names the project's file.
  ;(piManagementScan as jest.Mock).mockResolvedValue(
    snapshot({ scope: "project", cwd: "/picked", settingsPath: "/picked/.pi/settings.json" })
  )
  ;(pickFolder as jest.Mock).mockResolvedValue("/picked")
  await userEvent.click(scopeBar().getByRole("button", { name: m.chooseFolder }))
  const install = within(results).getByRole("button", { name: m.install })
  await waitFor(() => expect(install).toBeEnabled())
  await userEvent.click(install)
  expect(
    screen.getByText(m.permissionBody("demo-pkg", "/picked/.pi/settings.json"))
  ).toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: m.approve }))
  await waitFor(() => expect(run).toHaveBeenCalled())
  expect(staged[0][0]).toMatchObject({
    command: { file: "pi", args: ["install", "demo-pkg", "-l", "--approve"], cwd: "/picked" },
  })
})

it("re-reads the scope after any real run, a retry in the review panel included", async () => {
  await renderReady()
  ;(piManagementScan as jest.Mock).mockClear()
  // What the runner does when a retry batch finishes: no caller's run() resolves.
  act(() => afterRun.forEach((fn) => fn()))
  await waitFor(() => expect(piManagementScan).toHaveBeenCalledWith({ kind: "global" }))
})

it("does not search on Enter with nothing typed", async () => {
  await renderReady()
  await openView(m.tabBrowse)
  await userEvent.type(screen.getByRole("textbox", { name: m.browse }), "   {Enter}")
  expect(piPackageSearch).not.toHaveBeenCalled()
})

it("says it is reading authentication rather than that there are no providers", async () => {
  ;(piAuthStatus as jest.Mock).mockReturnValue(new Promise(() => {}))
  await renderReady()
  await openView(m.tabAuth)
  expect(screen.getByText(m.authReading)).toBeInTheDocument()
  expect(screen.queryByText(m.noProviders)).not.toBeInTheDocument()
})

it("says the authentication read failed, with the reason and a retry", async () => {
  ;(piAuthStatus as jest.Mock).mockRejectedValueOnce("pi: auth.json unreadable")
  await renderReady()
  await openView(m.tabAuth)
  expect(await screen.findByText(m.authReadFailed("pi: auth.json unreadable"))).toBeInTheDocument()
  expect(screen.queryByText(m.noProviders)).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: m.retry }))
  expect(await screen.findByText(m.noProviders)).toBeInTheDocument()
})

it("opens Pi even when the clipboard refuses, and says what to type", async () => {
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: { writeText: jest.fn(async () => Promise.reject(new Error("denied"))) },
  })
  try {
    await renderReady()
    await openView(m.tabAuth)
    await userEvent.click(screen.getByRole("button", { name: m.login }))
    await waitFor(() => expect(launchPiInteractive).toHaveBeenCalledWith(null))
    expect(toast.info).toHaveBeenCalledWith(m.typeCommand("/login"), expect.anything())
  } finally {
    Object.defineProperty(window.navigator, "clipboard", { configurable: true, value: undefined })
  }
})

it("names a terminal that failed to open instead of promising one", async () => {
  ;(launchPiInteractive as jest.Mock).mockRejectedValueOnce("command not found: pi")
  await renderReady()
  await openView(m.tabAuth)
  await userEvent.click(screen.getByRole("button", { name: m.logout }))
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(m.launchFailed("command not found: pi"))
  )
  expect(toast.info).not.toHaveBeenCalled()
})

it("says why a file switch is off while its whole kind is", async () => {
  await renderReady(
    snapshot({
      packages: [
        pkg({
          resources: {
            extensions: resource(),
            skills: resource({ enabled: false, declared: ["skills/a.md"] }),
            prompts: resource(),
            themes: resource(),
          },
        }),
      ],
    })
  )
  await userEvent.click(screen.getByRole("button", { name: m.openPackage("demo-pkg") }))
  const dialog = await screen.findByRole("dialog")
  expect(within(dialog).getByText(m.detailKindOff)).toBeInTheDocument()
  expect(within(dialog).getByRole("switch", { name: "skills/a.md" })).toBeDisabled()
})

it("keeps a cancelled folder pick from changing the scope", async () => {
  ;(pickFolder as jest.Mock).mockResolvedValue(null)
  await renderReady()
  await userEvent.click(scopeBar().getByRole("button", { name: m.projectScope }))
  await userEvent.click(scopeBar().getByRole("button", { name: m.chooseFolder }))
  expect(screen.getByText(m.noProjectChosen)).toBeInTheDocument()
  expect(localStorage.getItem("agentpack.pi.projects")).toBeNull()
})

it("sorts by resources and can drop the inherited rows", async () => {
  await renderReady(
    snapshot({
      packages: [
        pkg({ source: "a@1", identity: "a-pkg" }),
        pkg({
          source: "b@1",
          identity: "b-pkg",
          inherited: true,
          resources: {
            extensions: resource({ declared: ["v.js", "w.js", "x.js", "y.js", "z.js"] }),
            skills: resource(),
            prompts: resource(),
            themes: resource(),
          },
        }),
      ],
    })
  )
  const rowNames = () =>
    within(screen.getByRole("list", { name: m.packagesListLabel }))
      .getAllByRole("listitem")
      .map((row) => row.textContent ?? "")

  expect(rowNames()[0]).toContain("a-pkg")
  await userEvent.click(screen.getByRole("button", { name: m.filtersLabel }))
  const sort = await screen.findByRole("combobox", { name: m.sortLabel })
  await userEvent.click(sort)
  await userEvent.click(await screen.findByRole("option", { name: m.sortResources }))
  await waitFor(() => expect(rowNames()[0]).toContain("b-pkg"))

  await userEvent.click(screen.getByRole("switch", { name: m.showInherited }))
  await waitFor(() => expect(rowNames()).toHaveLength(1))
  expect(rowNames()[0]).toContain("a-pkg")
})

it("switches a whole resource kind from the package dialog", async () => {
  await renderReady(snapshot({ packages: [pkg()] }))
  await userEvent.click(screen.getByRole("button", { name: m.openPackage("demo-pkg") }))
  const dialog = await screen.findByRole("dialog")
  await userEvent.click(within(dialog).getByRole("switch", { name: m.resources.skills }))
  await waitFor(() => expect(run).toHaveBeenCalled())
  expect(staged[0][0]).toMatchObject({ kind: "mergeFile" })
  await rescanned()
})

it("opens the gallery and a result's repository in the browser", async () => {
  const { openUrl } = jest.requireMock("@/lib/tauri/system")
  ;(piPackageSearch as jest.Mock).mockResolvedValue([
    {
      source: "repo-pkg",
      name: "repo-pkg",
      version: "0.1.0",
      description: "",
      publisher: "someone",
      license: "",
      repository: "https://github.com/o/r",
      publishedAt: 1700000000000,
      resources: [],
    },
  ])
  await renderReady()
  await openView(m.tabBrowse)
  await userEvent.click(screen.getByRole("button", { name: m.gallery }))
  expect(openUrl).toHaveBeenCalledWith("https://pi.dev/packages")
  await userEvent.type(screen.getByRole("textbox", { name: m.browse }), "repo{Enter}")
  const results = await screen.findByRole("list", { name: m.resultsLabel })
  await userEvent.click(within(results).getByRole("button", { name: "https://github.com/o/r" }))
  expect(openUrl).toHaveBeenCalledWith("https://github.com/o/r")
})

it("colours each provider by what Pi reported, and shows its reason", async () => {
  ;(piAuthStatus as jest.Mock).mockResolvedValue({
    installed: true,
    providers: [
      { provider: "gone", status: "missing", source: "settings" },
      { provider: "stale", status: "expired", source: "authFile", expiresAt: 1700000000000 },
      { provider: "odd", status: "something-else", source: "nowhere", reason: "unrecognised" },
    ],
  })
  await renderReady()
  await openView(m.tabAuth)
  const list = await screen.findByRole("list", { name: m.providersLabel })
  expect(within(list).getByText(m.authStatuses.missing)).toBeInTheDocument()
  expect(within(list).getByText(m.authStatuses.expired)).toBeInTheDocument()
  expect(within(list).getAllByText(m.unknown).length).toBeGreaterThan(0)
  expect(within(list).getByText("unrecognised")).toBeInTheDocument()
})

it("logs out through Pi in the project it is scoped to", async () => {
  const { launchPiInteractive } = jest.requireMock("@/lib/tauri/commands")
  ;(pickFolder as jest.Mock).mockResolvedValue("/picked")
  await renderReady()
  await userEvent.click(scopeBar().getByRole("button", { name: m.projectScope }))
  await userEvent.click(scopeBar().getByRole("button", { name: m.chooseFolder }))
  await openView(m.tabAuth)
  await userEvent.click(screen.getByRole("button", { name: m.logout }))
  await waitFor(() => expect(launchPiInteractive).toHaveBeenCalledWith("/picked"))
})

it("updates one package and says so when a package loads nothing", async () => {
  await renderReady(
    snapshot({
      packages: [
        pkg({
          resources: {
            extensions: resource({ enabled: false, declared: ["ext/one.js"] }),
            skills: resource({ enabled: false, declared: ["skills/a.md"] }),
            prompts: resource(),
            themes: resource(),
          },
        }),
      ],
    })
  )
  expect(screen.getByText(m.resourcesOff)).toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: m.actions }))
  await userEvent.click(await screen.findByRole("menuitem", { name: m.update }))
  await userEvent.click(screen.getByRole("button", { name: m.approve }))
  await waitFor(() => expect(run).toHaveBeenCalled())
  expect(staged[0][0]).toMatchObject({
    command: { file: "pi", args: ["update", "--extension", "demo-pkg@1.2.0"] },
  })
  await rescanned()
})

it("puts the refinements back where it found them", async () => {
  await renderReady(snapshot({ packages: [pkg(), pkg({ source: "b@1", identity: "b-pkg" })] }))
  await userEvent.click(screen.getByRole("button", { name: m.filtersLabel }))
  await userEvent.click(await screen.findByRole("switch", { name: m.showInherited }))
  expect(screen.getByRole("button", { name: `${m.filtersLabel} 1` })).toBeInTheDocument()
  await userEvent.click(await screen.findByRole("button", { name: m.filtersReset }))
  expect(screen.getByRole("button", { name: m.filtersLabel })).toBeInTheDocument()
})
