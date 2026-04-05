import { Queue } from "bullmq";
import { createRedisConnection } from "./redis.js";

export interface AgentJobData {
  jobId: string;        // UUID from agent_jobs table
  projectId: string;
  userId: string;
  worktreeId: string;
  message: string;
  model: string;
}

/**
 * Shared queue for agent execution jobs.
 * Jobs are enqueued by the API server and processed by worker.ts.
 */
export const agentQueue = new Queue<AgentJobData>("agent-queue", {
  connection: createRedisConnection(),
  defaultJobOptions: {
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 100 },
    attempts: 1, // Don't auto-retry — let the user re-send
  },
});

/**
 * Publish an abort signal for a specific job.
 * The worker processing this job will receive the message via pub/sub
 * and trigger its local AbortController.
 */
export async function publishAbort(jobId: string): Promise<void> {
  const redis = createRedisConnection();
  try {
    await redis.publish(`abort:${jobId}`, "1");
  } finally {
    await redis.quit();
  }
}
