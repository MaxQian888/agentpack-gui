---
name: cpp-cmake
description: Use when building, configuring, or debugging C++ projects with CMake — setting up CMakeLists.txt, CMakePresets.json, toolchain files, vcpkg/Conan dependencies, out-of-source builds, C++23 standard, C++20 modules, install/export, cross-compilation, or diagnosing CMake/linker errors. Triggers on CMake, CMakePresets, C++ build, target_link_libraries, find_package, vcpkg, ninja, install(TARGETS), compile errors in C/C++ projects.
---

# C++ Engineering with CMake

Guidance for modern, maintainable C++ builds. Default to **CMake ≥ 3.28 + presets + Ninja** (current stable is the 4.x line, e.g. 4.3). A 3.28 floor unlocks C++20 modules and `CMakePresets.json` schema v8.

## Project layout (out-of-source)

```
project/
├── CMakeLists.txt          # top-level
├── CMakePresets.json       # configure/build/test presets
├── cmake/                  # helper modules, toolchain files
├── include/<proj>/         # public headers
├── src/                    # sources + private headers
├── tests/                  # CTest targets
└── build/                  # generated, gitignored — NEVER commit
```

Always build out-of-source: `cmake --preset debug && cmake --build --preset debug`. Never run `cmake .` in the source tree.

## Modern CMakeLists.txt skeleton

```cmake
cmake_minimum_required(VERSION 3.28...4.3)   # range form: min..max-tested, avoids policy warnings on new CMake
project(myproj VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 23)               # C++23 is broadly supported (GCC 14+, Clang 18+, MSVC 19.4x)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)   # for clangd / tooling

add_library(core src/core.cpp)
target_include_directories(core PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
  $<INSTALL_INTERFACE:include>)
target_compile_features(core PUBLIC cxx_std_23)   # cxx_std_26 exists but is still partial/experimental

add_executable(app src/main.cpp)
target_link_libraries(app PRIVATE core)
```

**Target-centric rules** — prefer `target_*` over global commands:

- Use `target_link_libraries`, `target_include_directories`, `target_compile_definitions`.
- Choose visibility deliberately: `PUBLIC` (used by target + consumers), `PRIVATE` (target only), `INTERFACE` (consumers only).
- Never hardcode `-I`/`-l` in `CMAKE_CXX_FLAGS`; never glob sources for build inputs you care about (globs miss new files unless re-configured).

## CMakePresets.json

```json
{
  "version": 8,
  "configurePresets": [
    {
      "name": "debug",
      "generator": "Ninja",
      "binaryDir": "${sourceDir}/build/debug",
      "cacheVariables": { "CMAKE_BUILD_TYPE": "Debug" }
    },
    {
      "name": "release",
      "inherits": "debug",
      "binaryDir": "${sourceDir}/build/release",
      "cacheVariables": { "CMAKE_BUILD_TYPE": "Release" }
    }
  ],
  "buildPresets": [
    { "name": "debug", "configurePreset": "debug" },
    { "name": "release", "configurePreset": "release" }
  ],
  "testPresets": [
    { "name": "debug", "configurePreset": "debug", "output": { "outputOnFailure": true } }
  ]
}
```

## Dependencies

**vcpkg (manifest mode)** — add `vcpkg.json` with a `dependencies` array plus a `builtin-baseline` (a vcpkg commit SHA) so versions are reproducible; generate it with `vcpkg x-update-baseline --add-initial-baseline`. Then point CMake at the toolchain file via a preset:

```json
"cacheVariables": {
  "CMAKE_TOOLCHAIN_FILE": "$env{VCPKG_ROOT}/scripts/buildsystems/vcpkg.cmake"
}
```

Then `find_package(fmt CONFIG REQUIRED)` and `target_link_libraries(app PRIVATE fmt::fmt)`. Use `vcpkg-configuration.json` to add overlay/extra registries.

**FetchContent** for header-only / small deps without a package manager:

```cmake
include(FetchContent)
FetchContent_Declare(json URL https://github.com/nlohmann/json/releases/download/v3.11.3/json.tar.xz)
FetchContent_MakeAvailable(json)
```

## Testing with CTest

```cmake
enable_testing()
add_executable(unit tests/unit.cpp)
target_link_libraries(unit PRIVATE core)   # + GoogleTest/Catch2 if used
add_test(NAME unit COMMAND unit)
```

Run: `ctest --preset debug` (or `ctest --test-dir build/debug --output-on-failure`).

## Installing & exporting a library

Make a target consumable via `find_package` by other projects:

```cmake
include(GNUInstallDirs)
install(TARGETS core EXPORT coreTargets
  ARCHIVE DESTINATION ${CMAKE_INSTALL_LIBDIR}
  LIBRARY DESTINATION ${CMAKE_INSTALL_LIBDIR}
  RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR})
install(DIRECTORY include/ DESTINATION ${CMAKE_INSTALL_INCLUDEDIR})
install(EXPORT coreTargets NAMESPACE myproj:: DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/myproj)
```

## C++20 modules (optional)

Native since CMake 3.28 (Ninja + a scanning-capable compiler: MSVC 14.34+, Clang 16+, GCC 14+). Enable per target with `set_target_properties(app PROPERTIES CXX_SCAN_FOR_MODULES ON)`. `import std;` is available from 3.30 via the experimental `CXX_MODULE_STD` property (C++23 only) — treat as bleeding-edge.

## Common pitfalls

- **"No CMAKE_CXX_COMPILER could be found"** → install a compiler / on Windows run from a Developer prompt or install Ninja + MSVC/clang.
- **Linker `undefined reference`** → a `target_link_libraries` is missing or link order matters for static libs; ensure the symbol's library is listed.
- **find_package fails** → wrong `CMAKE_PREFIX_PATH`/toolchain; use `CONFIG` mode for modern packages; check `<pkg>_DIR`.
- **Stale cache after editing CMakeLists** → delete the `build/<preset>` dir and re-configure if variables don't take effect.
- **compile_commands.json not found by clangd** → ensure `CMAKE_EXPORT_COMPILE_COMMANDS=ON` and symlink/copy it to the project root.
- Verify changes by actually configuring + building + running CTest, not by reading CMakeLists alone.
