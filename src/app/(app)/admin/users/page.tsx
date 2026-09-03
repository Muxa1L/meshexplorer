"use client";

import { useState } from "react";
import AppPageShell from "@/components/AppPageShell";
import { useAuth } from "@/components/AuthProvider";
import { useLocale } from "@/components/LocaleProvider";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, XMarkIcon, ShieldCheckIcon } from "@heroicons/react/24/solid";
import moment from "moment";
import type { AuthUser, UserStatus, UserRole } from "@/types/auth";

type AdminTab = "pending" | "all";

async function fetchUsers(): Promise<AuthUser[]> {
  const response = await fetch("/api/auth/admin/users", { credentials: "same-origin" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof data?.code === "string" ? data.code : "LOAD_ERROR");
  }
  return (data?.users as AuthUser[]) ?? [];
}

const STATUS_BADGE_CLASS: Record<UserStatus, string> = {
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300",
  approved: "bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300",
  rejected: "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300",
};

const STATUS_LABEL_KEY: Record<UserStatus, string> = {
  pending: "adminUsers.statusPending",
  approved: "adminUsers.statusApproved",
  rejected: "adminUsers.statusRejected",
};

function formatRegistered(createdAt: string): string {
  // ClickHouse DateTime64 strings like `2026-01-02 12:34:56.789` are not
  // valid ISO dates, so swap the separator before parsing (same as the
  // coverage page).
  const parsed = new Date(String(createdAt).replace(" ", "T"));
  return moment(Number.isNaN(parsed.getTime()) ? createdAt : parsed).format("lll");
}

export default function AdminUsersPage() {
  const { t } = useLocale();
  const { user: currentUser, isLoading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<AdminTab>("pending");

  const usersQuery = useQuery({
    queryKey: ["admin", "users"],
    queryFn: fetchUsers,
    retry: false,
  });

  const moderateMutation = useMutation({
    mutationFn: async (payload: { email: string; status?: Exclude<UserStatus, "pending">; role?: UserRole }) => {
      const response = await fetch("/api/auth/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof data?.code === "string" ? data.code : "MUTATION_ERROR");
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });

  const isAdmin = currentUser?.role === "admin";
  const users = usersQuery.data ?? [];
  const visibleUsers = tab === "pending" ? users.filter((u) => u.status === "pending") : users;

  return (
    <AppPageShell contentClassName="max-w-5xl">
      <div className="mb-6 text-center">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">{t("adminUsers.title")}</h1>
        <p className="text-gray-600 dark:text-gray-400">{t("adminUsers.subtitle")}</p>
      </div>

      {authLoading ? (
        <div className="text-center">
          <div className="animate-spin mx-auto mb-4 h-8 w-8 rounded-full border-b-2 border-blue-600" />
        </div>
      ) : !isAdmin ? (
        <p className="rounded-md border border-yellow-200 bg-yellow-50 px-3 py-2 text-sm text-yellow-800 dark:border-yellow-900 dark:bg-yellow-950 dark:text-yellow-300">
          {t("adminUsers.adminOnly")}
        </p>
      ) : (
        <>
          <div className="mb-4 flex justify-center gap-2">
            <button
              onClick={() => setTab("pending")}
              className={`rounded px-4 py-1.5 text-sm font-medium transition-colors ${
                tab === "pending"
                  ? "bg-blue-600 text-white"
                  : "text-gray-700 hover:bg-neutral-100 dark:text-gray-300 dark:hover:bg-neutral-700"
              }`}
            >
              {t("adminUsers.pendingTab")}
            </button>
            <button
              onClick={() => setTab("all")}
              className={`rounded px-4 py-1.5 text-sm font-medium transition-colors ${
                tab === "all"
                  ? "bg-blue-600 text-white"
                  : "text-gray-700 hover:bg-neutral-100 dark:text-gray-300 dark:hover:bg-neutral-700"
              }`}
            >
              {t("adminUsers.allTab")}
            </button>
          </div>

          {moderateMutation.isError && (
            <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
              {t("adminUsers.loadError")}
            </p>
          )}

          {usersQuery.isLoading ? (
            <div className="text-center">
              <div className="animate-spin mx-auto mb-4 h-8 w-8 rounded-full border-b-2 border-blue-600" />
              <p className="text-gray-600 dark:text-gray-400">{t("common.loading")}</p>
            </div>
          ) : usersQuery.isError ? (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
              {t("adminUsers.loadError")}
            </p>
          ) : visibleUsers.length === 0 ? (
            <p className="rounded-md border border-gray-200 bg-white px-3 py-6 text-center text-sm text-gray-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-gray-400">
              {tab === "pending" ? t("adminUsers.noPending") : t("adminUsers.noUsers")}
            </p>
          ) : (
            <UserTable
              users={visibleUsers}
              currentEmail={currentUser?.email ?? null}
              isMutating={moderateMutation.isPending}
              onModerate={(payload) => moderateMutation.mutate(payload)}
              t={t}
            />
          )}
        </>
      )}
    </AppPageShell>
  );
}

interface UserTableProps {
  users: AuthUser[];
  currentEmail: string | null;
  isMutating: boolean;
  onModerate: (payload: { email: string; status?: Exclude<UserStatus, "pending">; role?: UserRole }) => void;
  t: (key: string) => string;
}

function UserTable({ users, currentEmail, isMutating, onModerate, t }: UserTableProps) {
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-neutral-700">
      <table className="w-full text-left text-sm">
        <thead className="bg-neutral-100 text-xs uppercase tracking-wide text-gray-500 dark:bg-neutral-800 dark:text-gray-400">
          <tr>
            <th className="px-4 py-3">{t("adminUsers.name")}</th>
            <th className="px-4 py-3">{t("adminUsers.email")}</th>
            <th className="px-4 py-3">{t("adminUsers.status")}</th>
            <th className="px-4 py-3">{t("adminUsers.role")}</th>
            <th className="px-4 py-3">{t("adminUsers.registered")}</th>
            <th className="px-4 py-3 text-right">{t("common.filters")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 bg-white dark:divide-neutral-700 dark:bg-neutral-800">
          {users.map((user) => (
            <tr key={user.id} className={isMutating ? "opacity-60" : undefined}>
              <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{user.displayName}</td>
              <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                {user.email}
                {currentEmail === user.email && (
                  <span className="ml-1 text-xs font-semibold text-blue-600 dark:text-blue-400">({t("adminUsers.you")})</span>
                )}
              </td>
              <td className="px-4 py-3">
                <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE_CLASS[user.status]}`}>
                  {t(STATUS_LABEL_KEY[user.status])}
                </span>
              </td>
              <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                {user.role === "admin" ? t("adminUsers.roleAdmin") : t("adminUsers.roleUser")}
              </td>
              <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{formatRegistered(user.createdAt)}</td>
              <td className="px-4 py-3">
                <div className="flex justify-end gap-2">
                  {user.status !== "approved" && (
                    <button
                      onClick={() => onModerate({ email: user.email, status: "approved" })}
                      disabled={isMutating}
                      title={t("adminUsers.approve")}
                      className="inline-flex items-center gap-1 rounded bg-green-600 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-60"
                    >
                      <CheckIcon className="h-4 w-4" />
                      <span className="hidden sm:inline">{t("adminUsers.approve")}</span>
                    </button>
                  )}
                  {user.status !== "rejected" && (
                    <button
                      onClick={() => onModerate({ email: user.email, status: "rejected" })}
                      disabled={isMutating}
                      title={t("adminUsers.reject")}
                      className="inline-flex items-center gap-1 rounded bg-red-600 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-60"
                    >
                      <XMarkIcon className="h-4 w-4" />
                      <span className="hidden sm:inline">{t("adminUsers.reject")}</span>
                    </button>
                  )}
                  {currentEmail !== user.email && (
                    <button
                      onClick={() => onModerate({ email: user.email, role: user.role === "admin" ? "user" : "admin" })}
                      disabled={isMutating}
                      title={user.role === "admin" ? t("adminUsers.revokeAdmin") : t("adminUsers.makeAdmin")}
                      className="inline-flex items-center gap-1 rounded border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-neutral-100 disabled:opacity-60 dark:border-neutral-600 dark:text-gray-300 dark:hover:bg-neutral-700"
                    >
                      <ShieldCheckIcon className="h-4 w-4" />
                      <span className="hidden sm:inline">
                        {user.role === "admin" ? t("adminUsers.revokeAdmin") : t("adminUsers.makeAdmin")}
                      </span>
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}