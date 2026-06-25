jest.mock("@tauri-apps/api/core", () => ({
  invoke: jest.fn(async (cmd: string) => (cmd === "get_paths" ? { os: "mac" } : undefined)),
  Channel: class {
    onmessage: ((m: string) => void) | null = null
  },
}))

import {
  getPaths,
  detectCli,
  latestVersion,
  ccWriteProvider,
  runCommand,
  isProcessRunning,
  readTextFile,
  writeTextFile,
  removeDir,
  pathExists,
  installSkill,
  ccLoadProviders,
} from "./commands"
import { invoke } from "@tauri-apps/api/core"

it("getPaths invokes get_paths", async () => {
  expect(await getPaths()).toEqual({ os: "mac" })
})

it("detectCli passes bin + gui", async () => {
  await detectCli("claude", false)
  expect(invoke).toHaveBeenCalledWith("detect_cli", { bin: "claude", gui: false })
})

it("latestVersion passes the package under `package`", async () => {
  await latestVersion("@openai/codex")
  expect(invoke).toHaveBeenCalledWith("latest_version", { package: "@openai/codex" })
})

it("ccWriteProvider wraps the request under `req`", async () => {
  await ccWriteProvider({ op: "delete", dryRun: false, app: "claude", id: "1" })
  expect(invoke).toHaveBeenCalledWith("cc_write_provider", {
    req: { op: "delete", dryRun: false, app: "claude", id: "1" },
  })
})

it("runCommand wires a Channel to the onLine callback", async () => {
  const onLine = jest.fn()
  await runCommand({ file: "echo", args: ["hi"] }, onLine)
  const call = (invoke as jest.Mock).mock.calls.find(([c]) => c === "run_command")
  expect(call).toBeTruthy()
  expect(call![1]).toMatchObject({ file: "echo", args: ["hi"] })
  // The channel forwards messages to onLine.
  call![1].onEvent.onmessage("a line")
  expect(onLine).toHaveBeenCalledWith("a line")
})

it("simple wrappers forward their arguments to the right command", async () => {
  await isProcessRunning("cc-switch")
  expect(invoke).toHaveBeenCalledWith("is_process_running", { name: "cc-switch" })

  await readTextFile("/p")
  expect(invoke).toHaveBeenCalledWith("read_text_file", { path: "/p" })

  await writeTextFile("/p", "data")
  expect(invoke).toHaveBeenCalledWith("write_text_file", { path: "/p", content: "data" })

  await removeDir("/d")
  expect(invoke).toHaveBeenCalledWith("remove_dir", { path: "/d" })

  await pathExists("/p")
  expect(invoke).toHaveBeenCalledWith("path_exists", { path: "/p" })

  await installSkill("rust", ["claude"])
  expect(invoke).toHaveBeenCalledWith("install_skill", { id: "rust", targets: ["claude"] })

  await ccLoadProviders()
  expect(invoke).toHaveBeenCalledWith("cc_load_providers")
})
