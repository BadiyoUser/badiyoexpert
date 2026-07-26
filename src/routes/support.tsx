import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, Phone, MessageCircle, Loader2, Send } from "lucide-react";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useExpertSession } from "@/lib/expert-client";

export const Route = createFileRoute("/support")({
  head: () => ({
    meta: [
      { title: "Help & Support — Badiyo Expert" },
      { name: "description", content: "Get help from the Badiyo Support team." },
    ],
  }),
  component: SupportScreen,
});

function SupportScreen() {
  const { loading, userId } = useExpertSession();
  const [message, setMessage] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);
  const support = "+918007444464";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim() || !userId) return;
    setState("sending"); setErr(null);
    const { error } = await supabase.from("support_tickets").insert({ user_id: userId, message: message.trim(), status: "open" });
    if (error) { setState("error"); setErr(error.message); return; }
    setState("sent"); setMessage("");
  }

  if (loading) return <div className="flex min-h-[100dvh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col bg-background pt-[env(safe-area-inset-top)] pb-[max(env(safe-area-inset-bottom),2rem)]">
      <header className="flex items-center gap-3 px-6 pt-6 pb-4">
        <Link to="/home" className="inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground hover:bg-muted">
          <ChevronLeft className="h-6 w-6" />
        </Link>
        <h1 className="text-[22px] font-bold text-foreground">Help & Support</h1>
      </header>

      <section className="grid grid-cols-2 gap-3 px-6">
        <a href={`tel:${support}`} className="flex h-24 flex-col items-center justify-center gap-1 rounded-[18px] border border-border bg-card">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[color:var(--color-accent)]"><Phone className="h-5 w-5 text-primary" /></div>
          <span className="text-[13px] font-bold text-foreground">Call us</span>
        </a>
        <a href={`https://wa.me/${support.replace(/[^\d]/g, "")}`} target="_blank" rel="noreferrer" className="flex h-24 flex-col items-center justify-center gap-1 rounded-[18px] border border-border bg-card">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[color:var(--color-accent)]"><MessageCircle className="h-5 w-5 text-primary" /></div>
          <span className="text-[13px] font-bold text-foreground">WhatsApp</span>
        </a>
      </section>

      <section className="mt-6 px-6">
        <h2 className="text-[16px] font-bold text-foreground">Send us a message</h2>
        <form onSubmit={submit} className="mt-3">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Describe your issue..."
            rows={5}
            className="w-full rounded-[14px] border border-border bg-card p-4 text-[15px] text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
          {err && <p className="mt-2 text-[13px] font-semibold text-[color:var(--color-destructive)]">{err}</p>}
          {state === "sent" && <p className="mt-2 text-[13px] font-semibold text-primary">Thanks — our team will get back shortly.</p>}
          <button type="submit" disabled={!message.trim() || state === "sending"}
            className="mt-3 flex h-[52px] w-full items-center justify-center gap-2 rounded-[14px] bg-primary text-[16px] font-bold text-primary-foreground shadow-[var(--shadow-brand-sm)] disabled:opacity-40">
            {state === "sending" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
            {state === "sending" ? "Sending…" : "Submit ticket"}
          </button>
        </form>
      </section>
    </div>
  );
}
