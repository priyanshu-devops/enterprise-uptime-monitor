/**
 * In-memory cache service with TTL support.
 * Used for 5-minute server-side caching of Sheets data.
 */
import pino from 'pino';

const logger = pino({ name: 'cache-service' });

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
}

/**
 * Simple in-memory cache with TTL and size limits.
 */
export class CacheService {
  private cache = new Map<string, CacheEntry<unknown>>();
  private readonly maxSize: number;
  private readonly defaultTtl: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(maxSize = 500, defaultTtlSeconds = 300) {
    // Accept a non-numeric first arg gracefully (legacy call from server.ts)
    if (typeof maxSize !== 'number') maxSize = 500;
    this.maxSize = maxSize;
    this.defaultTtl = (typeof defaultTtlSeconds === 'number' ? defaultTtlSeconds : 300) * 1000;
    this.startCleanup();
  }

  /**
   * Get cached value if not expired.
   */
  get<T>(key: string): CacheEntry<T> | null {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;

    const now = Date.now();
    if (now > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry;
  }

  /**
   * Set cache value with TTL.
   */
  set<T>(key: string, data: T, ttlSeconds?: number): void {
    // Enforce max size by removing oldest entries
    if (this.cache.size >= this.maxSize) {
      this.evictOldest();
    }

    const now = Date.now();
    const ttl = (ttlSeconds || this.defaultTtl / 1000) * 1000;
    this.cache.set(key, {
      data,
      timestamp: now,
      expiresAt: now + ttl,
    });
  }

  /**
   * Delete a specific key.
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Invalidate all keys matching a prefix.
   */
  invalidatePrefix(prefix: string): number {
    let count = 0;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        count++;
      }
    }
    logger.debug({ prefix, count }, 'Cache invalidated');
    return count;
  }

  /**
   * Clear all cache entries.
   */
  clear(): void {
    this.cache.clear();
    logger.info('Cache cleared');
  }

  /**
   * Get cache statistics.
   */
  getStats(): { size: number; maxSize: number; keys: string[] } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      keys: Array.from(this.cache.keys()),
    };
  }

  /**
   * Return info about the domains cache entry (used by healthz).
   */
  getCacheInfo(): { generatedAt: number } | null {
    const entry = this.cache.get('domains:all');
    if (!entry) return null;
    return { generatedAt: entry.timestamp };
  }

  /**
   * Flush all data and stop timers — called during graceful shutdown.
   */
  async flush(): Promise<void> {
    this.stop();
    this.clear();
  }

  /**
   * Start periodic cleanup of expired entries.
   */
  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000); // Every minute
    // Don't prevent process exit
    if (typeof this.cleanupTimer === 'object' && 'unref' in this.cleanupTimer) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Remove expired entries.
   */
  private cleanup(): void {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        removed++;
      }
    }
    if (removed > 0) {
      logger.debug({ removed, remaining: this.cache.size }, 'Cache cleanup');
    }
  }

  /**
   * Evict the oldest entry.
   */
  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Date.now();

    for (const [key, entry] of this.cache.entries()) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      logger.debug({ evicted: oldestKey }, 'Cache eviction');
    }
  }

  /**
   * Stop cleanup timer (for testing/shutdown).
   */
  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}

/** Global cache instance (for use outside Express middleware). */
export const globalCache = new CacheService();