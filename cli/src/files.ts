import fs from "fs";
import path from "path";
import os from "os";
import { ApiClient } from "./apiClient.js";

const FILE_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tiff", ".svg",
  ".pdf", ".txt", ".csv", ".json", ".html", ".css", ".js", ".ts", ".tsx", ".jsx",
  ".mp3", ".wav", ".mp4", ".zip",
]);

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

export async function uploadFiles(
  api: ApiClient,
  projectId: string,
  filePaths: string[],
): Promise<UploadResult[]> {
  const results: UploadResult[] = [];

  for (const filePath of filePaths) {
    const fileName = path.basename(filePath);
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
