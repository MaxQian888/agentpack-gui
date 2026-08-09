jest.mock("@/lib/tauri", () => ({ isTauri: () => true }))
jest.mock("@/lib/tauri/commands", () => ({ httpGet: jest.fn() }))

import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { httpGet } from "@/lib/tauri/commands"
import { en } from "@/lib/i18n/en"
import { ProviderForm } from "./provider-form"
import type { ProviderForm as ProviderFormData } from "@/lib/agentpack/ccswitch/types"

beforeEach(() => jest.clearAllMocks())

function renderForm(props: Partial<React.ComponentProps<typeof ProviderForm>> = {}) {
  const onSubmit = jest.fn()
  const onOpenChange = jest.fn()
  render(
    <I18nProvider>
      <ProviderForm open onOpenChange={onOpenChange} onSubmit={onSubmit} {...props} />
    </I18nProvider>
  )
  return { onSubmit, onOpenChange }
}

it("disables save until a name is entered", async () => {
  renderForm()
  const save = screen.getByRole("button", { name: /save/i })
  expect(save).toBeDisabled()
  await userEvent.type(screen.getByLabelText(/name/i), "Mine")
  expect(save).toBeEnabled()
})

it("submits the collected form and closes the dialog", async () => {
  const { onSubmit, onOpenChange } = renderForm({
    initial: { baseUrl: "https://b" },
  })
  await userEvent.type(screen.getByLabelText(/name/i), "Mine")
  await userEvent.click(screen.getByRole("button", { name: /save/i }))
  expect(onSubmit).toHaveBeenCalledTimes(1)
  const form = onSubmit.mock.calls[0][0] as ProviderFormData
  expect(form).toMatchObject({ name: "Mine", app: "claude", baseUrl: "https://b" })
  expect(onOpenChange).toHaveBeenCalledWith(false)
})

it("shows the auth-kind picker for claude and hides it for codex", async () => {
  renderForm()
  expect(screen.getByText(/Claude auth variable/i)).toBeInTheDocument()
  await userEvent.click(screen.getByRole("radio", { name: /codex/i }))
  expect(screen.queryByText(/Claude auth variable/i)).not.toBeInTheDocument()
})

it("renders the edit title and pre-fills from initial on mount", () => {
  renderForm({ editing: true, initial: { name: "Existing" } })
  expect(screen.getByText(/edit provider/i)).toBeInTheDocument()
  expect(screen.getByLabelText(/name/i)).toHaveValue("Existing")
})

it("trims a pasted token", async () => {
  // Copying a key routinely picks up a trailing newline or space, and the
  // resulting auth failure looks exactly like a wrong key.
  const { onSubmit } = renderForm()
  await userEvent.type(screen.getByLabelText(/name/i), "Mine")
  await userEvent.type(screen.getByLabelText(en.ccswitch.fieldToken), "  sk-pasted  ")
  await userEvent.click(screen.getByRole("button", { name: /save/i }))
  expect((onSubmit.mock.calls[0][0] as ProviderFormData).token).toBe("sk-pasted")
})

it("toggles the token between masked and readable", async () => {
  renderForm({ initial: { token: "sk-1" } })
  const token = screen.getByLabelText(en.ccswitch.fieldToken)
  expect(token).toHaveAttribute("type", "password")
  await userEvent.click(screen.getByRole("button", { name: en.ccswitch.showToken }))
  expect(token).toHaveAttribute("type", "text")
})

it("names the failure when the endpoint rejects the token", async () => {
  ;(httpGet as jest.Mock).mockResolvedValue({ status: 401, latencyMs: 30, body: "", error: null })
  renderForm({ initial: { baseUrl: "https://relay.example", token: "sk-bad" } })
  await userEvent.click(screen.getByRole("button", { name: en.ccswitch.testConnection }))
  expect(await screen.findByText(en.ccswitch.probeUnauthorized)).toBeInTheDocument()
})

it("probes the model list with the CLI's own auth header", async () => {
  ;(httpGet as jest.Mock).mockResolvedValue({
    status: 200,
    latencyMs: 120,
    body: JSON.stringify({ data: [{ id: "m1" }] }),
    error: null,
  })
  renderForm({
    initial: { baseUrl: "https://relay.example", token: "sk-1", claudeAuthKind: "api_key" },
  })
  await userEvent.click(screen.getByRole("button", { name: en.ccswitch.testConnection }))
  await waitFor(() => expect(httpGet).toHaveBeenCalled())
  const [url, headers] = (httpGet as jest.Mock).mock.calls[0]
  expect(url).toBe("https://relay.example/v1/models")
  expect(headers["x-api-key"]).toBe("sk-1")
  expect(await screen.findByText(en.ccswitch.probeOk(120, 1))).toBeInTheDocument()
  expect(screen.getByLabelText(en.ccswitch.fieldModel)).toHaveAttribute("list", "pf-model-options")
  expect(document.querySelector('#pf-model-options option[value="m1"]')).toBeInTheDocument()
})

it("won't probe without a base URL", () => {
  renderForm({ initial: { token: "sk-1" } })
  expect(screen.getByRole("button", { name: en.ccswitch.testConnection })).toBeDisabled()
})

const openRawTab = async () =>
  userEvent.click(screen.getByRole("tab", { name: en.ccswitch.tabRaw }))

/** JSON gets pasted in, not typed — and typing it would hit userEvent's brace escapes. */
const pasteRaw = async (el: HTMLElement, text: string) => {
  await userEvent.clear(el)
  await userEvent.click(el)
  await userEvent.paste(text)
}

it("seeds the raw tab from the form and saves it verbatim", async () => {
  // The raw tab exists for fields the form can't express, so what the user typed
  // has to reach the DB unchanged rather than being re-derived.
  const { onSubmit } = renderForm({ initial: { name: "Mine", baseUrl: "https://r" } })
  await openRawTab()
  const raw = screen.getByLabelText(en.ccswitch.rawLabel)
  expect(JSON.parse((raw as HTMLTextAreaElement).value).env.ANTHROPIC_BASE_URL).toBe("https://r")

  await pasteRaw(
    raw,
    '{"env":{"ANTHROPIC_BASE_URL":"https://r","ANTHROPIC_CUSTOM_HEADERS":"X-Key: v"}}'
  )
  await userEvent.click(screen.getByRole("button", { name: /save/i }))
  const form = onSubmit.mock.calls[0][0] as ProviderFormData
  expect(JSON.parse(form.rawSettingsConfig!).env.ANTHROPIC_CUSTOM_HEADERS).toBe("X-Key: v")
})

it("blocks saving an unparseable hand-written config", async () => {
  renderForm({ initial: { name: "Mine", baseUrl: "https://r" } })
  await openRawTab()
  await pasteRaw(screen.getByLabelText(en.ccswitch.rawLabel), "{oops")
  expect(screen.getByText(en.ccswitch.rawInvalid)).toBeInTheDocument()
  expect(screen.getByRole("button", { name: /save/i })).toBeDisabled()
})

it("keeps the two surfaces in sync: raw edits reach the form fields", async () => {
  renderForm({ initial: { name: "Mine", baseUrl: "https://old" } })
  await openRawTab()
  const raw = screen.getByLabelText(en.ccswitch.rawLabel)
  await pasteRaw(raw, '{"env":{"ANTHROPIC_BASE_URL":"https://new"}}')

  await userEvent.click(screen.getByRole("tab", { name: en.ccswitch.tabForm }))
  expect(screen.getByLabelText(en.ccswitch.fieldBaseUrl)).toHaveValue("https://new")
})

it("a form edit discards the hand-written config rather than contradicting it", async () => {
  const { onSubmit } = renderForm({ initial: { name: "Mine", baseUrl: "https://r" } })
  await openRawTab()
  const raw = screen.getByLabelText(en.ccswitch.rawLabel)
  await pasteRaw(raw, '{"env":{"CUSTOM":"1"}}')

  await userEvent.click(screen.getByRole("tab", { name: en.ccswitch.tabForm }))
  await userEvent.type(screen.getByLabelText(en.ccswitch.fieldBaseUrl), "https://typed")
  await userEvent.click(screen.getByRole("button", { name: /save/i }))

  const form = onSubmit.mock.calls[0][0] as ProviderFormData
  expect(form.rawSettingsConfig).toBeUndefined()
  expect(form.baseUrl).toBe("https://typed")
})
