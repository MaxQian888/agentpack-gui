jest.mock("@tauri-apps/api/core", () => ({
  invoke: jest.fn(async (cmd: string) => (cmd === "get_paths" ? { os: "mac" } : undefined)),
  Channel: class {
    onmessage: ((m: string) => void) | null = null
  },
}))

import {
  getPaths,
  detectCli,
  detectRuntime,
  latestVersion,
  pkgManagerOwns,
  ccWriteProvider,
  runCommand,
  isProcessRunning,
  readTextFile,
  writeTextFile,
  removeDir,
  pathExists,
  installSkill,
  ccLoadProviders,
  launchCcSwitch,
  quitCcSwitch,
  ccSwitchRunning,
  ccSchemaStatus,
  ccInitDb,
  listSkills,
  backupSnapshot,
  backupList,
  backupRestore,
  historyListSessions,
  historyUsageSeries,
  historyGetSession,
  historyGetPartText,
  cancelCommand,
  npmOwns,
  startCcConnect,
  stopCcConnect,
  probePort,
  commandOnPath,
  probeHost,
  proxyEnvSnapshot,
  systemProxySnapshot,
  toolProxySnapshot,
  proxyCheck,
  setProcessProxy,
  registryFetch,
  mcpProbeRemote,
  mcpProbeStdio,
  writeBinaryFile,
  skillsScan,
  installSkillFromDir,
  fetchRepoSkills,
  installRepoSkills,
  cleanupRepoScan,
  listSkillFiles,
  checkRepoUpdates,
  updateSkill,
  backupSkill,
  listSkillBackups,
  restoreSkillBackup,
  deleteSkillBackup,
  createSkill,
  loginStatus,
  httpGet,
  providerLoad,
  providerWrite,
  piManagementScan,
  piPackageSearch,
  piAuthStatus,
  piSessionDirsGet,
  piSessionDirsSet,
  launchPiInteractive,
  moreTokenListInstances,
  moreTokenSaveInstance,
  moreTokenRemoveInstance,
  moreTokenCredentialState,
  moreTokenForgetCredential,
  moreTokenPair,
  moreTokenPersonalLogin,
  moreTokenPersonalOAuthStart,
  moreTokenPersonalOAuthPoll,
  moreTokenPersonalOAuthCancel,
  moreTokenManagementStepUpStart,
  moreTokenManagementStepUpPoll,
  moreTokenManagementStepUpCancel,
  moreTokenRequest,
  launchApp,
  githubLatestRelease,
  manifestLatestRelease,
  downloadReleaseAsset,
  installPackage,
  fileStat,
  cleanupRoots,
  cleanupScan,
  cleanupApply,
  cleanupQuarantineList,
  cleanupQuarantineRestore,
  cleanupQuarantinePurge,
} from "./commands"
import { Channel, invoke } from "@tauri-apps/api/core"

it("getPaths invokes get_paths", async () => {
  expect(await getPaths()).toEqual({ os: "mac" })
})

it("detectCli passes bin + gui", async () => {
  await detectCli("claude", false)
  expect(invoke).toHaveBeenCalledWith("detect_cli", { bin: "claude", gui: false })
})

it("detectRuntime falls back to altBin when the primary bin is missing", async () => {
  ;(invoke as jest.Mock)
    .mockResolvedValueOnce({ installed: false })
    .mockResolvedValueOnce({ installed: true, version: "Python 3.13.1" })
  const d = await detectRuntime({ bin: "python", altBin: "python3" })
  expect(d).toEqual({ installed: true, version: "Python 3.13.1" })
  expect(invoke).toHaveBeenCalledWith("detect_cli", { bin: "python", gui: false })
  expect(invoke).toHaveBeenCalledWith("detect_cli", { bin: "python3", gui: false })
})

it("detectRuntime stops at the primary bin when it is installed", async () => {
  ;(invoke as jest.Mock).mockResolvedValueOnce({ installed: true, version: "1.0" })
  const calls = (invoke as jest.Mock).mock.calls.length
  const d = await detectRuntime({ bin: "uv" })
  expect(d.installed).toBe(true)
  expect((invoke as jest.Mock).mock.calls.length).toBe(calls + 1)
})

it("detects a GUI environment tool without executing it", async () => {
  ;(invoke as jest.Mock).mockResolvedValueOnce({ installed: true })

  await detectRuntime({
    bin: "wt",
    gui: true,
    appBundles: [{ name: "Microsoft.WindowsTerminal" }],
  })

  expect(invoke).toHaveBeenCalledWith("detect_cli", {
    bin: "wt",
    gui: true,
    appBundles: [{ name: "Microsoft.WindowsTerminal" }],
  })
})

it("latestVersion passes the package under `package`", async () => {
  await latestVersion("@openai/codex")
  expect(invoke).toHaveBeenCalledWith("latest_version", { package: "@openai/codex" })
})

it("pkgManagerOwns forwards the manager + id to pkg_manager_owns", async () => {
  await pkgManagerOwns("winget", "OpenJS.NodeJS.LTS")
  expect(invoke).toHaveBeenCalledWith("pkg_manager_owns", {
    manager: "winget",
    id: "OpenJS.NodeJS.LTS",
  })
})

it("ccWriteProvider wraps the request under `req`", async () => {
  await ccWriteProvider({ op: "delete", dryRun: false, app: "claude", id: "1" })
  expect(invoke).toHaveBeenCalledWith("cc_write_provider", {
    req: { op: "delete", dryRun: false, app: "claude", id: "1" },
  })
})

it("provider commands select the requested storage backend", async () => {
  await providerLoad("native")
  expect(invoke).toHaveBeenCalledWith("provider_load", { backend: "native" })

  await providerWrite({
    backend: "ccswitch",
    op: "setCurrent",
    dryRun: false,
    app: "codex",
    id: "provider-1",
  })
  expect(invoke).toHaveBeenCalledWith("provider_write", {
    req: {
      backend: "ccswitch",
      op: "setCurrent",
      dryRun: false,
      app: "codex",
      id: "provider-1",
    },
  })
})

it("runCommand wires a Channel to the onLine callback", async () => {
  const onLine = jest.fn()
  await runCommand({ file: "echo", args: ["hi"] }, onLine)
  const call = (invoke as jest.Mock).mock.calls.find(([c]) => c === "run_command")
  expect(call).toBeTruthy()
  expect(call![1]).toMatchObject({ file: "echo", args: ["hi"], env: null })
  // The channel forwards messages to onLine.
  call![1].onEvent.onmessage("a line")
  expect(onLine).toHaveBeenCalledWith("a line")
})

it("runCommand forwards per-run env overrides (how a recovery retry works)", async () => {
  await runCommand({ file: "npm", args: ["install", "-g", "pkg"] }, jest.fn(), {
    env: { HTTPS_PROXY: "http://127.0.0.1:7890" },
  })
  const call = (invoke as jest.Mock).mock.calls.find(([c]) => c === "run_command")
  expect(call![1].env).toEqual({ HTTPS_PROXY: "http://127.0.0.1:7890" })
})

it("runCommand forwards a project working directory", async () => {
  await runCommand({ file: "pi", args: ["list"], cwd: "/work/repo" }, jest.fn())
  const calls = (invoke as jest.Mock).mock.calls.filter(([c]) => c === "run_command")
  expect(calls.at(-1)?.[1].cwd).toBe("/work/repo")
})

it("Pi management wrappers preserve scope and refresh intent", async () => {
  await piManagementScan({ kind: "project", cwd: "/work/repo" })
  expect(invoke).toHaveBeenCalledWith("pi_management_scan", {
    scope: { kind: "project", cwd: "/work/repo" },
  })
  await piPackageSearch("memory")
  expect(invoke).toHaveBeenCalledWith("pi_package_search", { query: "memory" })
  await piAuthStatus(false)
  expect(invoke).toHaveBeenCalledWith("pi_auth_status", { refresh: false })
  await piSessionDirsGet()
  expect(invoke).toHaveBeenCalledWith("pi_session_dirs_get")
  await piSessionDirsSet(["/history/pi"])
  expect(invoke).toHaveBeenCalledWith("pi_session_dirs_set", { dirs: ["/history/pi"] })
  await launchPiInteractive("/work/repo")
  expect(invoke).toHaveBeenCalledWith("launch_pi_interactive", { cwd: "/work/repo" })
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

  await ccSchemaStatus()
  expect(invoke).toHaveBeenCalledWith("cc_schema_status")

  await ccInitDb()
  expect(invoke).toHaveBeenCalledWith("cc_init_db")

  await launchCcSwitch()
  expect(invoke).toHaveBeenCalledWith("launch_cc_switch")

  await quitCcSwitch()
  expect(invoke).toHaveBeenCalledWith("quit_cc_switch")

  await ccSwitchRunning()
  expect(invoke).toHaveBeenCalledWith("cc_switch_running")

  await listSkills("/d")
  expect(invoke).toHaveBeenCalledWith("list_skills", { path: "/d" })

  await backupSnapshot("provider write")
  expect(invoke).toHaveBeenCalledWith("backup_snapshot", { reason: "provider write" })

  await backupList()
  expect(invoke).toHaveBeenCalledWith("backup_list")

  await backupRestore("snapshot-1")
  expect(invoke).toHaveBeenCalledWith("backup_restore", { id: "snapshot-1" })

  // Rust takes the progress channel unconditionally (Tauri can't deserialize an
  // optional one), so a caller that doesn't want progress still sends one.
  await historyListSessions()
  expect(invoke).toHaveBeenCalledWith("history_list_sessions", {
    progress: expect.any(Channel),
  })

  await historyUsageSeries()
  expect(invoke).toHaveBeenCalledWith("history_usage_series", {
    progress: expect.any(Channel),
  })

  await historyGetSession("codex", "/x/rollout.jsonl")
  expect(invoke).toHaveBeenCalledWith("history_get_session", {
    source: "codex",
    path: "/x/rollout.jsonl",
  })
})

/**
 * The remaining wrappers, asserted as (command name, argument shape).
 *
 * These look mechanical, but they are the one place a Tauri IPC mismatch can be
 * caught before runtime: a typo in the command string or an argument key that
 * doesn't match the Rust parameter name compiles fine on both sides and only
 * fails when a user clicks the button. The optional arguments get both branches
 * because the `?? null` normalisation exists precisely because Tauri cannot
 * deserialize a missing field into `Option<T>`.
 */
describe("command wrappers", () => {
  it("maps process + service commands", async () => {
    await cancelCommand("op-1")
    expect(invoke).toHaveBeenCalledWith("cancel_command", { opId: "op-1" })

    await npmOwns("@anthropic-ai/claude-code")
    expect(invoke).toHaveBeenCalledWith("npm_owns", { package: "@anthropic-ai/claude-code" })

    await startCcConnect()
    expect(invoke).toHaveBeenCalledWith("start_cc_connect", { configPath: undefined })

    // Naming the config keeps a stray ./config.toml from winning cc-connect's
    // flag → cwd → home resolution order.
    await startCcConnect("/h/.cc-connect/config.toml")
    expect(invoke).toHaveBeenCalledWith("start_cc_connect", {
      configPath: "/h/.cc-connect/config.toml",
    })

    await stopCcConnect([3000, 3001])
    expect(invoke).toHaveBeenCalledWith("stop_cc_connect", { ports: [3000, 3001] })

    await probePort(3000)
    expect(invoke).toHaveBeenCalledWith("probe_port", { port: 3000 })

    await commandOnPath("npx")
    expect(invoke).toHaveBeenCalledWith("command_on_path", { command: "npx" })
  })

  it("sends null rather than omitting an optional timeout", async () => {
    await probeHost("example.com", 443)
    expect(invoke).toHaveBeenCalledWith("probe_host", {
      host: "example.com",
      port: 443,
      timeoutMs: null,
    })

    await probeHost("example.com", 443, 2000)
    expect(invoke).toHaveBeenCalledWith("probe_host", {
      host: "example.com",
      port: 443,
      timeoutMs: 2000,
    })
  })

  it("maps the proxy discovery + verification commands", async () => {
    await proxyEnvSnapshot()
    expect(invoke).toHaveBeenCalledWith("proxy_env_snapshot")

    await systemProxySnapshot()
    expect(invoke).toHaveBeenCalledWith("system_proxy_snapshot")

    await toolProxySnapshot()
    expect(invoke).toHaveBeenCalledWith("tool_proxy_snapshot")

    // null proxyUrl is the "measure the direct route" baseline, not a missing arg.
    await proxyCheck(null, "https://api.anthropic.com")
    expect(invoke).toHaveBeenCalledWith("proxy_check", {
      proxyUrl: null,
      testUrl: "https://api.anthropic.com",
      timeoutMs: null,
    })

    await proxyCheck("http://127.0.0.1:7890", "https://api.anthropic.com", 5000)
    expect(invoke).toHaveBeenCalledWith("proxy_check", {
      proxyUrl: "http://127.0.0.1:7890",
      testUrl: "https://api.anthropic.com",
      timeoutMs: 5000,
    })

    await setProcessProxy({ http: "http://127.0.0.1:7890" })
    expect(invoke).toHaveBeenCalledWith("set_process_proxy", {
      config: { http: "http://127.0.0.1:7890" },
    })
  })

  it("normalises every optional registry argument to null", async () => {
    await registryFetch()
    expect(invoke).toHaveBeenCalledWith("registry_fetch", {
      query: null,
      cursor: null,
      limit: null,
    })

    await registryFetch("memory", "cur-2", 50)
    expect(invoke).toHaveBeenCalledWith("registry_fetch", {
      query: "memory",
      cursor: "cur-2",
      limit: 50,
    })
  })

  it("maps both MCP probe transports", async () => {
    await mcpProbeRemote("https://mcp.example.com", { Authorization: "Bearer x" }, "http")
    expect(invoke).toHaveBeenCalledWith("mcp_probe_remote", {
      url: "https://mcp.example.com",
      headers: { Authorization: "Bearer x" },
      transport: "http",
    })

    await mcpProbeStdio("npx", ["-y", "server"], { KEY: "v" })
    expect(invoke).toHaveBeenCalledWith("mcp_probe_stdio", {
      command: "npx",
      args: ["-y", "server"],
      env: { KEY: "v" },
      timeoutMs: null,
    })

    await mcpProbeStdio("npx", [], {}, 3000)
    expect(invoke).toHaveBeenCalledWith("mcp_probe_stdio", {
      command: "npx",
      args: [],
      env: {},
      timeoutMs: 3000,
    })
  })

  it("sends binary payloads as a plain array Tauri can deserialize", async () => {
    await writeBinaryFile("/tmp/card.png", new Uint8Array([137, 80, 78, 71]))
    expect(invoke).toHaveBeenCalledWith("write_binary_file", {
      path: "/tmp/card.png",
      bytes: [137, 80, 78, 71],
    })
  })

  it("maps the skills commands", async () => {
    await skillsScan()
    expect(invoke).toHaveBeenCalledWith("skills_scan")

    await installSkillFromDir("/src/my-skill", "my-skill", ["claude"])
    expect(invoke).toHaveBeenCalledWith("install_skill_from_dir", {
      src: "/src/my-skill",
      dirName: "my-skill",
      targets: ["claude"],
    })

    await fetchRepoSkills("https://github.com/o/r")
    expect(invoke).toHaveBeenCalledWith("fetch_repo_skills", { url: "https://github.com/o/r" })

    // `ref` is renamed to `gitRef`: `ref` is reserved on the Rust side.
    await installRepoSkills("scan-1", ["a/SKILL.md"], ["claude"], "o/r", "main")
    expect(invoke).toHaveBeenCalledWith("install_repo_skills", {
      scanId: "scan-1",
      relPaths: ["a/SKILL.md"],
      targets: ["claude"],
      repo: "o/r",
      gitRef: "main",
    })

    await cleanupRepoScan("scan-1")
    expect(invoke).toHaveBeenCalledWith("cleanup_repo_scan", { scanId: "scan-1" })

    await listSkillFiles("/skills/my-skill")
    expect(invoke).toHaveBeenCalledWith("list_skill_files", { path: "/skills/my-skill" })

    await checkRepoUpdates([], null)
    expect(invoke).toHaveBeenCalledWith("check_repo_updates", { entries: [], mirrorPrefix: null })

    await updateSkill("/skills/my-skill", ["claude"], "https://mirror.example")
    expect(invoke).toHaveBeenCalledWith("update_skill", {
      path: "/skills/my-skill",
      targets: ["claude"],
      mirrorPrefix: "https://mirror.example",
    })
  })

  it("maps the skill-backup commands", async () => {
    await backupSkill("/skills/my-skill")
    expect(invoke).toHaveBeenCalledWith("backup_skill", { path: "/skills/my-skill" })

    await listSkillBackups()
    expect(invoke).toHaveBeenCalledWith("list_skill_backups")

    await restoreSkillBackup("b-1", ["claude"])
    expect(invoke).toHaveBeenCalledWith("restore_skill_backup", { id: "b-1", targets: ["claude"] })

    await deleteSkillBackup("b-1")
    expect(invoke).toHaveBeenCalledWith("delete_skill_backup", { id: "b-1" })
  })

  it("defaults createSkill to refusing an overwrite", async () => {
    await createSkill("my-skill", ["claude"], "# hi")
    expect(invoke).toHaveBeenCalledWith("create_skill", {
      name: "my-skill",
      targets: ["claude"],
      content: "# hi",
      overwrite: false,
    })

    await createSkill("my-skill", ["claude"], "# hi", true)
    expect(invoke).toHaveBeenCalledWith("create_skill", {
      name: "my-skill",
      targets: ["claude"],
      content: "# hi",
      overwrite: true,
    })
  })

  it("maps the login + http commands", async () => {
    await loginStatus()
    expect(invoke).toHaveBeenCalledWith("login_status")

    await httpGet("https://api.example.com", { Authorization: "Bearer x" }, 4000)
    expect(invoke).toHaveBeenCalledWith("http_get", {
      url: "https://api.example.com",
      headers: { Authorization: "Bearer x" },
      timeoutMs: 4000,
    })
  })

  it("fetches the full text behind a truncated transcript part", async () => {
    await historyGetPartText("claude", "/x/session.jsonl", "ref-1")
    expect(invoke).toHaveBeenCalledWith("history_get_part_text", {
      source: "claude",
      path: "/x/session.jsonl",
      ref: "ref-1",
    })
  })
})

describe("more-token bridge", () => {
  it("maps instance management onto the more_token_* commands", async () => {
    await moreTokenListInstances()
    expect(invoke).toHaveBeenCalledWith("more_token_list_instances")

    const draft = {
      id: null,
      name: "Team",
      baseUrl: "https://mt.example",
      caFingerprint: null,
      readOnly: false,
      displayCurrency: "USD",
      package: "management",
    }
    await moreTokenSaveInstance(draft as never)
    expect(invoke).toHaveBeenCalledWith("more_token_save_instance", { draft })

    await moreTokenRemoveInstance("i-1")
    expect(invoke).toHaveBeenCalledWith("more_token_remove_instance", { instanceId: "i-1" })

    await moreTokenCredentialState("i-1")
    expect(invoke).toHaveBeenCalledWith("more_token_credential_state", { instanceId: "i-1" })
  })

  it("defaults forgetCredential to requiring a remote revoke", async () => {
    await moreTokenForgetCredential("i-1")
    expect(invoke).toHaveBeenCalledWith("more_token_forget_credential", {
      instanceId: "i-1",
      allowLocalOnly: false,
    })
    await moreTokenForgetCredential("i-1", true)
    expect(invoke).toHaveBeenCalledWith("more_token_forget_credential", {
      instanceId: "i-1",
      allowLocalOnly: true,
    })
  })

  it("maps pairing and personal login with every credential field", async () => {
    await moreTokenPair("i-1", "ABCD-1234", "agentpack-desktop")
    expect(invoke).toHaveBeenCalledWith("more_token_pair", {
      instanceId: "i-1",
      pairingCode: "ABCD-1234",
      clientId: "agentpack-desktop",
    })

    await moreTokenPersonalLogin("i-1", "alice", "pw", null, "cid", "Label")
    expect(invoke).toHaveBeenCalledWith("more_token_personal_login", {
      instanceId: "i-1",
      username: "alice",
      password: "pw",
      twoFactorCode: null,
      clientId: "cid",
      clientLabel: "Label",
    })
  })

  it("maps the personal OAuth and management step-up flows by handle", async () => {
    await moreTokenPersonalOAuthStart("i-1", "cid", "Label")
    expect(invoke).toHaveBeenCalledWith("more_token_personal_oauth_start", {
      instanceId: "i-1",
      clientId: "cid",
      clientLabel: "Label",
    })
    await moreTokenPersonalOAuthPoll("i-1", "h-1")
    expect(invoke).toHaveBeenCalledWith("more_token_personal_oauth_poll", {
      instanceId: "i-1",
      handle: "h-1",
    })
    await moreTokenPersonalOAuthCancel("i-1", "h-1")
    expect(invoke).toHaveBeenCalledWith("more_token_personal_oauth_cancel", {
      instanceId: "i-1",
      handle: "h-1",
    })

    await moreTokenManagementStepUpStart("i-1", "preview-token")
    expect(invoke).toHaveBeenCalledWith("more_token_management_step_up_start", {
      instanceId: "i-1",
      previewToken: "preview-token",
    })
    await moreTokenManagementStepUpPoll("i-1", "h-2")
    expect(invoke).toHaveBeenCalledWith("more_token_management_step_up_poll", {
      instanceId: "i-1",
      handle: "h-2",
    })
    await moreTokenManagementStepUpCancel("i-1", "h-2")
    expect(invoke).toHaveBeenCalledWith("more_token_management_step_up_cancel", {
      instanceId: "i-1",
      handle: "h-2",
    })
  })

  it("passes a management operation through and returns the raw response", async () => {
    ;(invoke as jest.Mock).mockResolvedValueOnce({ status: 200, body: { success: true } })
    const operation = { kind: "overview" } as never
    await expect(moreTokenRequest("i-1", operation)).resolves.toEqual({
      status: 200,
      body: { success: true },
    })
    expect(invoke).toHaveBeenCalledWith("more_token_request", { instanceId: "i-1", operation })
  })
})

describe("runCommand cancellation", () => {
  it("cancels the process tree when the signal aborts mid-run", async () => {
    const controller = new AbortController()
    await runCommand({ file: "sleep", args: ["9"] }, jest.fn(), {
      opId: "op-live",
      signal: controller.signal,
    })
    expect(invoke).not.toHaveBeenCalledWith("cancel_command", { opId: "op-live" })
    controller.abort()
    expect(invoke).toHaveBeenCalledWith("cancel_command", { opId: "op-live" })
    // `once`: a second abort event must not cancel again.
    controller.signal.dispatchEvent(new Event("abort"))
    expect((invoke as jest.Mock).mock.calls.filter(([c]) => c === "cancel_command")).toHaveLength(1)
  })

  it("cancels immediately when handed an already-aborted signal", async () => {
    const controller = new AbortController()
    controller.abort()
    await runCommand({ file: "sleep", args: ["9"] }, jest.fn(), {
      opId: "op-dead",
      signal: controller.signal,
      timeoutSecs: 5,
      elevated: true,
    })
    expect(invoke).toHaveBeenCalledWith("cancel_command", { opId: "op-dead" })
    expect(invoke).toHaveBeenCalledWith(
      "run_command",
      expect.objectContaining({ opId: "op-dead", timeoutSecs: 5, elevated: true })
    )
  })

  it("does not wire cancellation without an opId", async () => {
    const controller = new AbortController()
    await runCommand({ file: "sleep", args: ["9"] }, jest.fn(), { signal: controller.signal })
    controller.abort()
    expect(invoke).not.toHaveBeenCalledWith("cancel_command", expect.anything())
    expect(invoke).toHaveBeenCalledWith(
      "run_command",
      expect.objectContaining({ opId: null, timeoutSecs: null, elevated: null, cwd: null })
    )
  })
})

describe("release, package and file wrappers", () => {
  it("launches a desktop app by every bundle name it may have", async () => {
    const bundles = [{ mac: "Codex.app" }, { mac: "ChatGPT.app" }] as never
    await launchApp(bundles)
    expect(invoke).toHaveBeenCalledWith("launch_app", { appBundles: bundles })
  })

  it("resolves releases from GitHub and from a vendor manifest", async () => {
    await githubLatestRelease("owner/repo", null)
    expect(invoke).toHaveBeenCalledWith("github_latest_release", {
      repo: "owner/repo",
      mirrorPrefix: null,
    })
    await githubLatestRelease("owner/repo", "https://mirror.example/")
    expect(invoke).toHaveBeenCalledWith("github_latest_release", {
      repo: "owner/repo",
      mirrorPrefix: "https://mirror.example/",
    })
    await manifestLatestRelease("https://vendor.example/RELEASES.json")
    expect(invoke).toHaveBeenCalledWith("manifest_latest_release", {
      url: "https://vendor.example/RELEASES.json",
    })
  })

  it("streams download progress through a channel and resolves the local path", async () => {
    ;(invoke as jest.Mock).mockResolvedValueOnce("/tmp/app.dmg")
    const onProgress = jest.fn()
    await expect(
      downloadReleaseAsset("https://x/app.dmg", "app.dmg", null, onProgress)
    ).resolves.toBe("/tmp/app.dmg")
    const call = (invoke as jest.Mock).mock.calls.find(([c]) => c === "download_release_asset")
    expect(call![1]).toMatchObject({
      url: "https://x/app.dmg",
      fileName: "app.dmg",
      mirrorPrefix: null,
    })
    expect(call![1].onProgress).toBeInstanceOf(Channel)
    call![1].onProgress.onmessage({ received: 5, total: 10 })
    expect(onProgress).toHaveBeenCalledWith({ received: 5, total: 10 })
  })

  it("streams installer output and resolves the exit code", async () => {
    ;(invoke as jest.Mock).mockResolvedValueOnce(0)
    const onLine = jest.fn()
    await expect(installPackage("/tmp/app.dmg", onLine)).resolves.toBe(0)
    const call = (invoke as jest.Mock).mock.calls.find(([c]) => c === "install_package")
    expect(call![1].path).toBe("/tmp/app.dmg")
    call![1].onEvent.onmessage("hdiutil attach")
    expect(onLine).toHaveBeenCalledWith("hdiutil attach")
  })

  it("stats a path for the restore-safety check", async () => {
    ;(invoke as jest.Mock).mockResolvedValueOnce({ exists: false, size: 0, modifiedMs: 0 })
    await expect(fileStat("/h/.claude/settings.json")).resolves.toEqual({
      exists: false,
      size: 0,
      modifiedMs: 0,
    })
    expect(invoke).toHaveBeenCalledWith("file_stat", { path: "/h/.claude/settings.json" })
  })

  it("names the provider backend on a snapshot only when one is given", async () => {
    await backupSnapshot("before restore", "native" as never)
    expect(invoke).toHaveBeenCalledWith("backup_snapshot", {
      reason: "before restore",
      backend: "native",
    })
  })

  it("forwards history scan progress when a listener is given", async () => {
    const onProgress = jest.fn()
    await historyListSessions(onProgress)
    const call = (invoke as jest.Mock).mock.calls.find(([c]) => c === "history_list_sessions")
    call![1].progress.onmessage({ done: 1, total: 2 })
    expect(onProgress).toHaveBeenCalledWith({ done: 1, total: 2 })

    const onSeries = jest.fn()
    await historyUsageSeries(onSeries)
    const series = (invoke as jest.Mock).mock.calls.find(([c]) => c === "history_usage_series")
    series![1].progress.onmessage({ done: 2, total: 2 })
    expect(onSeries).toHaveBeenCalledWith({ done: 2, total: 2 })
  })
})

describe("cleanup wrappers", () => {
  const spec = { targetId: "codex-sessions", path: "/h/.codex/sessions", glob: "**" } as never

  it("maps roots, scan and apply with the chosen mode", async () => {
    await cleanupRoots()
    expect(invoke).toHaveBeenCalledWith("cleanup_roots")

    await cleanupScan([spec])
    expect(invoke).toHaveBeenCalledWith("cleanup_scan", { specs: [spec] })

    await cleanupApply([spec], "quarantine")
    expect(invoke).toHaveBeenCalledWith("cleanup_apply", { specs: [spec], mode: "quarantine" })
    await cleanupApply([spec], "delete")
    expect(invoke).toHaveBeenCalledWith("cleanup_apply", { specs: [spec], mode: "delete" })
  })

  it("maps the quarantine list / restore commands", async () => {
    await cleanupQuarantineList()
    expect(invoke).toHaveBeenCalledWith("cleanup_quarantine_list")
    await cleanupQuarantineRestore("batch-1")
    expect(invoke).toHaveBeenCalledWith("cleanup_quarantine_restore", { id: "batch-1" })
  })

  it("purges every batch with an explicit null rather than an omitted id", async () => {
    await cleanupQuarantinePurge()
    expect(invoke).toHaveBeenCalledWith("cleanup_quarantine_purge", { id: null })
    await cleanupQuarantinePurge("batch-1")
    expect(invoke).toHaveBeenCalledWith("cleanup_quarantine_purge", { id: "batch-1" })
  })
})
