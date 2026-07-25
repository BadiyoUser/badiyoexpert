
CREATE OR REPLACE FUNCTION public.notify_expert_assigned()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  _base text := 'https://dkneclwmmjlqswovtqno.supabase.co/functions/v1';
  _secret text;
BEGIN
  IF NEW.assigned_expert_id IS NOT NULL
     AND (OLD.assigned_expert_id IS DISTINCT FROM NEW.assigned_expert_id)
     AND NEW.status = 'expert_assigned' THEN
    SELECT value INTO _secret FROM public.edge_runtime_config WHERE key = 'push_trigger_secret';
    IF _secret IS NOT NULL AND _secret <> '' THEN
      PERFORM net.http_post(
        url := _base || '/expert-send-push',
        headers := jsonb_build_object(
          'content-type','application/json',
          'x-trigger-secret', _secret
        ),
        body := jsonb_build_object('booking_id', NEW.id, 'expert_id', NEW.assigned_expert_id)
      );
    END IF;
  END IF;
  RETURN NEW;
END $$;
