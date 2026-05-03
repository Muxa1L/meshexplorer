# MeshExplorer – Agent Guidelines

This document provides context, conventions, and instructions for AI coding agents working in the MeshExplorer repository.

## Project Overview

MeshExplorer is a **Next.js 15** web application for visualising mesh network nodes in real time, chatting through mesh channels, and analysing raw packet data. It supports two mesh-network backends:

- **MeshCore** – custom mesh protocol
- **Meshtastic** – open-source LoRa mesh communication

Data is persisted in **ClickHouse** and served through Next.js API routes.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router, TypeScript) |
| Styling | Tailwind CSS v4 |
| UI components | Headless UI, Heroicons, Lucide React, shadcn/ui primitives (`components.json`) |
| Data fetching | TanStack React Query v5 |
| Maps | Leaflet + react-leaflet, leaflet.markercluster |
| Charts | Recharts |
| Database | ClickHouse (`@clickhouse/client`) |
| Runtime extras | Discord webhook bot (`scripts/discord-bot.ts`, run via `tsx`) |

---

## Repository Layout

```
meshexplorer/
├── src/
│   ├── app/
│   │   ├── (app)/            # Main authenticated app pages
│   │   │   ├── map/          # Live node map
│   │   │   ├── messages/     # Chat messages
│   │   │   ├── packets/      # Packet analysis
│   │   │   ├── stats/        # Network statistics
│   │   │   ├── wardrive/     # Wardrive coverage map
│   │   │   └── ...
│   │   ├── (embed)/          # Embeddable / standalone views
│   │   ├── api/              # Next.js API routes
│   │   │   ├── map/          # Node map data
│   │   │   ├── chat/         # Chat stream
│   │   │   ├── packets/      # Packet data
│   │   │   ├── samples/      # Wardrive samples (GET/POST/DELETE)
│   │   │   └── ...
│   │   ├── layout.tsx        # Root layout with providers
│   │   └── globals.css
│   ├── components/           # Shared React components
│   ├── contexts/             # React contexts
│   ├── hooks/                # Custom React hooks
│   ├── i18n/                 # Internationalisation strings
│   ├── lib/                  # Shared utilities and ClickHouse helpers
│   │   ├── clickhouse/       # ClickHouse query helpers
│   │   ├── meshcore.ts       # MeshCore protocol utilities
│   │   ├── regions.ts        # Region definitions
│   │   └── ...
│   ├── middleware.ts          # CORS headers for /api/* routes
│   └── types/                # Shared TypeScript types
├── scripts/
│   ├── discord-bot.ts        # Discord webhook bot
│   └── lib/discord.ts        # Discord client utilities
├── public/                   # Static assets
├── clickhouse-schema.sql     # Full ClickHouse schema
├── docker-compose.yml
├── Dockerfile                # Next.js app image
├── Dockerfile.bot            # Discord bot image
├── CLICKHOUSE_DATABASE.md    # ClickHouse schema reference
└── README.md
```

---

## Development Setup

### Prerequisites

- Node.js 20+
- ClickHouse server (local or remote)
- Docker + Docker Compose (optional)

### Install & Run

```bash
npm install
npm run dev        # Starts Next.js dev server on http://localhost:3000
```

### Environment Variables

Create a `.env.local` in the project root:

```bash
# ClickHouse connection
CLICKHOUSE_HOST=localhost
CLICKHOUSE_PORT=8123
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=password

# Optional: point frontend at a remote API instead of local routes
NEXT_PUBLIC_API_URL=https://map.w0z.is

# Discord bot (only needed when running the bot)
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/YOUR_WEBHOOK_URL
MESH_REGION=seattle
POLL_INTERVAL=1000
MAX_ROWS_PER_POLL=50
PRIVATE_KEYS=key1,key2
```

When `NEXT_PUBLIC_API_URL` is set the local `/api/*` routes are bypassed and the frontend calls the remote URL instead.

### Scripts

| Command | Description |
|---|---|
| `npm run dev` | Next.js development server |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run lint` | ESLint (Next.js config) |
| `npm run discord-bot` | Run Discord bot |
| `npm run discord-bot:dev` | Run Discord bot with hot-reload |

---

## Coding Conventions

### TypeScript

- Strict TypeScript throughout (`tsconfig.json`).
- All shared types live in `src/types/`.
- Prefer explicit return types on exported functions.

### React / Next.js

- Use the **App Router** exclusively; do not add Pages Router files.
- Pages are placed in `src/app/(app)/` for the main shell or `src/app/(embed)/` for embeddable views.
- API routes are in `src/app/api/` as `route.ts` files.
- Providers (React Query, Theme, Config, Locale) are composed in `src/app/layout.tsx`.
- Client components must include the `"use client"` directive at the top.
- Data fetching in server components uses the ClickHouse helpers in `src/lib/clickhouse/`.

### Styling

- Tailwind CSS v4 utility classes only; avoid custom CSS unless absolutely necessary.
- Use `clsx` / `tailwind-merge` for conditional class names.
- Dark-mode support is implemented via `next-themes`; use Tailwind's `dark:` variant.

### API Routes

- All `/api/*` routes automatically receive CORS headers via `src/middleware.ts`.
- Return `NextResponse.json(...)` for JSON responses.
- Use `@clickhouse/client` through the shared helpers in `src/lib/clickhouse/`.

### ClickHouse

- Schema is defined in `clickhouse-schema.sql`; update that file when adding tables or views.
- Prefer querying **materialized views** (`meshcore_adverts_latest`, `unified_latest_nodeinfo`) over raw tables for current-state lookups.
- Always include a time-range filter (`WHERE ingest_timestamp >= now() - INTERVAL X DAY`) on large table scans.
- See `CLICKHOUSE_DATABASE.md` for the full schema reference and query examples.

---

## Key Modules

| File / Directory | Purpose |
|---|---|
| `src/lib/clickhouse/` | ClickHouse client and query helpers |
| `src/lib/meshcore.ts` | MeshCore packet decoding |
| `src/lib/packet-decode.ts` | Meshtastic packet decoding |
| `src/lib/regions.ts` | Region / MQTT broker definitions |
| `src/lib/regionFilters.ts` | SQL filter builders for regions |
| `src/lib/wardrive/` | Wardrive sample processing |
| `src/components/MapView.tsx` | Leaflet map wrapper |
| `src/components/ChatBox.tsx` | Real-time chat component |
| `src/components/PacketAnalyzer.tsx` | Packet inspection UI |
| `src/components/WardriveMap.tsx` | Wardrive coverage map |
| `src/middleware.ts` | CORS middleware for API routes |
| `scripts/discord-bot.ts` | Discord webhook integration |

---

## Testing & Linting

Run the linter before submitting changes:

```bash
npm run lint
```

There is no automated test suite at this time; verify changes manually with the development server.

---

## Docker

```bash
# Create the required external network (once)
docker network create shared-network

# Build and start both services
docker-compose up --build

# Access the app
open http://localhost:3001
```

The `docker-compose.yml` defines two services:
- **meshexplorer** – Next.js web application (port 3001)
- **discord-bot** – Discord webhook bot

---

## Additional References

- [README.md](README.md) – User-facing setup and feature documentation
- [CLICKHOUSE_DATABASE.md](CLICKHOUSE_DATABASE.md) – Full ClickHouse schema and query guide
- [scripts/README.md](scripts/README.md) – Discord bot documentation
