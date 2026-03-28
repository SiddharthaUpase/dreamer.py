import fs from "fs";
import path from "path";
import os from "os";

const BASE_DIR = path.join(os.homedir(), ".dreamer");
const PREFS_PATH = path.join(BASE_DIR, "preferences.json");

export function loadPrefs(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(PREFS_PATH, "utf8"));
  } catch {
    return {};
  }
}

export function savePrefs(prefs: Record<string, string>) {
  if (!fs.existsSync(BASE_DIR)) fs.mkdirSync(BASE_DIR, { recursive: true });
  fs.writeFileSync(PREFS_PATH, JSON.stringify(prefs, null, 2));
}
