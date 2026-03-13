"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo } from "react";
import moment from "moment";
import "moment/locale/ru";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { messages, type Locale } from "@/i18n/messages";

type TranslateValues = Record<string, string | number>;

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, values?: TranslateValues) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

function getValueByPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

function interpolate(template: string, values?: TranslateValues): string {
  if (!values) return template;
  return template.replace(/\{(.*?)\}/g, (_, key) => String(values[key] ?? `{${key}}`));
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocale] = useLocalStorage<Locale>("meshExplorerLocale", "en");

  useEffect(() => {
    document.documentElement.lang = locale;
    moment.locale(locale === "ru" ? "ru" : "en");
  }, [locale]);

  const t = useCallback((key: string, values?: TranslateValues) => {
    const localized = getValueByPath(messages[locale], key);
    const fallback = getValueByPath(messages.en, key);
    const result = typeof localized === "string" ? localized : typeof fallback === "string" ? fallback : key;
    return interpolate(result, values);
  }, [locale]);

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error("useLocale must be used within LocaleProvider");
  }
  return context;
}
