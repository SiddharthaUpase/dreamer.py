import "dotenv/config";

const url = "https://77738c44b99b8c692289f02e33b09bf0.preview.bl.run/terminal";
const key = process.env.BL_API_KEY!;

async function main() {
  // BL API key as bearer
  const r1 = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
  console.log("BL_API_KEY bearer:", r1.status);

  // As cookie
  const r2 = await fetch(url, { headers: { Cookie: `blaxel_token=${key}` } });
  console.log("BL cookie:", r2.status);

  // X-Blaxel-Authorization
  const r3 = await fetch(url, { headers: { "X-Blaxel-Authorization": `Bearer ${key}` } });
  console.log("X-Blaxel-Auth:", r3.status);

  // Try the preview token we generated earlier with cookie
  const previewToken = "03766cd415383b99c6bce8f5a59e6705";
  const r4 = await fetch(url, { headers: { Cookie: `blaxel_token=${previewToken}` } });
  console.log("Preview token as cookie:", r4.status);

  // Try ?blaxel_token query param
  const r5 = await fetch(`${url}?blaxel_token=${previewToken}`);
  console.log("Preview token as blaxel_token param:", r5.status);

  // Try BL API key as query
  const r6 = await fetch(`${url}?token=${key}`);
  console.log("BL key as ?token=:", r6.status);

  const r7 = await fetch(`${url}?blaxel_token=${key}`);
  console.log("BL key as ?blaxel_token=:", r7.status);
}

main().catch(console.error);
