"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale } from "@/components/LocaleProvider";
import { getAppName } from "@/lib/api";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

const INPUT_CLASS =
  "w-full px-3 py-2 rounded-md border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-neutral-600 dark:bg-neutral-700 dark:text-gray-100";

function registerErrorMessage(code: string | undefined, t: (key: string) => string): string {
  switch (code) {
    case "INVALID_EMAIL":
      return t("auth.invalidEmail");
    case "PASSWORD_TOO_SHORT":
      return t("auth.passwordTooShort");
    case "INVALID_DISPLAY_NAME":
      return t("auth.displayNameRequired");
    case "EMAIL_EXISTS":
      return t("auth.emailExists");
    default:
      return t("auth.requestFailed");
  }
}

interface RegistrationResult {
  status: "pending" | "approved";
  isFirstUser: boolean;
}

export default function RegisterPage() {
  const { t } = useLocale();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<RegistrationResult | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    // Client-side validation mirrors the API validation.
    if (displayName.trim().length < 1) return setError(t("auth.displayNameRequired"));
    if (!EMAIL_PATTERN.test(email.trim())) return setError(t("auth.invalidEmail"));
    if (password.length < MIN_PASSWORD_LENGTH) return setError(t("auth.passwordTooShort"));
    if (password !== confirmPassword) return setError(t("auth.passwordsDoNotMatch"));

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email, password, displayName }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(registerErrorMessage(data?.code, t));
        return;
      }
      setResult({ status: data.status, isFirstUser: Boolean(data.isFirstUser) });
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
        {result ? (
          <div className="text-center">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {result.isFirstUser ? t("auth.firstUserTitle") : t("auth.pendingTitle")}
            </h1>
            <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
              {result.isFirstUser ? t("auth.firstUserText") : t("auth.pendingText")}
            </p>
            <Link
              href="/login"
              className="mt-6 inline-block w-full rounded bg-blue-600 px-4 py-2.5 font-medium text-white transition-colors hover:bg-blue-700"
            >
              {t("auth.signIn")}
            </Link>
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t("auth.registerTitle")}</h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{t("auth.registerSubtitle")}</p>

            <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
              <div>
                <label htmlFor="displayName" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t("auth.displayName")}
                </label>
                <input
                  id="displayName"
                  type="text"
                  maxLength={64}
                  autoComplete="name"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className={INPUT_CLASS}
                />
              </div>
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
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={INPUT_CLASS}
                />
              </div>
              <div>
                <label htmlFor="confirmPassword" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t("auth.confirmPassword")}
                </label>
                <input
                  id="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
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
                {isSubmitting ? t("auth.registering") : t("auth.signUp")}
              </button>
            </form>

            <p className="mt-4 text-center text-sm text-gray-600 dark:text-gray-400">
              {t("auth.haveAccount")}{" "}
              <Link href="/login" className="font-medium text-blue-600 hover:underline dark:text-blue-400">
                {t("auth.signIn")}
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}