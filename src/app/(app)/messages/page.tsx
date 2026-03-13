"use client";
import { Suspense } from "react";
import ChatBox from "@/components/ChatBox";
import { useLocale } from "@/components/LocaleProvider";

// Messages page: displays all chat messages from all channels using the ChatBox component with tabs

export default function MessagesPage() {
  const { t } = useLocale();

  return (
    <div className="w-full h-full flex flex-col">
      {/* ChatBox component with all messages tab enabled and expanded behavior */}
      <div className="flex-1 flex justify-center items-start p-4">
        <div className="w-full max-w-6xl h-full">
          <Suspense fallback={<div className="w-full h-full flex items-center justify-center">{t("common.loading")}</div>}>
            <ChatBox showAllMessagesTab={true} startExpanded={true} className="w-full h-full" />
          </Suspense>
        </div>
      </div>
    </div>
  );
} 