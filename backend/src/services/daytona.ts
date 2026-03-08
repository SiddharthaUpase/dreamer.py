import { Daytona, Sandbox } from "@daytonaio/sdk";
import "dotenv/config";

const daytona = new Daytona({
  apiKey: process.env.DAYTONA_API_KEY!,
});

export async function createSandbox(): Promise<Sandbox> {
  const sandbox = await daytona.create({
    language: "typescript",
    autoStopInterval: 15,
    public: true,
  } as any);
  console.log(`Sandbox created: ${sandbox.id}`);
  try {
    await (sandbox as any).resize({ memory: 4, cpu: 2 });
    console.log(`Sandbox ${sandbox.id} resized to 4GB RAM, 2 CPU`);
  } catch (err: any) {
    console.warn(`Could not resize sandbox: ${err.message}`);
  }
  return sandbox;
}

export async function startSandbox(sandboxId: string): Promise<Sandbox> {
  const sandbox = await daytona.findOne({ idOrName: sandboxId });
  await sandbox.start();
  return sandbox;
}

export async function stopSandbox(sandboxId: string): Promise<void> {
  const sandbox = await daytona.findOne({ idOrName: sandboxId });
  await sandbox.stop();
}

export async function deleteSandbox(sandboxId: string): Promise<void> {
  const sandbox = await daytona.findOne({ idOrName: sandboxId });
  await sandbox.delete();
}

export { daytona };
