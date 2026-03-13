"use client";
import { Suspense } from "react";
import ChatBox from "@/components/ChatBox";
import { useLocale } from "@/components/LocaleProvider";

// Messages page: displays all chat messages from all channels using the ChatBox component with tabs

export default function MessagesPage() {
  const { t } = useLocale();

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-neutral-100/70 dark:bg-neutral-950">
      <div className="flex-1 min-h-0 p-3 sm:p-4 lg:p-6">
        <Suspense fallback={<div className="flex h-full w-full items-center justify-center rounded-3xl bg-white/70 dark:bg-neutral-900/70">{t("common.loading")}</div>}>
          <ChatBox showAllMessagesTab={true} startExpanded={true} className="h-full w-full" />
        </Suspense>
      </div>
    </div>
  );
} 