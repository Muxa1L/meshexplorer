# MeshExplorer

MeshExplorer is a real-time map, chat client, and packet analysis tool for mesh networks using MeshCore and Meshtastic. It enables users to visualize mesh nodes on a map, communicate via chat, and analyze packet data in real time.

## Features
- Real-time map of mesh network nodes (MeshCore and Meshtastic)
- Integrated chat client for mesh channels
- Packet analysis and inspection tools
- Customizable map layers and clustering
- Modern, responsive UI

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

## Environment Variables

### ClickHouse Database Configuration

The application connects to ClickHouse using the following environment variables:

- `CLICKHOUSE_HOST` - ClickHouse server hostname (default: `localhost`)
- `CLICKHOUSE_PORT` - ClickHouse server port (default: `8123`)
- `CLICKHOUSE_USER` - ClickHouse username (default: `default`)
- `CLICKHOUSE_PASSWORD` - ClickHouse password (default: `password`)

### `NEXT_PUBLIC_API_URL`

This environment variable allows you to override the API base URL for frontend development purposes. When set, all API calls will be made to the specified URL instead of using relative URLs.

**Use case**: This is useful when you want to develop the frontend without direct access to the ClickHouse database, by pointing to a remote API endpoint.

**Example**:
```bash
NEXT_PUBLIC_API_URL=https://map.w0z.is
```

**Important**: When this environment variable is set, the local API routes (`/api/*`) will not work. Make sure the remote API endpoint provides the same API structure and endpoints.

**Default behavior**: If not set, the application uses relative URLs and works with the local Next.js API routes.

### CORS Support

The application includes middleware (`middleware.ts`) that automatically adds CORS headers to all API routes. This allows:

- Cross-origin requests from localhost to production APIs
- Cross-protocol requests (HTTP on localhost to HTTPS in production)
- Preflight OPTIONS requests are handled automatically

The middleware applies the following CORS headers to all `/api/*` routes:
- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS`
- `Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With`
- `Access-Control-Allow-Credentials: true`

## Authentication

MeshExplorer requires a signed-in session for **all pages**. Registration is pre-moderated:

1. A user registers at `/register` — the account is created with `pending` status.
2. An administrator approves or declines the registration at `/admin/users`.
3. Only approved users can sign in at `/login`; everyone else is redirected there by middleware.

The **first registered user** is automatically approved with administrator rights, so a fresh instance is never locked out.

Sessions are HMAC-SHA256 signed, HttpOnly cookies (`SameSite=Lax`, 7 day expiry). Accounts and password hashes (scrypt) are stored in the ClickHouse `users` table (see [CLICKHOUSE_DATABASE.md](CLICKHOUSE_DATABASE.md)); the table is created automatically on first use.

Environment variables:

- `AUTH_SECRET` — secret used to sign session cookies. **Set this in production** to a long random string (e.g. `openssl rand -hex 32`). If unset, an insecure development fallback is used and a warning is logged.

Middleware (`src/middleware.ts`) redirects unauthenticated page requests to `/login` (only `/login` and `/register` stay public). The existing `/api/*` data routes keep their public CORS behaviour; the auth API (`/api/auth/*`) enforces its own session/admin checks.

## Learn More

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [MeshCore](https://github.com/your-org/meshcore) - mesh network backend
- [Meshtastic](https://meshtastic.org/) - open source mesh communication project

## Docker Deployment

The application includes Docker support for easy deployment. The Docker configuration is set up to connect to ClickHouse running on the Docker host.

### Published Container Image

GitHub Actions now builds and publishes the production app image to GitHub Container Registry (GHCR) as:

```bash
ghcr.io/muxa1l/meshexplorer:latest
```

- Pushes to `main` publish `latest`, `main`, and commit-SHA tags
- Version tags like `v1.2.3` publish a matching image tag
- Pull requests build the Docker image for validation without pushing it

### Prerequisites

- Docker and Docker Compose installed
- ClickHouse running on the Docker host (default port 8123)
- External Docker network `shared-network` must exist (see setup instructions below)

### External Network Setup

The application requires an external Docker network called `shared-network` to communicate with ClickHouse. You must create this network before running the application:

```bash
docker network create shared-network
```

**Note**: If the network already exists, this command will show an error but can be safely ignored.

### Running with Docker Compose

1. **Create the required external network (if not already created):**
   ```bash
   docker network create shared-network
   ```

2. **Build and start the application:**
   ```bash
   docker-compose up --build
   ```

3. **Access the application:**
   Open [http://localhost:3001](http://localhost:3001) in your browser.

### Docker Configuration

The `docker-compose.yml` file is configured with:
- **Port mapping**: Container port 3000 → Host port 3001
- **ClickHouse connection**: Uses `clickhouse` hostname to connect to ClickHouse via the shared network
- **External network**: Requires `shared-network` to be created externally
- **Environment variables**: Pre-configured for typical ClickHouse setup

### Customizing ClickHouse Connection

You can customize the ClickHouse connection by modifying the environment variables in `docker-compose.yml`:

```yaml
environment:
  - CLICKHOUSE_HOST=your-clickhouse-host
  - CLICKHOUSE_PORT=8123
  - CLICKHOUSE_USER=your-username
  - CLICKHOUSE_PASSWORD=your-password
```

### Building with BuildKit

For faster builds with caching, enable BuildKit:

```bash
DOCKER_BUILDKIT=1 docker-compose up --build
```

## Wardrive Support 🚗

This project now includes a wardrive map and backend APIs ported from the [meshwar-map](https://github.com/mintylinux/meshwar-map) repository.

### Frontend

- A new **Wardrive** page is available at `/wardrive` (or via the header). It displays coverage generated from wardrive samples, allowing you to visualize radio reception quality on a map.
- **Settings panel** in the map lets you:
  - toggle day/night basemap
  - choose **resolution** (geohash precision 5–9) which will fetch lower/higher-resolution coverage cells from the API
- The map is powered by Leaflet and dynamically loads data from the `/api/samples` endpoint (supports `?precision=` query parameter).
- When `NEXT_PUBLIC_API_URL` is set, the wardrive map will load data from the remote API instead of the local one.

### Backend APIs

The following API routes are provided by the Next.js application:

| Method | Path             | Description |
|--------|------------------|-------------|
| GET    | `/api/samples`   | Retrieve aggregated coverage cells. |
| POST   | `/api/samples`   | Upload an array of wardrive samples (deduplicated server-side). |
| DELETE | `/api/samples`   | Truncate wardrive coverage/seen data (useful for clearing dev data). |

Additionally, `/api/wardrive/put-sample` accepts individual samples for raw storage.

API responses include appropriate CORS headers to allow cross-origin clients.

### Persistence & ClickHouse Schema

Wardrive data is now persisted in ClickHouse. Three new tables are required:

```sql
CREATE TABLE IF NOT EXISTS wardrive_coverage (
    hash String,
    received Float64,
    lost Float64,
    samples UInt32,
    repeaters String,
    lastUpdate DateTime,
    appVersion String
) ENGINE = MergeTree()
ORDER BY hash
TTL toDateTime(lastUpdate) + INTERVAL 90 DAY;

CREATE TABLE IF NOT EXISTS wardrive_samples (
    lat Float64,
    lon Float64,
    path String,
    snr Float64,
    rssi Float64,
    ingest_timestamp DateTime DEFAULT now()
) ENGINE = MergeTree()
ORDER BY ingest_timestamp
TTL ingest_timestamp + INTERVAL 90 DAY;

CREATE TABLE IF NOT EXISTS wardrive_seen (
    id String,
    seen_at DateTime DEFAULT now(),
    expiration UInt32
) ENGINE = MergeTree()
ORDER BY id
TTL seen_at + toIntervalSecond(expiration);
```

These statements are already included at the top of `clickhouse-schema.sql`; run that file against your ClickHouse server before using the wardrive APIs.

The `wardrive_seen` table is used for deduplication. The API will insert an ID for each sample and skip processing if it has been seen before. Truncating `/api/samples` clears both the coverage and seen tables.

### Notes

- The wardrive endpoints do not currently require authentication; you may want to add headers or tokens in production.
- The frontend map caches data until the browser reloads; you can force a refresh by navigating away and back to the page.

## Deploy

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out the [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
