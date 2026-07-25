import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Bell, Inbox } from "lucide-react";
import badiyoGreen from "@/assets/badiyo-green.png.asset.json";

export const Route = createFileRoute("/home")({
  head: () => ({
    meta: [
      { title: "Dashboard — Badiyo Expert" },
      { name: "description", content: "Toggle your availability and wait for bookings." },
    ],
  }),
  component: HomeDashboard,
});

function HomeDashboard() {
  const [online, setOnline] = useState(false);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-background">
      <header className="flex items-center justify-between px-6 pt-6 pb-4">
        <img src={badiyoGreen.url} alt="Badiyo" className="h-7 w-auto" />
        <div className="flex items-center gap-3">
          <button
            className="flex h-11 w-11 items-center justify-center rounded-full bg-card border border-border text-foreground"
            aria-label="Notifications"
          >
            <Bell className="h-5 w-5" strokeWidth={2} />
          </button>
          <div className="flex items-center gap-2 rounded-full bg-card border border-border py-1.5 pl-1.5 pr-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[color:var(--color-charcoal)] text-[13px] font-bold text-white">
              R
            </div>
            <span className="text-[13px] font-semibold text-foreground">Rahul</span>
          </div>
        </div>
      </header>

      <section className="px-6">
        <div
          className="rounded-[18px] border p-6 transition"
          style={{
            backgroundColor: online ? "#00B97A" : "#FFFFFF",
            borderColor: online ? "#00B97A" : "#E5E7EB",
            boxShadow: online
              ? "0 12px 32px -12px rgba(0,185,122,0.5)"
              : "0 4px 16px -8px rgba(34,40,49,0.08)",
          }}
        >
          <p
            className="text-[13px] font-semibold uppercase tracking-wider"
            style={{ color: online ? "rgba(255,255,255,0.85)" : "#6B7280" }}
          >
            Status
          </p>
          <p
            className="mt-1 text-[26px] font-bold leading-tight"
            style={{ color: online ? "#FFFFFF" : "#222831" }}
          >
            {online ? "You're online" : "You're offline"}
          </p>
          <p
            className="mt-1 text-[14px]"
            style={{ color: online ? "rgba(255,255,255,0.85)" : "#6B7280" }}
          >
            {online ? "Ready to receive bookings" : "Go online to start receiving bookings"}
          </p>

          <button
            type="button"
            role="switch"
            aria-checked={online}
            onClick={() => setOnline((v) => !v)}
            className="mt-6 flex h-[52px] w-full items-center justify-between rounded-[14px] px-2 transition"
            style={{
              backgroundColor: online ? "rgba(255,255,255,0.18)" : "#F1F5F9",
            }}
          >
            <span
              className="pl-3 text-[15px] font-bold"
              style={{ color: online ? "#FFFFFF" : "#222831" }}
            >
              {online ? "Tap to go offline" : "Tap to go online"}
            </span>
            <span
              className="relative flex h-10 w-[72px] items-center rounded-full transition"
              style={{ backgroundColor: online ? "#FFFFFF" : "#E5E7EB" }}
            >
              <span
                className="absolute h-8 w-8 rounded-full shadow-md transition-all"
                style={{
                  left: online ? "36px" : "4px",
                  backgroundColor: online ? "#00B97A" : "#FFFFFF",
                }}
              />
            </span>
          </button>
        </div>
      </section>

      <section className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[color:var(--color-accent)]">
          <Inbox className="h-9 w-9 text-primary" strokeWidth={2} />
        </div>
        <h2 className="mt-5 text-[20px] font-bold text-foreground">
          Waiting for a booking
        </h2>
        <p className="mt-2 max-w-xs text-[14px] text-[color:var(--text-secondary)]">
          {online
            ? "New requests from nearby customers will appear here."
            : "Turn on your availability to start getting requests."}
        </p>
      </section>
    </div>
  );
}
