# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default tseslint.config({
  extends: [
    // Remove ...tseslint.configs.recommended and replace with this
    ...tseslint.configs.recommendedTypeChecked,
    // Alternatively, use this for stricter rules
    ...tseslint.configs.strictTypeChecked,
    // Optionally, add this for stylistic rules
    ...tseslint.configs.stylisticTypeChecked,
  ],
  languageOptions: {
    // other options...
    parserOptions: {
      project: ['./tsconfig.node.json', './tsconfig.app.json'],
      tsconfigRootDir: import.meta.dirname,
    },
  },
})
```

## Storage Backend

Backend persistence supports two drivers:

- `file`: JSON files in `server/data` (fallback)
- `postgres`: PostgreSQL with SQL migrations

Environment variables:

- `RW_STORAGE_DRIVER=auto|file|postgres` (default: `auto`)
- `DATABASE_URL=postgres://...` (required for `postgres`)
- `RW_MIGRATIONS_DIR=server/migrations` (optional)
- `RW_FEED_SCHEDULER_ENABLED=true|false` (optional)
- `RW_BACKUP_SCHEDULER_ENABLED=true|false` (optional)
- `RW_PG_BOOTSTRAP_FROM_LOCAL=true|false` (optional, default: `false`)
- `RW_SEED_ENABLED=true|false` (optional, default: `true` outside production, `false` in production)
- `RW_ALLOW_FILE_STORAGE_IN_PROD=true|false` (optional, default: `false`; safety override)
- `RW_MEDIA_STORAGE_DRIVER=auto|local|s3` (default: `auto`)
- `RW_RUN_DB_MIGRATIONS_ON_START=true|false` (optional, default: `true` in Docker entrypoint)

Media storage (`/api/admin/upload`):

- `local` mode stores files in `UPLOADS_DIR` and serves them from `/uploads/*`.
- `s3` mode uploads files to an S3-compatible bucket and returns CDN/public URL.
- `auto` mode uses `s3` when `RW_S3_BUCKET` is set, otherwise `local`.
- If S3 upload fails at runtime, upload automatically falls back to `local` mode (no manual switch needed).

S3/CDN variables:

- `RW_S3_BUCKET` (required for `s3`)
- `RW_S3_REGION` (default: `us-east-1`)
- `RW_S3_ENDPOINT` (optional, for S3-compatible providers)
- `RW_S3_FORCE_PATH_STYLE=true|false` (optional)
- `RW_S3_ACCESS_KEY_ID`, `RW_S3_SECRET_ACCESS_KEY` (optional, IAM/default chain is supported)
- `RW_S3_PREFIX` (optional, default: `media`)
- `RW_MEDIA_CDN_BASE_URL` or `RW_S3_PUBLIC_BASE_URL` (optional public/CDN base URL)
- `RW_MEDIA_CACHE_CONTROL` (optional, default: `public, max-age=31536000, immutable`)

Feed scheduler behavior:

- If `RW_FEED_SCHEDULER_ENABLED` is set, its value is used directly.
- If not set, scheduler defaults to `true` in long-running Node runtime and `false` in serverless runtime.
- Auto-refresh updates only `draft`; publish to `published` remains manual via admin publish action.
- Missing feed records now follow lifecycle `active -> hidden -> archived` on consecutive imports.

Backup scheduler behavior:

- If `RW_BACKUP_SCHEDULER_ENABLED` is set, its value is used directly.
- If not set, scheduler defaults to `true` in long-running Node runtime and `false` in serverless runtime.
- Scheduler creates one automatic backup per day and keeps only the latest 3 automatic backups.
- In admin (`/admin/backups`) you can create manual backups; manual backups are kept until deleted.
- Restore from backup updates `draft` content only. Publish to `published` remains manual.
- In admin leads (`/admin/leads`) you can separately restore lead processing fields (`status`, `assignee`, `admin_note`) from a backup snapshot; new leads are never deleted by this operation.

Safe deployment notes:

- For production, set `RW_STORAGE_DRIVER=postgres` explicitly (avoid silent fallback to file mode).
- In production, startup is blocked when storage driver is `file` unless `RW_ALLOW_FILE_STORAGE_IN_PROD=true` is explicitly set.
- Keep a stable external `DATABASE_URL` between deploys.
- Local JSON -> PostgreSQL bootstrap is disabled by default and runs only when `RW_PG_BOOTSTRAP_FROM_LOCAL=true`.
- Demo seed is disabled in production by default (`RW_SEED_ENABLED` can override).
- Docker container startup runs `npm run db:migrate` before app start (disable only with `RW_RUN_DB_MIGRATIONS_ON_START=false`).

Run migrations:

```bash
npm run db:migrate
```

PostgreSQL initialization and end-to-end smoke (PowerShell):

```powershell
$env:RW_STORAGE_DRIVER = 'postgres'
$env:DATABASE_URL = 'postgres://user:password@127.0.0.1:5432/dbname'
npm run db:migrate
npm run smoke:postgres:e2e
```

Backup system end-to-end smoke:

```bash
npm run smoke:backup:e2e
```

Backup smoke on PostgreSQL:

```bash
SMOKE_STORAGE_DRIVER=postgres RW_STORAGE_DRIVER=postgres DATABASE_URL=postgres://user:password@127.0.0.1:5432/dbname npm run smoke:backup:e2e
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default tseslint.config({
  extends: [
    // other configs...
    // Enable lint rules for React
    reactX.configs['recommended-typescript'],
    // Enable lint rules for React DOM
    reactDom.configs.recommended,
  ],
  languageOptions: {
    // other options...
    parserOptions: {
      project: ['./tsconfig.node.json', './tsconfig.app.json'],
      tsconfigRootDir: import.meta.dirname,
    },
  },
})
```
