jest.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light", setTheme: mockSetTheme }),
}))
const mockSetTheme = jest.fn()

import { useState } from "react"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import { CommandPalette, useCommandShortcut, type PaletteHandlers } from "./command-palette"

function handlers(): PaletteHandlers {
  return {
    navigate: jest.fn(),
    quickConfig: jest.fn(),
    rescan: jest.fn(),
    review: jest.fn(),
    onboarding: jest.fn(),
    updates: jest.fn(),
  }
}

/**
 * The palette as the shell mounts it: a trigger that opens it, so focus
 * restoration has somewhere real to return to.
 */
function Harness({ h, pending = 0 }: { h: PaletteHandlers; pending?: number }) {
  const [open, setOpen] = useState(false)
  useCommandShortcut(() => setOpen(true))
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        open
      </button>
      <CommandPalette open={open} onOpenChange={setOpen} pendingChanges={pending} handlers={h} />
    </>
  )
}

function renderPalette(pending = 0) {
  const h = handlers()
  render(
    <I18nProvider>
      <Harness h={h} pending={pending} />
    </I18nProvider>
  )
  return h
}

const openIt = () => userEvent.click(screen.getByRole("button", { name: "open" }))

describe("opening and closing", () => {
  it("opens on ⌘K and on Ctrl+K, from anywhere", async () => {
    renderPalette()
    await userEvent.keyboard("{Meta>}k{/Meta}")
    expect(await screen.findByPlaceholderText(en.palette.placeholder)).toBeInTheDocument()
    await userEvent.keyboard("{Escape}")
    await waitFor(() =>
      expect(screen.queryByPlaceholderText(en.palette.placeholder)).not.toBeInTheDocument()
    )
    await userEvent.keyboard("{Control>}k{/Control}")
    expect(await screen.findByPlaceholderText(en.palette.placeholder)).toBeInTheDocument()
  })

  it("closes on Escape and hands focus back to whatever opened it", async () => {
    renderPalette()
    const trigger = screen.getByRole("button", { name: "open" })
    await userEvent.click(trigger)
    await screen.findByPlaceholderText(en.palette.placeholder)
    await userEvent.keyboard("{Escape}")
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it("starts empty every time, not inside the last search", async () => {
    renderPalette()
    await openIt()
    await userEvent.type(await screen.findByPlaceholderText(en.palette.placeholder), "network")
    await userEvent.keyboard("{Escape}")
    await openIt()
    expect(await screen.findByPlaceholderText(en.palette.placeholder)).toHaveValue("")
  })
})

describe("finding things", () => {
  it("groups destinations and actions", async () => {
    renderPalette()
    await openIt()
    expect(await screen.findByText(en.palette.groupGo)).toBeInTheDocument()
    expect(screen.getByText(en.palette.groupActions)).toBeInTheDocument()
  })

  it("narrows as you type, and says so when nothing matches", async () => {
    renderPalette()
    await openIt()
    const input = await screen.findByPlaceholderText(en.palette.placeholder)
    await userEvent.type(input, "zzzzzz")
    expect(await screen.findByText(en.palette.empty)).toBeInTheDocument()
    await userEvent.clear(input)
    await userEvent.type(input, en.workspaces.usage)
    expect(await screen.findByText(en.workspaces.usage)).toBeInTheDocument()
  })

  it("offers review only when something is staged", async () => {
    renderPalette(0)
    await openIt()
    await screen.findByText(en.palette.groupActions)
    expect(screen.queryByText(en.palette.reviewCount(2))).not.toBeInTheDocument()
  })
})

describe("running a command", () => {
  it("navigates with the keyboard alone — arrows then Enter", async () => {
    const h = renderPalette()
    await userEvent.keyboard("{Meta>}k{/Meta}")
    await screen.findByPlaceholderText(en.palette.placeholder)
    await userEvent.keyboard("{ArrowDown}{Enter}")
    expect(h.navigate).toHaveBeenCalled()
    const call = (h.navigate as jest.Mock).mock.calls[0][0]
    expect(call.kind).toBe("navigate")
  })

  it("runs an action and closes", async () => {
    const h = renderPalette()
    await openIt()
    await userEvent.click(await screen.findByText(en.palette.rescan))
    expect(h.rescan).toHaveBeenCalled()
    await waitFor(() =>
      expect(screen.queryByPlaceholderText(en.palette.placeholder)).not.toBeInTheDocument()
    )
  })

  it("opens the review panel when changes are staged", async () => {
    const h = renderPalette(2)
    await openIt()
    await userEvent.click(await screen.findByText(en.palette.reviewCount(2)))
    expect(h.review).toHaveBeenCalled()
  })

  it("toggles the theme itself rather than routing it through the shell", async () => {
    renderPalette()
    await openIt()
    await userEvent.click(await screen.findByText(en.palette.toggleTheme))
    expect(mockSetTheme).toHaveBeenCalledWith("dark")
  })

  it("reaches quick config, onboarding and updates", async () => {
    const h = renderPalette()
    await openIt()
    await userEvent.click(await screen.findByText(en.palette.quickConfig))
    expect(h.quickConfig).toHaveBeenCalled()
    await openIt()
    await userEvent.click(await screen.findByText(en.palette.onboarding))
    expect(h.onboarding).toHaveBeenCalled()
    await openIt()
    await userEvent.click(await screen.findByText(en.palette.updates))
    expect(h.updates).toHaveBeenCalled()
  })
})
