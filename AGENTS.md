# Birda GUI: agent guide

Desktop GUI for the **birda** bird species detection CLI. Built with Electron + Svelte 5 + TypeScript.

## Tech Stack

| Layer        | Technology                         | Version                                |
| ------------ | ---------------------------------- | -------------------------------------- |
| Runtime      | Electron                           | 43.x                                   |
| UI Framework | Svelte                             | 5.x (runes API, **not** legacy stores) |
| CSS          | Tailwind CSS v4 + daisyUI v5       | 4.3.x / 5.7.x                          |
| Language     | TypeScript                         | 6.0.x (strict mode)                    |
| Bundler      | Vite (direct configs + dev script) | 8.x (Rolldown)                         |
| Database     | better-sqlite3                     | 13.x                                   |
| i18n         | Paraglide (compile-time)           | 2.x                                    |
| Maps         | MapLibre GL + svelte-maplibre-gl   | 6.x / 2.x                              |
| Audio        | WaveSurfer.js                      | 7.x                                    |
| Icons        | Lucide Svelte (`@lucide/svelte`)   | 1.x                                    |
| Validation   | Zod                                | 4.x                                    |

Development and CI need Node.js 22 (22.12 or later), 24, or 26 and newer, the range Vitest 5 supports (see `engines` in `package.json`). `.nvmrc` sets the Node version for every workflow job that runs `actions/setup-node`.

## Project Structure

```text
src/
  main/              # Electron main process (Node.js)
    index.ts          # Entry point, window creation, menu, protocol registration
    birda/            # CLI integration (spawns birda process, parses NDJSON)
    db/               # SQLite database layer (schema, migrations, CRUD modules)
    ipc/              # IPC handler modules (one per domain)
    labels/           # Species name localization service
  preload/
    index.ts          # contextBridge: exposes window.birda with allowlisted channels
  renderer/           # Svelte 5 frontend (browser context)
    index.html        # HTML entry with Content Security Policy
    src/
      main.ts         # Renderer entry point
      app.css         # Global CSS (Tailwind + daisyUI imports)
      App.svelte      # Root component
      pages/          # Page-level components (Analysis, Detections, Map, Species, Settings)
      lib/
        components/   # Reusable UI components (PascalCase .svelte files)
        stores/       # State management (.svelte.ts files using $state runes)
        utils/        # Helpers (ipc.ts wrappers, format.ts, shortcuts.ts)
shared/
  types.ts            # TypeScript interfaces shared between main and renderer
messages/
  en.json             # i18n message catalog (Paraglide)
build/                # Electron-builder resources (macOS entitlements, NSIS installer script), plus vite/ with the Vite configs and the externalize helper and its test
```

## Path Aliases

| Alias          | Resolves To                    | Available In    |
| -------------- | ------------------------------ | --------------- |
| `$lib/*`       | `src/renderer/src/lib/*`       | Renderer only   |
| `$shared/*`    | `shared/*`                     | Main + Renderer |
| `$paraglide/*` | `src/renderer/src/paraglide/*` | Renderer only   |

## TypeScript Configuration

Two separate tsconfig files (never mix them):

- **`tsconfig.json`**: Renderer + Shared. Extends `@tsconfig/svelte`. Includes DOM libs, `$lib`, `$shared` and `$paraglide` aliases.
- **`tsconfig.node.json`**: Main + Preload + Shared, plus `scripts/`, `build/vite/` and `vitest.config.ts`. `allowImportingTsExtensions` is on so the Vite configs import local modules as `./externalize.ts`; Vite's planned native config loader needs the extension. Node.js only, no DOM. Has `types: ["node"]`: TypeScript 6 does not auto-include `@types/*` packages, so Node's globals are listed explicitly rather than relying on the reference in Electron's own type declarations.

Both use: `strict: true`, `exactOptionalPropertyTypes: true`, `noEmit: true`, `moduleResolution: "bundler"`.

## Commands

Task runner: **Taskfile.yml** (Go Task) or npm scripts.

```bash
# Development
task dev                    # renderer HMR + Electron via scripts/dev.ts (restarts on main/preload change)
task build                  # direct Vite build (main + preload + renderer) plus node --check of the bundles, via npm run build

# Linting & Type Checking
task lint                   # npm run lint (ESLint + svelte-check) alongside tsc on tsconfig.node.json
task eslint                 # ESLint only (same files as npm run lint's ESLint step)
task check                  # svelte-check only
task typecheck:main         # npm run typecheck: tsc on tsconfig.node.json (svelte-check covers tsconfig.json)
task lint:fix               # ESLint with auto-fix

# Formatting
task format                 # Prettier write
task format:check           # Prettier check (CI)

# Testing
npm run test                # vitest run (unit tests; no Taskfile target yet)
npm run paraglide           # compile messages into src/renderer/src/paraglide (gitignored, dev layout) and check none is missing; lint, lint:fix, check, knip, test, task eslint and the pre-commit hook run it first

# Full validation (every CI check except the build)
npm run validate            # format:check + lint + typecheck + test + knip + validate:translations + npm audit

# Packaging
task dist                   # Build + electron-builder for current platform
task dist:win               # Windows (NSIS + portable)
task dist:linux             # Linux (AppImage + deb)
task dist:mac               # macOS (dmg)

# Utilities
task clean                  # Remove out/ and release/
```

## CSS & Styling

- **Tailwind CSS v4** with `@tailwindcss/vite` plugin (no PostCSS config needed)
- **daisyUI v5** component classes (`btn`, `input`, `modal`, `table`, `badge`, `select`, etc.)
- Two custom themes: `birda-light` and `birda-dark` (defined with `@plugin 'daisyui/theme'` in `src/renderer/src/app.css`)
- Theme switching via `data-theme` attribute on `<html>`
- Brand blue `#023E8A` is the theme primary and accent color (a brighter variant in `birda-dark`)
- Prettier plugin auto-sorts Tailwind classes

Use daisyUI component classes + Tailwind utilities. Do not write custom CSS unless absolutely necessary.

## Linting

**ESLint 10 flat config** (`eslint.config.js`):

- `typescript-eslint` `strictTypeChecked` + `stylisticTypeChecked` with both tsconfig files; the root JS configs (`eslint.config.js`, `svelte.config.mjs`) are in no tsconfig and are linted without type information
- `eslint-plugin-security` for `src/main/` (Node.js code)
- `eslint-plugin-no-unsanitized` for `src/renderer/` (XSS prevention)
- `eslint-plugin-svelte:flat/recommended` for `.svelte` files
- Key rules enforced: `eqeqeq`, `no-eval`, `no-implied-eval`, `prefer-const`, `no-var`

**Prettier** (`.prettierrc`): single quotes, trailing commas, 120 char width, 2-space indent.

**Pre-commit hook** (Husky + lint-staged): compiles Paraglide, then runs ESLint fix + Prettier on staged `.ts`/`.svelte`/`.js`/`.mjs` files, and Prettier on staged `.jsonc`/`.md`/`.css`/`.html`/`.yml`/`.yaml` files and `.prettierrc` (`.prettierignore` excludes `*.json`).

## Svelte 5 Patterns

**This project uses Svelte 5 runes exclusively. Do NOT use legacy Svelte stores or `$:` reactive declarations.**

- **State**: `$state()` for reactive state (module-level singletons in `.svelte.ts` files)
- **Derived**: `$derived()` for computed values
- **Effects**: `$effect()` for side effects
- **Props**: `let { prop1, prop2 } = $props()` destructuring
- **Events**: event attributes (`onclick={...}`), not legacy `on:` directives

State stores are in `src/renderer/src/lib/stores/`:

- `app.svelte.ts`: Global UI state (active tab, settings, selections)
- `analysis.svelte.ts`: Analysis progress tracking
- `log.svelte.ts`: Application log entries
- `map.svelte.ts`: Map view state
- `annotation.svelte.ts`: Annotation editor boxes and their persistence
- `gallery.svelte.ts`: Model gallery state (tab, family, manifests, installed models, downloads, accepted licenses, errors)
- `toast.svelte.ts`: The single app-wide transient toast

Components mutate store state directly (no actions/reducers pattern).

## IPC Architecture

Electron IPC uses a **secure preload bridge** with allowlisted channels:

1. **Preload** (`src/preload/index.ts`) exposes `window.birda.invoke()` and `window.birda.on()` with channel allowlists
2. **Main handlers** (`src/main/ipc/`) register `ipcMain.handle()` for each channel
3. **Renderer wrappers** (`src/renderer/src/lib/utils/ipc.ts`) provide typed async functions

When adding a new IPC channel:

1. Add the handler in `src/main/ipc/<module>.ts`
2. Register it in `src/main/ipc/handlers.ts`
3. Add channel name to `ALLOWED_INVOKE_CHANNELS` or `ALLOWED_RECEIVE_CHANNELS` in `src/preload/index.ts`
4. Add a typed wrapper function in `src/renderer/src/lib/utils/ipc.ts`
5. Add shared types to `shared/types.ts` if needed

Security constraints:

- `contextIsolation: true`, `nodeIntegration: false`
- Content Security Policy in `src/renderer/index.html`
- Custom `birda-media://` protocol for audio file access (restricted to audio extensions)

## Database

**better-sqlite3** (synchronous, main process only).

- Location: `{userData}/birda-catalog.db`
- Schema: `src/main/db/schema.ts`
- Migrations: `src/main/db/database.ts` (sequential version-based)
- Tables: `locations`, `analysis_runs`, `detections`, `audio_files`, `annotations`, `species_lists`, `species_list_entries` (plus `schema_migrations` for migration tracking)
- View: `species_summary`
- Pragmas: `journal_mode = WAL`, `foreign_keys = ON`

CRUD modules in `src/main/db/`: `runs.ts`, `detections.ts`, `locations.ts`, `species-lists.ts`, `audio-files.ts`, `annotations.ts`.

## i18n

**Paraglide** (compile-time i18n). Messages in `messages/en.json`.

Usage in components:

```svelte
<script>
  import * as m from '$paraglide/messages';
</script>

<h1>{m.settings_title()}</h1>
```

13 locales live in `messages/` (en is the reference; cs, da, de, es, fi, fr, hu, it, nl, pl, pt, sv). Every new key added to `en.json` MUST be added to all locales; CI enforces this via `npm run validate:translations`. Message keys follow pattern: `{section}_{element}_{descriptor}`.

The inlang plugins in `project.inlang/settings.json` are pinned to exact versions on jsdelivr. Dependabot does not read that file, so bump them by hand.

## Testing

**Vitest** is configured for unit tests. Run with `npm run test` (`vitest run`); it is part of `npm run validate` and runs in CI.

- Config: `vitest.config.ts` (node environment; aliases mirror the app's `$lib` / `$shared` / `$paraglide` paths).
- Test files: co-located `*.test.ts` next to the code under test (include globs `src/**/*.test.ts`, `shared/**/*.test.ts`, `build/**/*.test.ts`). Current examples: `src/main/birda/progress.test.ts`, `src/renderer/src/lib/gallery/logic.test.ts`, `build/vite/externalize.test.ts`. `src/renderer/src/lib/aliases.test.ts` value-imports through each path alias, since type-only imports never resolve them.
- Scope: framework-free logic only. The node environment has no DOM, so there are no Svelte component or DOM tests.

Additional quality gates: strict TypeScript (both tsconfigs), ESLint with type-aware and security rules, knip (dead code detection), npm audit (dependency security), and pre-commit hooks (lint-staged).

CI (`ci.yml`) and the release workflow (`release.yml`) both call `.github/workflows/checks.yml`, so pull requests and release tags run the same checks; the release skips the build step there because its platform jobs build the app.

## Key Conventions

- **No `any` types**: strict TypeScript throughout
- **Shared types** go in `shared/types.ts`, never duplicated
- **Component files**: PascalCase `.svelte` (e.g., `DetectionDetail.svelte`)
- **Store files**: camelCase `.svelte.ts` (e.g., `app.svelte.ts`)
- **Main process modules**: `.ts` files grouped by domain; multi-word names are mostly kebab-case (`species-lists.ts`, `label-service.ts`)
- **ESM throughout** (`"type": "module"` in package.json), CJS only for the Electron preload bundle
- **Test files**: co-located `*.test.ts` next to the code under test (Vitest, node environment, framework-free logic only)
- **Formatting**: single quotes, trailing commas, 120 char lines, 2-space indent

## Cross-Project Reference: birda

The Rust CLI backend lives in the [birda](https://github.com/tphakala/birda) repository, usually checked out next to this one as `../birda`.

- When changing output types in TypeScript ([shared/types.ts](shared/types.ts)), ensure compatibility with Rust output structures in `../birda/src/output/types.rs`.
- NDJSON streaming format from birda CLI is parsed in [src/main/birda/](src/main/birda/)
