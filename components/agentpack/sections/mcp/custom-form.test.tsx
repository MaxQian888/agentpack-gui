import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { CustomServerForm, type CustomFormValue } from "./custom-form"

function renderForm(props: Partial<Parameters<typeof CustomServerForm>[0]> = {}) {
  const onSubmit = jest.fn<void, [CustomFormValue]>()
  const onCancel = jest.fn()
  const utils = render(
    <I18nProvider>
      <CustomServerForm
        mode="add"
        takenIds={new Set()}
        onSubmit={onSubmit}
        onCancel={onCancel}
        {...props}
      />
    </I18nProvider>
  )
  return { onSubmit, onCancel, ...utils }
}

it("builds a stdio spec from the form and submits it", async () => {
  const { onSubmit } = renderForm()
  await userEvent.type(screen.getByLabelText(/Server id/i), "my-server")
  await userEvent.click(screen.getByRole("button", { name: /Add server/i }))
  expect(onSubmit).toHaveBeenCalledTimes(1)
  const value = onSubmit.mock.calls[0][0]
  expect(value.id).toBe("my-server")
  expect(value.spec).toEqual({ transport: "stdio", command: "npx", args: [], env: {} })
  expect(value.targets).toEqual(["claude"])
})

it("rejects a reserved catalog id", async () => {
  const { onSubmit } = renderForm()
  await userEvent.type(screen.getByLabelText(/Server id/i), "context7")
  await userEvent.click(screen.getByRole("button", { name: /Add server/i }))
  expect(onSubmit).not.toHaveBeenCalled()
  expect(screen.getByText(/built-in catalog server/i)).toBeInTheDocument()
})

it("requires a Codex token env var when a bearer token is set", async () => {
  const { onSubmit } = renderForm()
  await userEvent.type(screen.getByLabelText(/Server id/i), "remote-one")
  await userEvent.click(screen.getByRole("button", { name: /Remote \(http\)/i }))
  await userEvent.type(screen.getByLabelText(/Server URL/i), "https://x/mcp")
  await userEvent.type(screen.getByLabelText(/^Bearer token$/i), "secret")
  // Add Codex as a target (checkboxes are claude, codex, opencode in order).
  await userEvent.click(screen.getAllByRole("checkbox")[1])
  await userEvent.click(screen.getByRole("button", { name: /Add server/i }))
  expect(onSubmit).not.toHaveBeenCalled()
  expect(screen.getByText(/Codex needs a token env-var name/i)).toBeInTheDocument()
})

it("builds an http spec with a bearer header and a token env var", async () => {
  const { onSubmit } = renderForm()
  await userEvent.type(screen.getByLabelText(/Server id/i), "remote-one")
  await userEvent.click(screen.getByRole("button", { name: /Remote \(http\)/i }))
  await userEvent.type(screen.getByLabelText(/Server URL/i), "https://x/mcp")
  await userEvent.type(screen.getByLabelText(/^Bearer token$/i), "secret")
  await userEvent.type(screen.getByLabelText(/Token env var/i), "MY_TOKEN")
  await userEvent.click(screen.getByRole("button", { name: /Add server/i }))
  expect(onSubmit).toHaveBeenCalledTimes(1)
  expect(onSubmit.mock.calls[0][0].spec).toEqual({
    transport: "http",
    url: "https://x/mcp",
    headers: { Authorization: "Bearer secret" },
    bearerTokenEnvVar: "MY_TOKEN",
  })
})

it("edits environment rows and submits the resulting env map", async () => {
  const { onSubmit } = renderForm()
  await userEvent.type(screen.getByLabelText(/Server id/i), "envy")
  await userEvent.type(screen.getByPlaceholderText("NAME"), "API_KEY")
  await userEvent.type(screen.getByPlaceholderText("value"), "abc")
  // Add a blank row, then remove it again via its (icon-only) X button.
  await userEvent.click(screen.getByRole("button", { name: /Add row/i }))
  const blankRemove = screen.getAllByRole("button").filter((b) => b.textContent === "")
  await userEvent.click(blankRemove[blankRemove.length - 1])
  await userEvent.click(screen.getByRole("button", { name: /Add server/i }))
  expect(onSubmit).toHaveBeenCalledTimes(1)
  expect(onSubmit.mock.calls[0][0].spec).toMatchObject({ env: { API_KEY: "abc" } })
})

it("edit mode locks the id and prefills the stdio spec", async () => {
  const { onSubmit } = renderForm({
    mode: "edit",
    initial: {
      id: "mine",
      spec: { transport: "stdio", command: "node", args: ["a.js", "b.js"], env: { TOKEN: "x" } },
      targets: ["codex"],
    },
  })
  const idInput = screen.getByLabelText(/Server id/i)
  expect(idInput).toBeDisabled()
  expect(idInput).toHaveValue("mine")
  expect(screen.getByLabelText(/Arguments/i)).toHaveValue("a.js\nb.js")
  await userEvent.click(screen.getByRole("button", { name: /Save changes/i }))
  expect(onSubmit).toHaveBeenCalledTimes(1)
  const value = onSubmit.mock.calls[0][0]
  expect(value.id).toBe("mine")
  expect(value.spec).toMatchObject({
    transport: "stdio",
    command: "node",
    args: ["a.js", "b.js"],
    env: { TOKEN: "x" },
  })
  expect(value.targets).toEqual(["codex"])
})

it("calls onCancel from the Cancel button", async () => {
  const { onCancel } = renderForm()
  await userEvent.click(screen.getByRole("button", { name: /Cancel/i }))
  expect(onCancel).toHaveBeenCalledTimes(1)
})
