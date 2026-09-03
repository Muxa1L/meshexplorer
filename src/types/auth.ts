/**
 * Shared types for authentication and user management.
 */

/** Moderation status of a registered account. */
export type UserStatus = "pending" | "approved" | "rejected";

/** Role of an account. Admins can moderate registrations. */
export type UserRole = "user" | "admin";

/** Public representation of a user (never includes the password hash). */
export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  status: UserStatus;
  role: UserRole;
  createdAt: string;
  approvedAt: string | null;
}