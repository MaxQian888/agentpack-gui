import type { en } from "./en"

/** Supported interface languages. */
export type Lang = "en" | "zh-CN"

/**
 * The full message-catalog shape, derived from the English catalog (the single
 * source of truth). Every locale must structurally satisfy this type.
 */
export type Messages = typeof en

/** Narrow subset of messages passed into low-level core helpers. */
export type CoreOutput = Messages["coreOutput"]
