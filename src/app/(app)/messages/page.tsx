"use client";
import AppPageShell from "@/components/AppPageShell";

// Messages page: TEMPORARILY_DISABLED
// To re-enable, delete this disabled-notice body and uncomment the original block below.

export default function MessagesPage() {
  return (
    <AppPageShell width="full">
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-8 text-center">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
          Chat is temporarily disabled
        </h1>
        <p className="max-w-md text-sm text-gray-600 dark:text-gray-400">
          The chat page and its APIs are currently turned off. Please check back later.
        </p>
      </div>
    </AppPageShell>
  );
}

/*
import { Suspense } from "react";
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
*/
 