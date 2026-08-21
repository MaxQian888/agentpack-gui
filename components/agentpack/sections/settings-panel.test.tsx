import { render, screen } from "@testing-library/react"
import { SettingsGroup, SettingsPanel, SettingsRow } from "./settings-panel"

it("labels a control by id and explains it", () => {
  render(
    <SettingsPanel label="Preferences" lead={<p>Web mode</p>}>
      <SettingsGroup title="Appearance" hint="Applies as you change it.">
        <SettingsRow
          label="Reduce motion"
          hint="Collapses the panel fade."
          htmlFor="motion"
          control={<input id="motion" type="checkbox" />}
          note={<p>Desktop only</p>}
        />
      </SettingsGroup>
    </SettingsPanel>
  )

  expect(screen.getByRole("region", { name: "Preferences" })).toBeInTheDocument()
  expect(screen.getByRole("region", { name: "Appearance" })).toBeInTheDocument()
  expect(screen.getByText("Web mode")).toBeInTheDocument()
  expect(screen.getByLabelText("Reduce motion")).toHaveAttribute("id", "motion")
  expect(screen.getByText("Collapses the panel fade.")).toBeInTheDocument()
  expect(screen.getByText("Desktop only")).toBeInTheDocument()
})

/**
 * A segmented control is several buttons, so it has no id to point a <label>
 * at — it names itself with `aria-labelledby` against the row's label instead.
 */
it("names a group of controls that has no single id", () => {
  render(
    <SettingsPanel label="Preferences">
      <SettingsGroup title="Startup">
        <SettingsRow
          label="Theme"
          labelId="theme-label"
          control={
            <div role="radiogroup" aria-labelledby="theme-label">
              <button type="button" role="radio" aria-checked="true">
                Dark
              </button>
            </div>
          }
        />
      </SettingsGroup>
    </SettingsPanel>
  )

  expect(screen.getByRole("radiogroup", { name: "Theme" })).toBeInTheDocument()
})
