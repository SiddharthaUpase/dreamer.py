import "dotenv/config";
import { SandboxInstance } from "@blaxel/core";

async function main() {
  const sb = await SandboxInstance.get("proj-proj-1773027003708");
  const previews = await sb.previews.list();

  for (const p of previews) {
    if (p.name.startsWith("terminal-") && p.name !== "terminal-preview") {
      console.log("Deleting:", p.name);
      try { await sb.previews.delete(p.name); } catch {}
    }
  }
  console.log("Done");
}

main();
