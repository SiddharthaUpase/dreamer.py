import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "../../data");
const STORE_FILE = join(DATA_DIR, "agents.json");

export interface StoredAgent {
  id: string;
  name: string;
  x: number;
  y: number;
  model: string;
  sandboxId: string | null;
  messages: { role: "user" | "assistant"; content: string }[];
  previewUrl?: string;
}

function ensureDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readStore(): Record<string, StoredAgent> {
  ensureDir();
  if (!existsSync(STORE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(STORE_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function writeStore(data: Record<string, StoredAgent>) {
  ensureDir();
  writeFileSync(STORE_FILE, JSON.stringify(data, null, 2));
}

export function getAllAgents(): StoredAgent[] {
  return Object.values(readStore());
}

export function getAgent(id: string): StoredAgent | null {
  return readStore()[id] || null;
}

export function saveAgent(agent: StoredAgent) {
  const store = readStore();
  store[agent.id] = agent;
  writeStore(store);
}

export function updateAgent(id: string, updates: Partial<StoredAgent>) {
  const store = readStore();
  if (!store[id]) return null;
  store[id] = { ...store[id], ...updates };
  writeStore(store);
  return store[id];
}

export function deleteAgent(id: string) {
  const store = readStore();
  delete store[id];
  writeStore(store);
}
