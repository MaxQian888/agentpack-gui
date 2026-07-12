/**
 * Jest setup file
 * This file is executed before each test file
 */

import "@testing-library/jest-dom"
import React from "react"
import { webcrypto } from "node:crypto"

// jsdom lacks matchMedia — needed by next-themes and the shadcn use-mobile hook.
if (typeof window !== "undefined" && !window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }),
  })
}

// jsdom lacks ResizeObserver (recharts' ResponsiveContainer) and the pointer-
// capture / scrollIntoView methods Radix Dialog & Select call. Stub them so the
// history charts and transcript dialog can render under jsdom.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}
// jsdom lacks IntersectionObserver (used by useIncremental for windowed lists).
// A no-op stub never fires, so tests just render the initial window.
if (typeof globalThis.IntersectionObserver === "undefined") {
  globalThis.IntersectionObserver = class {
    root = null
    rootMargin = ""
    thresholds = []
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return []
    }
  } as unknown as typeof IntersectionObserver
}
if (typeof Element !== "undefined") {
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || jest.fn()
  Element.prototype.hasPointerCapture = Element.prototype.hasPointerCapture || jest.fn()
  Element.prototype.releasePointerCapture = Element.prototype.releasePointerCapture || jest.fn()
}

// jsdom lacks the Web Crypto API (ccconnect's web-admin token generator uses
// crypto.getRandomValues). Back it with Node's webcrypto so tests can exercise it.
if (typeof globalThis.crypto === "undefined" || !globalThis.crypto.getRandomValues) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true })
}

type MockNextImageProps = React.ComponentPropsWithoutRef<"img"> & {
  priority?: boolean
  fill?: boolean
}

// Mock Next.js Image component
jest.mock("next/image", () => ({
  __esModule: true,
  default: (props: MockNextImageProps) => {
    const normalizedProps = { ...props }
    delete normalizedProps.priority
    delete normalizedProps.fill
    return React.createElement("img", normalizedProps)
  },
}))

// Mock Next.js router
jest.mock("next/navigation", () => ({
  useRouter() {
    return {
      push: jest.fn(),
      replace: jest.fn(),
      prefetch: jest.fn(),
      back: jest.fn(),
      pathname: "/",
      query: {},
      asPath: "/",
    }
  },
  usePathname() {
    return "/"
  },
  useSearchParams() {
    return new URLSearchParams()
  },
}))

// Suppress console errors in tests (optional)
// global.console = {
//   ...console,
//   error: jest.fn(),
//   warn: jest.fn(),
// };
