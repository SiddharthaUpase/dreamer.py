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
}

export interface StoredMessage {
  id: string;
  project_id: string;
  role: "human" | "ai" | "tool";
  content: string;
  tool_calls: any[] | null;     // AI messages: [{name, args, id}]
  tool_call_id: string | null;  // Tool messages: links to AI tool_call
  name: string | null;          // Tool messages: tool name
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
  const { error } = await supabase.from("projects").insert(project);
  if (error) throw error;
}

export async function updateProject(id: string, updates: Partial<StoredProject>) {
  const { data, error } = await supabase
    .from("projects")
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

export async function getProjectMessages(projectId: string): Promise<StoredMessage[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function saveMessage(msg: Omit<StoredMessage, "id" | "created_at">) {
  const { error } = await supabase.from("messages").insert(msg);
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
  const { error } = await supabase.from("messages").insert(withTimestamps);
  if (error) throw error;
}

export async function deleteProjectMessages(projectId: string) {
  const { error } = await supabase.from("messages").delete().eq("project_id", projectId);
  if (error) throw error;
}
