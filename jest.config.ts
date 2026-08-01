/**
 * For a detailed explanation regarding each configuration property, visit:
 * https://jestjs.io/docs/configuration
 */

import type { Config } from "jest"
import nextJest from "next/jest.js"

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files in your test environment
  dir: "./",
})

const config: Config = {
  // Automatically clear mock calls, instances, contexts and results before every test
  clearMocks: true,

  // Indicates whether the coverage information should be collected while executing the test
  collectCoverage: false, // Set to false by default, enable with --coverage flag

  // An array of glob patterns indicating a set of files for which coverage information should be collected
  collectCoverageFrom: [
    "app/**/*.{js,jsx,ts,tsx}",
    "components/**/*.{js,jsx,ts,tsx}",
    "lib/**/*.{js,jsx,ts,tsx}",
    "!**/*.d.ts",
    "!**/node_modules/**",
    "!**/.next/**",
    "!**/coverage/**",
    "!**/out/**",
    "!components/ui/**",
    // Test-only harnesses. Not under a `__tests__/` name because jest would then
    // try to run them as suites; excluded here so they aren't counted as
    // uncovered product code either.
    "!**/__testing__/**",
    "!app/**/layout.{js,jsx,ts,tsx}",
    // Pure type-only modules (interfaces / type aliases) — no runtime to cover.
    "!lib/agentpack/types.ts",
    "!lib/agentpack/ccswitch/types.ts",
    "!lib/i18n/types.ts",
    "!lib/history/types.ts",
    "!lib/skills/types.ts",
  ],

  // The directory where Jest should output its coverage files
  coverageDirectory: "coverage",

  // An array of regexp pattern strings used to skip coverage collection
  coveragePathIgnorePatterns: ["/node_modules/", "/.next/", "/out/", "/coverage/"],

  // Indicates which provider should be used to instrument code for coverage
  coverageProvider: "v8",

  // A list of reporter names that Jest uses when writing coverage reports
  coverageReporters: ["json", "text", "lcov", "html", "clover", "cobertura"],

  // Coverage thresholds - enforce minimum coverage in CI
  // Uncomment to enable strict coverage requirements
  coverageThreshold: {
    global: {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90,
    },
  },

  // An object that configures minimum threshold enforcement for coverage results
  // coverageThreshold: undefined,

  // A path to a custom dependency extractor
  // dependencyExtractor: undefined,

  // Make calling deprecated APIs throw helpful error messages
  // errorOnDeprecated: false,

  // The default configuration for fake timers
  // fakeTimers: {
  //   "enableGlobally": false
  // },

  // Force coverage collection from ignored files using an array of glob patterns
  // forceCoverageMatch: [],

  // A path to a module which exports an async function that is triggered once before all test suites
  // globalSetup: undefined,

  // A path to a module which exports an async function that is triggered once after all test suites
  // globalTeardown: undefined,

  // A set of global variables that need to be available in all test environments
  // globals: {},

  // Cap parallelism at half the cores. On a 2-core CI runner this resolves to a
  // single worker (unchanged); on many-core dev machines it prevents the default
  // (cores - 1) from spawning ~30 jsdom+SWC workers, which paradoxically ran
  // SLOWER and peaked at ~18 GB RSS from memory pressure. Half the cores is both
  // faster and far lighter here.
  maxWorkers: "50%",

  // Recycle a worker once its heap passes this limit. v8 coverage + jsdom bloat
  // a long-lived worker's old-space across 90+ suites, and the resulting GC
  // thrash is severe — on a single worker it cut the coverage run from ~259 s to
  // ~155 s, and locally it bounds peak RSS to ~7 GB instead of 11-18 GB. Faster
  // AND lighter on every path (single-worker CI included).
  workerIdleMemoryLimit: "768MB",

  // An array of directory names to be searched recursively up from the requiring module's location
  // moduleDirectories: [
  //   "node_modules"
  // ],

  // An array of file extensions your modules use
  moduleFileExtensions: ["js", "mjs", "cjs", "jsx", "ts", "mts", "cts", "tsx", "json", "node"],

  // A map from regular expressions to module names or to arrays of module names that allow to stub out resources with a single module
  moduleNameMapper: {
    // Handle module aliases (this will be automatically configured for you by Next.js)
    "^@/(.*)$": "<rootDir>/$1",

    // Handle CSS imports (with CSS modules)
    "^.+\\.module\\.(css|sass|scss)$": "identity-obj-proxy",

    // Handle CSS imports (without CSS modules)
    "^.+\\.(css|sass|scss)$": "<rootDir>/__mocks__/styleMock.js",

    // Handle image imports
    "^.+\\.(png|jpg|jpeg|gif|webp|avif|ico|bmp|svg)$/i": "<rootDir>/__mocks__/fileMock.js",

    // Mock Tauri API for Jest (not available in jsdom)
    "^@tauri-apps/api/core$": "<rootDir>/__mocks__/tauri-api.js",
  },

  // An array of regexp pattern strings, matched against all module paths before considered 'visible' to the module loader
  modulePathIgnorePatterns: ["<rootDir>/out/", "<rootDir>/.next/"],

  // Activates notifications for test results
  // notify: false,

  // An enum that specifies notification mode. Requires { notify: true }
  // notifyMode: "failure-change",

  // A preset that is used as a base for Jest's configuration
  // preset: undefined,

  // Run tests from one or more projects
  // projects: undefined,

  // Use this configuration option to add custom reporters to Jest
  reporters: [
    "default",
    [
      "jest-junit",
      {
        outputDirectory: "coverage",
        outputName: "junit.xml",
        classNameTemplate: "{classname}",
        titleTemplate: "{title}",
        ancestorSeparator: " › ",
        usePathForSuiteName: true,
      },
    ],
  ],

  // Automatically reset mock state before every test
  // resetMocks: false,

  // Reset the module registry before running each individual test
  // resetModules: false,

  // A path to a custom resolver
  // resolver: undefined,

  // Automatically restore mock state and implementation before every test
  // restoreMocks: false,

  // The root directory that Jest should scan for tests and modules within
  // rootDir: undefined,

  // A list of paths to directories that Jest should use to search for files in
  // roots: [
  //   "<rootDir>"
  // ],

  // Allows you to use a custom runner instead of Jest's default test runner
  // runner: "jest-runner",

  // The paths to modules that run some code to configure or set up the testing environment before each test
  // setupFiles: [],

  // A list of paths to modules that run some code to configure or set up the testing framework before each test
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],

  // The number of seconds after which a test is considered as slow and reported as such in the results.
  // slowTestThreshold: 5,

  // A list of paths to snapshot serializer modules Jest should use for snapshot testing
  // snapshotSerializers: [],

  // The test environment that will be used for testing
  testEnvironment: "jsdom",

  // Options that will be passed to the testEnvironment
  // testEnvironmentOptions: {},

  // Adds a location field to test results
  // testLocationInResults: false,

  // The glob patterns Jest uses to detect test files
  testMatch: ["**/__tests__/**/*.?([mc])[jt]s?(x)", "**/?(*.)+(spec|test).?([mc])[jt]s?(x)"],

  // An array of regexp pattern strings that are matched against all test paths, matched tests are skipped
  testPathIgnorePatterns: ["/node_modules/", "/.next/", "/out/", "/src-tauri/", "/e2e/"],

  // The regexp pattern or array of patterns that Jest uses to detect test files
  // testRegex: [],

  // This option allows the use of a custom results processor
  // testResultsProcessor: undefined,

  // This option allows use of a custom test runner
  // testRunner: "jest-circus/runner",

  // A map from regular expressions to paths to transformers
  // transform: undefined,

  // An array of regexp pattern strings that are matched against all source file paths, matched files will skip transformation
  // transformIgnorePatterns: [
  //   "\\\\node_modules\\\\",
  //   "\\.pnp\\.[^\\\\]+$"
  // ],

  // An array of regexp pattern strings that are matched against all modules before the module loader will automatically return a mock for them
  // unmockedModulePathPatterns: undefined,

  // Indicates whether each individual test should be reported during the run
  // verbose: undefined,

  // An array of regexp patterns that are matched against all source file paths before re-running tests in watch mode
  // watchPathIgnorePatterns: [],

  // Whether to use watchman for file crawling
  // watchman: true,
}

export default createJestConfig(config)
