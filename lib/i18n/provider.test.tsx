import { render, screen, act } from "@testing-library/react"
import { I18nProvider, useT, useLocale } from "./provider"

function Probe() {
  const t = useT()
  const { setLang } = useLocale()
  return (
    <button type="button" onClick={() => setLang("zh-CN")}>
      {t.menu.title}
    </button>
  )
}

it("provides messages and switches locale", async () => {
  render(
    <I18nProvider>
      <Probe />
    </I18nProvider>
  )
  expect(await screen.findByText("Main menu")).toBeInTheDocument()
  await act(async () => {
    screen.getByRole("button").click()
  })
  expect(screen.getByText("主菜单")).toBeInTheDocument()
})

it("persists the chosen language to localStorage", async () => {
  render(
    <I18nProvider>
      <Probe />
    </I18nProvider>
  )
  await act(async () => screen.getByRole("button").click())
  expect(localStorage.getItem("agentpack.lang")).toBe("zh-CN")
})

it("throws when useT / useLocale are used outside a provider", () => {
  const Bad = () => {
    useT()
    return null
  }
  const BadLocale = () => {
    useLocale()
    return null
  }
  const spy = jest.spyOn(console, "error").mockImplementation(() => {})
  expect(() => render(<Bad />)).toThrow(/I18nProvider/)
  expect(() => render(<BadLocale />)).toThrow(/I18nProvider/)
  spy.mockRestore()
})
