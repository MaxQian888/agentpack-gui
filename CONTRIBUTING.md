# Contributing to agentpack

Thank you for your interest in contributing to agentpack! This document provides guidelines and instructions for contributing.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Architecture](#architecture)
- [Making Changes](#making-changes)
- [Commit Guidelines](#commit-guidelines)
- [Pull Request Process](#pull-request-process)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Documentation](#documentation)

## Code of Conduct

See [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md).

## Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/agentpack-gui.git
   cd agentpack-gui
   ```
3. **Add the upstream remote**:
   ```bash
   git remote add upstream https://github.com/Arxtect/agentpack-gui.git
   ```

## Development Setup

### Prerequisites

- **Node.js** 20.x or later
- **pnpm** 10.x (the repo pins it via `packageManager`)
- **Rust** 1.95+ — pinned in `src-tauri/rust-toolchain.toml`
- Platform toolchain for Tauri builds: MSVC Build Tools (Windows), Xcode Command
  Line Tools (macOS), or the GTK/WebKit dev packages (Linux — see
  `.github/workflows/build-tauri.yml` for the exact apt list)

### Installation

This is a **pnpm workspace**; always install from the repo root.

```bash
pnpm install

pnpm dev        # UI only, in a browser at http://localhost:3000
pnpm tauri dev  # the real desktop app, with hot reload
```

`pnpm dev` is useful for layout work, but every system-touching operation is a
Tauri command — installs, scans and file writes only work under `pnpm tauri dev`.
`isTauri()` gates those paths, and the UI says so when it's running in a browser.

### Verify Setup

```bash
pnpm lint          # ESLint
pnpm typecheck     # tsc --noEmit
pnpm format:check  # Prettier
pnpm test          # Jest
pnpm tauri info    # Tauri environment report
```

Rust lives under `src-tauri/`:

```bash
cd src-tauri
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all-features
```

## Architecture

The split that matters: **pure TypeScript logic** on one side, **Rust
side-effects** on the other, with one typed bridge between them.

| Layer        | Where                                           | Rule                                                  |
| ------------ | ----------------------------------------------- | ----------------------------------------------------- |
| Pure logic   | `lib/agentpack/`, `lib/history/`, `lib/skills/` | No Node builtins, no Tauri, no DOM. Unit-tested.      |
| The bridge   | `lib/tauri/commands.ts`                         | The **only** place that calls `invoke()`.             |
| Side-effects | `src-tauri/src/`                                | Process exec, filesystem, SQLite, network.            |
| UI           | `components/agentpack/`                         | Prop-driven sections; scans are owned by `app-shell`. |

Key consequences:

- **Dry-run is structural.** In preview mode `lib/agentpack/runner.ts` renders
  the "would …" lines locally and never calls a mutating Rust command. It cannot
  accidentally write, because the write path isn't taken at all.
- **A `Plan` becomes a `StepDescriptor[]`** (`lib/agentpack/plan.ts`) before
  anything runs, so the same description drives both the preview and the run.
- **History is read-only.** `src-tauri/src/history.rs` parses three on-disk
  formats (Claude JSONL, Codex rollout JSONL, OpenCode SQLite) and normalizes
  them into one model; nothing writes back.

`CLAUDE.md` carries the deeper notes — the two-cache history scan, the Claude
per-content-block dedup rule, the frameless-window config, and the accounting
rules that must not drift.

### Workspace layout

| Path                    | What                                                                  |
| ----------------------- | --------------------------------------------------------------------- |
| `app/`                  | Next.js App Router (static export — do not remove `output: "export"`) |
| `components/agentpack/` | The application UI                                                    |
| `components/ui/`        | shadcn/ui primitives — all 57 are pre-installed                       |
| `lib/`                  | Pure logic, the Tauri bridge, and the i18n catalog                    |
| `src-tauri/`            | The Rust backend and Tauri config                                     |
| `docs/`                 | Fumadocs site (a separate workspace package, port 3001)               |
| `e2e/`                  | Playwright specs (web mode, Tauri mocked)                             |

### Adding a Tauri command

1. Write it in the right `src-tauri/src/*.rs` module.
2. Register it in the `invoke_handler![…]` list in `src-tauri/src/lib.rs`.
3. Add a typed wrapper to `lib/tauri/commands.ts` — nothing else may call
   `invoke()` directly.
4. Cover the wrapper in `lib/tauri/commands.test.ts`. A mismatch between the TS
   argument key and the Rust parameter name compiles fine on both sides and only
   fails at runtime, so that test is the guardrail.

### Internationalization

`lib/i18n/en.ts` is the source of truth and `Messages = typeof en`, so
`zh-CN.ts` is type-checked against it — a missing or misspelled key is a
compile error, not a runtime blank. Every user-visible string goes through
`useT()`; nothing user-facing is hard-coded in a component.

## Making Changes

### Branch Naming

Create a feature branch from `master`:

```bash
git checkout master
git pull upstream master
git checkout -b <type>/<description>
```

Branch types:

- `feat/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation changes
- `refactor/` - Code refactoring
- `test/` - Test additions or modifications
- `chore/` - Maintenance tasks

Examples:

- `feat/add-dark-mode-toggle`
- `fix/navigation-scroll-issue`
- `docs/update-installation-guide`

### Keep Your Fork Updated

```bash
git fetch upstream
git checkout master
git merge upstream/master
```

## Commit Guidelines

We follow [Conventional Commits](https://www.conventionalcommits.org/) specification.

### Commit Message Format

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

### Types

| Type       | Description                                             |
| ---------- | ------------------------------------------------------- |
| `feat`     | New feature                                             |
| `fix`      | Bug fix                                                 |
| `docs`     | Documentation only                                      |
| `style`    | Code style (formatting, semicolons, etc.)               |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `perf`     | Performance improvement                                 |
| `test`     | Adding or updating tests                                |
| `build`    | Build system or external dependencies                   |
| `ci`       | CI/CD configuration                                     |
| `chore`    | Other changes that don't modify src or test files       |
| `revert`   | Reverts a previous commit                               |

### Examples

```bash
feat(ui): add Button component variants
fix(auth): resolve token refresh loop
docs(readme): update installation instructions
refactor(utils): simplify cn helper function
test(button): add accessibility tests
```

## Pull Request Process

1. **Update your branch** with the latest upstream changes
2. **Run all checks locally**:
   ```bash
   pnpm lint
   pnpm test
   pnpm build
   ```
3. **Push your branch** to your fork
4. **Create a Pull Request** against `main`
5. **Fill out the PR template** completely
6. **Request review** from maintainers
7. **Address feedback** and make requested changes
8. **Squash commits** if requested

### PR Checklist

- [ ] Code follows project style guidelines
- [ ] Self-reviewed the code
- [ ] Added/updated tests as needed
- [ ] Updated documentation as needed
- [ ] All CI checks pass
- [ ] Linked related issues

## Coding Standards

**Tooling enforcement** (auto-runs on commit):

- **Prettier** formats staged files via `lint-staged`
- **ESLint --fix** runs on staged TS/JS files
- **commitlint** validates commit messages against Conventional Commits

First-time setup: `pnpm install` — the `prepare` script installs git hooks via Husky. If hooks don't fire, run `pnpm exec husky` manually.

### TypeScript

- Use TypeScript for all new code
- Enable strict mode
- Avoid `any` type; use proper typing
- Export types from dedicated type files when shared

### React

- Use functional components with hooks
- Follow React 19 best practices
- Keep components small and focused
- Use proper prop typing

### Styling

- Use Tailwind CSS utility classes
- Follow the existing design system
- Use CSS variables for theming
- Avoid inline styles

### File Organization

```
components/
├── ui/           # shadcn/ui components
│   └── button.tsx
├── feature/      # Feature-specific components
│   └── header.tsx
└── index.ts      # Barrel exports
```

### Naming Conventions

| Type             | Convention                  | Example           |
| ---------------- | --------------------------- | ----------------- |
| Components       | PascalCase                  | `UserProfile.tsx` |
| Hooks            | camelCase with `use` prefix | `useAuth.ts`      |
| Utilities        | camelCase                   | `formatDate.ts`   |
| Types/Interfaces | PascalCase                  | `UserData`        |
| Constants        | SCREAMING_SNAKE_CASE        | `MAX_RETRIES`     |

## Testing

### Running Tests

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run with coverage
pnpm test:coverage
```

### Writing Tests

- Place tests next to source files: `Component.test.tsx`
- Use React Testing Library for component tests
- Test behavior, not implementation details
- Aim for meaningful coverage, not 100%

### Test Structure

```typescript
import { render, screen } from '@testing-library/react'
import { Button } from './button'

describe('Button', () => {
  it('renders children correctly', () => {
    render(<Button>Click me</Button>)
    expect(screen.getByRole('button')).toHaveTextContent('Click me')
  })

  it('handles click events', async () => {
    const handleClick = jest.fn()
    render(<Button onClick={handleClick}>Click</Button>)
    await userEvent.click(screen.getByRole('button'))
    expect(handleClick).toHaveBeenCalledTimes(1)
  })
})
```

## Documentation

### When to Update Docs

- Adding new features
- Changing existing behavior
- Updating dependencies
- Modifying configuration

### Documentation Files

- `README.md` - Project overview and quick start
- `README_zh.md` - Chinese documentation
- `CONTRIBUTING.md` - This file
- `CI_CD.md` - CI/CD setup guide
- `TESTING.md` - Testing guide

### Code Comments

- Use JSDoc for public APIs
- Explain "why", not "what"
- Keep comments up to date

## Questions?

If you have questions, feel free to:

1. Check existing [Issues](https://github.com/Arxtect/agentpack-gui/issues)
2. Open a new issue for discussion
3. Reach out to maintainers

Thank you for contributing! 🎉
