# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Auth**: Replit Auth (OpenID Connect via `openid-client`); DB-backed sessions

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Artifacts

### `pos` (`artifacts/pos`) — AL-BARAKAH Restaurant POS

Full-stack React POS for a Saudi-Arabia restaurant (SAR, 15% VAT-inclusive).

**Frontend** — Single-page React app (Vite + Tailwind v4) at `/`.
- **Replit Auth gate** (outer) — `AuthGate.tsx` shows a "Sign in with Replit" screen until the user authenticates. Wraps the app in `main.tsx`.
- **Existing admin/cashier login** (inner) — preserved unchanged inside `App.tsx`. Default users: `admin/admin`, `cashier1/1234`. Cashiers see only Billing; admin sees everything. 8-hour session.
- **Server sync layer** (`src/lib/serverSync.tsx`) — installs a `window.storage` proxy that reads from localStorage (sync) and on writes mirrors to the REST API (debounced background). On boot, hydrates localStorage from the server (menu, categories, orders, settings) BEFORE App mounts. Falls back to localStorage if the server is unreachable. A `SyncIndicator` pill in the bottom-right shows synced / syncing / offline / error.
  - Order sync: `seenOrderIds` is seeded **only** from server-confirmed IDs at hydration. Any local-only orders (from offline use or pre-migration) are POSTed on hydration. The server endpoint is idempotent (`onConflictDoNothing` on the `ORD-<n>` display id) so re-POSTs are safe.
- **Features**: Billing (cart, discount, payment method), Menu Editor, Tickets/Token Numbering System (auto-increment T-001 with daily Asia/Riyadh-midnight reset, admin manual reset, printable 80mm token), Raw Materials Inventory (add/edit/delete ingredients independently from menu), Order History, Sales Summary, VAT Reports (ZATCA-formatted bilingual, recharts), Cloud Backup (legacy Firebase, still works), 80mm thermal receipt with ZATCA Phase 1 TLV/Base64 QR.
- **VAT model** (preserved): `gross = Σ(price * qty)`, `total = gross - discount`, `subtotal = total / (1 + vatRate)`, `vat = total - subtotal`. Money on the wire is a string (`numeric(12,2)`), client converts via `toFixed(2)`.
- **Inventory model**: `RawMaterial { id, name, unit, stock, lowStockThreshold, costPerUnit?, notes? }` stored in `pos:rawMaterials` localStorage key (admin-only, manually managed — not auto-deducted by orders). Independent from `MenuItem` which has no stock fields.
- **Storage keys**: `pos:menu`, `pos:rawMaterials`, `pos:categories`, `pos:orders`, `pos:settings`, `pos:nextOrderId`, `pos:users`, `pos:cloud`, `pos:session`, `pos:sidebarCollapsed`. Of these, `pos:menu`, `pos:categories`, `pos:orders`, and `pos:settings` are mirrored to the server; the rest stay local.

**Backend** — Express 5 API at `/api` (`artifacts/api-server`).
- **Auth**: Replit Auth via `openid-client`; opaque DB-backed session IDs stored in the `sessions` table (set by the OAuth callback). All business endpoints behind `requireAuth`. Public endpoints: `/api/healthz`, `/api/login`, `/api/callback`, `/api/logout`, `/api/auth/user`.
- **Order placement** (`POST /api/orders`) is wrapped in `db.transaction()` and inserts the order header + items + payments atomically. Idempotent on display id (`ORD-<n>`).
- **All write endpoints** validate input with Zod (`zod@catalog:`).
- **Daily JSON backup** (`src/lib/dailyBackup.ts`) — runs 10s after boot then every 24h, writes `<repo-root>/backups/orders-YYYY-MM-DD.json` containing all orders + items + payments. Also exposed as `POST /api/backup/run`, `GET /api/backup/list`, `GET /api/backup/download/:name`.

**Database** — PostgreSQL via `@neondatabase/serverless` + Drizzle.
- Schema split: `lib/db/src/schema/auth.ts` (Replit Auth `users` + `sessions`) and `lib/db/src/schema/pos.ts` (`categories`, `menu_items`, `customers`, `orders`, `order_items`, `payments`, `settings_kv`).
- Indexes on `orders.created_at`, `orders.status`, `orders.customer_id`, `order_items.order_id`, `payments.order_id`.
- Money columns: `numeric(12,2)`. ID columns: `varchar(64)` (display IDs like `ORD-1042`).

### `api-server` (`artifacts/api-server`) — Shared Express API

See above. Routes under `src/routes/`: `auth`, `categories`, `menu`, `orders`, `customers`, `settings`, `backup`, `health`.

### `mockup-sandbox` (`artifacts/mockup-sandbox`) — Canvas mockup sandbox

Standard scaffold; not used by the POS.

## Secrets

- `SESSION_SECRET` — reserved for future session-cookie signing (the current Replit Auth template uses cryptographically-random opaque session IDs in the DB rather than signed cookies, which is the recommended pattern).
- `DATABASE_URL` — provisioned automatically by Replit Postgres.
- Replit Auth OIDC env vars (`REPLIT_DOMAINS`, `REPL_ID`, `ISSUER_URL`) — provisioned automatically.
