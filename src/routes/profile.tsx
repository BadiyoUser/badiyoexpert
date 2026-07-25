import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { ChevronLeft, LogOut, Phone, MapPin, Award, ShieldCheck, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useExpert, useExpertSession, initials } from "@/lib/expert-client";

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "Profile — Badiyo Expert" },
      { name: "description", content: "Your Badiyo Expert profile." },
    ],
  }),
  component: ProfileScreen,
});

function ProfileScreen() {
  const { loading, userId } = useExpertSession();
  const { data: expert } = useExpert(userId);
  const navigate = useNavigate();

  async function logout() {
    await supabase.auth.signOut();
    navigate({ to: "/login" });
  }

  if (loading) return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-background pb-8">
      <header className="flex items-center gap-3 px-6 pt-6 pb-4">
        <Link to="/home" className="inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground hover:bg-muted">
          <ChevronLeft className="h-6 w-6" />
        </Link>
        <h1 className="text-[22px] font-bold text-foreground">Profile</h1>
      </header>

      <section className="flex flex-col items-center px-6 text-center">
        {expert?.photo_url ? (
          <img src={expert.photo_url} alt={expert.name ?? ""} className="h-24 w-24 rounded-full object-cover" />
        ) : (
          <div className="flex h-24 w-24 items-center justify-center rounded-full bg-[color:var(--color-charcoal)] text-3xl font-bold text-white">
            {initials(expert?.name)}
          </div>
        )}
        <h2 className="mt-4 text-[22px] font-bold text-foreground">{expert?.name ?? "—"}</h2>
        <p className="text-[13px] text-[color:var(--text-secondary)]">+91 {expert?.phone}</p>
      </section>

      <section className="mt-6 space-y-2 px-6">
        <Row Icon={Award} label="Level" value={(expert?.level ?? "bronze").toString().toUpperCase()} />
        <Row Icon={ShieldCheck} label="KYC" value={(expert?.kyc_status ?? "pending").toString().toUpperCase()} highlight={expert?.kyc_status === "approved"} />
        <Row Icon={Phone} label="Phone" value={`+91 ${expert?.phone ?? ""}`} />
        {expert?.address && <Row Icon={MapPin} label="Address" value={expert.address} />}
      </section>

      <div className="mt-auto px-6 pt-8">
        <button onClick={logout} className="flex h-[52px] w-full items-center justify-center gap-2 rounded-[14px] border border-border bg-card text-[16px] font-bold text-foreground">
          <LogOut className="h-5 w-5" /> Log out
        </button>
      </div>
    </div>
  );
}

function Row({ Icon, label, value, highlight }: { Icon: React.ComponentType<{ className?: string }>; label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-[14px] border border-border bg-card p-4">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[color:var(--color-accent)]"><Icon className="h-5 w-5 text-primary" /></div>
      <div className="flex-1">
        <p className="text-[12px] font-semibold uppercase tracking-wider text-[color:var(--text-secondary)]">{label}</p>
        <p className={`text-[15px] font-semibold ${highlight ? "text-primary" : "text-foreground"}`}>{value}</p>
      </div>
    </div>
  );
}
