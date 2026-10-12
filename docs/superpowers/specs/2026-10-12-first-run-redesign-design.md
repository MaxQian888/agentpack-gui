# First-run redesign — Design

**Date:** 2026-10-12
**Status:** Approved (design); implementation split into five PRs (below)

## Problem

The first-run wizard is short — four clicks — but it ends at "installed", not at
"usable". Everything that stands between an installed agent and a first message
happens after the wizard, in places the user has to find on their own:

| Stage            | What the user does today                                                                            | Why it lengthens the path                                                                                               |
| ---------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Wizard (4 stops) | surface → bundle → (network) → summary with MCP key fields and skill checkboxes                     | The summary asks for `CONTEXT7_API_KEY` / `GITHUB_PERSONAL_ACCESS_TOKEN` — names a newcomer can't place                 |
| Second gate      | The review panel lists the same thing again → Apply                                                 | The wizard's last page is already a summary; "Review and install" also writes `onboarded: true` before anything has run |
| Credentials      | Not asked at all. Capabilities → Accounts & relays → Quick add → form → Save → review panel → Apply | The largest break: the agent is installed and cannot answer, and nothing says where to go next                          |
| Completion       | A "Still to do" list                                                                                | Gone the moment the panel closes                                                                                        |
| Afterwards       | Overview keeps showing "No coding agent installed"                                                  | The default surface ("In a window") installs Claude Desktop, and the finding only counts the CLIs                       |

Patterns borrowed: Cursor and Warp put sign-in inside the first three screens;
Cherry Studio and cc-switch open on "pick a provider → paste a key → test"; VS
Code's Walkthroughs are a persistent, resumable checklist on the welcome page;
Ninite and Setapp ask everything up front and then install unattended.

## Goal

The wizard ends at **"you can send your first message"**: the agent is installed
_and_ authenticated (official subscription login, API key, or relay). Credentials
are the only hard prerequisite. MCP servers and skills are enhancements and do
not stand in front of the first conversation.

## The new flow

```
Launch → wizard
  ① Pick an agent: Claude Code (default) / Codex / both   [□ also install the desktop app]
  ② How to connect (once per agent): official subscription / API key (tested) / relay (preset or custom, tested)
  ③ Network: its own step only when a proxy is needed (adopted by default); a mirror is one line in ④
  ④ Review and install: preflight brief, step list, Apply — the only gate; progress shown in the wizard
       └ on failure: FailureNotes + Retry, in place
  ⑤ Sign in (official subscription only): open a terminal running claude / codex login → poll login_status → auto-tick
  ⑥ Done → "Open claude in a terminal"
Overview "Getting started" checklist (ticked from measured state):
  installed → connected → first message (from the history scan) → optional: MCP keys / skills / desktop app / tour
```

Shortest path: Continue → official subscription → Apply → Sign in. Four clicks,
the same as today, but the agent works at the end of them.

## Decisions

### Scope of first run

1. **Endpoint** is installed + authenticated. MCP and skills are not part of it.
2. **Default surface is the terminal.** The target user is a developer, and the
   CLI is where skills, MCP and provider config actually take effect. The desktop
   app stays available as a secondary toggle (default off). Claude Desktop's Code
   tab also needs a paid plan, which made it a poor default.
3. **First run asks only what the endpoint needs.** Skill checkboxes and MCP key
   fields leave the wizard. The wizard always installs the chosen agent(s) plus
   the keyless core MCP servers (memory, sequential-thinking, fetch); keyed ones
   (context7, github) are offered from the checklist afterwards.
4. **The surface and bundle screens merge into one "which agent?" screen.**
   Minimal / Recommended / Everything leave the wizard; Quick setup (Presets)
   keeps them.

### Gates

5. **One gate, inside the wizard.** The invariant "every write goes through the
   review panel" protects _a human seeing the real steps before they run_, not
   the side sheet. The wizard's last pre-install step renders the same
   `pendingSteps`, the same `PreflightBrief` and the same Apply. Install progress
   stays in the wizard.
6. **`onboarded` is written once Apply has run** (whatever the outcome) or on a
   deliberate exit — never on "Review and install". Tying it to full success
   would reopen the wizard on every launch because one optional MCP server
   failed; the checklist already carries unfinished core items.

### Network

7. **A suggestion is adopted by default.** Continue applies it; "Keep direct"
   declines it. Today Continue silently ignores the suggestion unless "Use these
   settings" was clicked.
8. **Only a proxy earns its own step.** An npm or GitHub mirror suggestion is
   folded into the review step as one line. A proxy touches a local port and is
   worth a look.

### Credentials

9. **Asked before install, per selected agent.** Three options: official
   subscription (only the choice is recorded before install), API key, relay
   (preset or custom base URL). Asking everything before Apply means nobody is
   pulled back halfway through an install to answer a question.
10. **Provider writes join the same Apply** as the install steps — no second
    review panel.
11. **Test connection runs automatically and never blocks.** A failure shows the
    cause (401 = wrong key, transport error = network) and offers "Save anyway";
    some relays block `/models`. A passing test is a badge, not a precondition —
    the same principle as "a blocker is not a veto" in preflight.
12. **The auth variable follows from the option.** API key → `ANTHROPIC_API_KEY`;
    relay → the preset's `ANTHROPIC_AUTH_TOKEN`; Codex by `auth_mode`. The
    variable picker stays in the full Accounts & relays form only.
13. **More-token presets sit level with the other relay presets.** No special
    placement or auto-filled key.
14. **Official login is finished in the wizard.** "Sign in" opens the system
    terminal on `claude` (or `codex login`) — the same mechanism as Pi's
    `/login` — and polls `login_status`, which reads presence without a Keychain
    prompt and returns no credential. Where no terminal can be launched (Linux
    has no single answer) it falls back to copying the command; "Later" is
    always available.

### Install defaults

15. **Agents install with the official native installer by default**; npm becomes
    the alternative. The core path then no longer depends on Node or Homebrew;
    Node is installed only for npx-launched MCP servers, and its failure no longer
    takes the agent down with it. Upgrades go through the agent's own
    self-update; detection already uses `--version`.
16. **Existing npm installs are not migrated.** Native is the default for fresh
    installs only. Where `npmOwns` says npm owns the binary, upgrade and
    reinstall stay on npm — two `claude` binaries on PATH is the hardest kind of
    problem to diagnose.
17. **cc-switch leaves the default install.** It is offered only when the user
    picks the CC Switch-compatible provider store. The default store is native.

### After the wizard

18. **A persistent "Getting started" checklist on Overview.** Every tick comes
    from measured state (inventory + login status), never a manual click. It
    disappears when complete or dismissed, replaces the quick-start card and the
    first-run use of "No coding agent installed", and the completion screen
    points to it.
19. **"First message" is measured from the history scan**: at least one session
    for that agent. Otherwise the row offers "Open claude in a terminal".
20. **Existing users** never see the new wizard. The checklist shows only unmet
    items, so a user whose core items are satisfied never sees it at all.
21. **The tour leaves the wizard and shrinks** from 29 stops to about 7 (one per
    workspace, plus ⌘K and the change tray). Its entry points are the end of the
    checklist and Preferences.

## Defects found along the way (PR 1)

Independent correctness bugs, fixed first so the redesign starts from a clean
baseline:

1. **The probe reads a healthy machine as offline.** `PRIMARY_TEST_URL` is
   `https://api.anthropic.com/v1/models`, which answers 401 without a key, and
   `proxy_check` maps every status ≥ 400 to `ok: false` (`src-tauri/src/net.rs`),
   contradicting its own comment. `directOk` is therefore always false and the
   Overview warns "Nothing was reachable".
2. **Continue on the network step does not adopt the suggestion** (folded into
   decision 7 in PR 3; PR 1 only fixes the false negative feeding it).
3. **Homebrew is assumed on macOS.** Node, Claude Desktop, Codex app and cc-switch
   all install through `brew`, with no check; a missing brew surfaces as a
   `notFound` failure.
4. **On Linux without Node, the npm installs still run.** The manual Node blocker
   is not a `dependsOn`, so the CLI step runs and fails with "command not found".
5. **A desktop-only install still reports "No coding agent installed"**, and the
   quick-start card stays up: `AGENT_CLI_IDS` counts only `claude-code` and
   `codex`.

## Delivery

Five PRs, merged in order; each leaves the app whole.

1. **Defects** above.
2. **Install defaults** — native installer default, npm kept where it owns the
   binary; cc-switch out of the default bundle.
3. **Wizard restructure** — one "which agent?" screen, the review embedded in the
   wizard, the network step folded, the new `onboarded` timing, the tour link
   removed.
4. **Credentials** — the connect step, test connection, provider writes in the
   same Apply, official login via terminal + polling. Depends on 3.
5. **Checklist + shorter tour** — replaces the quick-start card; the completion
   screen points to it. Can run alongside 4.

Every PR holds the 90% coverage gate, with the new pure logic (agent-to-plan
selection, checklist state, auth-variable mapping) unit-tested in
`lib/agentpack`. The first-run e2e spec is updated, and CLAUDE.md's invariants
are rewritten where they change: onboarding invariant 1 ("only a deliberate exit
marks someone onboarded" → "Apply has run, or a deliberate exit"), the "Review
and install" copy note, and the two-gate description. PRs 3 and 4 are walked
through in `pnpm tauri dev` before delivery.
