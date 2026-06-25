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
