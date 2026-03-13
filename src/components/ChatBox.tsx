"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownIcon, Bars3Icon, MinusIcon, PlusIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { useConfig } from "./ConfigContext";
import { getChannelIdFromKey } from "@/lib/meshcore";
import ChatMessageItem from "./ChatMessageItem";
import RefreshButton from "./RefreshButton";
import RegionSelector from "./RegionSelector";
import { getRegionDisplayName } from "@/lib/regions";
import { useChatMessages } from "@/hooks/useChatMessages";
import { useIntersectionObserver } from "@/hooks/useIntersectionObserver";
import { useQueryParams } from "@/hooks/useQueryParams";
import { useLocale } from "./LocaleProvider";


interface ChatBoxProps {
  showAllMessagesTab?: boolean;
  className?: string;
  startExpanded?: boolean; // New prop to control initial expanded state
}

interface TabItem {
  channelName: string;
  privateKey: string;
  isAllMessages?: boolean;
}

interface ChatBoxQuery {
  selectedTab?: number;
}

function getChannelDisplayLabel(tab: TabItem) {
  return tab.channelName || getChannelIdFromKey(tab.privateKey).toUpperCase();
}

function getChannelSubtitle(tab: TabItem, t: (key: string) => string) {
  if (tab.isAllMessages) {
    return t("chatBox.aggregatedFeed");
  }

  return `${t("chatBox.secureChannel")} · ${getChannelIdFromKey(tab.privateKey).toUpperCase()}`;
}

function getDayLabel(value: string, locale: string) {
  const date = new Date(value.endsWith("Z") ? value : `${value}Z`);
  return new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

export default function ChatBox({
  showAllMessagesTab = false,
  className = "",
  startExpanded = false,
}: ChatBoxProps) {
  const { locale, t } = useLocale();
  const { config, openKeyModal } = useConfig();
  const meshcoreKeys: TabItem[] = [
    { channelName: "Public", privateKey: "izOH6cXN6mrJ5e26oRXNcg==" },
    ...(config?.meshcoreKeys || []),
  ];

  // Add "All Messages" tab if requested
  const allTabs: TabItem[] = showAllMessagesTab
    ? [{ channelName: t("chatBox.allMessages"), privateKey: "", isAllMessages: true }, ...meshcoreKeys]
    : meshcoreKeys;

  // Use query params to persist selected tab across navigation
  const { query, setParam } = useQueryParams<ChatBoxQuery>({
    selectedTab: showAllMessagesTab ? 1 : 0,
  });
  
  // Ensure selectedTab is within bounds of available tabs
  const rawSelectedTab = query.selectedTab ?? (showAllMessagesTab ? 1 : 0);
  const selectedTab = rawSelectedTab >= 0 && rawSelectedTab < allTabs.length 
    ? rawSelectedTab 
    : (showAllMessagesTab ? 1 : 0);
  const setSelectedTab = (tabIndex: number) => setParam('selectedTab', tabIndex);
  
  const [minimized, setMinimized] = useState(!startExpanded); // Use startExpanded as default for minimized state
  const [isCompactViewport, setIsCompactViewport] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  const expandedScrollRef = useRef<HTMLDivElement>(null);
  const previousExpandedScrollHeightRef = useRef<number | null>(null);

  const selectedKey = allTabs[selectedTab];
  const channelId = selectedKey.isAllMessages
    ? undefined
    : getChannelIdFromKey(selectedKey.privateKey).toUpperCase();

  useEffect(() => {
    if (!startExpanded || typeof window === "undefined") {
      return;
    }

    const mediaQuery = window.matchMedia("(max-width: 1023px)");

    const handleViewportChange = (event: MediaQueryList | MediaQueryListEvent) => {
      const matches = event.matches;
      setIsCompactViewport(matches);
      setIsSidebarOpen(!matches);
    };

    handleViewportChange(mediaQuery);

    const listener = (event: MediaQueryListEvent) => handleViewportChange(event);
    mediaQuery.addEventListener("change", listener);

    return () => mediaQuery.removeEventListener("change", listener);
  }, [startExpanded]);
  
  // Use the new chat messages hook
  const {
    messages,
    loading,
    hasMore,
    loadMore,
    isLoadingMore,
    refresh,
    isRefreshing
  } = useChatMessages({
    channelId,
    region: config?.selectedRegion,
    enabled: !minimized,
    autoRefreshEnabled: !minimized,
  });

  // Always show tabs

  // Set up intersection observer for infinite scrolling
  const loadMoreTriggerRef = useIntersectionObserver(
    () => {
      if (hasMore && !isLoadingMore && !loading) {
        loadMore();
      }
    },
    {
      threshold: 0.1,
      rootMargin: '100px',
      enabled: hasMore && !isLoadingMore && !loading
    }
  );

  const handleRefresh = () => {
    refresh();
  };

  const selectedChannelLabel = getChannelDisplayLabel(selectedKey);
  const isExpandedLayout = startExpanded;
  const expandedMessages = useMemo(() => messages.toReversed(), [messages]);
  const isSidebarVisible = isExpandedLayout ? (!isCompactViewport || isSidebarOpen) : true;

  const updateExpandedScrollState = useCallback(() => {
    const container = expandedScrollRef.current;
    if (!container) {
      return;
    }

    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    const isNearBottom = distanceFromBottom <= 160;

    setShowJumpToLatest(!isNearBottom && expandedMessages.length > 0);
  }, [expandedMessages.length]);

  const scrollToLatestMessage = useCallback((behavior: ScrollBehavior = "smooth") => {
    const container = expandedScrollRef.current;
    if (!container) {
      return;
    }

    container.scrollTo({
      top: container.scrollHeight,
      behavior,
    });
  }, []);

  const handleExpandedScroll = useCallback(() => {
    const container = expandedScrollRef.current;
    if (!container) {
      return;
    }

    updateExpandedScrollState();

    if (container.scrollTop <= 180 && hasMore && !isLoadingMore && !loading) {
      previousExpandedScrollHeightRef.current = container.scrollHeight;
      loadMore();
    }
  }, [hasMore, isLoadingMore, loadMore, loading, updateExpandedScrollState]);

  useEffect(() => {
    if (!isExpandedLayout || !config?.selectedRegion) {
      return;
    }

    previousExpandedScrollHeightRef.current = null;
    setShowJumpToLatest(false);

    const frame = requestAnimationFrame(() => {
      updateExpandedScrollState();
    });

    return () => cancelAnimationFrame(frame);
  }, [config?.selectedRegion, isExpandedLayout, selectedTab, updateExpandedScrollState]);

  useEffect(() => {
    if (!isExpandedLayout || !config?.selectedRegion) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      const container = expandedScrollRef.current;
      if (!container) {
        return;
      }

      if (previousExpandedScrollHeightRef.current !== null) {
        const previousHeight = previousExpandedScrollHeightRef.current;
        previousExpandedScrollHeightRef.current = null;
        container.scrollTop += container.scrollHeight - previousHeight;
      }

      updateExpandedScrollState();
    });

    return () => cancelAnimationFrame(frame);
  }, [config?.selectedRegion, expandedMessages.length, isExpandedLayout, updateExpandedScrollState]);

  const LoadingIndicator = () => (
    <div className="flex justify-center py-4">
      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-700 dark:border-gray-200"></div>
    </div>
  );

  if (isExpandedLayout) {
    return (
      <div className={`flex h-full min-h-0 w-full overflow-hidden rounded-[28px] border border-gray-200/80 bg-white/90 shadow-[0_24px_80px_-32px_rgba(15,23,42,0.35)] backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/95 ${className}`}>
        {isCompactViewport && isSidebarOpen && (
          <button
            type="button"
            aria-label={t("chatBox.closeChannels")}
            className="absolute inset-0 z-20 bg-black/40 backdrop-blur-[1px] lg:hidden"
            onClick={() => setIsSidebarOpen(false)}
          />
        )}

        <aside className={`z-30 flex w-[320px] max-w-[calc(100%-1rem)] shrink-0 flex-col border-gray-200/80 bg-gradient-to-b from-slate-50 to-white dark:border-neutral-800 dark:from-neutral-900 dark:to-neutral-950 ${
          isCompactViewport
            ? `absolute inset-y-0 left-0 border-r shadow-2xl transition-transform duration-300 ${isSidebarVisible ? "translate-x-0" : "-translate-x-full"}`
            : "relative border-b lg:border-b-0 lg:border-r"
        }`}>
          <div className="border-b border-gray-200/80 px-5 py-5 dark:border-neutral-800">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-600 dark:text-blue-400">
                  {t("chatBox.channels")}
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-gray-900 dark:text-white">
                  {t("chatBox.title")}
                </h2>
                <p className="mt-2 truncate text-sm text-gray-500 dark:text-gray-400">
                  {config?.selectedRegion
                    ? getRegionDisplayName(config.selectedRegion, locale)
                    : t("chatBox.selectRegion")}
                </p>
              </div>
              <button
                className="rounded-2xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600 transition hover:border-blue-300 hover:text-blue-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-gray-300 dark:hover:border-blue-500 dark:hover:text-blue-400"
                onClick={() => openKeyModal()}
                title={t("chatBox.openChannelSettings")}
                aria-label={t("chatBox.openChannelSettings")}
              >
                +
              </button>
              {isCompactViewport && (
                <button
                  type="button"
                  className="rounded-2xl border border-gray-200 bg-white p-2 text-gray-600 transition hover:border-blue-300 hover:text-blue-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-gray-300 dark:hover:border-blue-500 dark:hover:text-blue-400"
                  onClick={() => setIsSidebarOpen(false)}
                  title={t("chatBox.closeChannels")}
                  aria-label={t("chatBox.closeChannels")}
                >
                  <XMarkIcon className="h-5 w-5" />
                </button>
              )}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            <div className="space-y-2">
              {allTabs.map((key, idx) => {
                const selected = idx === selectedTab;
                const label = getChannelDisplayLabel(key);
                const badgeLabel = key.isAllMessages ? "#" : label.slice(0, 1).toUpperCase();

                return (
                  <button
                    key={key.privateKey + idx}
                    className={`group w-full rounded-2xl border px-4 py-3 text-left transition ${
                      selected
                        ? "border-blue-500 bg-blue-50 shadow-sm dark:border-blue-500/70 dark:bg-blue-500/10"
                        : "border-transparent bg-transparent hover:border-gray-200 hover:bg-gray-50 dark:hover:border-neutral-700 dark:hover:bg-neutral-800/70"
                    }`}
                    onClick={() => {
                      setSelectedTab(idx);
                      if (isCompactViewport) {
                        setIsSidebarOpen(false);
                      }
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-sm font-semibold ${
                        selected
                          ? "bg-blue-600 text-white"
                          : "bg-gray-100 text-gray-700 dark:bg-neutral-800 dark:text-gray-200"
                      }`}>
                        {badgeLabel}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className={`truncate text-sm font-semibold ${selected ? "text-blue-700 dark:text-blue-300" : "text-gray-900 dark:text-gray-100"}`}>
                            {label}
                          </span>
                          {selected && (
                            <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-blue-600 shadow-sm dark:bg-neutral-900 dark:text-blue-300">
                              {t("chatBox.liveFeed")}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">
                          {getChannelSubtitle(key, t)}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        <section className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-neutral-50/80 dark:bg-neutral-950">
          <div className="flex shrink-0 items-center justify-between gap-4 border-b border-gray-200/80 bg-white/85 px-4 py-4 backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/85 sm:px-6">
            <div className="min-w-0 flex items-center gap-3">
              <button
                type="button"
                className="inline-flex shrink-0 items-center gap-2 rounded-2xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600 transition hover:border-blue-300 hover:text-blue-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-gray-300 dark:hover:border-blue-500 dark:hover:text-blue-400"
                onClick={() => setIsSidebarOpen((open) => !open)}
                aria-label={isSidebarVisible ? t("chatBox.hideChannels") : t("chatBox.showChannels")}
                title={isSidebarVisible ? t("chatBox.hideChannels") : t("chatBox.showChannels")}
              >
                <Bars3Icon className="h-5 w-5" />
                <span className="hidden sm:inline">{t("chatBox.channels")}</span>
              </button>

              <div className="min-w-0">
                <div className="flex items-center gap-2">
                <span className="inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
                  <p className="truncate text-lg font-semibold text-gray-900 dark:text-white">
                    {selectedChannelLabel}
                  </p>
                </div>
                <p className="mt-1 truncate text-sm text-gray-500 dark:text-gray-400">
                  {selectedKey.isAllMessages ? t("chatBox.aggregatedFeed") : getChannelSubtitle(selectedKey, t)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {config?.selectedRegion && (
                <RefreshButton
                  onClick={handleRefresh}
                  loading={isRefreshing}
                  small={true}
                  title={t("chatBox.refreshMessages")}
                  ariaLabel={t("chatBox.refreshMessages")}
                />
              )}
            </div>
          </div>

          {config?.selectedRegion ? (
            <div
              ref={expandedScrollRef}
              onScroll={handleExpandedScroll}
              className="min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.08),_transparent_35%),linear-gradient(to_bottom,_rgba(255,255,255,0.96),_rgba(248,250,252,0.96))] px-3 py-4 dark:bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.12),_transparent_35%),linear-gradient(to_bottom,_rgba(10,10,10,0.98),_rgba(23,23,23,0.98))] sm:px-5 lg:px-6"
            >
              <div className="mx-auto flex w-full max-w-4xl flex-col gap-3">
                {loading && messages.length === 0 && (
                  <div className="flex min-h-[240px] items-center justify-center rounded-3xl border border-dashed border-gray-300 bg-white/70 dark:border-neutral-700 dark:bg-neutral-900/60">
                    <LoadingIndicator />
                  </div>
                )}

                {isLoadingMore && messages.length > 0 && <LoadingIndicator />}

                {expandedMessages.map((msg, index) => {
                  const currentDay = getDayLabel(msg.ingest_timestamp, locale);
                  const previousDay = index > 0 ? getDayLabel(expandedMessages[index - 1].ingest_timestamp, locale) : null;
                  const shouldRenderDivider = currentDay !== previousDay;

                  return (
                    <div key={`${msg.message_id}-${msg.origin_path_info?.length || 0}`}>
                      {shouldRenderDivider && (
                        <div className="sticky top-3 z-10 flex justify-center py-2">
                          <span className="rounded-full border border-gray-200/80 bg-white/95 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500 shadow-sm backdrop-blur dark:border-neutral-700 dark:bg-neutral-900/95 dark:text-gray-400">
                            {currentDay}
                          </span>
                        </div>
                      )}
                      <ChatMessageItem
                        msg={msg}
                        showErrorRow={selectedKey.isAllMessages}
                        variant="channel"
                      />
                    </div>
                  );
                })}

                {messages.length === 0 && !loading && (
                  <div className="flex min-h-[280px] flex-col items-center justify-center rounded-3xl border border-dashed border-gray-300 bg-white/75 px-6 text-center dark:border-neutral-700 dark:bg-neutral-900/70">
                    <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600/10 text-xl font-semibold text-blue-600 dark:text-blue-400">
                      #
                    </div>
                    <p className="text-lg font-semibold text-gray-900 dark:text-white">{selectedChannelLabel}</p>
                    <p className="mt-2 max-w-md text-sm text-gray-500 dark:text-gray-400">{t("chatBox.noMessages")}</p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center p-6">
              <div className="w-full max-w-md rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
                <p className="mb-4 text-base font-semibold text-gray-900 dark:text-white">
                  {t("chatBox.selectRegion")}
                </p>
                <RegionSelector className="w-full" />
              </div>
            </div>
          )}

          {config?.selectedRegion && showJumpToLatest && (
            <div className="pointer-events-none absolute bottom-5 right-5 z-20">
              <button
                type="button"
                onClick={() => scrollToLatestMessage("smooth")}
                className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-600/30 transition hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 dark:focus:ring-offset-neutral-950"
                aria-label={t("chatBox.jumpToLatest")}
                title={t("chatBox.jumpToLatest")}
              >
                <ArrowDownIcon className="h-4 w-4" />
                <span>{t("chatBox.jumpToLatest")}</span>
              </button>
            </div>
          )}
        </section>
      </div>
    );
  }

  return (
    <div
      className={`bg-white dark:bg-neutral-900 rounded-lg shadow-lg flex flex-col ${
        startExpanded ? className : minimized ? "w-80" : "w-80 h-96"
      }`}
    >
      <div
        className={`flex items-center justify-between ps-4 pe-3 py-3 ${
          startExpanded ? "border-b border-gray-200 dark:border-neutral-800" : "min-h-8"
        }`}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="font-semibold text-gray-800 dark:text-gray-100 whitespace-nowrap flex-shrink-0">
            {t("chatBox.title")}
          </span>
          <span
            className="text-xs text-gray-500 dark:text-gray-400 truncate"
            title={getRegionDisplayName(config.selectedRegion!, locale)}
          >
            {getRegionDisplayName(config.selectedRegion!, locale)}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {!minimized && config?.selectedRegion && (
            <RefreshButton
              onClick={handleRefresh}
              loading={isRefreshing}
              small={true}
              title={t("chatBox.refreshMessages")}
              ariaLabel={t("chatBox.refreshMessages")}
            />
          )}
          {!startExpanded && (
            <button
              className="p-1 rounded text-gray-800 dark:text-gray-100 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              onClick={() => setMinimized((m) => !m)}
              aria-label={minimized ? t("chatBox.maximize") : t("chatBox.minimize")}
            >
              {minimized ? <PlusIcon className="h-5 w-5" /> : <MinusIcon className="h-5 w-5" />}
            </button>
          )}
        </div>
      </div>

      {!minimized && config?.selectedRegion && (
        <>
          <div
            className={`border-b border-gray-200 dark:border-neutral-800 ${
              startExpanded ? "px-4 py-2" : "mb-2"
            }`}
          >
            <div className="flex gap-1 overflow-x-auto scrollbar-hide">
              {allTabs.map((key, idx) => (
                <button
                  key={key.privateKey + idx}
                  className={`px-2 py-1 text-xs rounded-t font-mono whitespace-nowrap flex-shrink-0 ${
                    idx === selectedTab
                      ? "bg-gray-100 dark:bg-neutral-800 text-blue-700 dark:text-blue-400 border-b-2 border-blue-500"
                      : "bg-transparent text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-neutral-800"
                  }`}
                  onClick={() => setSelectedTab(idx)}
                >
                  {getChannelDisplayLabel(key)}
                </button>
              ))}
              <button
                className="px-2 py-1 text-xs rounded-t whitespace-nowrap flex-shrink-0 bg-transparent text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-neutral-800"
                onClick={() => openKeyModal()}
                title={t("chatBox.manageChannelKeys")}
              >
                +
              </button>
            </div>
          </div>

           <div
             className={`flex-1 overflow-y-auto text-sm text-gray-700 dark:text-gray-200 ${
               startExpanded ? "" : "flex flex-col-reverse"
             }`}
           >
             <div className={`p-4 ${startExpanded ? "flex flex-col gap-2" : "flex flex-col gap-2"}`}>
               {messages.length === 0 && !loading && (
                 <div className={`text-gray-400 text-center ${startExpanded ? "py-8" : "mt-8"}`}>
                   {t("chatBox.noMessages")}
                 </div>
               )}
               
               {/* Messages */}
               {(startExpanded ? messages : messages.toReversed()).map((msg, i) => (
                 <ChatMessageItem
                   key={`${msg.message_id}-${msg.origin_path_info?.length || 0}`}
                   msg={msg}
                   showErrorRow={selectedKey.isAllMessages}
                 />
               ))}
               
               {/* Loading indicator */}
               {isLoadingMore && <LoadingIndicator />}
               

               {/* Load more trigger always at the bottom */}
               {hasMore && (
                 <div ref={loadMoreTriggerRef} className="h-2" />
               )}
             </div>
           </div>
        </>
      )}
      {!minimized && !config?.selectedRegion && (
        <div className="p-4 flex flex-col rounded-lg overflow-scroll">
          <RegionSelector
            className="w-full"
          />
        </div>
      )}
    </div>
  );
}
