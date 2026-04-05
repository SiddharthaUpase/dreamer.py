import { supabase } from "./supabase.js";

export type JobStatus = "queued" | "running" | "completed" | "failed" | "aborted";

export interface AgentJob {
  id: string;
  project_id: string;
  worktree_id: string;
  user_id: string;
  status: JobStatus;
  message: string;
  model: string;
  error: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Create a new agent job row. Returns the created job.
 */
export async function createAgentJob(params: {
  projectId: string;
  userId: string;
  worktreeId: string;
  message: string;
  model: string;
}): Promise<AgentJob> {
  const { data, error } = await (supabase.from("agent_jobs") as any)
    .insert({
      project_id: params.projectId,
      user_id: params.userId,
      worktree_id: params.worktreeId,
      message: params.message,
      model: params.model,
      status: "queued",
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to create job: ${error?.message || "no data"}`);
  }
  return data as AgentJob;
}

/**
 * Update an agent job's status and optional error message.
 */
export async function updateJobStatus(
  jobId: string,
  status: JobStatus,
  error?: string
): Promise<void> {
  const update: any = { status, updated_at: new Date().toISOString() };
  if (error !== undefined) update.error = error;
  await (supabase.from("agent_jobs") as any).update(update).eq("id", jobId);
}

/**
 * Fetch a job by id.
 */
export async function getJob(jobId: string): Promise<AgentJob | null> {
  const { data } = await (supabase.from("agent_jobs") as any)
    .select("*")
    .eq("id", jobId)
    .maybeSingle();
  return (data as AgentJob) || null;
}

/**
 * Insert an agent event. Frontend subscribes to these via Supabase Realtime.
 */
export async function insertAgentEvent(jobId: string, event: any): Promise<void> {
  await (supabase.from("agent_events") as any).insert({
    job_id: jobId,
    type: event.type,
    data: event,
  });
}

/**
 * Find the currently-active (queued or running) job for a project+worktree.
 * Used on frontend reconnect to resume subscribing to an in-flight agent.
 */
export async function getActiveJob(
  projectId: string,
  worktreeId: string,
  userId: string
): Promise<AgentJob | null> {
  const { data } = await (supabase.from("agent_jobs") as any)
    .select("*")
    .eq("project_id", projectId)
    .eq("worktree_id", worktreeId)
    .eq("user_id", userId)
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as AgentJob) || null;
}
