"use client";

import AppPageShell from "@/components/AppPageShell";
import { useConfig } from "@/components/ConfigContext";
import { getRegionDisplayName } from "@/lib/regions";
import PacketCountChart from "@/components/PacketCountChart";
import Link from "next/link";
import { useLocale } from "@/components/LocaleProvider";

export default function PacketCountPage() {
  const { config } = useConfig();
  const { locale, t } = useLocale();
  const region = config?.selectedRegion;

  // Get the friendly name for the selected region
  const regionFriendlyName = config?.selectedRegion
    ? getRegionDisplayName(config.selectedRegion, locale)
    : null;

  return (
    <AppPageShell>
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link
            href="/stats"
            className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 mb-2 inline-block"
          >
            {t("packetCount.backToStats")}
          </Link>
          <h1 className="text-2xl font-bold">{t("packetCount.title")}</h1>
        </div>
        {regionFriendlyName && (
          <div className="text-sm text-gray-500 dark:text-gray-400">
            {regionFriendlyName}
          </div>
        )}
      </div>

      <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
        {t("packetCount.description")}
      </p>

      <PacketCountChart region={region} />
    </AppPageShell>
  );
}
