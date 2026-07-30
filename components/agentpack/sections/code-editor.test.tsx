import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { CodeEditor } from "./code-editor"

const TOML_SAMPLE = [
  "# a comment",
  "[management]",
  "enabled = true",
  "port = 9820",
  'token = "secret"',
].join("\n")

it("exposes an editable textarea by its accessible name holding the value", () => {
  render(<CodeEditor lang="toml" ariaLabel="TOML" value={TOML_SAMPLE} onChange={() => {}} />)
  const area = screen.getByRole("textbox", { name: "TOML" }) as HTMLTextAreaElement
  expect(area.value).toBe(TOML_SAMPLE)
})

it("reports edits through onChange", async () => {
  const onChange = jest.fn()
  render(<CodeEditor lang="toml" ariaLabel="TOML" value="" onChange={onChange} />)
  await userEvent.type(screen.getByRole("textbox", { name: "TOML" }), "x")
  expect(onChange).toHaveBeenCalledWith("x")
})

it("mirrors the textarea's scroll position onto the highlighted layer", () => {
  const { container } = render(
    <CodeEditor lang="toml" ariaLabel="TOML" value={"line\n".repeat(60)} onChange={() => {}} />
  )
  const area = screen.getByRole("textbox", { name: "TOML" })
  const pre = container.querySelector("pre")!
  area.scrollTop = 42
  area.scrollLeft = 7
  fireEvent.scroll(area)
  expect(pre.scrollTop).toBe(42)
  expect(pre.scrollLeft).toBe(7)
})

it("colorizes TOML comments, table headers, strings, booleans and numbers", () => {
  render(<CodeEditor lang="toml" ariaLabel="TOML" value={TOML_SAMPLE} onChange={() => {}} />)
  expect(screen.getByText("# a comment").className).toContain("text-muted-foreground")
  expect(screen.getByText("[management]").className).toContain("text-violet-600")
  expect(screen.getByText("true").className).toContain("text-rose-600")
  expect(screen.getByText("9820").className).toContain("text-amber-600")
  expect(screen.getByText('"secret"').className).toContain("text-emerald-600")
})

it("colorizes JSON keys, literals and numbers", () => {
  const json = '{\n  "model": "opus",\n  "verbose": true,\n  "cleanupPeriodDays": 30\n}'
  render(<CodeEditor lang="json" ariaLabel="JSON" value={json} onChange={() => {}} />)
  expect(screen.getByText('"model"').className).toContain("text-sky-700")
  expect(screen.getByText("true").className).toContain("text-rose-600")
  expect(screen.getByText("30").className).toContain("text-amber-600")
  expect(screen.getByText('"opus"').className).toContain("text-emerald-600")
})
