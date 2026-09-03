/**
 * User accounts stored in ClickHouse.
 *
 * The `users` table uses ReplacingMergeTree keyed by email with
 * `updated_at DateTime64(3, 'UTC')` as the version column. Updates are
 * performed by inserting a replacement row (a common ClickHouse pattern) and
 * all reads use FINAL so the newest version of each user is returned.
 *
 * The table is created automatically on first use (CREATE TABLE IF NOT EXISTS).
 */

import { clickhouse } from "@/lib/clickhouse/clickhouse";
import type { AuthUser, UserStatus, UserRole } from "@/types/auth";

/** Raw ClickHouse row (snake_case column names as stored). */
interface UsersTableRowRaw {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  status: string;
  role: string;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
}

/** Internal user representation: public fields plus the password hash. */
export interface UsersTableRow extends AuthUser {
  password_hash: string;
}

const USERS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id UUID,
    email String,
    display_name String,
    password_hash String,
    status Enum8('pending' = 1, 'approved' = 2, 'rejected' = 3),
    role Enum8('user' = 1, 'admin' = 2),
    created_at DateTime64(3, 'UTC') DEFAULT now64(3, 'UTC'),
    updated_at DateTime64(3, 'UTC') DEFAULT now64(3, 'UTC'),
    approved_at Nullable(DateTime64(3, 'UTC'))
  )
  ENGINE = ReplacingMergeTree(updated_at)
  ORDER BY email
`;

let ensureTablePromise: Promise<void> | null = null;

/** Create the users table on first use. Failures are not cached (retry on next call). */
export function ensureUsersTable(): Promise<void> {
  if (!ensureTablePromise) {
    ensureTablePromise = clickhouse
      .command({ query: USERS_TABLE_SQL })
      .then(() => undefined)
      .catch((error: unknown) => {
        ensureTablePromise = null;
        throw error;
      });
  }
  return ensureTablePromise;
}

/** Normalize an email for storage/lookup (trimmed + lowercased). */
export function normalizeEmail(email: unknown): string {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

function toUtcDateTimeString(date: Date): string {
  // ClickHouse-friendly `YYYY-MM-DD HH:MM:SS.mmm` in UTC.
  return date.toISOString().replace("T", " ").replace("Z", "");
}

function asStatus(value: unknown): UserStatus {
  return value === "approved" || value === "rejected" ? value : "pending";
}

function asRole(value: unknown): UserRole {
  return value === "admin" ? "admin" : "user";
}

function normalizeRow(row: UsersTableRowRaw): UsersTableRow {
  return {
    id: String(row.id),
    email: row.email,
    displayName: row.display_name,
    status: asStatus(row.status),
    role: asRole(row.role),
    createdAt: String(row.created_at),
    approvedAt: row.approved_at ? String(row.approved_at) : null,
    password_hash: row.password_hash,
  };
}

export function toPublicUser(row: UsersTableRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    status: row.status,
    role: row.role,
    createdAt: row.createdAt,
    approvedAt: row.approvedAt,
  };
}

const USER_COLUMNS =
  "id, email, display_name, password_hash, status, role, created_at, updated_at, approved_at";

/** Look up a single user by email (newest row wins). */
export async function getUserByEmail(email: string): Promise<UsersTableRow | null> {
  await ensureUsersTable();
  const resultSet = await clickhouse.query({
    query: `SELECT ${USER_COLUMNS} FROM users FINAL WHERE email = {email:String} LIMIT 1`,
    query_params: { email },
    format: "JSONEachRow",
  });
  const rows = await resultSet.json<UsersTableRowRaw>();
  return rows.length > 0 ? normalizeRow(rows[0]) : null;
}

/** Total number of distinct registered users (used for first-user bootstrap). */
export async function getUserCount(): Promise<number> {
  await ensureUsersTable();
  const resultSet = await clickhouse.query({
    query: "SELECT count() AS total FROM users FINAL",
    format: "JSONEachRow",
  });
  const rows = await resultSet.json<{ total: number }>();
  return Number(rows[0]?.total ?? 0);
}

/** Insert a new user. */
export async function createUser(input: {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  status: UserStatus;
  role: UserRole;
}): Promise<void> {
  await ensureUsersTable();
  await clickhouse.insert({
    table: "users",
    format: "JSONEachRow",
    values: [
      {
        id: input.id,
        email: input.email,
        display_name: input.displayName,
        password_hash: input.passwordHash,
        status: input.status,
        role: input.role,
        approved_at: input.status === "approved" ? toUtcDateTimeString(new Date()) : null,
      },
    ],
  });
}

/** List all users (newest row per user wins), newest registrations first. */
export async function listUsers(): Promise<AuthUser[]> {
  await ensureUsersTable();
  const resultSet = await clickhouse.query({
    query: `SELECT ${USER_COLUMNS} FROM users FINAL ORDER BY created_at DESC, email ASC`,
    format: "JSONEachRow",
  });
  const rows = await resultSet.json<UsersTableRowRaw>();
  return rows.map(normalizeRow).map(toPublicUser);
}

/**
 * Insert a replacement row for the user with the given email.
 * ReplacingMergeTree keeps the row with the highest `updated_at`.
 */
async function replaceUser(
  user: UsersTableRow,
  changes: { status?: UserStatus; role?: UserRole }
): Promise<void> {
  const status = changes.status ?? asStatus(user.status);
  const role = changes.role ?? asRole(user.role);
  const nowUtc = toUtcDateTimeString(new Date());
  const approvedAt = status === "approved" ? (user.approvedAt ?? nowUtc) : null;

  await clickhouse.insert({
    table: "users",
    format: "JSONEachRow",
    values: [
      {
        id: user.id,
        email: user.email,
        display_name: user.displayName,
        password_hash: user.password_hash,
        status,
        role,
        created_at: user.createdAt,
        updated_at: nowUtc,
        approved_at: approvedAt,
      },
    ],
  });
}

/** Approve or decline a registration. Returns false when the user was not found. */
export async function setUserStatus(
  email: string,
  status: Exclude<UserStatus, "pending">
): Promise<boolean> {
  const user = await getUserByEmail(email);
  if (!user) {
    return false;
  }
  await replaceUser(user, { status });
  return true;
}

/** Grant or revoke admin rights. Returns false when the user was not found. */
export async function setUserRole(email: string, role: UserRole): Promise<boolean> {
  const user = await getUserByEmail(email);
  if (!user) {
    return false;
  }
  await replaceUser(user, { role });
  return true;
}