import "dotenv/config";

const baseUrl = "https://77738c44b99b8c692289f02e33b09bf0.preview.bl.run";
const key = process.env.BL_API_KEY!;
const headers = { Authorization: `Bearer ${key}` };

async function tryPath(path: string) {
  const res = await fetch(`${baseUrl}${path}`, { headers });
  const body = await res.text().catch(() => "");
  console.log(`${res.status} ${path} — ${body.slice(0, 200)}`);
}

async function main() {
  await tryPath("/");
  await tryPath("/terminal");
  await tryPath("/terminal/");
  await tryPath("/api");
  await tryPath("/sandbox-api");
  await tryPath("/sandbox-api/terminal");
  await tryPath("/shell");
  await tryPath("/ws");
  await tryPath("/xterm");
}

main().catch(console.error);
