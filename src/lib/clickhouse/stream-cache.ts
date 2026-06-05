import { StreamingConfig, StreamingParams, StreamingResult, createClickHouseStreamer } from './streaming';

/**
 * Represents a unique subscription to a cached stream
 */
interface StreamSubscription<T> {
  id: string;
  callback: (result: StreamingResult<T>) => void | Promise<void>;
  startAfter?: string | null;
}

/**
 * Manages a single cached stream with multiple subscribers
 */
class CachedStream<T = any> {
  private config: StreamingConfig;
  private params: StreamingParams;
  private subscribers: Map<string, StreamSubscription<T>> = new Map();
  private pollerPromise: Promise<void> | null = null;
  private isRunning = false;
  private lastError: Error | null = null;
  private subscriptionIdCounter = 0;
  private inactivityTimeout: NodeJS.Timeout | null = null;
  private inactivityMs = 30000; // Clean up stream if inactive for 30s

  constructor(config: StreamingConfig, params: StreamingParams = {}) {
    this.config = config;
    this.params = params;
  }

  /**
   * Subscribe to this stream, returns an unsubscribe function
   */
  subscribe(
    callback: (result: StreamingResult<T>) => void | Promise<void>
    , startAfter: string | null = null
  ): () => void {
    const id = `sub_${++this.subscriptionIdCounter}`;
    const subscription: StreamSubscription<T> = { id, callback, startAfter };
    this.subscribers.set(id, subscription);

    // Clear inactivity timeout when a subscriber connects
    if (this.inactivityTimeout) {
      clearTimeout(this.inactivityTimeout);
      this.inactivityTimeout = null;
    }

    // Start polling if not already running
    if (!this.isRunning) {
      this.startPoller();
    }

    // Return unsubscribe function
    return () => {
      this.subscribers.delete(id);
      // If no subscribers left, schedule cleanup
      if (this.subscribers.size === 0) {
        this.inactivityTimeout = setTimeout(() => {
          this.stopPoller();
        }, this.inactivityMs);
      }
    };
  }

  /**
   * Get the number of active subscribers
   */
  getSubscriberCount(): number {
    return this.subscribers.size;
  }

  /**
   * Get the last error encountered
   */
  getLastError(): Error | null {
    return this.lastError;
  }

  /**
   * Start the background poller
   */
  private startPoller() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.pollerPromise = this.runPoller();
  }

  /**
   * Stop the background poller
   */
  private stopPoller() {
    this.isRunning = false;
    // The next iteration of runPoller will exit when isRunning is false
  }

  /**
   * Run the polling loop
   */
  private async runPoller() {
    try {
      const streamer = createClickHouseStreamer<T>(this.config);
      
      for await (const result of streamer(this.params)) {
        // Stop if all subscribers have disconnected
        if (!this.isRunning || this.subscribers.size === 0) {
          break;
        }

        // Broadcast result to subscribers, honoring their startAfter preference
        const timeColumn = this.config.timeColumn;
        const rowTime = (result.row as any)?.[timeColumn];

        for (const sub of Array.from(this.subscribers.values())) {
          try {
            // If subscriber specified a startAfter timestamp, only deliver rows newer than that
            if (sub.startAfter && rowTime) {
              const rowTs = new Date(rowTime).getTime();
              const startTs = new Date(sub.startAfter).getTime();
              if (isNaN(rowTs) || isNaN(startTs) || rowTs <= startTs) {
                continue;
              }
            }

            await sub.callback(result);
          } catch (error) {
            console.error('Error in stream subscriber callback:', error);
          }
        }
      }
    } catch (error) {
      this.lastError = error instanceof Error ? error : new Error(String(error));
      console.error('Error in ClickHouse stream poller:', this.lastError);
      
      // Notify subscribers of error
      const errorResult: StreamingResult<T> & { error: string } = {
        row: {} as T,
        lastTimestamp: '1970-01-01 00:00:00',
        error: this.lastError.message
      };

      for (const subscriber of this.subscribers.values()) {
        try {
          await subscriber.callback(errorResult as any);
        } catch (e) {
          console.error('Error notifying subscriber of error:', e);
        }
      }
    } finally {
      this.isRunning = false;
    }
  }
}

/**
 * Global cache of active streams, keyed by a hash of their config and params
 */
class StreamCache {
  private streams: Map<string, CachedStream> = new Map();

  /**
   * Generate a cache key from config and params
   */
  private generateKey(config: StreamingConfig, params: StreamingParams): string {
    // Use JSON serialization for deterministic key generation
    const configKey = JSON.stringify({
      query: config.queryTemplate,
      timeColumn: config.timeColumn,
      pollInterval: config.pollInterval,
      maxRowsPerPoll: config.maxRowsPerPoll,
      additionalWhereClause: config.additionalWhereClause,
      skipInitialMessages: config.skipInitialMessages
    });
    // Avoid including per-subscriber transient params (like lastTimestamp) in the cache key
    const paramsCopy: Record<string, any> = { ...(params || {}) };
    delete paramsCopy.lastTimestamp;
    delete paramsCopy.firstTimestamp;
    const paramsKey = JSON.stringify(paramsCopy);

    return Buffer.from(`${configKey}::${paramsKey}`).toString('base64');
  }

  /**
   * Get or create a cached stream
   */
  getOrCreateStream<T = any>(
    config: StreamingConfig,
    params: StreamingParams = {}
  ): CachedStream<T> {
    const key = this.generateKey(config, params);

    if (!this.streams.has(key)) {
      this.streams.set(key, new CachedStream(config, params));
    }

    return this.streams.get(key) as CachedStream<T>;
  }

  /**
   * Get stats about active streams
   */
  getStats() {
    return {
      activeStreams: this.streams.size,
      streamsWithSubscribers: Array.from(this.streams.values()).filter(
        s => s.getSubscriberCount() > 0
      ).length,
      totalSubscribers: Array.from(this.streams.values()).reduce(
        (sum, s) => sum + s.getSubscriberCount(),
        0
      ),
      details: Array.from(this.streams.values()).map(s => ({
        subscribers: s.getSubscriberCount(),
        hasError: s.getLastError() !== null,
        error: s.getLastError()?.message
      }))
    };
  }
}

// Export singleton instance
export const streamCache = new StreamCache();

/**
 * Convenience function to subscribe to a cached stream
 */
export function subscribeToStream<T = any>(
  config: StreamingConfig,
  params: StreamingParams,
  callback: (result: StreamingResult<T>) => void | Promise<void>,
  options?: { startAfter?: string | null }
): () => void {
  const stream = streamCache.getOrCreateStream<T>(config, params);
  return stream.subscribe(callback, options?.startAfter ?? null);
}
