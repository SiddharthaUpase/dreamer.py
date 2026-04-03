import "dotenv/config";
import { SandboxInstance } from "@blaxel/core";

async function main() {
  const sandbox = await SandboxInstance.get("proj-test-2");
  console.log("Sandbox:", sandbox.metadata.name);

  // Clean up old terminal previews
  try { await sandbox.previews.delete("terminal-preview"); } catch {}
  try { await sandbox.previews.delete("terminal-public"); } catch {}

  // Create fresh private preview on 443
  const preview = await sandbox.previews.create({
    metadata: { name: "terminal-preview" },
    spec: { port: 443, public: false },
  });
  const baseUrl = preview.spec?.url;
  console.log("Terminal preview URL:", baseUrl);

  // Wait a moment for it to be ready
  await new Promise(r => setTimeout(r, 2000));

  const key = process.env.BL_API_KEY!;

  // Test paths with BL API key
  for (const path of ["/", "/terminal", "/terminal/"]) {
    const res = await fetch(`${baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${key}` },
      redirect: "manual",
    });
    const loc = res.headers.get("location") || "";
    const body = await res.text().catch(() => "");
    console.log(`${res.status} ${path} ${loc ? "→ " + loc : ""} — ${body.slice(0, 150)}`);
  }

  // Also try the dev-server preview (port 3000) /terminal path
  const devPreview = await sandbox.previews.get("dev-server-preview");
  const devUrl = devPreview.spec?.url;
  console.log("\nDev preview URL:", devUrl);
  for (const path of ["/terminal", "/terminal/"]) {
    const res = await fetch(`${devUrl}${path}`, { redirect: "manual" });
    const loc = res.headers.get("location") || "";
    const body = await res.text().catch(() => "");
    console.log(`${res.status} ${path} ${loc ? "→ " + loc : ""} — ${body.slice(0, 150)}`);
  }
}

main().catch(console.error);
