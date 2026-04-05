import "dotenv/config";
import { Worker } from "bullmq";
import { createRedisConnection } from "./services/redis.js";
import { updateJobStatus, insertAgentEvent, type JobStatus } from "./services/agentJobs.js";
import { getProjectSandbox } from "./services/sandboxHelper.js";
import {
  runAgentStream,
  collectOutputFiles,
  dbRowToLangChain,
  langChainToDbRow,
  sanitizeHistory,
  type DatabaseConfig,
  type DeployConfig,
} from "./agent/index.js";
import { getProject, getProjectMessages, saveMessages, deleteProjectMessages } from "./services/projectStore.js";
import { readSandboxEnvVars } from "./services/provisioning.js";
import { checkUserAccess } from "./services/starterCode.js";
import type { AgentJobData } from "./services/agentQueue.js";

// ===== Startup validation =====
const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "OPEN_ROUTER", "REDIS_URL"];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`\x1b[31m[worker] Missing required env var: ${key}\x1b[0m`);
    process.exit(1);
  }
}

console.log("[worker] starting agent worker...");

/**
 * Process a single agent job.
 * Writes events to agent_events table (frontend subscribes via Realtime).
 * Listens for abort signal on Redis pub/sub channel `abort:<jobId>`.
 */
async function processJob(data: AgentJobData): Promise<void> {
  const { jobId, projectId, userId, worktreeId, message, model } = data;
  console.log(`\x1b[33m[worker]\x1b[0m processing job=${jobId} project=${projectId} worktree=${worktreeId}`);

  // Mark job as running
  await updateJobStatus(jobId, "running");

  // Set up abort listener via Redis pub/sub
  const abortController = new AbortController();
  const abortSubscriber = createRedisConnection();
  await abortSubscriber.subscribe(`abort:${jobId}`);
  abortSubscriber.on("message", (channel) => {
    if (channel === `abort:${jobId}`) {
      console.log(`\x1b[31m[worker]\x1b[0m abort received for job=${jobId}`);
      abortController.abort();
    }
  });

  // Event emitter — writes to agent_events table.
  // Serialized via promise chain: the agent calls sendEvent synchronously
  // (without await) for token events, so without serialization, parallel
  // inserts race over the network and Postgres assigns IDs in arrival order
  // rather than emission order, causing garbled text on the frontend.
  let insertChain: Promise<void> = Promise.resolve();
  const sendEvent = (event: any): void => {
    if (abortController.signal.aborted) return;
    insertChain = insertChain.then(async () => {
      try {
        await insertAgentEvent(jobId, event);
      } catch (err: any) {
        console.error(`[worker] failed to insert event:`, err.message);
      }
    });
  };
  // Wait for all queued inserts to finish before marking job complete
  const drainEvents = () => insertChain;

  try {
    // Verify access
    const hasAccess = await checkUserAccess(userId);
    if (!hasAccess) {
      sendEvent({ type: "error", content: "No access. Please redeem a starter code." });
      await drainEvents();
      await updateJobStatus(jobId, "failed", "No access");
      return;
    }

    // Load project
    const project = await getProject(projectId);
    if (!project) {
      sendEvent({ type: "error", content: "Project not found" });
      await drainEvents();
      await updateJobStatus(jobId, "failed", "Project not found");
      return;
    }

    // Get sandbox
    const sandbox = await getProjectSandbox(projectId);

    // Load history
    const history = sanitizeHistory(
      (await getProjectMessages(projectId, userId)).map(dbRowToLangChain)
    );

    // Build configs
    const dbConfig: DatabaseConfig | undefined = project.database_url
      ? { connectionString: project.database_url }
      : undefined;

    const envVars = await readSandboxEnvVars(sandbox);
    const deployConfig: DeployConfig | undefined = process.env.VERCEL_TOKEN
      ? {
          projectName: `vas-${project.name}`,
          vercelToken: process.env.VERCEL_TOKEN,
          vercelTeamId: process.env.VERCEL_TEAM_ID || undefined,
          envVars: Object.keys(envVars).length > 0 ? envVars : undefined,
        }
      : undefined;

    // Run the agent (same function, just different event sink)
    const result = await runAgentStream(
      sandbox,
      history,
      message,
      model || "mimo",
      sendEvent,
      abortController.signal,
      project.preview_url || undefined,
      dbConfig,
      deployConfig,
    );

    console.log(`\x1b[32m[worker]\x1b[0m agent done job=${jobId}, ${result.newMessages.length} new messages`);

    // Persist messages
    if (result.newMessages.length > 0) {
      try {
        if ((result as any).compactedHistory) {
          await deleteProjectMessages(projectId, userId);
          const dbRows = (result as any).compactedHistory.map((m: any) => langChainToDbRow(m, projectId, userId));
          await saveMessages(dbRows);
          sendEvent({ type: "compacted", before: history.length, after: dbRows.length });
        } else {
          // Skip the user's HumanMessage — it was already saved by the API
          // when the job was created, so we don't re-save it here.
          const dbRows = result.newMessages
            .map((m) => langChainToDbRow(m, projectId, userId))
            .filter((row) => row.role !== "human");
          await saveMessages(dbRows);
        }
      } catch (err: any) {
        console.error(`[worker] failed to persist messages:`, err.message);
      }
    }

    // Collect output files
    const files = await collectOutputFiles(sandbox);
    if (files.length > 0) {
      sendEvent({ type: "outputs", files });
    }

    // Drain all pending event inserts before flipping status
    await drainEvents();
    const finalStatus: JobStatus = abortController.signal.aborted ? "aborted" : "completed";
    await updateJobStatus(jobId, finalStatus);
  } catch (err: any) {
    if (abortController.signal.aborted || err.name === "AbortError") {
      console.log(`[worker] job ${jobId} aborted`);
      sendEvent({ type: "aborted" });
      await drainEvents();
      await updateJobStatus(jobId, "aborted");
    } else {
      console.error(`\x1b[31m[worker]\x1b[0m job ${jobId} failed:`, err.message);
      sendEvent({ type: "error", content: err.message });
      await drainEvents();
      await updateJobStatus(jobId, "failed", err.message);
    }
  } finally {
    await abortSubscriber.unsubscribe(`abort:${jobId}`);
    abortSubscriber.disconnect();
  }
}

// ===== Start the worker =====
const worker = new Worker<AgentJobData>(
  "agent-queue",
  async (job) => processJob(job.data),
  {
    connection: createRedisConnection(),
    concurrency: parseInt(process.env.WORKER_CONCURRENCY || "3", 10),
  }
);

worker.on("ready", () => {
  console.log("\x1b[32m[worker]\x1b[0m ready, listening for jobs");
});

worker.on("error", (err) => {
  console.error("[worker] error:", err.message);
});

worker.on("failed", (job, err) => {
  console.error(`[worker] job ${job?.id} failed:`, err.message);
});

// Graceful shutdown
async function shutdown() {
  console.log("[worker] shutting down...");
  await worker.close();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
