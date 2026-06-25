---
name: web-frontend
description: Use when building or maintaining web frontends with React and TypeScript — scaffolding with Vite, styling with Tailwind CSS v4, component structure, state and data fetching, ESLint flat config, testing with Vitest/Testing Library/Playwright, and accessibility. Triggers on React, TypeScript, Vite, Tailwind, frontend, component, hooks, Vitest, Testing Library, ESLint, eslint.config.js, a11y.
---

# Web Frontend Engineering (React + TypeScript)

Default to **Vite** for tooling, **TypeScript (strict)**, **Tailwind v4** for styling, **Vitest + Testing Library** for unit/component tests, and **Playwright** for E2E. Target modern evergreen browsers. Current major versions: React 19, Vite 8, Tailwind 4, Vitest 4, TanStack Query 5, TypeScript 6, ESLint 10 (flat config). Requires Node 20.19+ or 22.12+.

## Scaffold & run

```bash
npm create vite@latest myapp -- --template react-ts   # needs Node 20.19+ or 22.12+
cd myapp && npm install
npm run dev            # dev server with HMR
npm run build          # production build to dist/ (runs tsc + bundler)
npm run preview        # serve the build locally
```

Enable strict TypeScript in `tsconfig.json` (`"strict": true`). Add path aliases (`@/*`) once relative imports get deep. The `react-ts` template scaffolds an ESLint **flat config** (`eslint.config.js`) using `typescript-eslint` v8 plus the React Hooks / React Refresh plugins — `.eslintrc` is no longer supported in ESLint 9+.

## Tailwind

```bash
npm install -D tailwindcss @tailwindcss/vite
```

Add `tailwindcss()` to `plugins` in `vite.config.ts` and `@import "tailwindcss";` to your CSS entry. Tailwind v4 is **CSS-first**: customize tokens in a `@theme { ... }` block in CSS (no `tailwind.config.js`, no PostCSS, no separate `init` step). Keep design tokens (colors, spacing) in the theme; avoid scattering magic values.

## Component structure

- One component per file; colocate `Component.tsx`, `Component.test.tsx`, and styles.
- Keep components small and focused; lift shared state up, push side effects to the edges.
- Type props explicitly; prefer discriminated unions over boolean soup.
- Data fetching: prefer a cache library (TanStack Query) over ad-hoc `useEffect` fetches for server state.
- React 19: `ref` is a plain prop now (no `forwardRef`); use **Actions** + `useActionState`/`useFormStatus` for form mutations, and the `use` hook to read promises/context. With the **React Compiler** enabled you can drop most manual `useMemo`/`useCallback`.

```tsx
interface Props {
  label: string
  onPress: () => void
}

export function Button({ label, onPress }: Props) {
  return (
    <button type="button" className="rounded bg-blue-600 px-3 py-1 text-white" onClick={onPress}>
      {label}
    </button>
  )
}
```

## Testing

```bash
npm run test           # vitest run
npx playwright test    # E2E
```

- Query the DOM by **accessible role/name** (`getByRole("button", { name: /save/i })`), not test ids.
- Test behavior the user observes, not implementation details.
- Write a failing test for a bug first, then fix it.

## Accessibility (a11y)

- Use semantic elements (`<button>`, `<nav>`, `<main>`, headings in order).
- Every interactive control is keyboard-reachable and has an accessible name.
- Images need `alt`; form inputs need associated `<label>`s.
- Check color contrast; don't convey state by color alone.

## Quality gates

```bash
npm run build          # tsc + bundler must pass
npx tsc --noEmit       # type-check
npx eslint .           # lint (if configured)
npm run test
```

Fail CI on any non-zero exit.

## Common pitfalls

- **`useEffect` for server state** → use a query cache; reserve effects for true side effects (subscriptions, DOM).
- **Stale closures in effects** → list every dependency, or restructure so the value isn't captured.
- **Unkeyed lists** → give stable `key`s (not array index for reorderable lists).
- **Tailwind class soup** → extract components, not `@apply` everywhere; share tokens via the theme.
- **Inaccessible custom widgets** → prefer native elements; if you must build one, follow the WAI-ARIA authoring pattern.
- Verify by running the build, type-check, and tests and showing their output — not by reading code alone.
