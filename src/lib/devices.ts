import { supabase } from "@/integrations/supabase/client";
import { getDeviceId, getDeviceLabel } from "@/lib/device-id";

export type DeviceRow = {
  device_id: string;
  device_label: string | null;
  last_active_at: string;
};

export type RegisterResult =
  | { status: "registered" }
  | { status: "limit_reached"; devices: DeviceRow[] };

// Registers this device for the signed-in expert (max 2 devices, enforced server-side).
export async function registerThisDevice(): Promise<RegisterResult> {
  const device_id = await getDeviceId();
  const { data, error } = await supabase.rpc("expert_register_device" as never, {
    _device_id: device_id,
    _device_label: getDeviceLabel(),
  } as never);
  if (error) throw error;
  return data as unknown as RegisterResult;
}

export async function revokeDevice(deviceId: string): Promise<void> {
  const { error } = await supabase.rpc("expert_revoke_device" as never, {
    _device_id: deviceId,
  } as never);
  if (error) throw error;
}

export async function listMyDevices(): Promise<DeviceRow[]> {
  const { data, error } = await supabase
    .from("device_sessions")
    .select("device_id, device_label, last_active_at")
    .order("last_active_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as DeviceRow[];
}

export function formatLastActive(iso: string): string {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "Active now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
