/**
 * Experiment: Get a terminal iframe URL from a Blaxel sandbox
 *
 * According to Blaxel (Mathis):
 * - Create a preview on port 443
 * - Terminal will be available at {previewUrl}/terminal
 * - This also exposes the sandbox-api
 */

import "dotenv/config";
import { SandboxInstance } from "@blaxel/core";

async function experiment() {
  // Use an existing sandbox (pick one that's running)
  // List all sandboxes first
  console.log("=== Listing sandboxes ===");
  const sandboxes = await SandboxInstance.list();

  for (const sb of sandboxes) {
    console.log(`  ${sb.metadata.name} — status: ${sb.status?.phase || "unknown"}`);
  }

  if (sandboxes.length === 0) {
    console.log("No sandboxes found. Create a project first.");
    return;
  }

  // Pick the first running sandbox
  const sandbox = sandboxes[0];
  const name = sandbox.metadata.name;
  console.log(`\n=== Using sandbox: ${name} ===`);

  // List existing previews
  console.log("\n=== Existing previews ===");
  const existingPreviews = await sandbox.previews.list();
  for (const p of existingPreviews) {
    console.log(`  ${p.name} — port: ${p.spec?.port} — url: ${p.spec?.url}`);
  }

  // Create a preview on port 443 for terminal access
  console.log("\n=== Creating terminal preview (port 443) ===");
  try {
    // Delete old private preview first, then create public one
    try { await sandbox.previews.delete("terminal-preview"); } catch {}
    const terminalPreview = await sandbox.previews.createIfNotExists({
      metadata: { name: "terminal-public" },
      spec: { port: 443, public: true },
    });

    console.log("Preview created:");
    console.log(`  Name: ${terminalPreview.name}`);
    console.log(`  Spec: ${JSON.stringify(terminalPreview.spec, null, 2)}`);

    const terminalUrl = terminalPreview.spec?.url;
    if (terminalUrl) {
      console.log(`\n=== RESULTS ===`);
      console.log(`  Preview URL: ${terminalUrl}`);
      console.log(`  Terminal URL: ${terminalUrl}/terminal`);
      console.log(`\n  Try opening in browser: ${terminalUrl}/terminal`);
    } else {
      console.log("  No URL returned in spec");
      console.log("  Full preview object:", JSON.stringify(terminalPreview, null, 2));
    }
  } catch (err: any) {
    console.error("Failed to create terminal preview:", err.message);
    console.error("Full error:", JSON.stringify(err, null, 2));
  }

  // Try creating a token for the private preview
  console.log("\n=== Creating preview token ===");
  try {
    const termPreview = await sandbox.previews.get("terminal-preview");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    const token = await termPreview.tokens.create(expiresAt);
    console.log(`  Token: ${token.value}`);
    console.log(`  Expires: ${token.expiresAt}`);

    const terminalUrl = termPreview.spec?.url;
    console.log(`\n  With ?token=: ${terminalUrl}/terminal?token=${token.value}`);
    console.log(`  With ?blaxel_token=: ${terminalUrl}/terminal?blaxel_token=${token.value}`);

    // Test if the token actually works
    console.log("\n=== Testing token access ===");
    const testRes = await fetch(`${terminalUrl}/terminal?token=${token.value}`);
    console.log(`  ?token= status: ${testRes.status}`);

    const testRes2 = await fetch(`${terminalUrl}/terminal?blaxel_token=${token.value}`);
    console.log(`  ?blaxel_token= status: ${testRes2.status}`);

    // Try Authorization header
    const testRes3 = await fetch(`${terminalUrl}/terminal`, {
      headers: { Authorization: `Bearer ${token.value}` },
    });
    console.log(`  Bearer header status: ${testRes3.status}`);
  } catch (err: any) {
    console.error("Token creation failed:", err.message);
    console.error("Full:", JSON.stringify(err, null, 2));
  }

  // Also list previews again to see what we have
  console.log("\n=== All previews after creation ===");
  const allPreviews = await sandbox.previews.list();
  for (const p of allPreviews) {
    console.log(`  ${p.name} — port: ${p.spec?.port} — url: ${p.spec?.url} — public: ${p.spec?.public}`);
  }
}

experiment().catch(console.error);
