// Thin HTTP client for the Dreamer backend API
// Used by the CLI to call backend endpoints instead of accessing services directly

export interface ApiClientOptions {
  baseUrl: string;
  apiKey: string;
}

export interface ApiProject {
  id: string;
  name: string;
  template: string;
  preview_url: string | null;
  created_at: string;
}

export interface ConnectResult {
  status: string;
  sandboxId: string;
  previewUrl: string | null;
  name: string;
  messages: any[];
}

export interface DeployEvent {
  type: "status" | "result" | "error";
  message?: string;
  success?: boolean;
  url?: string;
  error?: string;
}

export class ApiClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrlOrOpts: string | ApiClientOptions, apiKey?: string) {
    if (typeof baseUrlOrOpts === "string") {
      this.baseUrl = baseUrlOrOpts;
      this.apiKey = apiKey!;
    } else {
      this.baseUrl = baseUrlOrOpts.baseUrl;
      this.apiKey = baseUrlOrOpts.apiKey;
    }
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      ...extra,
    };
  }

  async redeemStarterCode(code: string): Promise<{ success: boolean; error?: string }> {
    const res = await fetch(`${this.baseUrl}/api/auth/redeem-code`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ code }),
    });
    return res.json() as Promise<{ success: boolean; error?: string }>;
  }

  async checkAccess(): Promise<boolean> {
    const res = await fetch(`${this.baseUrl}/api/auth/access-status`, {
      headers: this.headers(),
    });
    const data = await res.json() as { hasAccess: boolean };
    return data.hasAccess;
  }

  private async _request<T>(method: string, path: string, body?: any): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers(),
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(err.error || `Request failed: ${res.status}`);
    }
    return res.json() as T;
  }

  // Public fetch wrapper for custom requests
  async request(path: string, init?: RequestInit): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        ...this.headers(),
        ...(init?.headers as Record<string, string> || {}),
      },
    });
  }

  // Aliases for Ink components
  chatStream = this.chat.bind(this);
  deployStream = this.deploy.bind(this);

  // ===== Projects =====

  async createProject(id: string, name: string, template = "nextjs"): Promise<{ project: ApiProject }> {
    return this._request("POST", "/api/projects", { id, name, template });
  }

  async listProjects(): Promise<{ projects: ApiProject[] }> {
    return this._request("GET", "/api/projects");
  }

  async getProject(id: string): Promise<{ project: ApiProject }> {
    return this._request("GET", `/api/projects/${id}`);
  }

  async deleteProject(id: string): Promise<void> {
    await this._request("DELETE", `/api/projects/${id}`);
  }

  // ===== Connect =====

  async connect(projectId: string): Promise<ConnectResult> {
    return this._request("POST", `/api/projects/${projectId}/connect`);
  }

  // ===== Chat (SSE) =====

  async chat(
    projectId: string,
    message: string,
    model: string,
    onEvent: (event: any) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/projects/${projectId}/chat`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ message, model }),
      signal,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(err.error || `Chat failed: ${res.status}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response stream");

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const event = JSON.parse(line.slice(6));
            onEvent(event);
          } catch { /* skip malformed */ }
        }
      }
    }
  }

  // ===== History =====

  async getHistory(projectId: string): Promise<{ messages: any[] }> {
    return this._request("GET", `/api/projects/${projectId}/history`);
  }

  async clearHistory(projectId: string): Promise<void> {
    await this._request("DELETE", `/api/projects/${projectId}/history`);
  }

  async compactHistory(projectId: string): Promise<{ before: number; after: number }> {
    return this._request("POST", `/api/projects/${projectId}/compact`);
  }

  // ===== Deploy (SSE) =====

  async deploy(
    projectId: string,
    onEvent: (event: DeployEvent) => void,
  ): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/projects/${projectId}/deploy`, {
      method: "POST",
      headers: this.headers(),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(err.error || `Deploy failed: ${res.status}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response stream");

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const event = JSON.parse(line.slice(6));
            onEvent(event);
          } catch { /* skip */ }
        }
      }
    }
  }

  // ===== Upload =====

  async uploadFile(projectId: string, filename: string, content: Buffer): Promise<{ path: string }> {
    const formData = new FormData();
    formData.append("file", new Blob([new Uint8Array(content)]), filename);

    const res = await fetch(`${this.baseUrl}/api/projects/${projectId}/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(err.error || `Upload failed: ${res.status}`);
    }
    return res.json() as Promise<{ path: string }>;
  }
}
