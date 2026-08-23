jest.mock("next/font/google", () => ({
  Geist: () => ({ variable: "--font-geist-sans" }),
  Geist_Mono: () => ({ variable: "--font-geist-mono" }),
}))

import { renderToStaticMarkup } from "react-dom/server"
import RootLayout, { metadata } from "./layout"

describe("RootLayout", () => {
  it("exports agentpack metadata used by Next.js", () => {
    expect(metadata).toMatchObject({
      title: "agentpack",
    })
  })

  it("renders html/body with font variables and children", () => {
    const markup = renderToStaticMarkup(
      <RootLayout>
        <main>content</main>
      </RootLayout>
    )

    expect(markup).toContain('lang="en"')
    expect(markup).toContain("--font-geist-sans")
    expect(markup).toContain("--font-geist-mono")
    expect(markup).toContain("antialiased")
    expect(markup).toContain("<main>content</main>")
  })

  it("pins the document so only the app shell can opt into scrolling", () => {
    const markup = renderToStaticMarkup(
      <RootLayout>
        <main>content</main>
      </RootLayout>
    )

    expect(markup).toContain('<html lang="en" class="h-full overflow-hidden"')
    expect(markup).toContain(
      '<body class="--font-geist-sans --font-geist-mono h-full overflow-hidden antialiased"'
    )
  })
})
