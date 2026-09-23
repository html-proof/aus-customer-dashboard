# PixMagic Insights — live Shopify dashboard

## Setup
1. Rotate the app secret in the Shopify Dev Dashboard (the old one was shared in chat).
2. Copy `.env.example` to `.env` and fill in `SHOPIFY_CLIENT_ID` and `SHOPIFY_CLIENT_SECRET`.
3. `npm start` → open http://localhost:3000

No dependencies to install (Node 18+).

On first visit you'll be asked to **create the admin account**. Invite the rest of your team from **Settings → Team members** (roles: Admin or Viewer).

## Login & security
- Passwords are hashed with scrypt; users and preferences live in `data/` (git-ignored — back it up, don't share it).
- Sessions are HttpOnly, SameSite=Strict cookies. Restarting the server signs everyone out.
- 5 failed logins per email/IP locks that combination out for 15 minutes.
- When hosting online, put it behind HTTPS and set `COOKIE_SECURE=true` in `.env`.

## Settings page
Shopify connection status and permissions, default date range, auto-refresh interval, low-stock threshold, session length, team members, and password change. Shopify credentials stay in `.env` and are never shown in the UI.

## How it works
- `server.js` gets an access token via the client-credentials grant and renews it automatically before the ~24h expiry.
- `/api/overview?from=YYYY-MM-DD&to=YYYY-MM-DD` pulls orders (current + previous period) from the Admin GraphQL API and computes KPIs, trend, best sellers, payments, customers, and alerts. Results are cached 60s.
- The page auto-refreshes every minute; Day / Month / Year / Custom ranges reach back through all historical orders (`read_all_orders`).

## Scopes
| Section | Scope | Status |
|---|---|---|
| Sales, orders, products, payments | read_orders, read_all_orders, read_products | granted |
| Customers, returning % | read_customers (+ protected customer data) | **add** |
| Low stock | read_inventory | **add** |
| Customer journey (visitors) | read_reports / analytics | check |

Sections whose scope is missing show a clear note instead of failing.
