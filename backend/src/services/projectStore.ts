import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "../../data");
const STORE_FILE = join(DATA_DIR, "projects.json");

export interface StoredProject {
  id: string;
  name: string;
  template: string;
  sandboxId: string | null;
  previewUrl: string | null;
  messages: {
    role: "user" | "assistant";
    content: string;
    tools?: { tool: string; args?: Record<string, unknown>; status: "running" | "done" }[];
  }[];
  createdAt: string;
}

function ensureDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readStore(): Record<string, StoredProject> {
  ensureDir();
  if (!existsSync(STORE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(STORE_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function writeStore(data: Record<string, StoredProject>) {
  ensureDir();
  writeFileSync(STORE_FILE, JSON.stringify(data, null, 2));
}

export function getAllProjects(): StoredProject[] {
  return Object.values(readStore()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export function getProject(id: string): StoredProject | null {
  return readStore()[id] || null;
}

export function saveProject(project: StoredProject) {
  const store = readStore();
  store[project.id] = project;
  writeStore(store);
}

export function updateProject(id: string, updates: Partial<StoredProject>) {
  const store = readStore();
  if (!store[id]) return null;
  store[id] = { ...store[id], ...updates };
  writeStore(store);
  return store[id];
}

export function deleteProject(id: string) {
  const store = readStore();
  delete store[id];
  writeStore(store);
}
