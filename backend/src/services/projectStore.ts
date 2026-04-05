import { supabase } from "./supabase.js";

export interface StoredProject {
  id: string;
  user_id: string;
  name: string;
  template: string;
  sandbox_id: string | null;
  preview_url: string | null;
  created_at: string;
  updated_at: string;
  // Provisioning
  database_url: string | null;
  jwt_secret: string | null;
  r2_bucket_name: string | null;
  r2_access_key_id: string | null;
  r2_secret_access_key: string | null;
  r2_token_id: string | null;
  r2_public_domain: string | null;
  layout: any | null;
}

export interface StoredMessage {
  id: string;
  project_id: string;
  role: "human" | "ai" | "tool";
  content: string;
  tool_calls: any[] | null;     // AI messages: [{name, args, id}]
  tool_call_id: string | null;  // Tool messages: links to AI tool_call
  name: string | null;          // Tool messages: tool name
  user_id: string | null;       // Which user's conversation this belongs to
  commit_sha: string | null;    // Git commit SHA if this message triggered a commit
  created_at: string;
}

// ===== Projects =====

export async function getAllProjects(userId: string): Promise<StoredProject[]> {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getProject(id: string): Promise<StoredProject | null> {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return null;
  return data;
}

export async function saveProject(project: Omit<StoredProject, "created_at" | "updated_at">) {
  const { error } = await supabase.from("projects").insert(project as any);
  if (error) throw error;
}

export async function updateProject(id: string, updates: Partial<StoredProject>) {
  const { data, error } = await (supabase.from("projects") as any)
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) return null;
  return data;
}

export async function deleteProject(id: string) {
  const { error } = await supabase.from("projects").delete().eq("id", id);
  if (error) throw error;
}

// ===== Messages =====

export async function getProjectMessages(projectId: string, userId?: string): Promise<StoredMessage[]> {
  let query = supabase
    .from("messages")
    .select("*")
    .eq("project_id", projectId);
  if (userId) {
    query = query.eq("user_id", userId);
  }
  const { data, error } = await query.order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function saveMessage(msg: Omit<StoredMessage, "id" | "created_at">) {
  const { error } = await supabase.from("messages").insert(msg as any);
  if (error) throw error;
}

export async function saveMessages(msgs: Omit<StoredMessage, "id" | "created_at">[]) {
  if (msgs.length === 0) return;
  // Assign explicit timestamps with 1ms offsets to guarantee ordering.
  // Without this, batch insert gives all rows the same created_at,
  // and SELECT ORDER BY created_at returns them in arbitrary order.
  const now = Date.now();
  const withTimestamps = msgs.map((msg, i) => ({
    ...msg,
    created_at: new Date(now + i).toISOString(),
  }));
  const { error } = await supabase.from("messages").insert(withTimestamps as any);
  if (error) throw error;
}

export async function deleteProjectMessages(projectId: string, userId?: string) {
  let query = supabase.from("messages").delete().eq("project_id", projectId);
  if (userId) {
    query = query.eq("user_id", userId);
  }
  const { error } = await query;
  if (error) throw error;
}

/** Update the most recent human message for a project+user with a commit SHA */
export async function updateMessageCommitSha(projectId: string, userId: string, commitSha: string) {
  // Find the most recent human message
  const { data, error: findErr } = await (supabase as any)
    .from("messages")
    .select("id")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .eq("role", "human")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (findErr || !data) return;

  const { error } = await (supabase as any)
    .from("messages")
    .update({ commit_sha: commitSha })
    .eq("id", data.id);
  if (error) throw error;
}

/** Get a message by its commit SHA */
export async function getMessageByCommitSha(projectId: string, userId: string, commitSha: string) {
  const { data, error } = await (supabase as any)
    .from("messages")
    .select("*")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .eq("commit_sha", commitSha)
    .single();
  if (error) return null;
  return data as StoredMessage;
}

/** Delete all messages after a given timestamp for a project+user */
export async function deleteMessagesAfter(projectId: string, userId: string, afterTimestamp: string) {
  const { error } = await (supabase as any)
    .from("messages")
    .delete()
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .gt("created_at", afterTimestamp);
  if (error) throw error;
}

// ===== Collaborators =====

export async function addCollaborator(projectId: string, userId: string, invitedBy: string) {
  const { error } = await (supabase as any)
    .from("project_collaborators")
    .insert({ project_id: projectId, user_id: userId, invited_by: invitedBy });
  if (error) throw error;
}

export async function removeCollaborator(projectId: string, userId: string) {
  const { error } = await (supabase as any)
    .from("project_collaborators")
    .delete()
    .eq("project_id", projectId)
    .eq("user_id", userId);
  if (error) throw error;
}

export async function isCollaborator(projectId: string, userId: string): Promise<boolean> {
  const { data } = await (supabase as any)
    .from("project_collaborators")
    .select("project_id")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  return !!data;
}

export async function getSharedProjects(userId: string): Promise<(StoredProject & { shared: boolean })[]> {
  const { data: colRows, error } = await (supabase as any)
    .from("project_collaborators")
    .select("project_id")
    .eq("user_id", userId);
  if (error || !colRows || colRows.length === 0) return [];

  const projectIds = colRows.map((r: any) => r.project_id);
  const { data: projects, error: pErr } = await supabase
    .from("projects")
    .select("*")
    .in("id", projectIds)
    .order("created_at", { ascending: false });
  if (pErr || !projects) return [];

  return projects.map((p: any) => ({ ...p, shared: true }));
}
