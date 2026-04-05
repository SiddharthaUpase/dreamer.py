"use client";

import { useState, useRef, useCallback } from "react";

const API = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

export type VoiceState = "idle" | "recording" | "transcribing";

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { createClient } = await import("@/lib/supabase/client");
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export function useVoiceInput(onTranscript: (text: string) => void) {
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [recordingDuration, setRecordingDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const cleanup = useCallback(() => {
    stopTimer();
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    mediaRecorderRef.current = null;
    chunksRef.current = [];
    setRecordingDuration(0);
  }, [stopTimer]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.start(100); // collect in 100ms chunks
      setVoiceState("recording");
      setRecordingDuration(0);
      timerRef.current = setInterval(() => {
        setRecordingDuration((d) => d + 1);
      }, 1000);
    } catch (err) {
      console.error("Microphone access denied:", err);
      cleanup();
    }
  }, [cleanup]);

  const confirmRecording = useCallback(async () => {
    if (!mediaRecorderRef.current || mediaRecorderRef.current.state === "inactive") return;

    setVoiceState("transcribing");
    stopTimer();

    // Stop recorder and wait for final data
    const blob = await new Promise<Blob>((resolve) => {
      const recorder = mediaRecorderRef.current!;
      recorder.onstop = () => {
        const audioBlob = new Blob(chunksRef.current, { type: recorder.mimeType });
        resolve(audioBlob);
      };
      recorder.stop();
    });

    // Stop mic stream
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    try {
      const headers = await getAuthHeaders();
      const formData = new FormData();
      formData.append("audio", blob, "recording.webm");

      const res = await fetch(`${API}/api/transcribe`, {
        method: "POST",
        headers: {
          ...(headers.Authorization ? { Authorization: headers.Authorization } : {}),
        },
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Transcription failed" }));
        console.error("Transcription error:", err);
      } else {
        const data = await res.json();
        if (data.text) onTranscript(data.text);
      }
    } catch (err) {
      console.error("Transcription request failed:", err);
    } finally {
      chunksRef.current = [];
      mediaRecorderRef.current = null;
      setRecordingDuration(0);
      setVoiceState("idle");
    }
  }, [stopTimer, onTranscript]);

  const cancelRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    cleanup();
    setVoiceState("idle");
  }, [cleanup]);

  return {
    voiceState,
    recordingDuration,
    startRecording,
    confirmRecording,
    cancelRecording,
  };
}
