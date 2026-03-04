"use client";

import { useConfig } from "@/components/ConfigContext";
import { getRegionConfig } from "@/lib/regions";
import PacketCountChart from "@/components/PacketCountChart";
import Link from "next/link";

export default function PacketCountPage() {
  const { config } = useConfig();
  const region = config?.selectedRegion;

  // Get the friendly name for the selected region
  const regionFriendlyName = config?.selectedRegion
    ? getRegionConfig(config.selectedRegion)?.friendlyName || config.selectedRegion
    : null;

  return (
    <div className="max-w-6xl w-full mx-auto my-4 py-2 px-4 text-gray-800 dark:text-gray-200 bg-white dark:bg-neutral-900 rounded-lg shadow-lg">
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link
            href="/stats"
            className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 mb-2 inline-block"
          >
            ← Back to Stats
          </Link>
          <h1 className="text-2xl font-bold">Packet Count by Type</h1>
        </div>
        {regionFriendlyName && (
          <div className="text-sm text-gray-500 dark:text-gray-400">
            {regionFriendlyName}
          </div>
        )}
      </div>

      <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
        View packet count statistics grouped by type over a selectable time period. Click legend items to show/hide series.
      </p>

      <PacketCountChart region={region} />
    </div>
  );
}
