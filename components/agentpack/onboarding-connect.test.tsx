let mockTauri = true
jest.mock("@/lib/tauri", () => ({ isTauri: () => mockTauri }))
jest.mock("@/lib/tauri/clipboard", () => ({ copyText: jest.fn(async () => true) }))
const mockSignedOut = { signedIn: false, mode: null, plan: null, expiresAt: null, source: "x" }
jest.mock("@/lib/tauri/commands", () => ({
  loginStatus: jest.fn(),
  launchAgentLogin: jest.fn(),
  httpGet: jest.fn(),
}))

import { useState } from "react"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import {
  OFFICIAL_CONNECTION,
  relayPresets,
  type AgentConnection,
  type ConnectApp,
} from "@/lib/agentpack/onboarding"
import { copyText } from "@/lib/tauri/clipboard"
import { httpGet, launchAgentLogin, loginStatus } from "@/lib/tauri/commands"
import { ConnectStep, SignInPanel } from "./onboarding-connect"

const w = en.welcome
const c = en.ccswitch

beforeEach(() => {
  mockTauri = true
  jest.clearAllMocks()
  ;(loginStatus as jest.Mock).mockResolvedValue({
    claude: mockSignedOut,
    codex: mockSignedOut,
    opencode: mockSignedOut,
  })
  ;(launchAgentLogin as jest.Mock).mockResolvedValue(undefined)
  ;(httpGet as jest.Mock).mockResolvedValue({ status: 200, latencyMs: 42, body: "{}", error: null })
})

/** The step, with its state held the way the wizard holds it. */
function Connect({ apps = ["claude"] as ConnectApp[] }) {
  const [connections, setConnections] = useState<Partial<Record<ConnectApp, AgentConnection>>>(
    Object.fromEntries(apps.map((a) => [a, OFFICIAL_CONNECTION]))
  )
  return (
    <I18nProvider>
      <ConnectStep
        apps={apps}
        connections={connections}
        onChange={(app, next) => setConnections((p) => ({ ...p, [app]: next }))}
      />
      <pre data-testid="state">{JSON.stringify(connections)}</pre>
    </I18nProvider>
  )
}
const state = () => JSON.parse(screen.getByTestId("state").textContent!)

describe("ConnectStep", () => {
  it("starts on the official subscription and asks for nothing else", () => {
    render(<Connect />)
    expect(screen.getByRole("radio", { name: new RegExp(w.connectOfficial) })).toBeChecked()
    expect(screen.queryByLabelText(`${w.agentClaude} ${w.fieldKey}`)).toBeNull()
  })

  it("asks for a key, and only a key, for an API key", async () => {
    render(<Connect />)
    await userEvent.click(screen.getByRole("radio", { name: new RegExp(w.connectApiKey) }))
    await userEvent.type(screen.getByLabelText(`${w.agentClaude} ${w.fieldKey}`), "sk-ant")
    expect(state().claude).toEqual({ kind: "apiKey", baseUrl: "", token: "sk-ant" })
    // The auth variable is never a question.
    expect(screen.queryByText(c.fieldAuthKind)).toBeNull()
  })

  it("starts a relay on its first named preset, and asks for a URL only for Other", async () => {
    render(<Connect />)
    await userEvent.click(screen.getByRole("radio", { name: new RegExp(w.connectRelay) }))
    const [first] = relayPresets("claude")
    expect(state().claude).toMatchObject({ preset: first!.key, baseUrl: first!.form.baseUrl })
    expect(screen.queryByLabelText(w.fieldBaseUrl)).toBeNull()

    await userEvent.click(screen.getByRole("button", { name: w.relayCustom }))
    await userEvent.type(screen.getByLabelText(w.fieldBaseUrl), "https://r.example")
    expect(state().claude).toMatchObject({ preset: "custom", baseUrl: "https://r.example" })
  })

  it("gives each agent its own block when both are installed", () => {
    render(<Connect apps={["claude", "codex"]} />)
    expect(screen.getByText(w.connectFor(w.agentClaude))).toBeInTheDocument()
    expect(screen.getByText(w.connectFor(w.agentCodex))).toBeInTheDocument()
  })
})

describe("the connection test", () => {
  const typeKey = async () => {
    await userEvent.click(screen.getByRole("radio", { name: new RegExp(w.connectApiKey) }))
    await userEvent.type(screen.getByLabelText(`${w.agentClaude} ${w.fieldKey}`), "sk-ant")
  }

  it("calls the vendor API with the key once it is typed, and says it worked", async () => {
    render(<Connect />)
    await typeKey()
    expect(await screen.findByText(c.probeOk(42, 0))).toBeInTheDocument()
    expect(httpGet).toHaveBeenCalledTimes(1)
    const [url, headers] = (httpGet as jest.Mock).mock.calls[0]
    expect(url).toBe("https://api.anthropic.com/v1/models")
    expect(headers).toMatchObject({ "x-api-key": "sk-ant" })
  })

  it("names a rejected key, and says Continue still works", async () => {
    ;(httpGet as jest.Mock).mockResolvedValue({ status: 401, latencyMs: 10, body: "", error: null })
    render(<Connect />)
    await typeKey()
    expect(await screen.findByText(new RegExp(c.probeUnauthorized))).toBeInTheDocument()
    expect(screen.getByText(w.testNotBlocking)).toBeInTheDocument()
  })

  it("reads a request that never came back as unreachable", async () => {
    ;(httpGet as jest.Mock).mockRejectedValue(new Error("boom"))
    render(<Connect />)
    await typeKey()
    expect(await screen.findByText(new RegExp(c.probeUnreachable))).toBeInTheDocument()
  })

  it("says nothing in web mode, where there is nothing to send the request with", async () => {
    mockTauri = false
    render(<Connect />)
    await typeKey()
    await new Promise((r) => setTimeout(r, 700))
    expect(httpGet).not.toHaveBeenCalled()
    expect(screen.queryByRole("status")).toBeNull()
  })
})

describe("SignInPanel", () => {
  const renderPanel = (apps: ConnectApp[] = ["claude"]) =>
    render(
      <I18nProvider>
        <SignInPanel apps={apps} />
      </I18nProvider>
    )

  it("opens the agent's own sign-in in a terminal, then ticks it off", async () => {
    renderPanel()
    await userEvent.click(await screen.findByRole("button", { name: w.signInOpen }))
    expect(launchAgentLogin).toHaveBeenCalledWith("claude")
    expect(screen.getByText(w.signInWaiting)).toBeInTheDocument()

    ;(loginStatus as jest.Mock).mockResolvedValue({
      claude: { ...mockSignedOut, signedIn: true },
      codex: mockSignedOut,
      opencode: mockSignedOut,
    })
    expect(await screen.findByText(w.signedIn, {}, { timeout: 3000 })).toBeInTheDocument()
  })

  it("needs no click for an agent that is already signed in", async () => {
    ;(loginStatus as jest.Mock).mockResolvedValue({
      claude: mockSignedOut,
      codex: { ...mockSignedOut, signedIn: true },
      opencode: mockSignedOut,
    })
    renderPanel(["codex"])
    expect(await screen.findByText(w.signedIn)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: w.signInOpen })).toBeNull()
  })

  it("offers the command to copy when no terminal could be opened", async () => {
    ;(launchAgentLogin as jest.Mock).mockRejectedValue(new Error("no terminal"))
    renderPanel(["codex"])
    await userEvent.click(await screen.findByRole("button", { name: w.signInOpen }))
    expect(await screen.findByText("codex login")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: w.copy }))
    expect(copyText).toHaveBeenCalledWith("codex login")
    await waitFor(() => expect(screen.getByText(en.completion.copied)).toBeInTheDocument())
  })

  it("draws nothing when no agent signs in with a subscription", () => {
    const { container } = renderPanel([])
    expect(container).toBeEmptyDOMElement()
  })
})
