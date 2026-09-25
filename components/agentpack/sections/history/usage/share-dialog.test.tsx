import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import { resolveRange } from "@/lib/history/range"
import type { SessionSummary } from "@/lib/history/types"
import { ShareDialog } from "./share-dialog"
import { session } from "./fixtures"

jest.mock("@/lib/tauri", () => ({ isTauri: () => true }))
jest.mock("@/lib/tauri/commands", () => ({
  writeTextFile: jest.fn().mockResolvedValue(undefined),
  writeBinaryFile: jest.fn().mockResolvedValue(undefined),
}))
jest.mock("@/lib/tauri/dialog", () => ({ pickSavePath: jest.fn() }))
jest.mock("@/lib/tauri/clipboard", () => ({ copyText: jest.fn().mockResolvedValue(true) }))
jest.mock("./rasterize", () => ({
  ...jest.requireActual("./rasterize"),
  svgToPng: jest.fn(),
}))

import { writeBinaryFile, writeTextFile } from "@/lib/tauri/commands"
import { pickSavePath } from "@/lib/tauri/dialog"
import { copyText } from "@/lib/tauri/clipboard"
import { svgToPng } from "./rasterize"

const r = en.history.report
const NOW = new Date(2026, 6, 20, 12).getTime()
const day = (d: number) => new Date(2026, 6, d, 9).getTime()

function dialog(open: boolean, sessions: SessionSummary[]) {
  return (
    <I18nProvider>
      <ShareDialog
        open={open}
        onOpenChange={jest.fn()}
        sessions={sessions}
        range={resolveRange("30d", NOW)}
        rangeLabel="30 days"
        now={NOW}
      />
    </I18nProvider>
  )
}

function renderDialog(sessions: SessionSummary[] = [session({ updatedAt: day(18) })]) {
  return render(dialog(true, sessions))
}

beforeEach(() => jest.clearAllMocks())

describe("ShareDialog", () => {
  it("previews the card as an inline data URL, fetching nothing", () => {
    renderDialog()
    const img = screen.getByAltText(r.cardTitle)
    expect(img.getAttribute("src")).toMatch(/^data:image\/svg\+xml/)
  })

  it("copies a Markdown summary rather than the raw SVG", async () => {
    renderDialog()
    await userEvent.click(screen.getByRole("button", { name: r.copyMarkdown }))
    const copied = (copyText as jest.Mock).mock.calls[0][0] as string
    expect(copied).toContain(`# ${r.cardTitle}`)
    expect(copied).not.toContain("<svg")
    expect(await screen.findByText(r.copied)).toBeInTheDocument()
  })

  it("writes the PNG through the binary command, not the text one", async () => {
    ;(svgToPng as jest.Mock).mockResolvedValue(new Uint8Array([137, 80, 78, 71]))
    ;(pickSavePath as jest.Mock).mockResolvedValue("/tmp/card.png")
    renderDialog()
    await userEvent.click(screen.getByRole("button", { name: r.savePng }))
    expect(writeBinaryFile).toHaveBeenCalledWith("/tmp/card.png", new Uint8Array([137, 80, 78, 71]))
    expect(writeTextFile).not.toHaveBeenCalled()
  })

  it("says the render failed instead of writing an empty file", async () => {
    ;(svgToPng as jest.Mock).mockResolvedValue(null)
    renderDialog()
    await userEvent.click(screen.getByRole("button", { name: r.savePng }))
    expect(await screen.findByText(r.renderFailed)).toBeInTheDocument()
    expect(pickSavePath).not.toHaveBeenCalled()
    expect(writeBinaryFile).not.toHaveBeenCalled()
  })

  it("writes nothing when the save dialog is cancelled", async () => {
    ;(svgToPng as jest.Mock).mockResolvedValue(new Uint8Array([1]))
    ;(pickSavePath as jest.Mock).mockResolvedValue(null)
    renderDialog()
    await userEvent.click(screen.getByRole("button", { name: r.savePng }))
    expect(writeBinaryFile).not.toHaveBeenCalled()
  })

  it("saves the SVG as text", async () => {
    ;(pickSavePath as jest.Mock).mockResolvedValue("/tmp/card.svg")
    renderDialog()
    await userEvent.click(screen.getByRole("button", { name: r.saveSvg }))
    const [path, content] = (writeTextFile as jest.Mock).mock.calls[0]
    expect(path).toBe("/tmp/card.svg")
    expect(content.startsWith("<svg")).toBe(true)
  })

  it("says the clipboard write failed instead of doing nothing", async () => {
    ;(copyText as jest.Mock).mockResolvedValueOnce(false)
    renderDialog()
    await userEvent.click(screen.getByRole("button", { name: r.copyMarkdown }))
    expect(await screen.findByRole("alert")).toHaveTextContent(r.copyFailed)
    expect(screen.queryByText(r.copied)).not.toBeInTheDocument()
  })

  it("reports a failed save with the system's reason", async () => {
    ;(pickSavePath as jest.Mock).mockResolvedValue("/tmp/card.svg")
    ;(writeTextFile as jest.Mock).mockRejectedValueOnce(new Error("disk full"))
    renderDialog()
    await userEvent.click(screen.getByRole("button", { name: r.saveSvg }))
    expect(await screen.findByRole("alert")).toHaveTextContent(r.saveFailed("disk full"))
  })

  it("forgets the last opening's outcome when it opens again", async () => {
    ;(pickSavePath as jest.Mock).mockResolvedValue("/tmp/card.svg")
    const sessions = [session({ updatedAt: day(18) })]
    const { rerender } = renderDialog(sessions)
    await userEvent.click(screen.getByRole("button", { name: r.saveSvg }))
    expect(await screen.findByText(r.saved("/tmp/card.svg"))).toBeInTheDocument()
    rerender(dialog(false, sessions))
    rerender(dialog(true, sessions))
    expect(screen.queryByText(r.saved("/tmp/card.svg"))).not.toBeInTheDocument()
  })

  it("renders the empty-state card when the range holds no sessions", () => {
    renderDialog([])
    expect(screen.getByAltText(r.cardTitle).getAttribute("src")).toContain(
      encodeURIComponent(r.noActivity)
    )
  })
})
