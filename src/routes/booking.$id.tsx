import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { ChevronLeft, MapPin, Phone, Loader2, Navigation2, X, AlertTriangle } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useExpert, useExpertSession } from "@/lib/expert-client";
import { useState, useRef, useEffect } from "react";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/booking/$id")({
  head: () => ({
    meta: [
      { title: "Booking — badiyos Expert" },
      { name: "description", content: "Manage your assigned booking." },
    ],
  }),
  component: BookingScreen,
});

type Booking = {
  id: string;
  status: string;
  service_duration_minutes: number;
  price: number | null;
  address_id: string | null;
  assigned_expert_id: string | null;
  started_at: string | null;
  service_end_at: string | null;
  user_id: string;
  created_at: string;
};

type Address = {
  full_address: string | null;
  area: string | null;
  city: string | null;
  landmark_photo_url: string | null;
  latitude: number | null;
  longitude: number | null;
};

function BookingScreen() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const t = useT();
  const { loading: sessionLoading, userId } = useExpertSession();
  const { data: expert } = useExpert(userId);

  const bookingQ = useQuery({
    queryKey: ["booking", id],
    enabled: !!expert?.id,
    queryFn: async (): Promise<Booking | null> => {
      const { data, error } = await supabase
        .from("bookings")
        .select("id, status, service_duration_minutes, price, address_id, assigned_expert_id, started_at, service_end_at, user_id, created_at")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data as Booking | null;
    },
  });

  const booking = bookingQ.data;
  const isMine = booking && expert && booking.assigned_expert_id === expert.id;

  const addressQ = useQuery({
    queryKey: ["address", booking?.address_id],
    enabled: !!booking?.address_id && !!isMine,
    queryFn: async (): Promise<Address | null> => {
      const { data, error } = await supabase
        .from("addresses")
        .select("full_address, area, city, landmark_photo_url, latitude, longitude")
        .eq("id", booking!.address_id!)
        .maybeSingle();
      if (error) throw error;
      return data as Address | null;
    },
  });

  const customerQ = useQuery({
    queryKey: ["customer", booking?.user_id],
    enabled: !!booking?.user_id && !!isMine,
    queryFn: async () => {
      const { data } = await supabase.from("users").select("full_name, phone").eq("id", booking!.user_id).maybeSingle();
      return data;
    },
  });

  // Realtime updates for this booking
  useEffect(() => {
    if (!id) return;
    const ch = supabase
      .channel(`booking-${id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "bookings", filter: `id=eq.${id}` },
        () => qc.invalidateQueries({ queryKey: ["booking", id] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id, qc]);

  const reject = useMutation({
    mutationFn: async (reason: string) => {
      const { error } = await supabase.rpc("expert_reject_booking", { _booking_id: id, _reason: reason });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["assigned-booking"] });
      navigate({ to: "/home" });
    },
  });

  const ensureCodes = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("expert_ensure_booking_codes", { _booking_id: id });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["booking", id] }),
  });

  if (sessionLoading || !expert || bookingQ.isLoading) {
    return <div className="flex min-h-[100dvh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }
  if (!booking || !isMine) {
    return (
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col items-center justify-center px-6 text-center">
        <h1 className="text-[22px] font-bold text-foreground">{t("job.notFound.title")}</h1>
        <p className="mt-2 text-[14px] text-[color:var(--text-secondary)]">{t("job.notFound.sub")}</p>
        <Link to="/home" className="mt-6 h-[52px] w-full max-w-xs flex items-center justify-center rounded-[14px] bg-primary font-bold text-primary-foreground">{t("job.notFound.back")}</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col bg-background pt-[env(safe-area-inset-top)] pb-[max(env(safe-area-inset-bottom),1.5rem)]">
      <header className="flex items-center justify-between px-6 pt-6 pb-4">
        <Link to="/home" className="inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground hover:bg-muted">
          <ChevronLeft className="h-6 w-6" />
        </Link>
        {booking.status === "in_progress" && (
          <Link to="/sos" search={{ booking_id: id }} className="flex h-10 items-center gap-1 rounded-full bg-[color:var(--color-destructive)]/10 px-3 text-[13px] font-bold text-[color:var(--color-destructive)]">
            <AlertTriangle className="h-4 w-4" /> SOS
          </Link>
        )}
      </header>

      <div className="px-6">
        <span className="rounded-full bg-[color:var(--color-accent)] px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-primary">
          {booking.status === "in_progress" ? t("job.badge.inProgress") : booking.status === "completed" ? t("job.badge.completed") : t("job.badge.new")}
        </span>
        <h1 className="mt-2 text-[26px] font-bold leading-tight text-foreground">{t("job.title", { minutes: booking.service_duration_minutes })}</h1>
      </div>

      <section className="mt-5 px-6">
        <div className="rounded-[18px] border border-border bg-card p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[color:var(--color-accent)]">
              <MapPin className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1">
              <p className="text-[13px] font-semibold uppercase tracking-wider text-[color:var(--text-secondary)]">{t("job.address.label")}</p>
              <p className="mt-1 text-[15px] font-semibold text-foreground">
                {addressQ.isLoading ? t("job.address.loading") : (addressQ.data?.full_address ?? t("job.address.unavailable"))}
              </p>
              {(addressQ.data?.area || addressQ.data?.city) && (
                <p className="mt-1 text-[13px] text-[color:var(--text-secondary)]">
                  {[addressQ.data?.area, addressQ.data?.city].filter(Boolean).join(", ")}
                </p>
              )}
            </div>
          </div>

          {addressQ.data?.landmark_photo_url && (
            <img src={addressQ.data.landmark_photo_url} alt="Landmark" className="mt-4 w-full rounded-[14px] object-cover aspect-video" />
          )}

          {booking.status !== "in_progress" && booking.status !== "completed" && (
            <div className="mt-4 grid grid-cols-2 gap-2">
              {addressQ.data?.latitude && addressQ.data?.longitude && (
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${addressQ.data.latitude},${addressQ.data.longitude}`}
                  target="_blank" rel="noreferrer"
                  className="flex h-11 items-center justify-center gap-1 rounded-[14px] bg-primary text-[14px] font-bold text-primary-foreground"
                >
                  <Navigation2 className="h-4 w-4" /> {t("job.navigate")}
                </a>
              )}
              {customerQ.data?.phone && (
                <a href={`tel:${customerQ.data.phone}`} className="flex h-11 items-center justify-center gap-1 rounded-[14px] border border-border bg-card text-[14px] font-bold text-foreground">
                  <Phone className="h-4 w-4" /> {t("job.call")}
                </a>
              )}
            </div>
          )}
        </div>
      </section>

      {booking.status === "expert_assigned" && (
        <AssignedControls
          bookingId={id}
          onEnsureCodes={() => ensureCodes.mutateAsync()}
          onReject={(reason) => reject.mutate(reason)}
          rejecting={reject.isPending}
        />
      )}
      {booking.status === "in_progress" && <InProgressPanel booking={booking} bookingId={id} />}
      {booking.status === "completed" && <CompletedPanel />}
    </div>
  );
}

function AssignedControls({
  bookingId, onEnsureCodes, onReject, rejecting,
}: { bookingId: string; onEnsureCodes: () => Promise<unknown>; onReject: (r: string) => void; rejecting: boolean }) {
  const t = useT();
  const [step, setStep] = useState<"start" | "otp">("start");
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState("");
  const [starting, setStarting] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [otp, setOtp] = useState(["", "", "", ""]);
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const [err, setErr] = useState<string | null>(null);
  const qc = useQueryClient();
  const navigate = useNavigate();

  async function beginStart() {
    setErr(null);
    setPreparing(true);
    try {
      await onEnsureCodes();
      setStep("otp");
    } catch (e) {
      console.error("ensureCodes failed", e);
      setErr(t("job.error.generic"));
    } finally {
      setPreparing(false);
    }
  }

  async function verifyStart(e?: React.FormEvent) {
    e?.preventDefault();
    const code = otp.join("");
    if (code.length !== 4) return;
    setStarting(true); setErr(null);
    const { error } = await supabase.rpc("expert_verify_start_otp", { _booking_id: bookingId, _otp: code });
    setStarting(false);
    if (error) { setErr(error.message); return; }
    qc.invalidateQueries({ queryKey: ["booking", bookingId] });
  }

  if (step === "start") {
    return (
      <>
        <div className="mt-auto px-6 pt-6">
          <button
            onClick={beginStart}
            disabled={preparing}
            className="h-[52px] w-full rounded-[14px] bg-primary text-[16px] font-bold text-primary-foreground shadow-[var(--shadow-brand-sm)] disabled:opacity-60"
          >
            {preparing ? t("job.preparing") : t("job.start")}
          </button>
          <button onClick={() => setShowReject(true)} className="mt-3 h-[52px] w-full rounded-[14px] border border-border bg-card text-[16px] font-bold text-foreground">{t("job.reject")}</button>
          {err && <p className="mt-3 text-center text-[13px] font-semibold text-[color:var(--color-destructive)]">{err}</p>}
        </div>
        {showReject && (
          <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={() => setShowReject(false)}>
            <div onClick={(e) => e.stopPropagation()} className="w-full rounded-t-[24px] bg-card p-6 pb-8">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-[18px] font-bold text-foreground">{t("job.reject.title")}</h3>
                <button onClick={() => setShowReject(false)}><X className="h-5 w-5" /></button>
              </div>
              <p className="text-[13px] text-[color:var(--text-secondary)]">{t("job.reject.sub")}</p>
              <div className="mt-4 space-y-2">
                {([
                  ["Too far", "job.reject.reason.tooFar"],
                  ["Health issue", "job.reject.reason.health"],
                  ["Personal emergency", "job.reject.reason.emergency"],
                  ["Wrong service", "job.reject.reason.wrongService"],
                  ["Other", "job.reject.reason.other"],
                ] as const).map(([r, key]) => (
                  <button key={r} onClick={() => setReason(r)}
                    className={`w-full rounded-[14px] border p-4 text-left text-[14px] font-semibold ${reason === r ? "border-primary bg-[color:var(--color-accent)] text-primary" : "border-border bg-card text-foreground"}`}>
                    {t(key)}
                  </button>
                ))}
              </div>
              <button
                disabled={!reason || rejecting}
                onClick={() => { onReject(reason); navigate({ to: "/home" }); }}
                className="mt-6 h-[52px] w-full rounded-[14px] bg-[color:var(--color-destructive)] text-[16px] font-bold text-white disabled:opacity-40"
              >
                {rejecting ? t("job.reject.rejecting") : t("job.reject.confirm")}
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  // Start-OTP step
  return (
    <form onSubmit={verifyStart} className="mt-auto px-6 pt-6">
      <p className="text-[13px] font-semibold uppercase tracking-wider text-[color:var(--text-secondary)]">{t("job.startCode.label")}</p>
      <h3 className="mt-1 text-[22px] font-bold text-foreground">{t("job.startCode.title")}</h3>
      <div className="mt-6 grid grid-cols-4 gap-3">
        {otp.map((d, i) => (
          <input key={i} ref={(el) => { inputs.current[i] = el; }} type="tel" inputMode="numeric" maxLength={1}
            value={d}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, "").slice(-1);
              setOtp((prev) => { const n = [...prev]; n[i] = v; return n; });
              if (v && i < 3) inputs.current[i + 1]?.focus();
            }}
            onKeyDown={(e) => { if (e.key === "Backspace" && !otp[i] && i > 0) inputs.current[i - 1]?.focus(); }}
            className="h-16 w-full min-w-0 rounded-[14px] border border-border bg-card text-center text-[26px] font-bold text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        ))}
      </div>
      {err && <p className="mt-3 text-[13px] font-semibold text-[color:var(--color-destructive)]">{err}</p>}
      <button type="submit" disabled={starting || otp.join("").length !== 4}
        className="mt-6 h-[52px] w-full rounded-[14px] bg-primary text-[16px] font-bold text-primary-foreground shadow-[var(--shadow-brand-sm)] disabled:opacity-40">
        {starting ? t("job.starting") : t("job.start")}
      </button>
    </form>
  );
}

function InProgressPanel({ booking, bookingId }: { booking: Booking; bookingId: string }) {
  const qc = useQueryClient();
  const t = useT();
  const [otp, setOtp] = useState(["", "", "", ""]);
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const [err, setErr] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const remainingMs = booking.service_end_at ? new Date(booking.service_end_at).getTime() - now : 0;
  const totalSec = Math.max(0, Math.floor(remainingMs / 1000));
  const hh = Math.floor(totalSec / 3600);
  const mm = Math.floor((totalSec % 3600) / 60);
  const ss = totalSec % 60;
  const timeText = hh > 0
    ? `${hh}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`
    : `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;

  async function verifyEnd(e?: React.FormEvent) {
    e?.preventDefault();
    const code = otp.join("");
    if (code.length !== 4) return;
    setEnding(true); setErr(null);
    const { error } = await supabase.rpc("expert_verify_end_otp", { _booking_id: bookingId, _otp: code });
    setEnding(false);
    if (error) { setErr(error.message); return; }
    qc.invalidateQueries({ queryKey: ["booking", bookingId] });
    qc.invalidateQueries({ queryKey: ["assigned-booking"] });
    qc.invalidateQueries({ queryKey: ["expert"] });
  }

  return (
    <section className="mt-5 px-6">
      <div className="rounded-[18px] border-2 border-primary bg-[color:var(--color-accent)] p-5 text-center">
        <p className="text-[12px] font-bold uppercase tracking-wider text-primary">{t("job.timeRemaining")}</p>
        <p className="mt-1 font-mono text-[44px] font-bold leading-none text-primary">
          {timeText}
        </p>
      </div>

      <form onSubmit={verifyEnd} className="mt-6">
        <p className="text-[13px] font-semibold uppercase tracking-wider text-[color:var(--text-secondary)]">{t("job.endCode.label")}</p>
        <h3 className="mt-1 text-[20px] font-bold text-foreground">{t("job.endCode.title")}</h3>
        <div className="mt-4 grid grid-cols-4 gap-3">
          {otp.map((d, i) => (
            <input key={i} ref={(el) => { inputs.current[i] = el; }} type="tel" inputMode="numeric" maxLength={1}
              value={d}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, "").slice(-1);
                setOtp((prev) => { const n = [...prev]; n[i] = v; return n; });
                if (v && i < 3) inputs.current[i + 1]?.focus();
              }}
              onKeyDown={(e) => { if (e.key === "Backspace" && !otp[i] && i > 0) inputs.current[i - 1]?.focus(); }}
              className="h-16 w-full min-w-0 rounded-[14px] border border-border bg-card text-center text-[26px] font-bold text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          ))}
        </div>
        {err && <p className="mt-3 text-[13px] font-semibold text-[color:var(--color-destructive)]">{err}</p>}
        <button type="submit" disabled={ending || otp.join("").length !== 4}
          className="mt-6 h-[52px] w-full rounded-[14px] bg-primary text-[16px] font-bold text-primary-foreground shadow-[var(--shadow-brand-sm)] disabled:opacity-40">
          {ending ? t("job.completing") : t("job.complete")}
        </button>
      </form>
    </section>
  );
}

function CompletedPanel() {
  const t = useT();
  return (
    <section className="mt-6 flex flex-1 flex-col items-center justify-center px-6 text-center">
      <div className="flex h-24 w-24 items-center justify-center rounded-full bg-primary/10">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-white text-3xl">✓</div>
      </div>
      <h2 className="mt-5 text-[24px] font-bold text-foreground">{t("job.done.title")}</h2>
      <p className="mt-2 max-w-xs text-[14px] text-[color:var(--text-secondary)]">{t("job.done.sub")}</p>
      <div className="mt-8 flex w-full gap-3">
        <Link to="/wallet" className="flex h-[52px] flex-1 items-center justify-center rounded-[14px] border border-border bg-card font-bold text-foreground">{t("job.done.wallet")}</Link>
        <Link to="/home" className="flex h-[52px] flex-1 items-center justify-center rounded-[14px] bg-primary font-bold text-primary-foreground">{t("job.done.home")}</Link>
      </div>
    </section>
  );
}
