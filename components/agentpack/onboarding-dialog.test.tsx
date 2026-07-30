jest.mock("@/lib/tauri", () => ({ isTauri: () => true }))
jest.mock("@/lib/tauri/settings", () => ({ saveSettings: jest.fn(async () => ({})) }))

import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import type { NetworkProbeResult } from "@/lib/agentpack/network/probe"
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
  useAppStore.setState({ dryRun: false })
  useAppStore.getState().resetPlan()
  useAppStore.setState((s) => ({ plan: { ...s.plan, network: {} } }))
  useAppStore.getState().setNetworkProbe(healthyProbe)
  useAppStore.getState().setNetworkProbing(false)
})

function renderDialog(overrides: Partial<React.ComponentProps<typeof OnboardingDialog>> = {}) {
  const onInstall = jest.fn()
  const onDismiss = jest.fn()
  const onTour = jest.fn()
  render(
    <I18nProvider>
      <OnboardingDialog
        open
        onInstall={onInstall}
        onDismiss={onDismiss}
        onTour={onTour}
        {...overrides}
      />
    </I18nProvider>
  )
  return { onInstall, onDismiss, onTour }
}

/** Walk from the intro to the final step, where Install lives. */
const goToInstall = async () => {
  await userEvent.click(screen.getByRole("button", { name: en.nav.continue }))
  await userEvent.click(screen.getByRole("button", { name: en.nav.continue }))
}

describe("step 1 — intro", () => {
  it("greets a newcomer with the plain-language rundown and preset choices", () => {
    renderDialog()
    expect(screen.getByRole("heading", { name: en.welcome.title })).toBeInTheDocument()
    expect(screen.getByText(en.welcome.whatClis)).toBeInTheDocument()
    expect(screen.getByText(en.welcome.whatCcswitch)).toBeInTheDocument()
    // One radio per preset bundle (minimal / recommended / everything).
    expect(screen.getAllByRole("radio")).toHaveLength(3)
    expect(screen.getByText(en.tour.progress(1, 3))).toBeInTheDocument()
  })

  it("defaults to the Recommended bundle", () => {
    renderDialog()
    // PRESETS order is minimal, recommended, everything — recommended is index 1.
    expect(screen.getAllByRole("radio")[1]).toBeChecked()
  })

  it("has no Back button on the first step", () => {
    renderDialog()
    expect(screen.queryByRole("button", { name: en.tour.back })).not.toBeInTheDocument()
  })
})

describe("step 2 — network self-check", () => {
  it("reports a healthy network and offers nothing to change", async () => {
    renderDialog()
    await userEvent.click(screen.getByRole("button", { name: en.nav.continue }))

    expect(screen.getByText(en.network.probe.directOk)).toBeInTheDocument()
    expect(screen.getByText(en.network.probe.nothingToDo)).toBeInTheDocument()
    // A working setup is never nudged into settings it doesn't need.
    expect(screen.queryByRole("button", { name: en.network.probe.adopt })).not.toBeInTheDocument()
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
    await userEvent.click(screen.getByRole("button", { name: en.nav.continue }))

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
    await userEvent.click(screen.getByRole("button", { name: en.nav.continue }))
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
    await userEvent.click(screen.getByRole("button", { name: en.nav.continue }))
    expect(screen.getByText(en.network.probe.running)).toBeInTheDocument()
  })

  it("can be stepped back out of", async () => {
    renderDialog()
    await userEvent.click(screen.getByRole("button", { name: en.nav.continue }))
    await userEvent.click(screen.getByRole("button", { name: en.tour.back }))
    expect(screen.getAllByRole("radio")).toHaveLength(3)
  })
})

describe("step 3 — install", () => {
  it("installs the default (recommended) bundle on click", async () => {
    const { onInstall } = renderDialog()
    await goToInstall()
    await userEvent.click(screen.getByRole("button", { name: en.welcome.install }))
    expect(onInstall).toHaveBeenCalledWith("recommended")
  })

  it("installs the bundle the user picks, carried across the steps", async () => {
    const { onInstall } = renderDialog()
    await userEvent.click(screen.getAllByRole("radio")[2]) // "everything"
    await goToInstall()
    await userEvent.click(screen.getByRole("button", { name: en.welcome.install }))
    expect(onInstall).toHaveBeenCalledWith("everything")
  })

  it("turning on preview relabels Install and flips the shared dry-run flag", async () => {
    renderDialog()
    await goToInstall()
    await userEvent.click(screen.getByRole("switch"))
    expect(useAppStore.getState().dryRun).toBe(true)
    expect(screen.getByRole("button", { name: en.welcome.installPreview })).toBeInTheDocument()
  })
})

describe("exits", () => {
  it("dismisses via Maybe later", async () => {
    const { onDismiss } = renderDialog()
    await userEvent.click(screen.getByRole("button", { name: en.welcome.later }))
    expect(onDismiss).toHaveBeenCalled()
  })

  it("starts the guided tour from the wizard", async () => {
    const { onTour } = renderDialog()
    await userEvent.click(screen.getByRole("button", { name: `${en.tour.start} →` }))
    expect(onTour).toHaveBeenCalled()
  })

  it("dismisses when the dialog is closed with Escape", async () => {
    const { onDismiss } = renderDialog()
    await userEvent.keyboard("{Escape}")
    expect(onDismiss).toHaveBeenCalled()
  })

  it("renders nothing when closed", () => {
    renderDialog({ open: false })
    expect(screen.queryByText(en.welcome.title)).not.toBeInTheDocument()
  })

  // Guard against a stray second dialog implementation leaking the title twice.
  it("shows a single dialog", () => {
    renderDialog()
    const dialog = screen.getByRole("dialog")
    expect(within(dialog).getByRole("heading", { name: en.welcome.title })).toBeInTheDocument()
  })
})
