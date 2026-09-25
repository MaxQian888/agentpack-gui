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

it("editing a remote server keeps every header, and a non-bearer Authorization verbatim", async () => {
  const { onSubmit } = renderForm({
    mode: "edit",
    initial: {
      id: "remote",
      spec: {
        transport: "http",
        url: "https://x/mcp",
        headers: { Authorization: "Basic dXNlcjpwdw==", "X-Api-Key": "k1" },
      },
      targets: ["claude"],
    },
  })
  // A Basic credential is not a bearer token: it stays a header, not the token field.
  expect(screen.getByLabelText(/^Bearer token$/i)).toHaveValue("")
  await userEvent.click(screen.getByRole("button", { name: /Save changes/i }))
  expect(onSubmit.mock.calls[0][0].spec).toEqual({
    transport: "http",
    url: "https://x/mcp",
    headers: { Authorization: "Basic dXNlcjpwdw==", "X-Api-Key": "k1" },
  })
})

it("reads a bearer Authorization as the token and writes it back as one", async () => {
  const { onSubmit } = renderForm({
    mode: "edit",
    initial: {
      id: "remote",
      spec: {
        transport: "sse",
        url: "https://x/sse",
        headers: { authorization: "Bearer abc", "X-Trace": "1" },
      },
      targets: ["claude"],
    },
  })
  expect(screen.getByLabelText(/^Bearer token$/i)).toHaveValue("abc")
  await userEvent.click(screen.getByRole("button", { name: /Save changes/i }))
  expect(onSubmit.mock.calls[0][0].spec).toEqual({
    transport: "sse",
    url: "https://x/sse",
    headers: { "X-Trace": "1", Authorization: "Bearer abc" },
  })
})

it("adds an extra header to a new remote server", async () => {
  const { onSubmit } = renderForm()
  await userEvent.type(screen.getByLabelText(/Server id/i), "remote-two")
  await userEvent.click(screen.getByRole("button", { name: /Remote \(http\)/i }))
  await userEvent.type(screen.getByLabelText(/Server URL/i), "https://x/mcp")
  await userEvent.click(screen.getByRole("button", { name: /Add header/i }))
  await userEvent.type(screen.getByPlaceholderText("Header-Name"), "X-Api-Key")
  await userEvent.type(screen.getByLabelText(/X-Api-Key value/i), "k2")
  await userEvent.click(screen.getByRole("button", { name: /Add server/i }))
  expect(onSubmit.mock.calls[0][0].spec).toMatchObject({ headers: { "X-Api-Key": "k2" } })
})

it("refuses a bearer token and an Authorization header at once", async () => {
  const { onSubmit } = renderForm({
    mode: "edit",
    initial: {
      id: "remote",
      spec: { transport: "http", url: "https://x/mcp", headers: { Authorization: "Basic x" } },
      targets: ["claude"],
    },
  })
  await userEvent.type(screen.getByLabelText(/^Bearer token$/i), "tok")
  await userEvent.click(screen.getByRole("button", { name: /Save changes/i }))
  expect(onSubmit).not.toHaveBeenCalled()
  expect(screen.getByText(/not both/i)).toBeInTheDocument()
})

it("keeps a target the machine can't write unticked and says why", async () => {
  const { onSubmit } = renderForm({ disabledTargets: { claude: "Install Claude Code first" } })
  const [claude, codex] = screen.getAllByRole("checkbox")
  expect(claude).toBeDisabled()
  expect(claude).not.toBeChecked()
  expect(screen.getByTitle("Install Claude Code first")).toBeInTheDocument()
  await userEvent.type(screen.getByLabelText(/Server id/i), "my-server")
  await userEvent.click(screen.getByRole("button", { name: /Add server/i }))
  // Claude was the default target; with it gone, a target has to be chosen.
  expect(onSubmit).not.toHaveBeenCalled()
  await userEvent.click(codex)
  await userEvent.click(screen.getByRole("button", { name: /Add server/i }))
  expect(onSubmit.mock.calls[0][0].targets).toEqual(["codex"])
})
