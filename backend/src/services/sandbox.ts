import "dotenv/config";
import { SandboxInstance } from "@blaxel/core";

// Template → custom image mapping
// Images are pre-built with all dependencies via `bl deploy` from sandbox-templates/
const TEMPLATE_IMAGES: Record<string, string> = {
  nextjs: "nextjs-template:latest",
  blank: "github-template:latest",
};

function sandboxName(projectId: string): string {
  return `proj-${projectId}`.replace(/_/g, "-").toLowerCase();
}

export async function createSandbox(
  projectId: string,
  template: string = "blank"
): Promise<SandboxInstance> {
  const name = sandboxName(projectId);
  const image = TEMPLATE_IMAGES[template];

  const sandbox = await SandboxInstance.create({
    name,
    ...(image ? { image } : {}),
    memory: 4096,
    ports: [{ target: 3000, protocol: "HTTP" }],
    region: "us-pdx-1",
  });

  console.log(`Sandbox created: ${name} (template: ${template}, image: ${image || "base"})`);
  return sandbox;
}

export async function getSandbox(
  projectId: string
): Promise<SandboxInstance> {
  return await SandboxInstance.get(sandboxName(projectId));
}

export async function deleteSandbox(projectId: string): Promise<void> {
  await SandboxInstance.delete(sandboxName(projectId));
}
