"use client";

import { useEffect } from "react";
import { useConfig } from "@/components/ConfigContext";
import { getRegionDisplayName } from "@/lib/regions";
import { 
  useTotalNodes, 
  useNodesOverTime, 
  usePopularChannels, 
  useRepeaterPrefixes, 
  useUnusedPrefixes 
} from "@/hooks/useStats";
import Link from "next/link";
import { useLocale } from "@/components/LocaleProvider";

// Component for anchor links next to section headings
function AnchorLink({ id }: { id: string }) {
  return (
    <Link
      href={`#${id}`}
      className="ml-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity"
    >
      #
    </Link>
  );
}

export default function StatsPage() {
  const { config } = useConfig();
  const { locale, t } = useLocale();
  const region = config?.selectedRegion;
  
  // Use TanStack Query hooks for data fetching
  const totalNodesQuery = useTotalNodes(region);
  const nodesOverTimeQuery = useNodesOverTime(region);
  const popularChannelsQuery = usePopularChannels(region);
  const repeaterPrefixesQuery = useRepeaterPrefixes(region);
  const unusedPrefixesQuery = useUnusedPrefixes(region);
  
  // Combine loading states - show loading if any query is loading
  const isLoading = totalNodesQuery.isLoading || 
                   nodesOverTimeQuery.isLoading || 
                   popularChannelsQuery.isLoading || 
                   repeaterPrefixesQuery.isLoading;
  
  // Combine error states
  const error = totalNodesQuery.error || 
               nodesOverTimeQuery.error || 
               popularChannelsQuery.error || 
               repeaterPrefixesQuery.error;
  
  // Extract data with fallbacks
  const totalNodes = totalNodesQuery.data?.total_nodes ?? null;
  const nodesOverTime = nodesOverTimeQuery.data?.data ?? [];
  const popularChannels = popularChannelsQuery.data?.data ?? [];
  const repeaterPrefixes = repeaterPrefixesQuery.data?.data ?? [];
  const repeaterPrefixesByHashSize = repeaterPrefixesQuery.data?.byHashSize ?? { "1": repeaterPrefixes };
  const unusedPrefixes = unusedPrefixesQuery.data ?? [];

  // Get the friendly name for the selected region
  const regionFriendlyName = config?.selectedRegion 
    ? getRegionDisplayName(config.selectedRegion, locale)
    : null;

  // Handle scrolling to anchor after data loads
  useEffect(() => {
    if (!isLoading && !error) {
      // Small delay to ensure DOM is fully rendered
      const timer = setTimeout(() => {
        const hash = window.location.hash;
        if (hash) {
          const element = document.getElementById(hash.substring(1));
          if (element) {
            element.scrollIntoView({ behavior: 'smooth' });
          }
        }
      }, 100);
      
      return () => clearTimeout(timer);
    }
  }, [isLoading, error]);

  return (
    <div className="max-w-2xl w-full mx-auto my-4 py-2 px-4 text-gray-800 dark:text-gray-200 bg-white dark:bg-neutral-900 rounded-lg shadow-lg">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t("stats.title")}</h1>
        {regionFriendlyName && (
          <div className="text-sm text-gray-500 dark:text-gray-400">
            {regionFriendlyName}
          </div>
        )}
      </div>
      {error ? (
        <div className="text-red-600 dark:text-red-400">
          <h2 className="text-lg font-semibold mb-2">{t("stats.errorTitle")}</h2>
          <p>{error.message || t("stats.errorDescription")}</p>
        </div>
      ) : isLoading ? (
        <div className="text-center py-8">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p className="mt-2 text-gray-600 dark:text-gray-400">{t("stats.loading")}</p>
        </div>
      ) : (
        <>
          <div className="mb-6">
            <div className="group flex items-center">
              <h2 id="total-nodes" className="text-lg font-semibold mb-2">{t("stats.totalUniqueNodes")}</h2>
              <AnchorLink id="total-nodes" />
            </div>
            <div className="text-3xl font-mono">{totalNodes}</div>
          </div>

          <div className="mb-6">
            <div className="group flex items-center">
              <h2 id="nodes-over-time" className="text-lg font-semibold mb-2">{t("stats.nodesHeardOverTime")}</h2>
              <AnchorLink id="nodes-over-time" />
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              {t("stats.nodesHeardDescription")}
            </p>
            <div className="w-full overflow-x-auto">
              <table className="w-full text-sm border rounded">
                <thead>
                  <tr className="bg-gray-100 dark:bg-gray-800 font-semibold">
                    <th className="border px-3 py-2 text-center min-w-[120px]">{t("stats.day")}</th>
                    <th className="border px-3 py-2 text-center">{t("stats.totalNodes")}</th>
                    <th className="border px-3 py-2 text-center">{t("stats.withLocation")}</th>
                    <th className="border px-3 py-2 text-center">{t("stats.withoutLocation")}</th>
                    <th className="border px-3 py-2 text-center">{t("stats.repeaters")}</th>
                    <th className="border px-3 py-2 text-center">{t("stats.roomServers")}</th>
                  </tr>
                </thead>
                <tbody>
                  {nodesOverTime.map((row, i) => (
                    <tr key={i} className="border-t">
                      <td className="border px-3 py-2 text-center min-w-[120px]">{row.day}</td>
                      <td className="border px-3 py-2 text-center">{row.cumulative_unique_nodes}</td>
                      <td className="border px-3 py-2 text-center">{row.nodes_with_location}</td>
                      <td className="border px-3 py-2 text-center">{row.nodes_without_location}</td>
                      <td className="border px-3 py-2 text-center">{row.repeaters}</td>
                      <td className="border px-3 py-2 text-center">{row.room_servers}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mb-6">
            <div className="group flex items-center">
              <h2 id="packet-count-by-type" className="text-lg font-semibold mb-2">{t("stats.packetCountByType")}</h2>
              <AnchorLink id="packet-count-by-type" />
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              {t("stats.packetCountDescription")}
            </p>
            <Link
              href="/packet-count"
              className="inline-block px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors text-sm font-medium"
            >
              {t("stats.viewPacketChart")}
            </Link>
          </div>

          <div className="mb-6">
            <div className="group flex items-center">
              <h2 id="popular-channels" className="text-lg font-semibold mb-2">{t("stats.popularChannels")}</h2>
              <AnchorLink id="popular-channels" />
            </div>
            <table className="w-full text-sm border">
              <thead>
                <tr>
                  <th className="border px-2 py-1">{t("stats.channelHash")}</th>
                  <th className="border px-2 py-1">{t("stats.messageCount")}</th>
                </tr>
              </thead>
              <tbody>
                {popularChannels.map((row, i) => (
                  <tr key={i}>
                    <td className="border px-2 py-1">{row.channel_hash}</td>
                    <td className="border px-2 py-1">{row.message_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mb-6">
            <div className="group flex items-center">
              <h2 id="used-prefixes" className="text-lg font-semibold mb-2">{t("stats.usedRepeaterPrefixes")}</h2>
              <AnchorLink id="used-prefixes" />
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              {t("stats.usedPrefixesDescription")}
            </p>
            <div className="space-y-4">
              {Object.entries(repeaterPrefixesByHashSize)
                .sort(([left], [right]) => Number(left) - Number(right))
                .map(([hashSizeBytes, rows]) => (
                  <div key={hashSizeBytes}>
                    <div className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                      {hashSizeBytes}-byte path hashes
                    </div>
                    <table className="w-full text-sm border">
                      <thead>
                        <tr>
                          <th className="border px-2 py-1">{t("stats.prefix")}</th>
                          <th className="border px-2 py-1">Nodes</th>
                          <th className="border px-2 py-1">{t("stats.nodeNames")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row, i) => (
                          <tr key={`${hashSizeBytes}-${row.prefix}-${i}`}>
                            <td className="border px-2 py-1 font-mono">{row.prefix}</td>
                            <td className="border px-2 py-1 text-center">{row.node_count}</td>
                            <td className="border px-2 py-1">
                              {row.node_names && row.node_names.length > 0 ? (
                                <div className="space-y-1">
                                  {row.node_names.map((name: string, j: number) => (
                                    <div key={j} className="text-xs">
                                      {name || t("stats.unnamedNode")}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-gray-500">{t("stats.noNamedNodes")}</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
            </div>
          </div>

          <div className="mb-6">
            <div className="group flex items-center">
              <h2 id="unused-prefixes" className="text-lg font-semibold mb-2">{t("stats.unusedRepeaterPrefixes")}</h2>
              <AnchorLink id="unused-prefixes" />
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              {t("stats.unusedPrefixesDescription")}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
              Unused-prefix generation remains limited to legacy 1-byte prefixes.
            </p>
            <div className="grid grid-cols-8 sm:grid-cols-12 md:grid-cols-16 lg:grid-cols-20 gap-1">
              {unusedPrefixes.map((prefix) => (
                <a
                  key={prefix}
                  href={`https://gessaman.com/mc-keygen/?prefix=${prefix}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-mono text-center p-1 bg-gray-100 dark:bg-gray-800 rounded border hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors cursor-pointer"
                  title={t("stats.clickGenerate", { prefix })}
                >
                  {prefix}
                </a>
              ))}
            </div>
            <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              {t("stats.totalUnusedPrefixes", { count: unusedPrefixes.length })}
            </div>
          </div>
        </>
      )}
    </div>
  );
} 