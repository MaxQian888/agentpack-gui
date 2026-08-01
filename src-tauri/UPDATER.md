# Tauri Updater Setup

The in-app updater is **fully wired** in this repo — the `tauri-plugin-updater`
crate is registered, the endpoint is configured, capabilities grant
`updater:default` / `process:default`, and the About section (sidebar) drives
check → download → install → restart. The **only** remaining steps are supplying
a signing key, because Tauri refuses to install an update it can't verify.

## 1. Generate a signing key pair

```bash
pnpm tauri signer generate -w ~/.tauri/agentpack-gui.key
```

You'll be prompted for a password (optional but recommended). The command writes:

- `~/.tauri/agentpack-gui.key` — **PRIVATE KEY**, never commit
- `~/.tauri/agentpack-gui.key.pub` — public key

## 2. Wire the public key into config

Copy the **single-line** content of `~/.tauri/agentpack-gui.key.pub` into
`src-tauri/tauri.conf.json` → `plugins.updater.pubkey` (currently `""`).

The endpoint is already set to:

```json
"endpoints": [
  "https://github.com/Arxtect/agentpack-gui/releases/latest/download/latest.json"
]
```

`latest.json` is produced automatically by CI (see step 4). Its format is
documented at <https://v2.tauri.app/plugin/updater/>.

## 3. Add the CI signing secrets

Set these GitHub Actions repository secrets (Tauri v2 names):

- `TAURI_SIGNING_PRIVATE_KEY` — the **contents** of `~/.tauri/agentpack-gui.key`
  (or its base64), passed to the release build.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — the password (empty string if you
  skipped one).

> ⚠️ **Both lines.** A minisign key file is an `untrusted comment: …` line
> followed by the base64 body, and Tauri wants the whole file. A secret holding
> only the base64 line fails with **"failed to decode secret key: incorrect
> updater private key password: Missing comment in secret key"** — a message
> that blames the password for a truncated key. The key must also match the
> `pubkey` already in `tauri.conf.json`; regenerate one and you must update the
> other.

## 4. How CI ships updates

> **Currently disabled.** `release.yml` ships installers only. The secret above
> is not a well-formed key, and the failure lands _after_ bundling — so v0.11.0
> and v0.12.0 each built four working installers and published none of them,
> which is a worse outcome than shipping without auto-update. Fix the secret,
> then re-enable it as described below.

`release.yml` builds every platform with `tauri-apps/tauri-action`, which — with
the secrets above and `--config {"bundle":{"createUpdaterArtifacts":true}}` —
generates the signed `.sig` artifacts and the macOS `.app.tar.gz`, then merges
each platform's signature into a single `latest.json` on the GitHub Release.

To turn that back on, restore three things in the `tauri-action` step of
`release.yml`: the `TAURI_SIGNING_PRIVATE_KEY` / `…_PASSWORD` env vars,
`includeUpdaterJson: true`, and the `--config` fragment in `args`. Verify with a
pre-release tag (`v0.13.1-rc1`) before a real one — the signing step is the last
thing to run, so a bad key costs a full four-platform build to discover.

`createUpdaterArtifacts` belongs **only** in the release job (via `--config`),
never in `tauri.conf.json`, so the unsigned validation build in
`build-tauri.yml` and local `pnpm tauri build` keep working without a signing
key.

## 5. Release

Bump the version in `package.json`, `src-tauri/Cargo.toml`, and
`src-tauri/tauri.conf.json` (the `verify-version` gate requires all three to
match the tag), then push a `v*` tag. Installed apps check the endpoint on
startup (when "Check for updates on startup" is enabled) and via the About
section's **Check for updates** button.
