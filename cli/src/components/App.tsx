import React, { useState, useEffect } from "react";
import { Box, Text, useApp } from "ink";
import Spinner from "ink-spinner";
import { createRequire } from "module";
import { execSync } from "child_process";
import { ApiClient } from "../apiClient.js";
import { loadPrefs, savePrefs } from "../prefs.js";
import { LoginScreen } from "./LoginScreen.js";
import { KeyScreen } from "./KeyScreen.js";
import { ProjectScreen } from "./ProjectScreen.js";
import { ChatScreen } from "./ChatScreen.js";

const BACKEND_URL = process.env.DREAMER_BACKEND_URL || "https://dreamer-py.onrender.com";
const APP_URL = process.env.DREAMER_APP_URL || "https://dreamer-py.vercel.app";

const require = createRequire(import.meta.url);
const CURRENT_VERSION: string = require("../../package.json").version;

type Screen = "loading" | "login" | "api-key" | "projects" | "chat";

interface ProjectInfo {
  id: string;
  name: string;
  previewUrl?: string;
  messageCount: number;
  messages: any[];
}

async function validateOpenRouterKey(key: string): Promise<boolean> {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function App() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [api, setApi] = useState<ApiClient | null>(null);
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [updateStatus, setUpdateStatus] = useState<"" | "checking" | "updating" | "restart" | "failed">("checking");
  const [latestVersion, setLatestVersion] = useState("");
  const [keyError, setKeyError] = useState("");
  const [keyValidating, setKeyValidating] = useState(false);
  const [model, setModel] = useState(() => {
    const prefs = loadPrefs();
    return prefs.model || "claude-sonnet";
  });

  // Check for existing auth on mount
  useEffect(() => {
    const prefs = loadPrefs();
    if (prefs.apiKey) {
      if (prefs.openRouterKey) {
        setApi(new ApiClient(BACKEND_URL, prefs.apiKey, prefs.openRouterKey));
        setScreen("projects");
      } else {
        setApi(new ApiClient(BACKEND_URL, prefs.apiKey));
        setScreen("api-key");
      }
    } else {
      setScreen("login");
    }
  }, []);

  // Auto-update check (skip in dev mode)
  const isDev = process.env.NODE_ENV === "development" || process.argv.some((a) => a.includes("tsx"));
  useEffect(() => {
    if (isDev) { setUpdateStatus(""); return; }
    fetch("https://registry.npmjs.org/dreamer-py/latest", { signal: AbortSignal.timeout(3000) })
      .then((res) => res.json())
      .then((data: any) => {
        if (data.version && data.version !== CURRENT_VERSION) {
          setLatestVersion(data.version);
          setUpdateStatus("updating");
          try {
            execSync("npm i -g dreamer-py@latest", { stdio: "ignore", timeout: 30000 });
            setUpdateStatus("restart");
            setTimeout(() => process.exit(0), 1500);
          } catch {
            setUpdateStatus("failed");
            setTimeout(() => setUpdateStatus(""), 3000);
          }
        } else {
          setUpdateStatus("");
        }
      })
      .catch(() => { setUpdateStatus(""); });
  }, []);

  const handleLogin = (apiKey: string) => {
    const prefs = loadPrefs();
    prefs.apiKey = apiKey;
    savePrefs(prefs);
    setApi(new ApiClient(BACKEND_URL, apiKey));
    // Check if they already have an OpenRouter key
    if (prefs.openRouterKey) {
      api?.setOpenRouterKey(prefs.openRouterKey);
      setScreen("projects");
    } else {
      setScreen("api-key");
    }
  };

  const handleKeySubmit = async (key: string) => {
    setKeyError("");
    setKeyValidating(true);
    const valid = await validateOpenRouterKey(key);
    setKeyValidating(false);
    if (!valid) {
      setKeyError("Invalid API key. Please check and try again.");
      return;
    }
    const prefs = loadPrefs();
    prefs.openRouterKey = key;
    savePrefs(prefs);
    api?.setOpenRouterKey(key);
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

  const handleUpdateKey = () => {
    setKeyError("");
    setScreen("api-key");
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
        <Text key={i} color="yellow">{line}</Text>
      ))}
      <Text> </Text>
      <Text dimColor>  Turn your ideas into production apps.</Text>
      <Text dimColor>  No coding experience needed.</Text>
      {updateStatus === "updating" && (
        <Box>
          <Text>  </Text>
          <Text color="yellow"><Spinner type="dots" /></Text>
          <Text color="yellow"> Updating to v{latestVersion}...</Text>
        </Box>
      )}
      {updateStatus === "restart" && (
        <Text color="green">  ✔ Updated to v{latestVersion}. Please restart dreamer.</Text>
      )}
      {updateStatus === "failed" && (
        <Text color="yellow">  Update available: v{latestVersion}. Run: <Text bold>npm i -g dreamer-py@latest</Text></Text>
      )}
      <Text> </Text>

      {screen === "loading" && (
        <Box>
          <Text>  </Text>
          <Text color="yellow"><Spinner type="dots" /></Text>
          <Text dimColor> Connecting...</Text>
        </Box>
      )}

      {screen === "login" && (
        <LoginScreen backendUrl={BACKEND_URL} appUrl={APP_URL} onLogin={handleLogin} />
      )}

      {screen === "api-key" && (
        <KeyScreen onSubmit={handleKeySubmit} error={keyError} validating={keyValidating} />
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
          onUpdateKey={handleUpdateKey}
        />
      )}
    </Box>
  );
}
