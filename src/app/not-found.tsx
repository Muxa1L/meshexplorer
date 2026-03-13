"use client";

import Link from "next/link";
import { useLocale } from "@/components/LocaleProvider";

export default function NotFound() {
  const { t } = useLocale();

  return (
    <div className="flex flex-1 flex-col items-center justify-center min-h-[60vh] text-center px-4">
      <h1 className="text-6xl font-bold text-primary mb-4">404</h1>
      <h2 className="text-2xl font-semibold mb-2">{t("notFound.title")}</h2>
      <p className="text-muted-foreground mb-6 max-w-md">
        {t("notFound.description")}
      </p>
      <Link
        href="/"
        className="inline-block bg-blue-600 text-white px-6 py-2 rounded shadow hover:bg-blue-700 transition-colors"
      >
        {t("notFound.goHome")}
      </Link>
    </div>
  );
} 