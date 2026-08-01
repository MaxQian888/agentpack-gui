jest.mock("@/lib/tauri", () => ({ isTauri: () => true }))
jest.mock("@/lib/tauri/settings", () => ({ saveSettings: jest.fn(async () => ({})) }))

import { act, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import type { NetworkProbeResult } from "@/lib/agentpack/network/probe"
import { SKILLS } from "@/lib/agentpack/registry"
import { useAppStore } from "@/store/app-store"
import { OnboardingDialog } from "./onboarding-dialog"

/** A probe result where the direct route works and no mirror beats the default. */
const healthyProbe: NetworkProbeResult = {
  proxies: [],
  bestProxy: null,
  directOk: true,
  npm: [],
  gh: [],
  pypi: [],
  brew: [],
  pacUrl: null,
}

beforeEach(() => {
  useAppStore.getState().resetPlan()
  useAppStore.setState((s) => ({ plan: { ...s.plan, network: {} } }))
  useAppStore.getState().setNetworkProbe(healthyProbe)
  useAppStore.getState().setNetworkProbing(false)
})

function renderDialog(overrides: Partial<React.ComponentProps<typeof OnboardingDialog>> = {}) {
  const onInstall = jest.fn()
  const onLater = jest.fn()
  const onSuspend = jest.fn()
  const onProgress = jest.fn()
  const onTour = jest.fn()
  render(
    <I18nProvider>
      <OnboardingDialog
        open
        progress={null}
        onProgress={onProgress}
        onInstall={onInstall}
        onLater={onLater}
        onSuspend={onSuspend}
        onTour={onTour}
        {...overrides}
      />
    </I18nProvider>
  )
  return { onInstall, onLater, onSuspend, onProgress, onTour }
}

const next = () => userEvent.click(screen.getByRole("button", { name: en.welcome.continue }))

/** Walk from the surface question to the final step, where Install lives. */
const goToInstall = async () => {
  await next() // surface -> bundle
  await next() // bundle -> install (healthy network: the check is skipped)
}

describe("step 1 — how do you want to use it", () => {
  it("leads with the surface question, not the bundle", () => {
    renderDialog()
    expect(screen.getByRole("heading", { name: en.welcome.title })).toBeInTheDocument()
    expect(screen.getByText(en.welcome.surfaceLabel)).toBeInTheDocument()
    // Window / terminal / both — the bundle radios come one step later.
    expect(screen.getAllByRole("radio")).toHaveLength(3)
    expect(screen.getByText(en.welcome.surfaceGui)).toBeInTheDocument()
  })

  it("still gives the plain-language rundown of what gets set up", () => {
    renderDialog()
    expect(screen.getByText(en.welcome.whatClis)).toBeInTheDocument()
    expect(screen.getByText(en.welcome.whatCcswitch)).toBeInTheDocument()
  })

  it("defaults to the desktop app — it needs no terminal and no Node", () => {
    renderDialog()
    expect(screen.getAllByRole("radio")[0]).toBeChecked()
  })

  it("has no Back button on the first step", () => {
    renderDialog()
    expect(screen.queryByRole("button", { name: en.tour.back })).not.toBeInTheDocument()
  })
})

describe("step 2 — which bundle", () => {
  it("asks for the bundle after the surface", async () => {
    renderDialog()
    await next()
    expect(screen.getByText(en.welcome.presetLabel)).toBeInTheDocument()
    expect(screen.getAllByRole("radio")).toHaveLength(3)
  })

  it("defaults to the Recommended bundle", async () => {
    renderDialog()
    await next()
    // PRESETS order is minimal, recommended, everything — recommended is index 1.
    expect(screen.getAllByRole("radio")[1]).toBeChecked()
  })
})

describe("step 3 — network self-check", () => {
  it("is skipped entirely when the probe found nothing to change", async () => {
    // A healthy machine should not be made to read green ticks and press
    // Continue — the step is dropped from the sequence, counter included.
    renderDialog()
    expect(screen.getByText(en.tour.progress(1, 3))).toBeInTheDocument()
    await next()
    await next()
    expect(screen.queryByText(en.network.probe.directOk)).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: en.welcome.install })).toBeInTheDocument()
  })

  it("surfaces a blocked network and the proxy it found", async () => {
    useAppStore.getState().setNetworkProbe({
      ...healthyProbe,
      directOk: false,
      bestProxy: {
        id: "port:clash",
        source: "port",
        url: "http://127.0.0.1:7890",
        detail: "Clash",
        result: { ok: true, status: 200, latencyMs: 62, reason: "ok" },
      },
    })
    renderDialog()
    // Four steps now that the check has something to say.
    expect(screen.getByText(en.tour.progress(1, 4))).toBeInTheDocument()
    await next()
    await next()

    expect(screen.getByText(en.network.probe.directBlocked)).toBeInTheDocument()
    expect(screen.getByText(en.network.probe.proxyFound("127.0.0.1:7890", 62))).toBeInTheDocument()
  })

  it("adopts the recommended proxy and mirror in one click", async () => {
    useAppStore.getState().setNetworkProbe({
      ...healthyProbe,
      directOk: false,
      bestProxy: {
        id: "port:clash",
        source: "port",
        url: "http://127.0.0.1:7890",
        detail: "Clash",
        result: { ok: true, status: 200, latencyMs: 62, reason: "ok" },
      },
      npm: [
        {
          preset: {
            id: "npmmirror",
            label: "npmmirror",
            url: "https://registry.npmmirror.com",
            probeUrl: "x",
          },
          result: { ok: true, status: 200, latencyMs: 30, reason: "ok" },
        },
      ],
    })
    renderDialog()
    await next()
    await next()
    await userEvent.click(screen.getByRole("button", { name: en.network.probe.adopt }))

    const plan = useAppStore.getState().plan
    expect(plan.network.proxy).toMatchObject({
      mode: "manual",
      httpUrl: "http://127.0.0.1:7890",
      httpsUrl: "http://127.0.0.1:7890",
    })
    expect(plan.network.npmRegistry).toBe("https://registry.npmmirror.com")
  })

  it("shows it is still working while the probe is in flight", async () => {
    useAppStore.getState().setNetworkProbe(null)
    useAppStore.getState().setNetworkProbing(true)
    renderDialog()
    await next()
    await next()
    // Still measuring: the step stays, rather than being skipped on a "no" that
    // hasn't been established yet.
    expect(screen.getByText(en.network.probe.running)).toBeInTheDocument()
  })

  it("can be stepped back out of", async () => {
    renderDialog()
    await next()
    await userEvent.click(screen.getByRole("button", { name: en.tour.back }))
    expect(screen.getByText(en.welcome.surfaceLabel)).toBeInTheDocument()
  })
})

describe("step 4 — install", () => {
  it("installs the defaults: the recommended bundle, in a window", async () => {
    const { onInstall } = renderDialog()
    await goToInstall()
    await userEvent.click(screen.getByRole("button", { name: en.welcome.install }))
    expect(onInstall).toHaveBeenCalledWith("recommended", "gui", {}, [])
  })

  it("carries both answers across the steps", async () => {
    const { onInstall } = renderDialog()
    await userEvent.click(screen.getAllByRole("radio")[1]) // terminal
    await next()
    await userEvent.click(screen.getAllByRole("radio")[2]) // "everything"
    await next()
    await userEvent.click(screen.getByRole("button", { name: en.welcome.install }))
    expect(onInstall).toHaveBeenCalledWith(
      "everything",
      "cli",
      {},
      SKILLS.map((sk) => sk.id)
    )
  })

  // The step used to render nothing at all: title, subtitle, Install button.
  it("shows what the bundle actually installs", async () => {
    renderDialog()
    await goToInstall()
    expect(screen.getByText(en.welcome.summaryClis)).toBeInTheDocument()
    // Recommended, in a window: the desktop apps plus cc-switch, and its servers.
    expect(screen.getByText(en.catalog.cli["claude-desktop"].title)).toBeInTheDocument()
    expect(screen.getByText(en.catalog.mcp.memory.title)).toBeInTheDocument()
    // A key-gated server is named twice on purpose — once in the list, once
    // labelling its key box — so the user knows which key goes where.
    expect(screen.getAllByText(en.catalog.mcp.context7.title)).toHaveLength(2)
    // Skills are always offered, ticked or not — the bundle can't know your stack.
    expect(screen.getByText(en.welcome.summarySkills)).toBeInTheDocument()
  })

  /**
   * The first screen promises "engineering skills" as one of the four things
   * agentpack sets up — and `minimal` and `recommended` carry none, so the
   * default path never delivered a single one. They're per-stack (Rust, Android,
   * STM32…), so the wizard offers them rather than picking for you.
   */
  it("offers every skill, unticked, on the bundles that carry none", async () => {
    renderDialog()
    await goToInstall()
    const boxes = SKILLS.map((sk) => screen.getByLabelText(en.catalog.skills[sk.id].title))
    expect(boxes).toHaveLength(SKILLS.length)
    for (const box of boxes) expect(box).not.toBeChecked()
  })

  it("pre-ticks the skills a bundle does carry", async () => {
    renderDialog()
    await next()
    await userEvent.click(screen.getAllByRole("radio")[2]) // "everything"
    await next()
    expect(screen.getByLabelText(en.catalog.skills.rust.title)).toBeChecked()
  })

  it("passes on the skills the user ticked", async () => {
    const { onInstall } = renderDialog()
    await goToInstall()
    await userEvent.click(screen.getByLabelText(en.catalog.skills.rust.title))
    await userEvent.click(screen.getByRole("button", { name: en.welcome.install }))
    expect(onInstall).toHaveBeenCalledWith("recommended", "gui", {}, ["rust"])
  })

  it("passes on an unticking of a skill the bundle had selected", async () => {
    const { onInstall } = renderDialog()
    await next()
    await userEvent.click(screen.getAllByRole("radio")[2]) // "everything"
    await next()
    await userEvent.click(screen.getByLabelText(en.catalog.skills.rust.title))
    await userEvent.click(screen.getByRole("button", { name: en.welcome.install }))
    const passed = onInstall.mock.calls[0]![3] as string[]
    expect(passed).not.toContain("rust")
    expect(passed).toHaveLength(SKILLS.length - 1)
  })

  // Going back and changing the bundle must re-seed, or the last step would show
  // the previous bundle's skills.
  it("re-seeds the skills when the bundle changes", async () => {
    renderDialog()
    await next()
    await userEvent.click(screen.getAllByRole("radio")[2]) // "everything" → all on
    await userEvent.click(screen.getAllByRole("radio")[0]) // "minimal" → none
    await next()
    expect(screen.getByLabelText(en.catalog.skills.rust.title)).not.toBeChecked()
  })

  it("marks what is already on the machine", async () => {
    useAppStore.setState({ detections: { "claude-desktop": { installed: true } } })
    renderDialog()
    await goToInstall()
    expect(screen.getAllByLabelText(en.welcome.summaryInstalled)).toHaveLength(1)
  })

  /**
   * context7 and github are both in the Recommended bundle and both key-gated.
   * Before this the wizard installed them without ever asking, so they went in
   * cleanly and then never worked.
   */
  it("asks for the API keys the chosen bundle needs, and passes them on", async () => {
    const { onInstall } = renderDialog()
    await goToInstall()
    await userEvent.type(screen.getByLabelText("context7 CONTEXT7_API_KEY"), "ctx-key")
    await userEvent.click(screen.getByRole("button", { name: en.welcome.install }))
    expect(onInstall).toHaveBeenCalledWith("recommended", "gui", { context7: "ctx-key" }, [])
  })

  it("drops keys the user left blank rather than writing an empty one", async () => {
    const { onInstall } = renderDialog()
    await goToInstall()
    await userEvent.type(screen.getByLabelText("context7 CONTEXT7_API_KEY"), "   ")
    await userEvent.click(screen.getByRole("button", { name: en.welcome.install }))
    expect(onInstall).toHaveBeenCalledWith("recommended", "gui", {}, [])
  })

  it("asks for no keys when the bundle selects no key-gated server", async () => {
    renderDialog()
    await next()
    await userEvent.click(screen.getAllByRole("radio")[0]) // minimal — memory only
    await next()
    expect(screen.queryByText(en.welcome.keysTitle)).not.toBeInTheDocument()
  })

  it("offers no preview toggle — that question belongs in the review panel", async () => {
    // As the first thing a newcomer is asked it only invites the wrong answer:
    // they preview, see every step report it *would* have run, and conclude the
    // install failed. Preview now lives next to the step list it previews.
    renderDialog()
    await goToInstall()
    expect(screen.queryByRole("switch")).not.toBeInTheDocument()
  })
})

describe("exits", () => {
  // The two exits are not interchangeable: "Maybe later" is the user declining,
  // Escape is a mis-click. Only the former should ever mark someone onboarded.
  it("declines deliberately via Maybe later", async () => {
    const { onLater, onSuspend } = renderDialog()
    await userEvent.click(screen.getByRole("button", { name: en.welcome.later }))
    expect(onLater).toHaveBeenCalled()
    expect(onSuspend).not.toHaveBeenCalled()
  })

  it("starts the guided tour from the wizard", async () => {
    const { onTour } = renderDialog()
    await userEvent.click(screen.getByRole("button", { name: `${en.tour.start} →` }))
    expect(onTour).toHaveBeenCalled()
  })

  it("only suspends when the dialog is closed with Escape", async () => {
    const { onLater, onSuspend } = renderDialog()
    await userEvent.keyboard("{Escape}")
    expect(onSuspend).toHaveBeenCalled()
    expect(onLater).not.toHaveBeenCalled()
  })

  it("renders nothing when closed", () => {
    renderDialog({ open: false })
    expect(screen.queryByText(en.welcome.title)).not.toBeInTheDocument()
  })

  it("reports every answer so a suspended wizard can be resumed", async () => {
    const { onProgress } = renderDialog()
    await userEvent.click(screen.getByLabelText(en.welcome.surfaceCli, { exact: false }))
    expect(onProgress).toHaveBeenLastCalledWith({
      step: "surface",
      preset: "recommended",
      surface: "cli",
    })
    await next()
    expect(onProgress).toHaveBeenLastCalledWith({
      step: "bundle",
      preset: "recommended",
      surface: "cli",
    })
  })
})

describe("resuming a suspended wizard", () => {
  it("starts on the saved step with the saved answers", () => {
    renderDialog({ progress: { step: "bundle", preset: "everything", surface: "cli" } })
    expect(screen.getByText(en.welcome.presetLabel)).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: /everything/i })).toBeChecked()
  })

  it("falls back to the first step when the saved step is unrecognised", () => {
    renderDialog({ progress: { step: "not-a-step", preset: "minimal", surface: "gui" } })
    expect(screen.getByText(en.welcome.surfaceLabel)).toBeInTheDocument()
  })

  // The network step drops out once a late probe reports a healthy network. The
  // user must not be thrown back to question 1 with their answers half re-asked.
  it("falls back to the LAST step when the current one vanishes", async () => {
    useAppStore.getState().setNetworkProbing(true)
    renderDialog({ progress: { step: "network", preset: "minimal", surface: "gui" } })
    expect(screen.getByText(en.tour.progress(3, 4))).toBeInTheDocument()

    // The probe lands healthy, so `network` leaves the sequence under the user.
    await act(async () => {
      useAppStore.getState().setNetworkProbing(false)
    })
    // `install` is the last step — not `surface`, which is where clamping -1 lands.
    expect(screen.getByText(en.welcome.installIntro)).toBeInTheDocument()
    expect(screen.getByText(en.tour.progress(3, 3))).toBeInTheDocument()
  })

  // Guard against a stray second dialog implementation leaking the title twice.
  it("shows a single dialog", () => {
    renderDialog()
    const dialog = screen.getByRole("dialog")
    expect(within(dialog).getByRole("heading", { name: en.welcome.title })).toBeInTheDocument()
  })
})

/**
 * Adopt writes a proxy, an npm registry and a GitHub mirror prefix. PyPI and
 * Homebrew mirrors are env vars agentpack only injects into a failed step's
 * retry — there is nothing to write — so listing all four identically under one
 * button put two of them in a promise the button doesn't keep.
 */
describe("the network step's adopt promise", () => {
  const withMirrors = (over: Partial<NetworkProbeResult> = {}): NetworkProbeResult => ({
    ...healthyProbe,
    directOk: false,
    bestProxy: {
      id: "port:clash",
      source: "port",
      url: "http://127.0.0.1:7890",
      detail: "Clash",
      result: { ok: true, status: 200, latencyMs: 62, reason: "ok" },
    },
    pypi: [
      {
        preset: {
          id: "tuna",
          label: "TUNA",
          url: "https://pypi.tuna.example/simple",
          probeUrl: "x",
        },
        result: { ok: true, status: 200, latencyMs: 20, reason: "ok" },
      },
    ],
    ...over,
  })

  it("marks the mirrors Adopt cannot apply", async () => {
    useAppStore.getState().setNetworkProbe(withMirrors())
    renderDialog()
    await next()
    await next()
    expect(screen.getByText(en.network.probe.fastestMirror("PyPI", "TUNA"))).toBeInTheDocument()
    expect(screen.getByText(new RegExp(en.network.probe.retryOnly))).toBeInTheDocument()
  })

  it("does not mark an npm mirror retry-only — Adopt really does write that one", async () => {
    useAppStore.getState().setNetworkProbe(
      withMirrors({
        npm: [
          {
            preset: {
              id: "npmmirror",
              label: "npmmirror",
              url: "https://r.example",
              probeUrl: "x",
            },
            result: { ok: true, status: 200, latencyMs: 30, reason: "ok" },
          },
        ],
        pypi: [],
      })
    )
    renderDialog()
    await next()
    await next()
    expect(screen.queryByText(new RegExp(en.network.probe.retryOnly))).not.toBeInTheDocument()
  })

  // The old check only looked at npm and the proxy, so a GitHub-only suggestion
  // left the button live forever and every further click re-applied it.
  it("reads as adopted once a GitHub-only suggestion has been taken", async () => {
    useAppStore.getState().setNetworkProbe({
      ...healthyProbe,
      gh: [
        {
          preset: { id: "ghproxy", label: "gh-proxy", url: "https://gh.example/", probeUrl: "x" },
          result: { ok: true, status: 200, latencyMs: 20, reason: "ok" },
        },
      ],
    })
    renderDialog()
    await next()
    await next()
    const adopt = screen.getByRole("button", { name: en.network.probe.adopt })
    await userEvent.click(adopt)
    expect(await screen.findByRole("button", { name: en.network.probe.adopted })).toBeDisabled()
  })
})
