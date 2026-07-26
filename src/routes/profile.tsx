import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { ChevronLeft, LogOut, Phone, MapPin, Award, ShieldCheck, Loader2, Camera, Radio } from "lucide-react";
import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useExpert, useExpertSession, initials } from "@/lib/expert-client";
import {
  checkBackgroundLocation,
  requestBackgroundLocation,
  openAppLocationSettings,
  type BgLocationStatus,
} from "@/lib/background-location";


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
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function logout() {
    await supabase.auth.signOut();
    navigate({ to: "/login" });
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !userId) return;
    setError(null);
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Image must be under 5 MB.");
      return;
    }
    setUploading(true);
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${userId}/avatar-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("expert-avatars")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      // Private bucket → long-lived signed URL (10 years)
      const { data: signed, error: sErr } = await supabase.storage
        .from("expert-avatars")
        .createSignedUrl(path, 60 * 60 * 24 * 365 * 10);
      if (sErr || !signed?.signedUrl) throw sErr ?? new Error("Could not create URL");
      const { error: rpcErr } = await supabase.rpc("expert_update_photo_url", { _url: signed.signedUrl });
      if (rpcErr) throw rpcErr;
      await qc.invalidateQueries({ queryKey: ["expert", userId] });
    } catch (err) {
      setError((err as Error).message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  if (loading) return <div className="flex min-h-[100dvh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col bg-background pt-[env(safe-area-inset-top)] pb-[max(env(safe-area-inset-bottom),2rem)]">
      <header className="flex items-center gap-3 px-6 pt-6 pb-4">
        <Link to="/home" className="inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground hover:bg-muted">
          <ChevronLeft className="h-6 w-6" />
        </Link>
        <h1 className="text-[22px] font-bold text-foreground">Profile</h1>
      </header>

      <section className="flex flex-col items-center px-6 text-center">
        <div className="relative">
          {expert?.photo_url ? (
            <img src={expert.photo_url} alt={expert.name ?? ""} className="h-24 w-24 rounded-full object-cover" />
          ) : (
            <div className="flex h-24 w-24 items-center justify-center rounded-full bg-[color:var(--color-charcoal)] text-3xl font-bold text-white">
              {initials(expert?.name)}
            </div>
          )}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            aria-label="Change profile photo"
            className="absolute -bottom-1 -right-1 flex h-9 w-9 items-center justify-center rounded-full bg-primary text-white shadow-md ring-4 ring-background disabled:opacity-60"
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onPickFile}
          />
        </div>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="mt-3 text-[13px] font-semibold text-primary disabled:opacity-60"
        >
          {uploading ? "Uploading…" : expert?.photo_url ? "Change photo" : "Upload photo"}
        </button>
        {error && <p className="mt-1 text-[12px] text-red-600">{error}</p>}
        <h2 className="mt-3 text-[22px] font-bold text-foreground">{expert?.name ?? "—"}</h2>
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
