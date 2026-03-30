import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";

function SelectItem({ isSelected, label }: { isSelected?: boolean; label: string }) {
  return <Text color={isSelected ? "yellow" : undefined}>{label}</Text>;
}
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
  shared?: boolean;
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

  async function connectToProject(id: string) {
    const proj = projects.find((p) => p.id === id);
    const displayName = proj?.name || id;
    setPhase("connecting");
    setConnectingName(displayName);
    try {
      const res = await api.request(`/api/projects/${id}/connect`, { method: "POST" });
      const data = (await res.json()) as any;

      if (!res.ok) {
        await api.request("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, name: displayName, template: "nextjs" }),
        });
        const retryRes = await api.request(`/api/projects/${id}/connect`, { method: "POST" });
        const retryData = (await retryRes.json()) as any;
        onSelect({
          id,
          name: displayName,
          previewUrl: retryData.previewUrl,
          messageCount: retryData.messageCount || 0,
          messages: retryData.messages || [],
        });
        return;
      }

      onSelect({
        id,
        name: data.name || displayName,
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
    // Sanitize: lowercase, only alphanumeric and hyphens, no leading/trailing/consecutive hyphens
    const sanitized = name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    if (!sanitized) {
      setError("Invalid name. Use letters, numbers, and dashes.");
      return;
    }
    // Check for duplicate names
    if (projects.some((p) => p.name === sanitized)) {
      setError(`Project "${sanitized}" already exists. Choose a different name.`);
      return;
    }
    await connectToProject(sanitized);
  }

  if (phase === "loading") {
    return (
      <Box paddingLeft={2}>
        <Text color="yellow"><Spinner type="dots" /></Text>
        <Text> Loading your projects...</Text>
      </Box>
    );
  }

  if (phase === "connecting") {
    return (
      <Box flexDirection="column" paddingLeft={2}>
        <Box>
          <Text color="yellow"><Spinner type="dots" /></Text>
          <Text> Starting up </Text>
          <Text bold color="white">{connectingName}</Text>
          <Text>...</Text>
        </Box>
        <Text dimColor>  This may take a moment the first time.</Text>
      </Box>
    );
  }

  if (phase === "creating") {
    return (
      <Box flexDirection="column" paddingLeft={2}>
        {projects.length === 0 ? (
          <Box flexDirection="column">
            <Text bold color="white">  Let's create your first project</Text>
            <Text dimColor>  Give it a name and we'll set everything up for you.</Text>
            <Text> </Text>
          </Box>
        ) : (
          <Box flexDirection="column">
            <Text bold color="white">  New project</Text>
            <Text> </Text>
          </Box>
        )}
        <Box>
          <Text color="yellow">  {">"} </Text>
          <TextInput
            value={newName}
            onChange={setNewName}
            onSubmit={(val) => createProject(val)}
            placeholder="my-awesome-app"
          />
        </Box>
        {error && (
          <Text color="red">  {error}</Text>
        )}
      </Box>
    );
  }

  // Build select items
  const prefs = loadPrefs();
  const lastProject = prefs.lastProject;

  const items = projects.map((p) => {
    const isLast = p.name === lastProject;
    const shared = p.shared ? " (shared)" : "";
    const date = p.created_at?.slice(0, 10) || "";
    return {
      key: p.id,
      label: `${isLast ? "● " : "  "}${p.name}${shared}  ${date}`,
      value: p.id,
    };
  });
  items.push({ key: "__new__", label: "  + New project", value: "__new__" });

  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Text bold color="white">  Your projects</Text>
      <Text> </Text>
      <SelectInput
        items={items}
        itemComponent={SelectItem}
        initialIndex={Math.max(0, projects.findIndex((p) => p.name === lastProject))}
        onSelect={(item) => {
          if (item.value === "__new__") {
            setPhase("creating");
          } else {
            connectToProject(item.value);
          }
        }}
      />
      {error && <Text color="red">  {error}</Text>}
    </Box>
  );
}
