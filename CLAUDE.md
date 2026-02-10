# Birda GUI - LLM Context

Desktop GUI for the **birda** bird species detection CLI. Built with Electron + Svelte 5 + TypeScript.

## Tech Stack

| Layer        | Technology                       | Version                                |
| ------------ | -------------------------------- | -------------------------------------- |
| Runtime      | Electron                         | 40.x                                   |
| UI Framework | Svelte                           | 5.x (runes API, **not** legacy stores) |
| CSS          | Tailwind CSS v4 + daisyUI v5     | 4.1.x / 5.5.x                          |
| Language     | TypeScript                       | 5.9.x (strict mode)                    |
| Bundler      | Vite via electron-vite           | 7.x / 5.x                              |
| Database     | better-sqlite3                   | 12.x                                   |
| i18n         | Paraglide (compile-time)         | 2.x                                    |
| Maps         | MapLibre GL + svelte-maplibre-gl | 5.x / 1.x                              |
| Audio        | WaveSurfer.js                    | 7.x                                    |
| Icons        | Lucide Svelte                    | latest                                 |
| Validation   | Zod                              | 3.x                                    |

## Project Structure

```
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
build/                # Electron-builder resources (icons, NSIS installer script)
```

## Path Aliases

| Alias          | Resolves To                    | Available In    |
| -------------- | ------------------------------ | --------------- |
| `$lib/*`       | `src/renderer/src/lib/*`       | Renderer only   |
| `$shared/*`    | `shared/*`                     | Main + Renderer |
| `$paraglide/*` | `src/renderer/src/paraglide/*` | Renderer only   |

## TypeScript Configuration

Two separate tsconfig files — **never mix them**:

- **`tsconfig.json`** — Renderer + Shared. Extends `@tsconfig/svelte`. Includes DOM libs, `$lib` and `$paraglide` aliases.
- **`tsconfig.node.json`** — Main + Preload + Shared. Node.js only, no DOM. Has `types: ["node"]`.

Both use: `strict: true`, `exactOptionalPropertyTypes: true`, `noEmit: true`, `moduleResolution: "bundler"`.

## Commands

Task runner: **Taskfile.yml** (Go Task) or npm scripts.

```bash
# Development
task dev                    # electron-vite dev with HMR
task build                  # electron-vite build (main + preload + renderer)

# Linting & Type Checking
task lint                   # ESLint + svelte-check + tsc (all three in parallel)
task eslint                 # ESLint only on src/ and shared/
task check                  # svelte-check only
task typecheck:main         # tsc on tsconfig.node.json only
task lint:fix               # ESLint with auto-fix

# Formatting
task format                 # Prettier write
task format:check           # Prettier check (CI)

# Full validation (CI equivalent)
npm run validate            # format:check + lint + typecheck + npm audit

# Packaging
task dist                   # Build + electron-builder for current platform
task dist:win               # Windows (NSIS + portable)
task dist:linux             # Linux (AppImage + deb)
task dist:mac               # macOS (dmg)

# Utilities
task rebuild                # Rebuild native modules (better-sqlite3) for Electron
task clean                  # Remove out/ and release/
```

## CSS & Styling

- **Tailwind CSS v4** with `@tailwindcss/vite` plugin (no PostCSS config needed)
- **daisyUI v5** component classes (`btn`, `input`, `modal`, `table`, `badge`, `select`, etc.)
- Two custom themes: `birda-light` and `birda-dark` (defined in `tailwind.config.ts`)
- Theme switching via `data-theme` attribute on `<html>`
- Custom brand color: `birda-blue: #023E8A`
- Prettier plugin auto-sorts Tailwind classes

Use daisyUI component classes + Tailwind utilities. Do not write custom CSS unless absolutely necessary.

## Linting

**ESLint 9 flat config** (`eslint.config.js`):

- `typescript-eslint:recommended-type-checked` with both tsconfig files
- `eslint-plugin-security` for `src/main/` and `src/preload/` (Node.js code)
- `eslint-plugin-no-unsanitized` for `src/renderer/` (XSS prevention)
- `eslint-plugin-svelte:flat/recommended` for `.svelte` files
- Key rules enforced: `eqeqeq`, `no-eval`, `no-implied-eval`, `prefer-const`, `no-var`

**Prettier** (`.prettierrc`): single quotes, trailing commas, 120 char width, 2-space indent.

**Pre-commit hook** (Husky + lint-staged): runs ESLint fix + Prettier on staged `.ts`/`.svelte` files.

## Svelte 5 Patterns

**This project uses Svelte 5 runes exclusively. Do NOT use legacy Svelte stores or `$:` reactive declarations.**

- **State**: `$state()` for reactive state (module-level singletons in `.svelte.ts` files)
- **Derived**: `$derived()` for computed values
- **Effects**: `$effect()` for side effects
- **Props**: `let { prop1, prop2 } = $props()` destructuring
- **Events**: Native DOM `on:` directives

State stores are in `src/renderer/src/lib/stores/`:

- `app.svelte.ts` — Global UI state (active tab, settings, selections)
- `analysis.svelte.ts` — Analysis progress tracking
- `log.svelte.ts` — Application log entries
- `map.svelte.ts` — Map view state

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
- Tables: `locations`, `analysis_runs`, `detections`, `species_lists`, `species_list_entries`
- View: `species_summary`
- Pragmas: `journal_mode = WAL`, `foreign_keys = ON`

CRUD modules in `src/main/db/`: `runs.ts`, `detections.ts`, `locations.ts`, `species-lists.ts`.

## i18n

**Paraglide** (compile-time i18n). Messages in `messages/en.json`.

Usage in components:

```svelte
<script>
  import * as m from '$paraglide/messages';
</script>

<h1>{m.settings_title()}</h1>
```

Currently English only. Message keys follow pattern: `{section}_{element}_{descriptor}`.

## Testing

No test framework is configured. Quality is enforced via:

- Strict TypeScript (both tsconfigs)
- ESLint with type-aware + security rules
- knip (dead code detection)
- npm audit (dependency security)
- Pre-commit hooks (lint-staged)

## Key Conventions

- **No `any` types** — strict TypeScript throughout
- **Shared types** go in `shared/types.ts`, never duplicated
- **Component files**: PascalCase `.svelte` (e.g., `DetectionDetail.svelte`)
- **Store files**: camelCase `.svelte.ts` (e.g., `app.svelte.ts`)
- **Main process modules**: camelCase `.ts` grouped by domain
- **ESM throughout** (`"type": "module"` in package.json), CJS only for Electron main/preload output
- **No testing files** — no `.test.ts` or `.spec.ts` convention established
- **Formatting**: single quotes, trailing commas, 120 char lines, 2-space indent
