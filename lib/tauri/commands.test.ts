jest.mock("@tauri-apps/api/core", () => ({
  invoke: jest.fn(async (cmd: string) => (cmd === "get_paths" ? { os: "mac" } : undefined)),
  Channel: class {
    onmessage: ((m: string) => void) | null = null
  },
}))

import { getPaths, detectCli, ccWriteProvider } from "./commands"
import { invoke } from "@tauri-apps/api/core"

it("getPaths invokes get_paths", async () => {
  expect(await getPaths()).toEqual({ os: "mac" })
})

it("detectCli passes bin + gui", async () => {
  await detectCli("claude", false)
  expect(invoke).toHaveBeenCalledWith("detect_cli", { bin: "claude", gui: false })
})

it("ccWriteProvider wraps the request under `req`", async () => {
  await ccWriteProvider({ op: "delete", dryRun: false, app: "claude", id: "1" })
  expect(invoke).toHaveBeenCalledWith("cc_write_provider", {
    req: { op: "delete", dryRun: false, app: "claude", id: "1" },
  })
})
