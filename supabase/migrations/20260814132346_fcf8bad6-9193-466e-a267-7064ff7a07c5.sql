CREATE OR REPLACE FUNCTION public.notify_expert_broadcast(_expert_id uuid, _booking_id uuid, _title text, _body text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  _base text := 'https://dkneclwmmjlqswovtqno.supabase.co/functions/v1';
  _secret text;
BEGIN
  BEGIN
    IF _expert_id IS NULL THEN RETURN; END IF;
    SELECT value INTO _secret FROM public.edge_runtime_config WHERE key = 'push_trigger_secret';
    IF _secret IS NULL OR _secret = '' THEN RETURN; END IF;

    PERFORM net.http_post(
      url := _base || '/expert-send-push',
      headers := jsonb_build_object(
        'content-type','application/json',
        'x-trigger-secret', _secret
      ),
      body := jsonb_build_object(
        'booking_id', _booking_id,
        'expert_id', _expert_id,
        'alert_type', 'broadcast',
        'title', _title,
        'body', _body
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[notify_expert_broadcast] failed for expert %: %', _expert_id, SQLERRM;
  END;
END;
$function$;