import { createClient } from '@clickhouse/client';

const host = process.env.CLICKHOUSE_HOST || 'localhost';
const port = process.env.CLICKHOUSE_PORT || '8123';
const user = process.env.CLICKHOUSE_USER || 'default';
const password = process.env.CLICKHOUSE_PASSWORD || 'password';
const database = process.env.CLICKHOUSE_DATABASE || 'default';

export const clickhouse = createClient({
  url: `http://${host}:${port}`,
  username: user,
  password: password,
  database: database,
  // You can add more options as needed, e.g. database, compression, etc.
});