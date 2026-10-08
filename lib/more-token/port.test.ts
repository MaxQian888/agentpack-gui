jest.mock("@/lib/tauri/commands", () => ({
  moreTokenCredentialState: jest.fn(),
  moreTokenForgetCredential: jest.fn(),
  moreTokenListInstances: jest.fn(),
  moreTokenManagementStepUpStart: jest.fn(),
  moreTokenManagementStepUpPoll: jest.fn(),
  moreTokenManagementStepUpCancel: jest.fn(),
  moreTokenPair: jest.fn(),
  moreTokenPersonalLogin: jest.fn(),
  moreTokenPersonalOAuthStart: jest.fn(),
  moreTokenPersonalOAuthPoll: jest.fn(),
  moreTokenPersonalOAuthCancel: jest.fn(),
  moreTokenRemoveInstance: jest.fn(),
  moreTokenRequest: jest.fn(),
  moreTokenSaveInstance: jest.fn(),
}))

import * as commands from "@/lib/tauri/commands"
import {
  createMemoryMoreTokenPort,
  getMoreTokenPort,
  hasInjectedMoreTokenPort,
  setMoreTokenPortForTests,
  tauriMoreTokenPort,
} from "./port"

afterEach(() => setMoreTokenPortForTests(null))

describe("tauriMoreTokenPort", () => {
  it("is the active port until a test injects another, and comes back on reset", () => {
    expect(getMoreTokenPort()).toBe(tauriMoreTokenPort)
    const memory = createMemoryMoreTokenPort()
    setMoreTokenPortForTests(memory)
    expect(getMoreTokenPort()).toBe(memory)
    expect(hasInjectedMoreTokenPort()).toBe(true)
    setMoreTokenPortForTests(null)
    expect(getMoreTokenPort()).toBe(tauriMoreTokenPort)
    expect(hasInjectedMoreTokenPort()).toBe(false)
  })

  it("binds every port operation to its Tauri command wrapper", () => {
    expect(tauriMoreTokenPort).toEqual({
      listInstances: commands.moreTokenListInstances,
      saveInstance: commands.moreTokenSaveInstance,
      removeInstance: commands.moreTokenRemoveInstance,
      credentialState: commands.moreTokenCredentialState,
      forgetCredential: commands.moreTokenForgetCredential,
      pair: commands.moreTokenPair,
      personalLogin: commands.moreTokenPersonalLogin,
      personalOAuthStart: commands.moreTokenPersonalOAuthStart,
      personalOAuthPoll: commands.moreTokenPersonalOAuthPoll,
      personalOAuthCancel: commands.moreTokenPersonalOAuthCancel,
      managementStepUpStart: commands.moreTokenManagementStepUpStart,
      managementStepUpPoll: commands.moreTokenManagementStepUpPoll,
      managementStepUpCancel: commands.moreTokenManagementStepUpCancel,
      request: commands.moreTokenRequest,
    })
  })
})

describe("createMemoryMoreTokenPort", () => {
  it("defaults to an empty, disconnected machine whose cleanups succeed", async () => {
    const port = createMemoryMoreTokenPort()
    await expect(port.listInstances()).resolves.toEqual([])
    await expect(port.removeInstance("i-1")).resolves.toBeUndefined()
    await expect(port.credentialState("i-1")).resolves.toEqual({
      connected: false,
      persistent: false,
    })
    await expect(port.forgetCredential("i-1", false)).resolves.toEqual({
      remoteRevoked: false,
      localDeleted: true,
      remoteError: null,
    })
    await expect(port.personalOAuthCancel("i-1", "h")).resolves.toBeUndefined()
    await expect(port.managementStepUpCancel("i-1", "h")).resolves.toBeUndefined()
  })

  it("rejects every operation that needs a server unless a test supplies it", async () => {
    const port = createMemoryMoreTokenPort()
    const notImplemented = "MEMORY_PORT_OPERATION_NOT_IMPLEMENTED"
    await expect(
      port.saveInstance({
        id: "i-1",
        name: "x",
        baseUrl: "https://x.example",
        readOnly: false,
        displayCurrency: null,
        customCaPath: null,
        clearCustomCa: false,
        package: "management",
      })
    ).rejects.toThrow(notImplemented)
    await expect(port.pair("i-1", "code", "cid")).rejects.toThrow(notImplemented)
    await expect(port.personalLogin("i-1", "u", "p", null, "cid", "l")).rejects.toThrow(
      notImplemented
    )
    await expect(port.personalOAuthStart("i-1", "cid", "l")).rejects.toThrow(notImplemented)
    await expect(port.personalOAuthPoll("i-1", "h")).rejects.toThrow(notImplemented)
    await expect(port.managementStepUpStart("i-1", "t")).rejects.toThrow(notImplemented)
    await expect(port.managementStepUpPoll("i-1", "h")).rejects.toThrow(notImplemented)
    await expect(port.request("i-1", { kind: "capabilities" })).rejects.toThrow(notImplemented)
  })

  it("lets overrides replace individual operations and leaves the rest alone", async () => {
    const request = jest.fn(async () => ({ status: 204, body: null }))
    const port = createMemoryMoreTokenPort({ request })
    await expect(port.request("i-1", { kind: "capabilities" })).resolves.toEqual({
      status: 204,
      body: null,
    })
    expect(request).toHaveBeenCalledWith("i-1", { kind: "capabilities" })
    await expect(port.listInstances()).resolves.toEqual([])
    expect(commands.moreTokenRequest).not.toHaveBeenCalled()
  })
})
