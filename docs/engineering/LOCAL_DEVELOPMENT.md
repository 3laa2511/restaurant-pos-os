# Local Development — Windows

This is the supported local development path for the current repository. It starts PostgreSQL, the NestJS API, and the Vite desktop-web preview. It does **not** claim that every workspace is complete or that the Vite preview is a packaged Windows Tauri installer.

## Requirements

- Windows 10/11
- Docker Desktop running with the Linux container engine
- Node.js 24 (Node 22+ is the repository minimum)
- pnpm 10.15.0

Open PowerShell in the canonical repository checkout.

## First-time setup

1. Install the workspace dependencies:

   ```powershell
   pnpm install --frozen-lockfile
   ```

2. Create the API environment file:

   ```powershell
   Copy-Item services/api/.env.example services/api/.env
   ```

   The example points to the local Docker PostgreSQL service and allows the Vite development origin. Do not commit `.env`.

3. Start PostgreSQL and wait until it is healthy:

   ```powershell
   docker compose up -d postgres
   docker compose ps
   ```

4. Apply repository migrations to this local database:

   ```powershell
   pnpm --dir services/api migrate:deploy
   ```

   This command targets only the local `DATABASE_URL` in `services/api/.env`. Never point it at production as part of local setup.

5. Create the first local tenant, branch, owner account, and POS device:

   ```powershell
   pnpm --dir services/api bootstrap:local
   ```

   The bootstrap asks for the company, branch, owner username, and a password (minimum 12 characters; password input is hidden). It does not print or save the password. It creates an owner account with tenant-wide scope, a branch and an active POS device, then writes the matching non-secret branch/device settings to `apps/pos-desktop/.env.local`.

   Bootstrap is intentionally non-destructive: it refuses to overwrite an existing username or move an existing device between branches.

## Run the application

Use two PowerShell terminals from the repository root.

**Terminal 1 — API**

```powershell
pnpm --dir services/api start:dev
```

API: `http://localhost:3000/api`

**Terminal 2 — desktop web preview**

```powershell
pnpm --filter @restaurant-pos/pos-desktop dev
```

Open `http://localhost:5173`. Sign in using the owner username and password created by the bootstrap. The POS workspace uses the configured branch ID and `POS-01` device code.

## Validation

```powershell
pnpm --dir services/api lint
pnpm --dir services/api typecheck
pnpm --dir services/api test --runInBand
pnpm --dir services/api build
pnpm --dir apps/pos-desktop lint
pnpm --dir apps/pos-desktop typecheck
pnpm --dir apps/pos-desktop test
pnpm --dir apps/pos-desktop build
```

The API quality workflow provisions a disposable PostgreSQL instance, applies migrations, and runs RLS integration tests. A local unit-test pass without PostgreSQL is not evidence that database isolation passed.

## Stop services

- Stop the API and Vite terminals with `Ctrl+C`.
- Stop PostgreSQL without deleting its data:

  ```powershell
  docker compose down
  ```

Do **not** add `-v` unless you intentionally want to delete the local database volume.

## Important current limitations

- The browser URL is a Vite development preview, not the signed/packaged Windows desktop installer.
- A local SQLite database on each workstation does not provide shared offline operation for multiple cashiers. The branch-LAN coordination service remains a separate required delivery item.
- Some workspaces currently expose overview/read-only or partial surfaces; do not interpret the login workspace selector as proof that every workflow is complete.
- The original FlutterFlow export and 32-page UI Directions PDF are not currently present in the inspected GitHub tree. Exact visual parity remains blocked until those source references are restored.
- Production hosting, live payment-provider verification, production migrations, backup/restore drills, and release deployment are not performed by these local commands.
