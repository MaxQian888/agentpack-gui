<!-- Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V4 -->

# agentpack — design system

Genre **modern-minimal** · theme **Cobalt** · application structure **Workbench**.

This file is the locked system for the app. `tokens.css` at the repo root is its
machine-readable half; `app/globals.css` maps the shadcn variable names onto
those tokens so all 56 `components/ui/` components inherit the system without
being rewritten. Read this before adding a surface; add a token before adding a
value.

Scope: the desktop app (`app/`, `components/`). The docs site (`docs/`) keeps
Fumadocs' own theme and is out of scope.

---

## 1. What this app is

An instrument panel for a developer's own machine. It reads the machine's state,
proposes changes, shows exactly what it will write, then writes it. Four moves,
in order, every time:

**diagnose → understand the proposal → review the change → apply it, with a way back.**

Everything below serves that sentence. When a design decision is ambiguous, the
tiebreaker is: _does this make the next change easier to review?_

Two consequences that are not negotiable:

- **No surface writes to disk without passing the review panel.** Not a card, not
  a menu item, not a one-click. The review panel is the only door.
- **Preview never lies.** A preview renders locally and calls no mutating
  command. If the app can't do something (web mode), it says so instead of
  showing a disabled-looking control or, worse, a success toast.

## 2. Voice

Declarative, technical, specific. Name the file, the command, the version, the
count. The app is talking to someone who could do this by hand and would like
not to.

- **Do:** "Writes 3 servers to `~/.claude.json`." · "Node 20.11 → 22.14." ·
  "Couldn't read `~/.codex/config.toml`."
- **Don't:** "Seamlessly supercharge your setup." · "Something went wrong." ·
  "Click here."
- Buttons name the destination or the effect: _Review changes_, _Apply changes_,
  _Preview only_, _Rescan_ — never _Submit_, _OK_, _Go_.
- Errors are three parts: what failed, the reason as the system reported it, and
  the one thing to try. No apology, no exclamation mark.
- Numbers are never invented. A metric the app hasn't measured renders as `—`
  with the reason, not as a plausible-looking zero. (An unpriced model is
  reported unpriced — see `lib/history/pricing.ts`.)

## 3. Colour

One paper, three inks, one signal. That is the whole palette; everything else is
a status mark.

| Role            | Token                    | Rule                                                 |
| --------------- | ------------------------ | ---------------------------------------------------- |
| Ground          | `--hm-paper`             | cool near-white (`98.5%`), never `#fff`              |
| Raised well     | `--hm-paper-2`           | the rail, table headers, inset areas                 |
| Hover / pressed | `--hm-paper-3` / `-4`    | interaction only, never decoration                   |
| Ink             | `--hm-ink` / `-2` / `-3` | headings / body / meta — cool charcoal, never `#000` |
| Rule            | `--hm-rule` / `-2`       | 1px. **This is the layout.**                         |
| Signal          | `--hm-accent`            | electric cobalt, hue 256                             |

**The 5% rule.** The cobalt may not exceed roughly 5% of any viewport. In
practice that means: the active rail item, one primary button per view, focus
rings, links, and live status. If a screen has two primary buttons, one of them
is wrong.

**Status colour is functional, never decorative.** `--hm-ok`, `--hm-warn`,
`--hm-danger` and `--hm-neutral` appear as a dot, a chip, or one word of text.
They are never a filled card background — a wall of tinted panels is how a
dashboard stops meaning anything. The four run statuses map straight onto them
(`done` → ok, `warning` → warn, `error` → danger, `skipped` → neutral), and
`cancelled` reads as neutral with its own label.

**Banned outright:** gradients on text or surfaces, glassmorphism, mesh/aurora
blobs, background textures, coloured drop shadows, and the four-uniform-coloured-
stat-card row. If a value needs emphasis, make it bigger or set it in mono —
don't paint it.

**Contrast floor.** Body text ≥ 4.5:1, meta and disabled ≥ 4.5:1 against their
own ground (we do not use contrast as the disabled signal — see § 7), non-text
UI boundaries and the focus ring ≥ 3:1. Both themes. The dark accent is lifted
to `70%` precisely to clear this on graphite.

## 4. Type

Geist for everything, Geist Mono for anything that is read as data.

- **Mono means "this is a value the machine produced":** paths, versions,
  commands, token counts, costs, durations, keyboard hints, model ids, status
  readouts. Mono labels that act as eyebrows are UPPERCASE at
  `--hm-tracking-mono`.
- Scale is a major third from 14px (`--hm-text-*`). A workspace title is `2xl`,
  a section title `xl`, a panel title `lg`, body `base`, meta `xs`.
- Display sizes (`xl` and up) take `--hm-tracking-tight`. Nothing else gets
  tracking.
- **All headings are roman.** No italic display type, and no italicised word
  inside a heading. Emphasis is weight (500/600) or the accent, never slant.
  Italic survives only as emphasis inside running body copy.
- Weight range is 400/500/600. There is no 700 in this app.
- Measure caps at ~72ch for prose; log output and transcripts are exempt.

## 5. Structure

**Hairlines do the work.** A panel is a 1px rule and 10px radius on the same
paper as its ground. It is not lifted, tinted, or shadowed. Nested panels are a
smell — if content needs a box inside a box, it needs a section rule instead.

- Controls `--hm-radius-control` (6px); containers `--hm-radius-surface` (10px);
  `--hm-radius-dot` is for status dots and count bubbles only. No pills on
  buttons.
- `shadow-2xs/xs/sm` are cut to `none` globally. `shadow-md/lg` survive **only**
  for true overlays (dialog, popover, dropdown, sheet), which float above a
  scrim where a rule alone can't carry the boundary.
- Spacing comes from `--hm-space-*` only. The rhythm inside a panel is
  `sm`/`md`; between panels `lg`; between sections `xl`.
- **No repeated identical cards.** Three cards of the same shape in a row is the
  single most reliable generated-UI tell. Vary by content weight: one wide
  primary panel plus narrower supporting ones, or a list with rules instead of
  cards.

### The Workbench shell

```
┌────────────┬──────────────────────────────────────────────┐
│            │  context · ⌘K · theme · window controls      │  header
│  task      ├──────────────────────────────────────────────┤
│  rail      │  [ sub-tab  sub-tab  sub-tab ]               │  workspace tabs
│  (7)       │                                              │
│            │  workspace                                   │
│            │                                              │
│            ├──────────────────────────────────────────────┤
│            │  n selected · Clear · Review changes →        │  change tray
└────────────┴──────────────────────────────────────────────┘
```

Seven task domains: **Overview · Install & repair · Capabilities · My account ·
Accounts & quota · Usage · Settings**. Personal self-service and administrator
operations are separate workspaces backed by separate instance packages and
credentials. Each maps onto section keys as sub-tabs; no route or capability is
removed, only regrouped. The rail is
`--hm-rail-width` from 900px and `--hm-rail-width-wide` from 1200px; below
desktop it collapses into a navigation Sheet with the same order and labels.

The header carries current context, the ⌘K affordance, theme and window
controls — nothing else. The old Run ▾ menu and the global dry-run switch are
gone: a run now starts from the workspace it belongs to and is previewed inside
the review panel, where the steps are visible.

The change tray appears only when the current install plan has selections. It
states the count, offers _Clear selection_, and its one primary action is
_Review changes_. Below 900px the selection summary folds into it.

## 6. Motion

Motion-cut project — there is no animation library and none is being added. Two
things move:

1. **Panel entry** — 180ms fade plus ≤ 8px rise on `--hm-ease-out`, once.
2. **State indication** — a running step's spinner, a progress bar, the tray
   sliding in at 260ms.

Both entrances live in `app/globals.css` as `hm-enter` (a destination arriving,
replayed by the shell on every navigation, `--hm-rise` of travel) and
`hm-tray-in`. Overlays are part of the same system: dialogs and the review
panel enter on `--hm-ease-out` at `--hm-dur-base` / `--hm-dur-slow` and leave
faster on `--hm-ease-in` — an exit is never slower than the entrance.

Anything that _moves_ animates `transform` and `opacity` only — never
top/left/width/height, which is why the tour's spotlight jumps rather than
glides. A control changing colour on hover or press may cross-fade at
`--hm-dur-fast`; that is a state change, not motion, and it never uses
`transition-all`. Use the three named easings; never the browser default
`ease`, never bounce or overshoot. The focus ring never animates.
`prefers-reduced-motion: reduce` collapses all of it to ≈0ms globally
(`app/globals.css`), and nothing that carries information is motion-only.

If removing an animation would lose the user no information, remove it.

## 7. States

Every interactive element ships all eight: **default · hover · focus-visible ·
active · disabled · loading · error · success.**

- **focus-visible** is `--hm-focus-width` solid `--hm-focus` at
  `--hm-focus-offset`, instantly, on every focusable element including custom
  ones.
- **disabled** is `opacity` plus `cursor: not-allowed` plus — always — a reason
  the user can read. A disabled control with no explanation is a bug. In web
  mode the reason is `DesktopOnlyNote`, not a greyed-out button.
- **loading** keeps the control's width so the layout doesn't jump, and replaces
  the label rather than adding a spinner beside it.
- **success** is silent by default. A toast is for something the user can't see;
  if the row already turned green, the toast is noise. Never toast a write that
  was skipped.
- **error** stays on screen with the failure text and a retry that re-runs only
  what failed.

## 8. Responsive

The desktop window floor is **900 × 600**; it is also a real target, not a
degraded one. Verified at 900 × 600, 1100 × 760, 1440 × 900 and 2000 × 1100, and
— because web mode is a shipping target with its own e2e suite — at
320 / 375 / 414 / 768.

The content column has **three** caps, not two (`--hm-content-width*`): a reading
measure for text-led sections, a wider one for the workbench grids, and a third
step at a 1600px viewport so a window larger than anything above stops turning
its extra width into margin. At 2000 × 1100 the wide column was sitting at 72rem
with ~290px of dead space on each side. The reading measure deliberately skips
the third step — a paragraph 1600px wide is harder to read, not easier — and
nothing below 1600px changes, so every size verified before it is untouched.

Non-negotiables at every width: no horizontal scroll on the page body (wide
tables, charts and log output scroll inside their own `overflow-x: auto`
container); no two-line clickable text on a button, tab or rail item; grid
tracks that carry content use `minmax(0, 1fr)`; long unbroken strings — paths,
package names, model ids — wrap with `overflow-wrap: anywhere`.

## 9. Bilingual

Every string ships in `en` and `zh-CN` (`lib/i18n/`, `Messages = typeof en`).
Chinese labels run ~30% shorter and wrap differently: never size a control to
its English label, never centre a label in a fixed-width box, and check the rail
and tab strip in both languages. No string is composed by concatenation at the
call site — the catalog owns the sentence.

## 10. Privacy

The app reads a developer's machine, so what it _records_ is part of the design.

- The activity log stores what happened — title, source, timestamp, overall
  status, per-step status and duration, restore point. It does **not** store
  command output, config file bodies, environment variables, or API keys.
- The command palette indexes destinations and global actions. It does **not**
  index chat transcripts, config contents, or keys.
- Operational account data leaves the machine only for explicitly saved
  more-token instances through the fixed-path Rust adapter; credentials remain
  in the OS credential store or process memory and never enter React state.
- A personal package is bound to the paired user and exposes only that user's
  profile, balance, ledger, usage, and security. A management package owns
  account relationships, quota operations, policy, audit, and alerts. The two
  packages use different route maps, token prefixes, and credential namespaces.

## 11. Exports

`tokens.css` (root) is the canonical export and is imported at the top of
`app/globals.css`. The shadcn CSS-variable mapping lives in the
`Hallmark · Cobalt mapping` block of that same file, and the Tailwind scale
corrections (radii, cut shadows) in the `@theme inline` block directly below it.
There is no separate Tailwind config or DTCG export: this project has exactly
one consumer.

To change a value, change it in `tokens.css`. If you find yourself typing an
`oklch(...)`, a `px` radius, or a `font-family` anywhere else, add a token
instead.
