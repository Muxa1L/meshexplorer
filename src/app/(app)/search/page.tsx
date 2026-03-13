"use client";

import { useConfig } from '@/components/ConfigContext';
import { useSearchQuery } from '@/hooks/useQueryParams';
import { useMeshcoreSearch } from '@/hooks/useMeshcoreSearch';
import SearchInput from '@/components/SearchInput';
import SearchResults from '@/components/SearchResults';
import RegionSelector from '@/components/RegionSelector';
import { getLastSeenOptions } from '@/components/ConfigContext';
import { getLocalizedRegionFriendlyNames } from '@/lib/regions';
import { useState, Suspense, useEffect } from 'react';
import { ChevronDownIcon } from '@heroicons/react/24/outline';
import { useLocale } from '@/components/LocaleProvider';

function SearchPageContent() {
  const { config } = useConfig();
  const { locale, t } = useLocale();
  const { query, setQuery, setLimit, setExact, setIsRepeater } = useSearchQuery();
  const [showFilters, setShowFilters] = useState(false);

  // Helper function to check if exact search is enabled
  const isExactEnabled = query.exact === true || (typeof query.exact === 'string' && (query.exact === 'true' || query.exact === ''));
  
  // Helper function to check if is_repeater search is enabled
  const isRepeaterEnabled = query.is_repeater === true || (typeof query.is_repeater === 'string' && (query.is_repeater === 'true' || query.is_repeater === ''));

  // Always use config values for region and lastSeen
  const searchParams = {
    query: query.q,
    region: config.selectedRegion,
    lastSeen: config.lastSeen,
    limit: query.limit || 50,
    exact: isExactEnabled,
    is_repeater: isRepeaterEnabled,
  };

  const { data, isLoading, error } = useMeshcoreSearch({
    ...searchParams,
    enabled: true,
  });

  const { setConfig } = useConfig();
  const lastSeenOptions = getLastSeenOptions(t);
  const localizedRegions = getLocalizedRegionFriendlyNames(locale);

  const handleRegionChange = (region: string) => {
    setConfig({ ...config, selectedRegion: region || undefined });
  };

  const handleLastSeenChange = (lastSeen: number | null) => {
    setConfig({ ...config, lastSeen });
  };

  const handleLimitChange = (limit: number) => {
    setLimit(limit);
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-neutral-900">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            {t("searchPage.title")}
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            {t("searchPage.subtitle")}
          </p>
        </div>

        {/* Search Input */}
        <div className="mb-6">
          <SearchInput
            value={query.q}
            onChange={setQuery}
            placeholder={t("searchPage.placeholder")}
            autoFocus
          />
        </div>

        {/* Filters */}
        <div className="mb-6">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
          >
            <span>{t("common.filters")}</span>
            <ChevronDownIcon className={`h-4 w-4 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
          </button>

          {showFilters && (
            <div className="mt-4 p-4 bg-white dark:bg-neutral-800 rounded-lg border border-gray-200 dark:border-neutral-700">
              <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                {/* Region Filter */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    {t("searchPage.regionLabel")}
                  </label>
                  <select
                    value={config.selectedRegion || ''}
                    onChange={(e) => handleRegionChange(e.target.value || '')}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-neutral-600 rounded-md bg-white dark:bg-neutral-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">{t("searchPage.allRegions")}</option>
                    {localizedRegions.map(({ name, friendlyName }) => (
                      <option key={name} value={name}>{friendlyName}</option>
                    ))}
                  </select>
                </div>

                {/* Last Seen Filter */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    {t("searchPage.lastSeenLabel")}
                  </label>
                  <select
                    value={config.lastSeen || ''}
                    onChange={(e) => handleLastSeenChange(e.target.value ? parseInt(e.target.value, 10) : null)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-neutral-600 rounded-md bg-white dark:bg-neutral-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {lastSeenOptions.map((option) => (
                      <option key={option.value || 'null'} value={option.value || ''}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Limit Filter */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    {t("searchPage.resultsLimit")}
                  </label>
                  <select
                    value={searchParams.limit}
                    onChange={(e) => handleLimitChange(parseInt(e.target.value, 10))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-neutral-600 rounded-md bg-white dark:bg-neutral-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value={10}>10</option>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                    <option value={200}>200</option>
                  </select>
                </div>

                {/* Exact Match Filter */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    {t("searchPage.matchType")}
                  </label>
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      id="exact-match"
                      checked={isExactEnabled}
                      onChange={(e) => setExact(e.target.checked)}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <label htmlFor="exact-match" className="ml-2 text-sm text-gray-700 dark:text-gray-300">
                      {t("searchPage.exactOnly")}
                    </label>
                  </div>
                </div>

                {/* Repeater Filter */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    {t("searchPage.nodeType")}
                  </label>
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      id="is-repeater"
                      checked={isRepeaterEnabled}
                      onChange={(e) => setIsRepeater(e.target.checked)}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <label htmlFor="is-repeater" className="ml-2 text-sm text-gray-700 dark:text-gray-300">
                      {t("searchPage.repeatersOnly")}
                    </label>
                  </div>
                </div>

              </div>
            </div>
          )}
        </div>

        {/* Search Results */}
        <SearchResults
          results={data?.results || []}
          isLoading={isLoading}
          error={error}
          query={query.q}
          total={data?.total || 0}
        />
      </div>
    </div>
  );
}

export default function SearchPage() {
  const { t } = useLocale();

  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 dark:bg-neutral-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">{t("searchPage.loadingSearch")}</p>
        </div>
      </div>
    }>
      <SearchPageContent />
    </Suspense>
  );
}
