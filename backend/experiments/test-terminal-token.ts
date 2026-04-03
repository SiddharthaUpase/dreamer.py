import "dotenv/config";
import { SandboxInstance } from "@blaxel/core";

async function main() {
  const sandbox = await SandboxInstance.get("proj-test-2");
  const preview = await sandbox.previews.get("terminal-preview");
  const baseUrl = preview.spec?.url;

  // Create a token
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const token = await preview.tokens.create(expiresAt);
  console.log("Token:", token.value);
  console.log("Base URL:", baseUrl);

  // Test with token in different ways
  const paths = [
    `${baseUrl}/terminal?token=${token.value}`,
    `${baseUrl}/terminal?blaxel_token=${token.value}`,
    `${baseUrl}/terminal?preview_token=${token.value}`,
  ];

  for (const url of paths) {
    const res = await fetch(url, { redirect: "manual" });
    const body = await res.text().catch(() => "");
    console.log(`\n${res.status} ${url.replace(baseUrl!, "")}`);
    if (res.status !== 200) console.log(`  body: ${body.slice(0, 100)}`);
    else console.log(`  OK! (${body.length} bytes)`);
  }

  // Try cookie-based
  const cookieRes = await fetch(`${baseUrl}/terminal`, {
    headers: { Cookie: `blaxel_preview_token=${token.value}` },
    redirect: "manual",
  });
  console.log(`\n${cookieRes.status} cookie: blaxel_preview_token`);

  // Try cookie blaxel_token
  const cookieRes2 = await fetch(`${baseUrl}/terminal`, {
    headers: { Cookie: `blaxel_token=${token.value}` },
    redirect: "manual",
  });
  console.log(`${cookieRes2.status} cookie: blaxel_token`);
}

main().catch(console.error);
