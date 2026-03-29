import fs from "fs";
import path from "path";
import os from "os";
import { ApiClient } from "./apiClient.js";

const FILE_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tiff", ".svg",
  ".pdf", ".txt", ".csv", ".json", ".html", ".css", ".js", ".ts", ".tsx", ".jsx",
  ".md", ".mdx", ".py", ".rb", ".go", ".rs", ".java", ".kt", ".swift", ".c", ".cpp", ".h",
  ".xml", ".yaml", ".yml", ".toml", ".sql", ".sh", ".env", ".lock",
  ".mp3", ".wav", ".mp4", ".zip", ".tar", ".gz",
]);

/**
 * Normalize a path pasted/dropped into the terminal.
 * macOS shell-escapes spaces as `\ `, and may add trailing whitespace or newlines.
 * Returns null if the normalized path doesn't point to an existing file.
 */
export function normalizeDroppedPath(raw: string): string | null {
  let p = raw.trim();
  // Strip surrounding quotes
  if ((p.startsWith("'") && p.endsWith("'")) || (p.startsWith('"') && p.endsWith('"'))) {
    p = p.slice(1, -1);
  }
  // Unescape shell escapes: `\ ` → ` `, `\(` → `(`, etc.
  p = p.replace(/\\(.)/g, "$1");
  // Expand ~
  if (p.startsWith("~/")) p = path.join(os.homedir(), p.slice(2));
  // Must be absolute and have a known extension
  if (!p.startsWith("/")) return null;
  const ext = path.extname(p).toLowerCase();
  if (!FILE_EXTENSIONS.has(ext)) return null;
  // Must exist on disk
  try {
    if (!fs.existsSync(p)) return null;
    if (!fs.statSync(p).isFile()) return null;
  } catch { return null; }
  return p;
}

export function detectFiles(text: string): string[] {
  const paths: string[] = [];

  // Quoted paths
  const quoted = text.match(/"((?:~\/|\/)[^"]+)"|'((?:~\/|\/)[^']+)'/g);
  if (quoted) {
    for (const q of quoted) {
      paths.push(q.replace(/^['"]|['"]$/g, ""));
    }
  }

  // Unquoted paths starting with / or ~/
  const unquoted = text.match(/(?:~\/|\/)[^\s,;'"]+/g);
  if (unquoted) {
    for (const p of unquoted) {
      if (!paths.includes(p)) paths.push(p);
    }
  }

  // Filter to existing files with known extensions
  return paths
    .map((p) => p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p)
    .filter((p) => {
      const ext = path.extname(p).toLowerCase();
      return FILE_EXTENSIONS.has(ext) && fs.existsSync(p);
    });
}

interface UploadResult {
  localPath: string;
  fileName: string;
  remotePath?: string;
  size: string;
  error?: string;
}

/**
 * Sanitize a filename for safe upload: replace non-ASCII, spaces, and special chars
 * with underscores, collapse runs, and lowercase.
 */
function sanitizeFileName(name: string): string {
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  const clean = base
    .replace(/[^\w.-]/g, "_")   // non-word chars → underscore
    .replace(/_+/g, "_")         // collapse runs
    .replace(/^_|_$/g, "")       // trim leading/trailing
    .toLowerCase();
  return (clean || "file") + ext.toLowerCase();
}

export async function uploadFiles(
  api: ApiClient,
  projectId: string,
  filePaths: string[],
): Promise<UploadResult[]> {
  const results: UploadResult[] = [];

  for (const filePath of filePaths) {
    const fileName = sanitizeFileName(path.basename(filePath));
    const content = fs.readFileSync(filePath);
    const size = content.length < 1024
      ? `${content.length} B`
      : `${(content.length / 1024).toFixed(1)} KB`;

    try {
      const res = await api.uploadFile(projectId, fileName, content);
      results.push({ localPath: filePath, fileName, remotePath: res.path, size });
    } catch (err: any) {
      results.push({ localPath: filePath, fileName, size, error: err.message });
    }
  }

  return results;
}
