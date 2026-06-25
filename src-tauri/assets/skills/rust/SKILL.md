---
name: rust
description: Use when setting up, building, testing, or releasing Rust projects — creating Cargo packages/workspaces, managing dependencies, choosing an edition (2024) and MSRV, linting with clippy, formatting with rustfmt, writing async code with tokio, running tests with cargo test/nextest, auditing the supply chain, or publishing to crates.io. Triggers on Rust, cargo, clippy, rustfmt, tokio, crates.io, Cargo.toml, edition 2024, nextest, cargo audit.
---

# Rust Project Engineering

Default to **cargo** for everything, **clippy** for lint, **rustfmt** for formatting, and the built-in test harness. Use a recent stable toolchain via `rustup` (current stable is 1.96). New crates default to **edition 2024** (stabilized in Rust 1.85).

## Toolchain & project setup

```bash
rustup default stable            # or rustup toolchain install stable
cargo new myapp                  # binary crate (--lib for a library); defaults to edition 2024
cargo add tokio --features full  # add a dependency (edits Cargo.toml)
cargo add --dev proptest         # dev-dependency
cargo build                      # debug build; --release for optimized
cargo run -- arg1 arg2
```

Set the edition and a Minimum Supported Rust Version (MSRV) in the package manifest so the compiler enforces them:

```toml
[package]
name = "myapp"
edition = "2024"                 # 2024 implies the v3 dependency resolver
rust-version = "1.85"            # MSRV; cargo errors if a dep needs newer
```

Pin the toolchain per project with a `rust-toolchain.toml` so CI and contributors match:

```toml
[toolchain]
channel = "1.96.0"               # or "stable" to always track the latest release
components = ["clippy", "rustfmt"]
```

## Workspaces (multi-crate)

```toml
# top-level Cargo.toml
[workspace]
members = ["crates/*"]
resolver = "3"                   # set explicitly: a virtual root has no edition to infer it from

[workspace.dependencies]
serde = { version = "1", features = ["derive"] }
```

Member crates reference shared deps with `serde = { workspace = true }`. Keeps versions aligned and builds cached. (Edition-2024 packages get resolver 3 automatically, but a virtual workspace root — no `[package]` — does not, so declare it.)

## Quality gates

```bash
cargo fmt --all                  # format (check-only: cargo fmt --all -- --check)
cargo clippy --all-targets --all-features -- -D warnings   # lint, fail on warnings
cargo clippy --fix               # auto-apply machine-fixable lints (add --allow-dirty if uncommitted)
cargo test                       # unit + integration + doc tests
cargo test --doc                 # doc tests only
```

Wire these into CI and fail on any non-zero exit. `-D warnings` turns clippy lints into errors.

**Supply chain:** add `cargo audit` (RustSec advisory scan) or `cargo deny check` (advisories + license/bans/duplicates) as a CI gate. **Faster tests:** `cargo nextest run` is the de-facto standard runner — parallel, better output, flaky-retry support (doc tests still go through `cargo test --doc`).

## Testing

- Unit tests live in the same file under `#[cfg(test)] mod tests { ... }`.
- Integration tests go in `tests/`, each file is its own crate.
- Use `#[tokio::test]` for async tests; `assert_eq!` / `assert!` for checks.
- `cargo test name` filters; `cargo test -- --nocapture` shows stdout.
- Reproduce a bug with a failing test first, then fix it.

## Async with tokio

```rust
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let body = reqwest::get("https://example.com").await?.text().await?;
    println!("{body}");
    Ok(())
}
```

Current majors: `tokio = "1"`, `reqwest = "0.13"`, `anyhow = "1"`, `thiserror = "2"`. Prefer `anyhow::Result` for application error handling and `thiserror` (now 2.x) for library error types. Avoid `.unwrap()` outside tests/prototypes.

## Release & publish

```bash
cargo build --release            # target/release/
cargo publish --dry-run          # validate package
cargo publish                    # upload to crates.io (needs cargo login)
```

## Common pitfalls

- **Borrow-checker fights** → clone for a first pass, then refactor to references/lifetimes once it compiles; don't reach for `unsafe`.
- **Slow incremental builds** → keep `target/` cached in CI; split large crates; use `cargo check` for fast feedback loops.
- **Feature unification surprises** → a dependency's features are merged across the build graph; audit with `cargo tree -f "{p} {f}"`.
- **`unwrap()` panics in production** → propagate with `?` and typed errors instead.
- **Migrating an old crate to edition 2024** → bump `edition` and run `cargo fix --edition` (apply suggested changes), then `cargo build` to confirm; 2024 tightens a few rules (e.g. `unsafe` blocks for some operations), so expect a handful of mechanical fixes.
- Verify by running fmt + clippy + test and showing their output — not by reading code alone.
