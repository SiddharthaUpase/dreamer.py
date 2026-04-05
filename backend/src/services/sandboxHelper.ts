import type { SandboxInstance } from "@blaxel/core";
import { createSandbox, getSandbox } from "./sandbox.js";
import { getProject, updateProject } from "./projectStore.js";

/**
 * Get an existing sandbox for a project, or create one if none exists.
 * Shared between API server and worker process.
 */
export async function getProjectSandbox(projectId: string): Promise<SandboxInstance> {
  console.log(`[sandbox] getProjectSandbox("${projectId}")`);

  const stored = await getProject(projectId);
  console.log(`[sandbox] stored project:`, stored ? { sandbox_id: stored.sandbox_id, template: stored.template } : "null");

  if (stored?.sandbox_id) {
    try {
      const sb = await getSandbox(projectId);
      console.log(`[sandbox] getSandbox succeeded: ${sb.metadata?.name}`);
      return sb;
    } catch (err: any) {
      console.error(`[sandbox] getSandbox failed:`, { code: err.code, message: err.message });
      /* fall through to create */
    }
  }

  const template = stored?.template || "nextjs";
  console.log(`[sandbox] creating new sandbox, template="${template}"...`);

  const sandbox = await createSandbox(projectId, template);
  console.log(`[sandbox] createSandbox succeeded: ${sandbox.metadata?.name}`);

  if (stored) {
    await updateProject(projectId, { sandbox_id: sandbox.metadata?.name || `proj-${projectId}` });
  }
  return sandbox;
}
