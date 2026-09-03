"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale } from "@/components/LocaleProvider";
import { getAppName } from "@/lib/api";

function loginErrorMessage(code: string | undefined, t: (key: string) => string): string {
  switch (code) {
    case "ACCOUNT_PENDING":
      return t("auth.accountPending");
    case "ACCOUNT_REJECTED":
      return t("auth.accountRejected");
    case "INVALID_CREDENTIALS":
      return t("auth.invalidCredentials");
    default:
      return t("auth.requestFailed");
  }
}

const INPUT_CLASS =
  "w-full px-3 py-2 rounded-md border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-neutral-600 dark:bg-neutral-700 dark:text-gray-100";

function LoginForm() {
  const { t } = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Only allow same-site redirect targets to prevent open redirects.
  const from = searchParams.get("from");
  const target = from && from.startsWith("/") && !from.startsWith("//") ? from : "/";

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(loginErrorMessage(data?.code, t));
        return;
      }
      router.replace(target);
      router.refresh();
    } catch {
      setError(t("auth.requestFailed"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="w-full max-w-md">
      <p className="mb-4 text-center text-lg font-bold text-gray-800 dark:text-gray-100">{getAppName()}</p>
      <div className="rounded-[28px] border border-black/5 bg-white/80 p-6 shadow-sm backdrop-blur sm:p-8 dark:border-white/10 dark:bg-neutral-900/80">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t("auth.loginTitle")}</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{t("auth.loginSubtitle")}</p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t("auth.email")}
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={INPUT_CLASS}
              placeholder="user@example.com"
            />
          </div>
          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t("auth.password")}
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={INPUT_CLASS}
            />
          </div>

          {error && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded bg-blue-600 px-4 py-2.5 font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
          >
            {isSubmitting ? t("auth.signingIn") : t("auth.signIn")}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-gray-600 dark:text-gray-400">
          {t("auth.noAccount")}{" "}
          <Link href="/register" className="font-medium text-blue-600 hover:underline dark:text-blue-400">
            {t("auth.register")}
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}