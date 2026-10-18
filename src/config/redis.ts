import type { ConnectionOptions } from 'bullmq';
import { Redis } from 'ioredis';

import { config } from './index.js';
import { logger } from '../shared/logger.js';

/**
 * Standard BullMQ connection options for Redis.
 * `maxRetriesPerRequest: null` is required by BullMQ to avoid queue stall issues.
 */
export const redisConnection: ConnectionOptions = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  maxRetriesPerRequest: null,
};

let redisClientInstance: Redis | null = null;

/**
 * Returns a singleton ioredis client instance for direct Redis commands or health checks.
 */
export function getRedisClient(): Redis {
  if (!redisClientInstance) {
    redisClientInstance = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });

    redisClientInstance.on('error', (err: unknown) => {
      logger.error({ err }, 'Redis connection error encountered');
    });
  }

  return redisClientInstance;
}

/**
 * Gracefully closes the Redis client instance if initialized.
 */
export async function closeRedisClient(): Promise<void> {
  if (redisClientInstance) {
    await redisClientInstance.quit();
    redisClientInstance = null;
    logger.debug('Redis client connection closed');
  }
}
