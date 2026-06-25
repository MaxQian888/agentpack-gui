---
name: android
description: Use when building, configuring, or debugging Android apps — Gradle build scripts (Kotlin DSL), Kotlin/Compose plugin setup, SDK/NDK setup, build variants and flavors, adb device/log workflows, dependency and version-catalog management, signing/release builds, or diagnosing Gradle/AGP build failures. Triggers on Android, Gradle, build.gradle.kts, AGP, Kotlin, Jetpack Compose, libs.versions.toml, adb, NDK, APK, AAB, Jetpack.
---

# Android Engineering with Gradle

Default to **Gradle Kotlin DSL (`.gradle.kts`) + version catalogs + AGP (Android Gradle Plugin)**. Use the project's `./gradlew` wrapper, never a globally installed Gradle.

## Toolchain

- **JDK 17** is the minimum for current AGP (9.x); 21 also works. Verify: `./gradlew -version`.
- Each AGP needs a matching **Gradle wrapper** — AGP 9.2 requires Gradle 9.x. Pin it in `gradle/wrapper/gradle-wrapper.properties` (`distributionUrl=...gradle-9.4.1-bin.zip`) and always use `./gradlew`.
- SDK via Android Studio or `cmdline-tools`; set `ANDROID_HOME` (or `sdk.dir` in `local.properties`, gitignored).
- Accept licenses once: `sdkmanager --licenses`.
- NDK only if you ship native code; pin its version in the module's `android { ndkVersion = "..." }`.

## Version catalog (gradle/libs.versions.toml)

```toml
[versions]
agp = "9.2.0"
kotlin = "2.4.0"
coreKtx = "1.19.0"

[libraries]
androidx-core-ktx = { group = "androidx.core", name = "core-ktx", version.ref = "coreKtx" }

[plugins]
android-application = { id = "com.android.application", version.ref = "agp" }
# NOTE: AGP 9+ carries Kotlin itself — do NOT also apply org.jetbrains.kotlin.android, it's built in.
# For Compose modules you still need the Compose compiler plugin (versioned to Kotlin):
kotlin-compose = { id = "org.jetbrains.kotlin.plugin.compose", version.ref = "kotlin" }
```

Reference in module build files via `alias(libs.plugins.android.application)` and `implementation(libs.androidx.core.ktx)`. (`core-ktx` is now an empty artifact — its extensions merged into `androidx.core:core` — but the dependency is still harmless to keep.)

## Module build.gradle.kts

```kotlin
plugins {
    alias(libs.plugins.android.application)
    // Kotlin is built into AGP 9+ — no kotlin-android plugin line.
    // alias(libs.plugins.kotlin.compose)   // add this only for Jetpack Compose modules
}

android {
    namespace = "com.example.app"
    compileSdk = 36                          // API 36 = Android 16; bump to 37 once Build-Tools 37 is installed

    defaultConfig {
        applicationId = "com.example.app"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
    }

    buildFeatures {
        buildConfig = true                   // AGP 9 requires opting in per-feature (buildConfig, compose, viewBinding…)
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.getByName("release")
        }
    }

    flavorDimensions += "env"
    productFlavors {
        create("dev")  { dimension = "env"; applicationIdSuffix = ".dev" }
        create("prod") { dimension = "env" }
    }

    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
}
```

Variants are `<flavor><BuildType>` → e.g. `devDebug`, `prodRelease`.

## Build & run commands

```bash
./gradlew tasks                       # discover available tasks
./gradlew assembleDebug               # build APK (build/outputs/apk/...)
./gradlew installDevDebug             # build + install variant on device
./gradlew bundleProdRelease           # AAB for Play Store
./gradlew lint testDebugUnitTest      # static checks + unit tests
./gradlew connectedAndroidTest        # instrumented tests on a device/emulator
```

## adb essentials

```bash
adb devices                           # list connected devices/emulators
adb install -r app-debug.apk
adb logcat --pid=$(adb shell pidof -s com.example.app)   # app logs only
adb shell am start -n com.example.app/.MainActivity
adb uninstall com.example.app
```

## Signing release builds

Keep keystore + passwords out of VCS. Put credentials in `~/.gradle/gradle.properties` or env, reference in `signingConfigs`:

```kotlin
signingConfigs {
    create("release") {
        storeFile = file(System.getenv("KEYSTORE_PATH") ?: "release.jks")
        storePassword = System.getenv("KEYSTORE_PASSWORD")
        keyAlias = System.getenv("KEY_ALIAS")
        keyPassword = System.getenv("KEY_PASSWORD")
    }
}
```

## Common pitfalls

- **AGP/Gradle/JDK mismatch** → each AGP needs a compatible Gradle (in `gradle-wrapper.properties`) and JDK ≥17; read the error's "requires Gradle X" line.
- **"Plugin org.jetbrains.kotlin.android … already on the classpath" / duplicate Kotlin** → AGP 9 applies Kotlin itself; remove the standalone `kotlin-android` plugin alias.
- **Compose: "This module is not using the Compose Compiler plugin"** → apply `org.jetbrains.kotlin.plugin.compose` (versioned to your Kotlin version) in every Compose module. Since Kotlin 2.0 the Compose compiler is a Kotlin Gradle plugin, not a `composeOptions` version.
- **`BuildConfig`/`Manifest` constants missing** → AGP 9 disables `buildConfig` by default; enable it in `buildFeatures`.
- **SDK not found** → set `sdk.dir` in `local.properties` or `ANDROID_HOME`.
- **Duplicate class / dependency conflict** → inspect `./gradlew :app:dependencies`; align versions via the catalog.
- **Slow/incremental issues** → `./gradlew --stop` then rebuild; enable configuration cache in `gradle.properties`.
- **Manifest merger failures** → read the merged manifest report under `build/outputs/logs/`.
- Verify by actually running the relevant `./gradlew` task and (for UI) deploying to a device, not by reading Gradle files.
