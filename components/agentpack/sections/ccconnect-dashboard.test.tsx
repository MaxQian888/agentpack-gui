import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { CcConnectDashboardFrame } from "./ccconnect-dashboard"
import { en } from "@/lib/i18n/en"

const URL_WITH_TOKEN = "http://localhost:9820/login?token=secret"

function renderFrame(overrides: Partial<Parameters<typeof CcConnectDashboardFrame>[0]> = {}) {
  const onOpenChange = jest.fn()
  const onOpenExternal = jest.fn()
  render(
    <I18nProvider>
      <CcConnectDashboardFrame
        open
        onOpenChange={onOpenChange}
        url={URL_WITH_TOKEN}
        displayUrl="http://localhost:9820"
        onOpenExternal={onOpenExternal}
        {...overrides}
      />
    </I18nProvider>
  )
  return { onOpenChange, onOpenExternal }
}

const frame = () => document.querySelector("iframe")

it("shows a loading state until the frame reports it loaded", async () => {
  renderFrame()
  expect(screen.getByText(en.ccconnect.embedLoading)).toBeInTheDocument()
  act(() => {
    frame()!.dispatchEvent(new Event("load"))
  })
  await waitFor(() => expect(screen.queryByText(en.ccconnect.embedLoading)).not.toBeInTheDocument())
})

it("offers reload and the browser once a frame has stayed blank too long", async () => {
  jest.useFakeTimers()
  try {
    renderFrame()
    expect(screen.getByText(en.ccconnect.embedLoading)).toBeInTheDocument()
    // Nothing has loaded; the overlay turns from "loading" into a way out.
    act(() => {
      jest.advanceTimersByTime(9000)
    })
    expect(screen.getByText(en.ccconnect.embedStalled)).toBeInTheDocument()
    expect(screen.queryByText(en.ccconnect.embedLoading)).not.toBeInTheDocument()
    // Both escape hatches are reachable from the overlay itself, not just the
    // toolbar behind it.
    expect(screen.getAllByRole("button", { name: en.ccconnect.embedReload })).toHaveLength(2)
    expect(screen.getAllByRole("button", { name: en.ccconnect.embedExternal })).toHaveLength(2)
  } finally {
    jest.useRealTimers()
  }
})

it("a load that arrives late still clears the stalled overlay", async () => {
  jest.useFakeTimers()
  try {
    renderFrame()
    act(() => {
      jest.advanceTimersByTime(9000)
    })
    expect(screen.getByText(en.ccconnect.embedStalled)).toBeInTheDocument()
    act(() => {
      frame()!.dispatchEvent(new Event("load"))
    })
    expect(screen.queryByText(en.ccconnect.embedStalled)).not.toBeInTheDocument()
  } finally {
    jest.useRealTimers()
  }
})

it("reloading from the stalled overlay restarts the load state", async () => {
  jest.useFakeTimers()
  try {
    renderFrame()
    act(() => {
      jest.advanceTimersByTime(9000)
    })
    const before = frame()
    const [overlayReload] = screen
      .getAllByRole("button", { name: en.ccconnect.embedReload })
      .slice(-1)
    act(() => {
      overlayReload.click()
    })
    // A fresh element, and the countdown starts over rather than staying stalled.
    expect(frame()).not.toBe(before)
    expect(screen.getByText(en.ccconnect.embedLoading)).toBeInTheDocument()
  } finally {
    jest.useRealTimers()
  }
})

it("closes through onOpenChange rather than hiding itself", async () => {
  const { onOpenChange } = renderFrame()
  await userEvent.click(screen.getByRole("button", { name: en.ccconnect.embedClose }))
  expect(onOpenChange).toHaveBeenCalledWith(false)
})

it("keeps the token out of the visible chrome", () => {
  renderFrame()
  expect(frame()).toHaveAttribute("src", URL_WITH_TOKEN)
  expect(document.body.textContent).not.toContain("secret")
})
