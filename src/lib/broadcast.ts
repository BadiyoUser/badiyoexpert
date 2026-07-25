// Utilities for the Home-screen broadcast experience.
import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export type Coords = { lat: number; lng: number };

// Haversine distance in km
export function haversineKm(a: Coords, b: Coords): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export type LocationState =
  | { status: "idle" }
  | { status: "requesting" }
  | { status: "denied" }
  | { status: "unavailable"; message: string }
  | { status: "ok"; coords: Coords; updatedAt: number };

// Tracks device geolocation while `enabled` is true and pushes it to Supabase
// every `intervalMs` (default 60s). Also pushes on every fresh reading.
export function useExpertLocationTracking(enabled: boolean) {
  const [state, setState] = useState<LocationState>({ status: "idle" });
  const stateRef = useRef(state);
  stateRef.current = state;
  const lastPushRef = useRef(0);

  const pushToServer = useCallback(async (coords: Coords) => {
    try {
      await supabase.rpc("expert_update_location", {
        _lat: coords.lat,
        _lng: coords.lng,
      });
      lastPushRef.current = Date.now();
    } catch {
      // Non-fatal; next tick will retry.
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setState({ status: "idle" });
      return;
    }
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setState({ status: "unavailable", message: "Geolocation not supported on this device." });
      return;
    }

    setState({ status: "requesting" });
    let cancelled = false;

    const onPosition = (pos: GeolocationPosition) => {
      if (cancelled) return;
      const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      setState({ status: "ok", coords, updatedAt: Date.now() });
      void pushToServer(coords);
    };
    const onError = (err: GeolocationPositionError) => {
      if (cancelled) return;
      if (err.code === err.PERMISSION_DENIED) setState({ status: "denied" });
      else setState({ status: "unavailable", message: err.message || "Location unavailable" });
    };

    const watchId = navigator.geolocation.watchPosition(onPosition, onError, {
      enableHighAccuracy: true,
      maximumAge: 30_000,
      timeout: 20_000,
    });

    // Also actively poll every 60s so the server row is always fresh even
    // if watchPosition doesn't fire (stationary device).
    const interval = window.setInterval(() => {
      navigator.geolocation.getCurrentPosition(onPosition, onError, {
        enableHighAccuracy: true,
        maximumAge: 30_000,
        timeout: 20_000,
      });
    }, 60_000);

    return () => {
      cancelled = true;
      navigator.geolocation.clearWatch(watchId);
      window.clearInterval(interval);
    };
  }, [enabled, pushToServer]);

  return state;
}

// -----------------------------------------------------------------------------
// Sound loop (Web Audio synth — no asset needed, matches the "notification loop"
// pattern used elsewhere in Badiyo).
// -----------------------------------------------------------------------------
let sharedCtx: AudioContext | null = null;
const activeSources = new Set<{ stop: () => void }>();

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!sharedCtx) sharedCtx = new AC();
  if (sharedCtx.state === "suspended") void sharedCtx.resume();
  return sharedCtx;
}

export function startNotificationLoop(): { stop: () => void } {
  const ctx = getCtx();
  if (!ctx) return { stop: () => {} };
  let stopped = false;
  let timer: number | null = null;

  const beep = () => {
    if (stopped) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(1320, ctx.currentTime + 0.18);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
  };

  beep();
  timer = window.setInterval(beep, 1400);

  const handle = {
    stop: () => {
      if (stopped) return;
      stopped = true;
      if (timer !== null) window.clearInterval(timer);
      activeSources.delete(handle);
    },
  };
  activeSources.add(handle);
  return handle;
}

export function stopAllNotificationLoops() {
  for (const s of Array.from(activeSources)) s.stop();
}
