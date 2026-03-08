import "dotenv/config";
import { Daytona } from "@daytonaio/sdk";

const daytona = new Daytona({
  apiKey: process.env.DAYTONA_API_KEY!,
});

async function main() {
  console.log("=== Creating sandbox ===");
  const sandbox = await daytona.create({
    language: "typescript",
    autoStopInterval: 15,
    public: true,
  });
  console.log(`Sandbox ID: ${sandbox.id}`);

  // 1. Check the filesystem
  console.log("\n=== Filesystem layout ===");
  const ls = await sandbox.process.executeCommand("ls -la /home/daytona");
  console.log(ls.result);

  // 2. Check what's installed
  console.log("\n=== Node/npm versions ===");
  const versions = await sandbox.process.executeCommand("node -v && npm -v");
  console.log(versions.result);

  // 3. Create a Next.js app in the home directory
  console.log("\n=== Creating Next.js app (this takes a minute) ===");
  const createApp = await sandbox.process.executeCommand(
    'cd /home/daytona && npx create-next-app@latest myapp --ts --no-eslint --no-tailwind --no-src-dir --app --no-import-alias --use-npm --yes',
    undefined,
    undefined,
    120
  );
  console.log(`Exit code: ${createApp.exitCode}`);
  console.log(createApp.result?.slice(0, 500));

  // 4. Check where files are
  console.log("\n=== Check home dir ===");
  const homeLs = await sandbox.process.executeCommand("ls -la /home/daytona/");
  console.log(homeLs.result);

  console.log("\n=== Check myapp dir ===");
  const appLs = await sandbox.process.executeCommand("ls -la /home/daytona/myapp 2>/dev/null || echo 'myapp not found'");
  console.log(appLs.result);

  // Also check if it was created in cwd
  console.log("\n=== Check pwd ===");
  const pwdCheck = await sandbox.process.executeCommand("pwd && ls");
  console.log(pwdCheck.result);

  // 5. Find the app directory
  const findApp = await sandbox.process.executeCommand("find /home/daytona -name 'package.json' -maxdepth 3 2>/dev/null | head -5");
  console.log("\n=== Found package.json files ===");
  console.log(findApp.result);

  // 6. Start Next.js dev server using a session (background process)
  console.log("\n=== Starting Next.js dev server in background session ===");
  const sessionId = "nextjs-server";
  await sandbox.process.createSession(sessionId);

  // Use the found app path
  const appPath = findApp.result?.trim().split("\n")[0]?.replace("/package.json", "") || "/home/daytona/myapp";
  console.log(`Using app path: ${appPath}`);

  const startResult = await sandbox.process.executeSessionCommand(sessionId, {
    command: `cd ${appPath} && npm run dev -- -H 0.0.0.0`,
    runAsync: true,
  });
  console.log(`Background command ID: ${startResult.cmdId}`);

  // 6. Wait for the server to start
  console.log("\n=== Waiting 10s for server to start ===");
  await new Promise((r) => setTimeout(r, 10000));

  // 7. Check if server is running
  console.log("\n=== Checking server logs ===");
  const logs = await sandbox.process.getSessionCommandLogs(sessionId, startResult.cmdId!);
  console.log("stdout:", logs.stdout?.slice(0, 500));
  console.log("stderr:", logs.stderr?.slice(0, 500));

  // 8. Check if port 3000 is open
  console.log("\n=== Checking port 3000 ===");
  const portCheck = await sandbox.process.executeCommand("curl -s -o /dev/null -w '%{http_code}' http://localhost:3000 || echo 'not reachable'");
  console.log(`Port 3000 status: ${portCheck.result}`);

  // 9. Get preview URL
  console.log("\n=== Getting preview URL ===");
  try {
    const previewUrl = await sandbox.getSignedPreviewUrl(3000, 3600);
    console.log("Preview URL:", previewUrl);
  } catch (e: any) {
    console.log("Preview URL error:", e.message);
  }

  // 10. Get session info
  console.log("\n=== Session info ===");
  const session = await sandbox.process.getSession(sessionId);
  console.log("Session commands:", session.commands?.map((c) => ({
    id: c.id,
    command: c.command,
    exitCode: c.exitCode,
  })));

  // Cleanup - delete session but keep sandbox running
  console.log("\n=== Done! Sandbox is still running ===");
  console.log(`Sandbox ID: ${sandbox.id}`);
  console.log("Remember to stop it manually or it auto-stops in 15 min");
}

main().catch(console.error);
