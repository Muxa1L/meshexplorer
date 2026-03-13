import { enMessages } from "./en";
import { ruMessages } from "./ru";

export type Locale = "en" | "ru";

export const messages = {
  en: enMessages,
  ru: ruMessages,
} as const;
