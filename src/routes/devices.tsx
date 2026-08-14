import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { ChevronLeft, Loader2, Smartphone, LogOut } from "lucide-react";
import { toast } from "sonner";
import {
  listMyDevices,
  registerThisDevice,
  revokeDevice,
  formatLastActive,
  type DeviceRow,
} from "@/lib/devices";
import { getDeviceId } from "@/lib/device-id";
import { supabase } from "@/integrations/supabase/client";
import { useT } from "@/lib/i18n";

const searchSchema = z.object({ limit: z.union([z.boolean(), z.string()]).optional() });

export const Route = createFileRoute("/devices")({
  validateSearch: (s) => searchSchema.parse(s),
  head: () => ({
    meta: [
      { title: "Active devices — Badiyo Expert" },
      { name: "description", content: "Manage the devices signed in to your Badiyo Expert account." },
    ],
  }),
  component: DevicesScreen,
});

function DevicesScreen() {
  const t = useT();
  const { limit } = Route.useSearch();
  const limitMode = limit === true || limit === "1" || limit === "true";
  const navigate = useNavigate();
  const [devices, setDevices] = useState<DeviceRow[] | null>(null);
  const [thisId, setThisId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [rows, id] = await Promise.all([listMyDevices(), getDeviceId()]);
      setDevices(rows);
      setThisId(id);
    } catch (err) {
      toast.error((err as Error).message ?? t("devices.toast.loadFailed"));
      setDevices([]);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onLogOut(deviceId: string) {
    setBusy(deviceId);
    try {
      await revokeDevice(deviceId);
      if (deviceId === thisId) {
        await supabase.auth.signOut();
        navigate({ to: "/login" });
        return;
      }
      if (limitMode) {
        const res = await registerThisDevice();
        if (res.status === "registered") {
          toast.success(t("devices.toast.nowActive"));
          navigate({ to: "/home" });
          return;
        }
        setDevices(res.devices);
        return;
      }
      await load();
      toast.success(t("devices.toast.loggedOut"));
    } catch (err) {
      toast.error((err as Error).message ?? t("devices.toast.logoutFailed"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col bg-background px-6 pt-[max(env(safe-area-inset-top),1.5rem)] pb-[max(env(safe-area-inset-bottom),2rem)]">
      <header className="flex items-center gap-3 py-4">
        {!limitMode && (
          <button
            type="button"
            onClick={() => navigate({ to: "/profile" })}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground hover:bg-muted"
            aria-label={t("common.back")}
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}
        <h1 className="text-[22px] font-bold text-foreground">
          {limitMode ? t("devices.limitTitle") : t("devices.title")}
        </h1>
      </header>

      <p className="text-[14px] leading-snug text-[color:var(--text-secondary)]">
        {limitMode ? t("devices.limitIntro") : t("devices.intro")}
      </p>

      <div className="mt-6 space-y-3">
        {devices === null && (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        )}
        {devices?.length === 0 && (
          <p className="py-8 text-center text-[14px] text-[color:var(--text-secondary)]">
            {t("devices.empty")}
          </p>
        )}
        {devices?.map((d) => {
          const isThis = d.device_id === thisId;
          return (
            <div key={d.device_id} className="rounded-[18px] border border-border bg-card p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[color:var(--color-accent)]">
                  <Smartphone className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold text-foreground">
                    {d.device_label ?? t("devices.unknown")}
                    {isThis && (
                      <span className="ml-2 rounded-full bg-[color:var(--color-accent)] px-2 py-0.5 text-[11px] font-bold text-primary">
                        {t("devices.thisDevice")}
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-[12px] text-[color:var(--text-secondary)]">
                    {t("devices.lastActive", { when: formatLastActive(d.last_active_at) })}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onLogOut(d.device_id)}
                disabled={busy !== null}
                className="mt-3 flex h-[44px] w-full items-center justify-center gap-2 rounded-[14px] border border-border bg-background text-[14px] font-bold text-[color:var(--color-destructive)] disabled:opacity-60"
              >
                {busy === d.device_id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <LogOut className="h-4 w-4" />
                )}
                {t("devices.logout")}
              </button>
            </div>
          );
        })}
      </div>

      {limitMode && (
        <button
          type="button"
          onClick={async () => {
            await supabase.auth.signOut();
            navigate({ to: "/login" });
          }}
          className="mt-auto pt-8 text-center text-[14px] font-semibold text-[color:var(--text-secondary)]"
        >
          {t("devices.cancel")}
        </button>
      )}
    </div>
  );
}
