import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import badiyoWhite from "@/assets/badiyo-white.png.asset.json";

export const Route = createFileRoute("/")({
  component: Splash,
});

function Splash() {
  const navigate = useNavigate();

  useEffect(() => {
    const t = setTimeout(() => {
      navigate({ to: "/login" });
    }, 1500);
    return () => clearTimeout(t);
  }, [navigate]);

  return (
    <div
      className="flex min-h-[100dvh] flex-col items-center justify-center px-8"
      style={{ backgroundColor: "#00B97A" }}
    >
      <img
        src={badiyoWhite.url}
        alt="Badiyo"
        className="w-56 max-w-[70%] animate-pulse"
      />
      <p className="mt-4 text-lg font-semibold tracking-wide text-white/90">
        Expert
      </p>
    </div>
  );
}
