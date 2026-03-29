import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { ApiClient } from "../apiClient.js";
import { loadPrefs, savePrefs } from "../prefs.js";
import { LoginScreen } from "./LoginScreen.js";
import { ProjectScreen } from "./ProjectScreen.js";
import { ChatScreen } from "./ChatScreen.js";

const BACKEND_URL = process.env.DREAMER_BACKEND_URL || "https://dreamer-py.onrender.com";
const APP_URL = process.env.DREAMER_APP_URL || "https://dreamer-py.vercel.app";

type Screen = "loading" | "login" | "projects" | "chat";

interface ProjectInfo {
  id: string;
  name: string;
  previewUrl?: string;
  messageCount: number;
  messages: any[];
}

export function App() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [api, setApi] = useState<ApiClient | null>(null);
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [model, setModel] = useState(() => {
    const prefs = loadPrefs();
    return prefs.model || "claude-sonnet";
  });

  // Check for existing auth on mount
  useEffect(() => {
    const prefs = loadPrefs();
    if (prefs.apiKey) {
      setApi(new ApiClient(BACKEND_URL, prefs.apiKey));
      setScreen("projects");
    } else {
      setScreen("login");
    }
  }, []);

  const handleLogin = (apiKey: string) => {
    const prefs = loadPrefs();
    prefs.apiKey = apiKey;
    savePrefs(prefs);
    setApi(new ApiClient(BACKEND_URL, apiKey));
    setScreen("projects");
  };

  const handleProjectSelect = (info: ProjectInfo) => {
    setProject(info);
    const prefs = loadPrefs();
    prefs.lastProject = info.name;
    savePrefs(prefs);
    setScreen("chat");
  };

  const handleSwitchProject = () => {
    setProject(null);
    setScreen("projects");
  };

  const handleLogout = () => {
    const prefs = loadPrefs();
    delete prefs.apiKey;
    savePrefs(prefs);
    setApi(null);
    setProject(null);
    setScreen("login");
  };

  const handleModelChange = (newModel: string) => {
    setModel(newModel);
    const prefs = loadPrefs();
    prefs.model = newModel;
    savePrefs(prefs);
  };

  const logo = [
    "     _                                   ",
    "  __| |_ __ ___  __ _ _ __ ___   ___ _ __",
    " / _` | '__/ _ \\/ _` | '_ ` _ \\ / _ \\ '__|",
    "| (_| | | |  __/ (_| | | | | | |  __/ |  ",
    " \\__,_|_|  \\___|\\__,_|_| |_| |_|\\___|_|  ",
  ];

  return (
    <Box flexDirection="column">
      <Text> </Text>
      {logo.map((line, i) => (
        <Text key={i} color="magenta">{line}</Text>
      ))}
      <Text> </Text>
      <Text dimColor>  Turn your ideas into production apps.</Text>
      <Text dimColor>  No coding experience needed.</Text>
      <Text> </Text>

      {screen === "loading" && (
        <Box>
          <Text>  </Text>
          <Text color="magenta"><Spinner type="dots" /></Text>
          <Text dimColor> Connecting...</Text>
        </Box>
      )}

      {screen === "login" && (
        <LoginScreen backendUrl={BACKEND_URL} appUrl={APP_URL} onLogin={handleLogin} />
      )}

      {screen === "projects" && api && (
        <ProjectScreen api={api} onSelect={handleProjectSelect} />
      )}

      {screen === "chat" && api && project && (
        <ChatScreen
          api={api}
          project={project}
          model={model}
          onModelChange={handleModelChange}
          onSwitchProject={handleSwitchProject}
          onLogout={handleLogout}
        />
      )}
    </Box>
  );
}
