"use client";
import { Suspense } from "react";
import AppPageShell from "@/components/AppPageShell";
import ChatBox from "@/components/ChatBox";
import { useLocale } from "@/components/LocaleProvider";

// Messages page: displays all chat messages from all channels using the ChatBox component with tabs

export default function MessagesPage() {
  const { t } = useLocale();

  return (
    <AppPageShell fill contentClassName="overflow-hidden p-0" width="full">
      <Suspense fallback={<div className="flex h-full w-full items-center justify-center bg-white/70 dark:bg-neutral-900/70">{t("common.loading")}</div>}>
          <ChatBox showAllMessagesTab={true} startExpanded={true} className="h-full w-full" />
      </Suspense>
    </AppPageShell>
  );
} 