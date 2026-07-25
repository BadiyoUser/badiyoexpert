
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.expert_push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expert_id uuid NOT NULL REFERENCES public.experts(id) ON DELETE CASCADE,
  fcm_token text NOT NULL UNIQUE,
  platform text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expert_push_tokens TO authenticated;
GRANT ALL ON public.expert_push_tokens TO service_role;
ALTER TABLE public.expert_push_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Experts manage own push tokens"
  ON public.expert_push_tokens FOR ALL TO authenticated
  USING (expert_id = public.get_expert_id_for_auth(auth.uid()))
  WITH CHECK (expert_id = public.get_expert_id_for_auth(auth.uid()));
CREATE INDEX IF NOT EXISTS expert_push_tokens_expert_id_idx ON public.expert_push_tokens(expert_id);

-- Small config table for trigger-side secrets (service-role key). No client access.
CREATE TABLE IF NOT EXISTS public.edge_runtime_config (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.edge_runtime_config TO service_role;
ALTER TABLE public.edge_runtime_config ENABLE ROW LEVEL SECURITY;
-- No policies: authenticated/anon cannot read.

CREATE OR REPLACE FUNCTION public.notify_expert_assigned()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  _base text := 'https://dkneclwmmjlqswovtqno.supabase.co/functions/v1';
  _key text;
BEGIN
  IF NEW.assigned_expert_id IS NOT NULL
     AND (OLD.assigned_expert_id IS DISTINCT FROM NEW.assigned_expert_id)
     AND NEW.status = 'expert_assigned' THEN
    SELECT value INTO _key FROM public.edge_runtime_config WHERE key = 'service_role_key';
    IF _key IS NOT NULL AND _key <> '' THEN
      PERFORM net.http_post(
        url := _base || '/expert-send-push',
        headers := jsonb_build_object(
          'content-type','application/json',
          'authorization','Bearer ' || _key
        ),
        body := jsonb_build_object('booking_id', NEW.id, 'expert_id', NEW.assigned_expert_id)
      );
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_expert_assigned ON public.bookings;
CREATE TRIGGER trg_notify_expert_assigned
AFTER UPDATE OF assigned_expert_id, status ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.notify_expert_assigned();
