import "dotenv/config";
import { Redis } from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

/**
 * Shared Redis connection for BullMQ and pub/sub.
 * BullMQ requires maxRetriesPerRequest: null for blocking operations.
 */
export function createRedisConnection(): Redis {
  return new Redis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

// Main connection used for publishing and generic ops.
// Subscribers must create their own dedicated connection via createRedisConnection().
export const redis = createRedisConnection();

redis.on("error", (err) => {
  console.error("[redis] error:", err.message);
});

redis.on("connect", () => {
  console.log("[redis] connected");
});
