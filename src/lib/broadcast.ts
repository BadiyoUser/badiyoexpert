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

export type LocationTracker = {
  state: LocationState;
  lastPushedAt: number | null;
  /** True when the page is currently hidden/backgrounded. Tracking is paused. */
  isHidden: boolean;
  /**
   * Imperatively request a fresh fix and persist it. Resolves with coords on
   * success, or throws with a user-readable message on failure. Callers should
   * await this before flipping the expert to Online so a booking broadcast
   * during the toggle gap doesn't miss the expert.
   */
  ensureFix: () => Promise<Coords>;
};

async function pushLocation(coords: Coords): Promise<void> {
  const { error } = await supabase.rpc("expert_update_location", {
    p_lat: coords.lat,
    p_lng: coords.lng,
  });
  if (error) {
    console.error("[expert] expert_update_location failed", error);
    throw new Error(error.message || "Could not save location");
  }
}

function getCurrentPositionOnce(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("Geolocation not supported on this device."));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      maximumAge: 15_000,
      timeout: 20_000,
    });
  });
}

// Tracks device geolocation while `enabled` is true and pushes it to Supabase
// on every fresh reading plus a 60s poll. Also exposes `ensureFix()` for the
// caller to await a fresh persisted fix before flipping Online.
export function useExpertLocationTracking(enabled: boolean): LocationTracker {
  const [state, setState] = useState<LocationState>({ status: "idle" });
  const [lastPushedAt, setLastPushedAt] = useState<number | null>(null);
  const [isHidden, setIsHidden] = useState<boolean>(
    typeof document !== "undefined" ? document.hidden : false,
  );
  const stateRef = useRef(state);
  stateRef.current = state;
  const hiddenRef = useRef(isHidden);
  hiddenRef.current = isHidden;

  const applyPosition = useCallback((pos: GeolocationPosition) => {
    const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    setState({ status: "ok", coords, updatedAt: Date.now() });
    return coords;
  }, []);

  const applyError = useCallback((err: GeolocationPositionError | Error) => {
    // Suppress geolocation errors while backgrounded — browsers throttle or
    // time out watchPosition/getCurrentPosition when the tab is hidden, and
    // that's expected OS behavior, not a genuine failure.
    if (hiddenRef.current) return;
    if ("code" in err && err.code === err.PERMISSION_DENIED) {
      setState({ status: "denied" });
      return;
    }
    setState({
      status: "unavailable",
      message: (err as Error).message || "Location unavailable",
    });
  }, []);

  const ensureFix = useCallback(async (): Promise<Coords> => {
    setState((prev) => (prev.status === "ok" ? prev : { status: "requesting" }));
    try {
      const pos = await getCurrentPositionOnce();
      const coords = applyPosition(pos);
      await pushLocation(coords);
      setLastPushedAt(Date.now());
      return coords;
    } catch (err) {
      applyError(err as GeolocationPositionError | Error);
      const message =
        (err as GeolocationPositionError).code === 1
          ? "Location permission denied. Enable location access to receive bookings."
          : (err as Error).message || "Could not get your location";
      throw new Error(message);
    }
  }, [applyPosition, applyError]);

  // Track page visibility so we can pause tracking while hidden.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVis = () => setIsHidden(document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setState({ status: "idle" });
      setLastPushedAt(null);
      return;
    }
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setState({ status: "unavailable", message: "Geolocation not supported on this device." });
      return;
    }
    // Pause tracking while the tab is hidden — keep last-known state intact.
    if (isHidden) return;

    let cancelled = false;

    const onPosition = (pos: GeolocationPosition) => {
      if (cancelled) return;
      const coords = applyPosition(pos);
      pushLocation(coords)
        .then(() => setLastPushedAt(Date.now()))
        .catch((err) => console.error("[expert] location push failed", err));
    };
    const onError = (err: GeolocationPositionError) => {
      if (cancelled) return;
      applyError(err);
    };

    // On becoming visible (or first enable), immediately refresh the fix.
    navigator.geolocation.getCurrentPosition(onPosition, onError, {
      enableHighAccuracy: true,
      maximumAge: 30_000,
      timeout: 20_000,
    });

    const watchId = navigator.geolocation.watchPosition(onPosition, onError, {
      enableHighAccuracy: true,
      maximumAge: 30_000,
      timeout: 20_000,
    });

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
  }, [enabled, isHidden, applyPosition, applyError]);

  return { state, lastPushedAt, isHidden, ensureFix };
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
