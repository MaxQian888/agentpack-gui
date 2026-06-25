---
name: python
description: Use when setting up, building, testing, or packaging Python projects — creating/managing virtual environments, pyproject.toml, dependency management with uv/pip, dependency-groups, running CLI tools with uvx/uv tool, linting and formatting with ruff, type-checking with mypy/pyright/ty, running pytest, or publishing to PyPI. Triggers on Python, venv, uv, uvx, pip, pyproject, ruff, pytest, mypy, pyright, requirements.txt, dependency-groups.
---

# Python Project Engineering

Default to **uv** for environments and dependency management, **ruff** for lint+format, **pytest** for tests, **pyright/mypy** for types. Target a modern Python (current stable is 3.14; pick ≥ 3.11 as a floor, ≥ 3.12 if you don't need older interpreters).

## Environment & dependencies with uv

`uv` is a fast, all-in-one tool (replaces pip/venv/pip-tools/pyenv for most workflows).

```bash
uv init myproj && cd myproj      # scaffold pyproject.toml + src layout
uv add requests                  # add a runtime dep (writes pyproject + lock)
uv add --dev pytest ruff pyright # dev deps (== uv add --group dev, PEP 735)
uv sync                          # create/refresh .venv from uv.lock
uv run pytest                    # run inside the managed env (no manual activate)
uv run python script.py
uv lock --check                  # assert the lockfile is up to date (CI)
```

Run CLI tools without polluting the project env: `uvx ruff check .` (ephemeral, like `npx`) or `uv tool install ruff` (persistent global tool — replaces pipx).

If the project uses plain pip: `python -m venv .venv && . .venv/Scripts/activate` (Windows) or `source .venv/bin/activate` (POSIX), then `pip install -e .[dev]`.

## pyproject.toml (PEP 621)

```toml
[project]
name = "myproj"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = ["requests>=2.31"]

[project.scripts]
myproj = "myproj.cli:main"

# PEP 735 dependency-groups — not shipped to consumers, unlike optional-dependencies.
# This is what `uv add --dev <pkg>` writes to.
[dependency-groups]
dev = ["pytest>=8", "ruff>=0.6", "pyright>=1.1"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.ruff]
line-length = 100
target-version = "py312"              # align with requires-python; drives pyupgrade fixes
[tool.ruff.lint]
select = ["E", "F", "I", "UP", "B"]   # pyflakes, pycodestyle, isort, pyupgrade, bugbear
[tool.ruff.format]
docstring-code-format = true          # also format code blocks inside docstrings

[tool.pytest.ini_options]
addopts = "-ra"
testpaths = ["tests"]
```

Use a **src layout** (`src/myproj/`) so tests run against the installed package, not the working tree.

## Quality gates

```bash
uv run ruff format .          # format (replaces black)
uv run ruff check --fix .     # lint + autofix
uv run pyright                # or: uv run mypy src
uv run pytest -q              # tests
```

Wire these into pre-commit or CI. Fail the build on any non-zero exit.

**Type checker choice:** `pyright` and `mypy` are the stable options (mypy has the richer plugin ecosystem — Django, SQLAlchemy, pydantic v1). `ty` (Astral's Rust-based checker) is extremely fast but still **beta** with no plugin system — try it with `uvx ty check`, but don't make it the only gate yet.

## Testing with pytest

- Put tests under `tests/`, files `test_*.py`, functions `test_*`.
- Prefer plain `assert`; use fixtures for setup; `@pytest.mark.parametrize` for table-driven cases.
- `pytest -k name` to filter, `-x` to stop on first failure, `--cov=myproj` (pytest-cov) for coverage.
- Write a failing test for a bug first, then fix it.

## Packaging & publishing

```bash
uv build                      # produces dist/*.whl and *.tar.gz
uv publish                    # upload to PyPI (token via UV_PUBLISH_TOKEN)
```

In CI, prefer PyPI **Trusted Publishing** (OIDC) over a long-lived token — no `UV_PUBLISH_TOKEN` needed when the workflow is registered as a trusted publisher.

## Common pitfalls

- **`ModuleNotFoundError` for your own package** → not installed in editable mode; use `uv sync` or `pip install -e .`, and use a src layout.
- **Wrong interpreter** → confirm with `uv run python -c "import sys; print(sys.executable)"`; don't mix system pip and venv.
- **Activating venv on Windows PowerShell blocked** → `Set-ExecutionPolicy -Scope Process RemoteSigned`, or just use `uv run` and skip activation.
- **Ruff vs black/isort conflicts** → use ruff for both format and import sorting; remove black/isort to avoid fighting formatters.
- **Slow CI installs** → commit `uv.lock` and use `uv sync --frozen` (install from lock, don't re-resolve). Use `uv sync --locked` when you want CI to _fail_ if the lock is stale instead of silently using it.
- Verify by running ruff + pyright + pytest and showing their output — not by inspecting files alone.
