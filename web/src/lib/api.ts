const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "https://dreamer-py.onrender.com";

export function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (typeof window !== "undefined") {
    const token = localStorage.getItem("supabase_access_token");
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const openrouterKey = localStorage.getItem("openrouter_key");
    if (openrouterKey) {
      headers["X-OpenRouter-Key"] = openrouterKey;
    }
  }

  return headers;
}

export async function apiGet(path: string) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    headers: getHeaders(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed: ${res.status}`);
  }
  return res.json();
}

export async function apiPost(path: string, body?: unknown) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: "POST",
    headers: getHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed: ${res.status}`);
  }
  return res.json();
}

export async function apiDelete(path: string) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: "DELETE",
    headers: getHeaders(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed: ${res.status}`);
  }
  return res.json();
}

export async function apiUpload(path: string, file: File) {
  const headers: Record<string, string> = {};
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("supabase_access_token");
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const openrouterKey = localStorage.getItem("openrouter_key");
    if (openrouterKey) headers["X-OpenRouter-Key"] = openrouterKey;
  }

  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: "POST",
    headers,
    body: formData,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Upload failed: ${res.status}`);
  }
  return res.json();
}

export interface SSEEvent {
  type: string;
  content?: string;
  tool?: string;
  args?: Record<string, unknown>;
  output?: string;
  todos?: Array<{ content: string; status: string }>;
  label?: string;
  detail?: string;
  before?: number;
  after?: number;
}

export function streamChat(
  projectId: string,
  message: string,
  model: string,
  onEvent: (event: SSEEvent) => void,
  onDone: () => void,
  onError: (err: Error) => void
): AbortController {
  const controller = new AbortController();

  const headers = getHeaders();

  fetch(`${BACKEND_URL}/api/projects/${projectId}/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify({ message, model }),
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Chat failed: ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;
          const data = trimmed.slice(6);
          if (data === "[DONE]") continue;
          try {
            const event = JSON.parse(data) as SSEEvent;
            onEvent(event);
          } catch {
            // skip malformed JSON
          }
        }
      }
      onDone();
    })
    .catch((err) => {
      if (err.name !== "AbortError") {
        onError(err);
      }
    });

  return controller;
}

export function streamDeploy(
  projectId: string,
  onEvent: (event: SSEEvent) => void,
  onDone: () => void,
  onError: (err: Error) => void
): AbortController {
  const controller = new AbortController();
  const headers = getHeaders();

  fetch(`${BACKEND_URL}/api/projects/${projectId}/deploy`, {
    method: "POST",
    headers,
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Deploy failed: ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;
          const data = trimmed.slice(6);
          if (data === "[DONE]") continue;
          try {
            const event = JSON.parse(data) as SSEEvent;
            onEvent(event);
          } catch {
            // skip
          }
        }
      }
      onDone();
    })
    .catch((err) => {
      if (err.name !== "AbortError") {
        onError(err);
      }
    });

  return controller;
}
