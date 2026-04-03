"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.replace("/login");
        return;
      }
      localStorage.setItem("supabase_access_token", session.access_token);
      const hasKey = !!localStorage.getItem("openrouter_key");
      if (!hasKey && window.location.pathname !== "/setup") {
        router.replace("/setup");
        return;
      }
      setReady(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        localStorage.removeItem("supabase_access_token");
        router.replace("/login");
      } else {
        localStorage.setItem("supabase_access_token", session.access_token);
      }
    });

    return () => subscription.unsubscribe();
  }, [router]);

  if (!ready) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0a0a0a]">
        <div className="w-8 h-8 border-2 border-[#eab308] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return <>{children}</>;
}
