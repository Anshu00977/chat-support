# Chat Support System

Real-time customer support chat for Shopify apps. Node/Express + Socket.IO
backend, two React frontends (admin dashboard + storefront widget), MySQL
via Prisma. The widget is delivered to storefronts via the Shopify ScriptTag
API — no theme editor step, no Liquid.

## Packages

- `shared/` — TS types and Socket.IO event names shared by all three apps.
- `backend/` — Express REST API, Socket.IO server, Prisma/MySQL, bot logic, ScriptTag registration.
- `admin-dashboard/` — React SPA for admins/super_admins (inbox, live chat, admin + store management).
- `widget/` — React app built as a single `widget.js` IIFE bundle, served by the backend and injected into storefronts.

## First-time setup

```bash
npm install
npm run build:shared          # backend/dashboard/widget all import compiled shared types

cp backend/.env.example backend/.env
# edit backend/.env: DATABASE_URL, JWT_SECRET, SMTP_*, INSTALL_WEBHOOK_SECRET,
# BOOTSTRAP_SUPER_ADMIN_* (creates your first login on first boot)

npm run prisma:migrate        # creates the MySQL schema
```

## Running locally

```bash
npm run dev:backend           # http://localhost:4000 (REST + Socket.IO)
npm run dev:dashboard         # http://localhost:5173 (admin login: your BOOTSTRAP_SUPER_ADMIN_* creds)
npm run dev:widget            # http://localhost:5174 (dev harness page simulating a storefront)
```

The widget's dev harness (`widget/index.html`) sets `window.Shopify.shop` for
you and talks to `VITE_API_URL` (see `widget/.env.example`). In production
the widget instead derives the backend URL from its own `<script src>`
origin — no rebuild needed per environment.

## Connecting a Shopify app

Once a Shopify app has completed OAuth and has an offline access token for a
shop, have its backend call:

```
POST {BACKEND_PUBLIC_URL}/api/apps/install
x-install-secret: <INSTALL_WEBHOOK_SECRET>
{ "shop": "some-store.myshopify.com", "name": "Some Store", "accessToken": "shpat_..." }
```

This upserts the shop and immediately registers the widget ScriptTag, so the
chat bubble appears on every storefront page with zero merchant setup. If
registration fails (revoked token, API hiccup), a super_admin can retry it
from the dashboard's **Stores** page.

## Bot keywords

Each connected store has its own FAQ keyword list, managed from the
dashboard's **Stores → Manage bot** panel. On a customer's first message the
backend does a case-insensitive substring match against that store's
keywords; a match gets an instant bot reply, a miss falls back to a generic
reply and emails every active admin.

## Production builds

```bash
npm run build   # shared -> widget -> backend (typecheck) -> dashboard, in that order
```

The backend runs via `tsx` in both dev and prod (`npm start` in
`backend/`) rather than a `tsc`-emitted `dist/`, since the whole workspace is
ESM and this sidesteps Node's stricter ESM extension-resolution rules
without needing a bundler for the backend.
