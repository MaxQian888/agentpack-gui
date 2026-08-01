# macOS Code Signing & Notarization

By default this repo ships **unsigned** macOS builds. On a user's Mac an unsigned,
downloaded `.app`/`.dmg` carries a `com.apple.quarantine` flag, and Gatekeeper —
especially on Apple Silicon — refuses to open it with:

> **"agentpack" is damaged and can't be opened. You should move it to the Trash.**

The app is **not** actually damaged: this is Gatekeeper rejecting an app that has
no Apple Developer ID signature and no notarization ticket. There are two fixes.

## Option A — end users: unblock an unsigned build (free, no changes needed)

Removing the download quarantine flag lets the current unsigned build run. Do it
**once** after copying the app into `/Applications`:

```bash
xattr -dr com.apple.quarantine /Applications/agentpack.app
```

…or right-click (Control-click) the app → **Open** → **Open**. This does not
modify the app; it only clears the "downloaded from the internet" quarantine
attribute. It is the same command the README and every release note give under
"macOS says the app 'is damaged'".

## Option B — maintainers: sign + notarize so it "just works" (recommended)

With the six secrets below configured, `.github/workflows/release.yml` signs and
notarizes every macOS build via `tauri-apps/tauri-action`. Users can then open the
app with a normal double-click — no `xattr`, no right-click. The wiring is already
in `release.yml`; it stays dormant (unsigned build) until the secrets exist.

**Requires an Apple Developer Program membership (US$99/yr).**

### 1. Create a "Developer ID Application" certificate

In [developer.apple.com → Certificates](https://developer.apple.com/account/resources/certificates/list),
create a **Developer ID Application** certificate (this is the cert type for apps
distributed **outside** the App Store — not "Apple Development" or "Mac App
Distribution"). Download it and double-click to import it into **Keychain
Access**.

### 2. Export it as a `.p12` and base64-encode it

In Keychain Access → **login** keychain → **My Certificates**, select the
"Developer ID Application: …" entry (expand it so the private key is included),
right-click → **Export** → save as `certificate.p12` and set a password.

```bash
# The base64 string goes into the APPLE_CERTIFICATE secret.
base64 -i certificate.p12 | pbcopy
```

### 3. Find your signing identity and Team ID

```bash
# APPLE_SIGNING_IDENTITY — copy the full quoted string, e.g.
#   "Developer ID Application: Your Name (ABCDE12345)"
security find-identity -v -p codesigning
```

The 10-character code in parentheses (`ABCDE12345`) is your **Team ID**
(`APPLE_TEAM_ID`), also shown in the top-right of the Apple Developer portal.

### 4. Create an app-specific password (for notarization)

At [appleid.apple.com](https://appleid.apple.com) → **Sign-In and Security** →
**App-Specific Passwords**, generate one. This is `APPLE_PASSWORD` (your Apple ID
email is `APPLE_ID`). Do **not** use your real Apple ID login password.

### 5. Add the six GitHub Actions repository secrets

`Settings → Secrets and variables → Actions → New repository secret`:

| Secret                       | Value                                                       |
| ---------------------------- | ----------------------------------------------------------- |
| `APPLE_CERTIFICATE`          | base64 of the `.p12` from step 2                            |
| `APPLE_CERTIFICATE_PASSWORD` | the `.p12` export password from step 2                      |
| `APPLE_SIGNING_IDENTITY`     | `Developer ID Application: Your Name (ABCDE12345)` (step 3) |
| `APPLE_ID`                   | your Apple ID email                                         |
| `APPLE_PASSWORD`             | the app-specific password from step 4                       |
| `APPLE_TEAM_ID`              | the 10-character Team ID from step 3                        |

### 6. Release

Push a version tag as usual (see the release flow). The next release's macOS
`.dmg`/`.app` are signed with hardened runtime and notarized. Verify locally after
download:

```bash
spctl -a -vvv -t install /Applications/agentpack.app   # → "accepted, source=Notarized Developer ID"
codesign -dv --verbose=4 /Applications/agentpack.app    # shows the Developer ID authority
```

> **Note:** notarization can take a few minutes; the tag build waits for Apple to
> return the ticket, then staples it to the artifacts. If a build fails at the
> signing/notarizing step, the most common causes are a wrong certificate **type**
> (must be _Developer ID Application_), a mismatched `APPLE_SIGNING_IDENTITY`
> string, or using the real Apple ID password instead of an app-specific one.

## Relationship to the in-app updater

This is **separate** from the Tauri updater signing in `UPDATER.md`. Notarization
(`APPLE_*`) is what stops Gatekeeper's "damaged" error on first launch; the updater
key (`TAURI_SIGNING_PRIVATE_KEY`) is what lets the app verify in-app updates. You
can enable either independently.
