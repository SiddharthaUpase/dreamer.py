"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        localStorage.setItem("supabase_access_token", session.access_token);
        // Check access status via backend
        const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "https://dreamer-py.onrender.com";
        try {
          const res = await fetch(`${BACKEND_URL}/api/auth/access-status`, {
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          const data = await res.json();
          router.replace(data.hasAccess ? "/projects" : "/setup");
        } catch {
          router.replace("/setup");
        }
      } else {
        router.replace("/login");
      }
    });
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-8 h-8 border-2 border-[#eab308] border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
