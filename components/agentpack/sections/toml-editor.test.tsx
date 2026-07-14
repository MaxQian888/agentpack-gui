import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { TomlEditor } from "./toml-editor"

const SAMPLE = [
  "# a comment",
  "[management]",
  "enabled = true",
  "port = 9820",
  'token = "secret"',
].join("\n")

it("exposes an editable textarea by its accessible name holding the value", () => {
  render(<TomlEditor ariaLabel="TOML" value={SAMPLE} onChange={() => {}} />)
  const area = screen.getByRole("textbox", { name: "TOML" }) as HTMLTextAreaElement
  expect(area.value).toBe(SAMPLE)
})

it("reports edits through onChange", async () => {
  const onChange = jest.fn()
  render(<TomlEditor ariaLabel="TOML" value="" onChange={onChange} />)
  await userEvent.type(screen.getByRole("textbox", { name: "TOML" }), "x")
  expect(onChange).toHaveBeenCalledWith("x")
})

it("mirrors the textarea's scroll position onto the highlighted layer", () => {
  const { container } = render(
    <TomlEditor ariaLabel="TOML" value={"line\n".repeat(60)} onChange={() => {}} />
  )
  const area = screen.getByRole("textbox", { name: "TOML" })
  const pre = container.querySelector("pre")!
  area.scrollTop = 42
  area.scrollLeft = 7
  fireEvent.scroll(area)
  expect(pre.scrollTop).toBe(42)
  expect(pre.scrollLeft).toBe(7)
})

it("colorizes comments, table headers, strings, booleans and numbers", () => {
  render(<TomlEditor ariaLabel="TOML" value={SAMPLE} onChange={() => {}} />)
  expect(screen.getByText("# a comment").className).toContain("text-muted-foreground")
  expect(screen.getByText("[management]").className).toContain("text-violet-600")
  expect(screen.getByText("true").className).toContain("text-rose-600")
  expect(screen.getByText("9820").className).toContain("text-amber-600")
  expect(screen.getByText('"secret"').className).toContain("text-emerald-600")
})
