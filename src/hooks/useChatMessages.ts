"use client";

import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';
import { buildApiUrl } from '@/lib/api';
import { ChatMessage } from '@/components/ChatMessageItem';

interface ChatMessagesParams {
  channelId?: string;
  region?: string;
  enabled?: boolean;
  autoRefreshEnabled?: boolean;
}

interface ChatMessagesPage {
  messages: ChatMessage[];
  hasMore: boolean;
  oldestTimestamp?: string;
}

const PAGE_SIZE = 20;

function mergeNewMessages(
  oldData: any,
  incomingMessages: ChatMessage[],
) {
  if (!oldData?.pages?.[0] || incomingMessages.length === 0) {
    return oldData;
  }

  const allExistingMessages = oldData.pages.flatMap((page: any) => page.messages);
  const trulyNewMessages: ChatMessage[] = [];
  const updatedExistingMessages = [...allExistingMessages];

  for (const newMessage of incomingMessages) {
    const existingIndex = updatedExistingMessages.findIndex(
      (msg: ChatMessage) => msg.message_id === newMessage.message_id
    );

    if (existingIndex !== -1) {
      updatedExistingMessages[existingIndex] = newMessage;
    } else {
      trulyNewMessages.push(newMessage);
    }
  }

  const allMessages = [...trulyNewMessages, ...updatedExistingMessages]
    .sort((a, b) => new Date(b.ingest_timestamp).getTime() - new Date(a.ingest_timestamp).getTime());

  const updatedPages = [];
  let currentPageMessages = [];

  for (let index = 0; index < allMessages.length; index += 1) {
    currentPageMessages.push(allMessages[index]);

    if (currentPageMessages.length === PAGE_SIZE || index === allMessages.length - 1) {
      updatedPages.push({
        ...(oldData.pages[Math.floor(index / PAGE_SIZE)] || { hasMore: false }),
        messages: currentPageMessages,
      });
      currentPageMessages = [];
    }
  }

  return {
    ...oldData,
    pages: updatedPages,
  };
}

export function useChatMessages({
  channelId,
  region,
  enabled = true,
  autoRefreshEnabled = true,
}: ChatMessagesParams) {
  const queryClient = useQueryClient();

  // Build base query key
  const baseQueryKey = useMemo(() => 
    ['chat-messages', channelId, region] as const, 
    [channelId, region]
  );

  // Main infinite query for loading messages with pagination
  const messagesQuery = useInfiniteQuery({
    queryKey: baseQueryKey,
    queryFn: async ({ pageParam, signal }): Promise<ChatMessagesPage> => {
      if (!region) {
        throw new Error('Region is required');
      }

      let url = `/api/chat?limit=${PAGE_SIZE}&region=${encodeURIComponent(region)}`;
      if (channelId) {
        url += `&channel_id=${channelId}`;
      }
      
      if (pageParam) {
        url += `&before=${encodeURIComponent(pageParam)}`;
      }

      const response = await fetch(buildApiUrl(url), { signal });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch chat messages: ${response.statusText}`);
      }
      
      const data = await response.json();
      const messages = Array.isArray(data) ? data : [];
      
      return {
        messages,
        hasMore: messages.length === PAGE_SIZE,
        oldestTimestamp: messages.length > 0 ? messages[messages.length - 1].ingest_timestamp : undefined,
      };
    },
    getNextPageParam: (lastPage) => {
      return lastPage.hasMore ? lastPage.oldestTimestamp : undefined;
    },
    initialPageParam: undefined as string | undefined,
    enabled: enabled && !!region,
    staleTime: 10 * 1000, // 10 seconds
    gcTime: 5 * 60 * 1000, // 5 minutes
    retry: 1,
  });

  const appendStreamMessages = useCallback((incomingMessages: ChatMessage[]) => {
    queryClient.setQueryData(baseQueryKey, (oldData: any) => mergeNewMessages(oldData, incomingMessages));
  }, [baseQueryKey, queryClient]);

  useEffect(() => {
    if (!enabled || !autoRefreshEnabled || !region) {
      return;
    }

    const params = new URLSearchParams({
      region,
      pollInterval: '1000',
      maxRows: String(PAGE_SIZE),
    });
    if (channelId) {
      params.set('channel_id', channelId.toLowerCase());
    }
    params.set('skipInitialMessages', 'true');

    const eventSource = new EventSource(buildApiUrl(`/api/meshcore/stream/chat?${params.toString()}`));

    eventSource.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as ChatMessage & { type?: string };
        if (message.type === 'error') {
          return;
        }

        appendStreamMessages([message]);
      } catch (error) {
        console.error('Failed to process streaming chat message:', error);
      }
    };

    eventSource.onerror = () => {
      // Allow EventSource to reconnect automatically.
    };

    return () => {
      eventSource.close();
    };
  }, [appendStreamMessages, autoRefreshEnabled, channelId, enabled, region]);

  // Flatten all messages from all pages
  const allMessages = messagesQuery.data?.pages.flatMap(page => page.messages) ?? [];
  
  // Check if there are more pages to load
  const hasNextPage = messagesQuery.hasNextPage;
  
  return {
    messages: allMessages,
    loading: messagesQuery.isLoading,
    error: messagesQuery.error,
    hasMore: hasNextPage,
    loadMore: messagesQuery.fetchNextPage,
    isLoadingMore: messagesQuery.isFetchingNextPage,
    refresh: () => {
      queryClient.invalidateQueries({ queryKey: baseQueryKey });
    },
    isRefreshing: messagesQuery.isRefetching,
  };
}
