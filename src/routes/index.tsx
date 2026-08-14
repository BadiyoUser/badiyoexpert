import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import badiyosWhite from "@/assets/badiyos-white.png.asset.json";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  component: Splash,
});

function Splash() {
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    const start = Date.now();

    (async () => {
      let hasSession = false;
      try {
        const { data } = await supabase.auth.getSession();
        hasSession = !!data.session;
      } catch (err) {
        console.warn("[splash] getSession failed", err);
      }
      const elapsed = Date.now() - start;
      const wait = Math.max(0, 1200 - elapsed);
      setTimeout(() => {
        if (cancelled) return;
        navigate({ to: hasSession ? "/home" : "/login", replace: true });
      }, wait);
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <div
      className="flex min-h-[100dvh] flex-col items-center justify-center px-8"
      style={{ backgroundColor: "#0874FD" }}
    >
      <img
        src={badiyosWhite.url}
        alt="badiyos"
        className="w-56 max-w-[70%] animate-pulse"
      />
      <p className="mt-4 text-lg font-semibold tracking-wide text-white/90">
        Expert
      </p>
    </div>
  );
}
