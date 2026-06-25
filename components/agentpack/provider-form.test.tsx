import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { ProviderForm } from "./provider-form"
import type { ProviderForm as ProviderFormData } from "@/lib/agentpack/ccswitch/types"

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
