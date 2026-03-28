import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import { ApiClient } from "../apiClient.js";
import { loadPrefs } from "../prefs.js";

interface ApiProject {
  id: string;
  name: string;
  template?: string;
  created_at: string;
  preview_url?: string;
}

interface ProjectInfo {
  id: string;
  name: string;
  previewUrl?: string;
  messageCount: number;
  messages: any[];
}

interface Props {
  api: ApiClient;
  onSelect: (info: ProjectInfo) => void;
}

type Phase = "loading" | "list" | "creating" | "connecting";

export function ProjectScreen({ api, onSelect }: Props) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [projects, setProjects] = useState<ApiProject[]>([]);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");
  const [connectingName, setConnectingName] = useState("");

  useEffect(() => {
    loadProjects();
  }, []);

  async function loadProjects() {
    try {
      const res = await api.request("/api/projects");
      const data = (await res.json()) as { projects: ApiProject[] };
      setProjects(data.projects || []);
      if ((data.projects || []).length === 0) {
        setPhase("creating");
      } else {
        setPhase("list");
      }
    } catch {
      setPhase("creating");
    }
  }

  async function connectToProject(name: string) {
    setPhase("connecting");
    setConnectingName(name);
    try {
      const res = await api.request(`/api/projects/${name}/connect`, { method: "POST" });
      const data = (await res.json()) as any;

      if (!res.ok) {
        // Project not found — create it
        await api.request("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: name, name, template: "nextjs" }),
        });
        const retryRes = await api.request(`/api/projects/${name}/connect`, { method: "POST" });
        const retryData = (await retryRes.json()) as any;
        onSelect({
          id: name,
          name,
          previewUrl: retryData.previewUrl,
          messageCount: retryData.messageCount || 0,
          messages: retryData.messages || [],
        });
        return;
      }

      onSelect({
        id: name,
        name,
        previewUrl: data.previewUrl,
        messageCount: data.messageCount || 0,
        messages: data.messages || [],
      });
    } catch (err: any) {
      setError(err.message);
      setPhase("list");
    }
  }

  async function createProject(name: string) {
    const sanitized = name.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
    if (!sanitized) {
      setError("Invalid project name.");
      return;
    }
    await connectToProject(sanitized);
  }

  if (phase === "loading") {
    return (
      <Text>
        <Text color="green"><Spinner type="dots" /></Text>
        {" "}Loading projects...
      </Text>
    );
  }

  if (phase === "connecting") {
    return (
      <Text>
        <Text color="green"><Spinner type="dots" /></Text>
        {" "}Connecting to "{connectingName}"...
      </Text>
    );
  }

  if (phase === "creating") {
    return (
      <Box flexDirection="column">
        {projects.length === 0 && <Text dimColor>No projects found. Create one to get started.</Text>}
        <Box>
          <Text bold>Project name: </Text>
          <TextInput
            value={newName}
            onChange={setNewName}
            onSubmit={(val) => createProject(val)}
            placeholder="my-app"
          />
        </Box>
        {error && <Text color="red">{error}</Text>}
      </Box>
    );
  }

  // Build select items
  const prefs = loadPrefs();
  const lastProject = prefs.lastProject;

  const items = projects.map((p) => ({
    label: `${p.name === lastProject ? "● " : "  "}${p.name} [${p.template || "nextjs"}] ${p.created_at?.slice(0, 10) || ""}`,
    value: p.name,
  }));
  items.push({ label: "  + Create new project", value: "__new__" });

  return (
    <Box flexDirection="column">
      <Text bold>Select a project:</Text>
      <Text> </Text>
      <SelectInput
        items={items}
        onSelect={(item) => {
          if (item.value === "__new__") {
            setPhase("creating");
          } else {
            connectToProject(item.value);
          }
        }}
      />
      {error && <Text color="red">{error}</Text>}
    </Box>
  );
}
