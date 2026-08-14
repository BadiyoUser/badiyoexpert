CREATE OR REPLACE FUNCTION public.bookings_before_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _bypass text;
BEGIN
  BEGIN _bypass := current_setting('app.booking_bypass', true); EXCEPTION WHEN OTHERS THEN _bypass := NULL; END;
  IF _bypass = 'on' THEN
    RETURN NEW;
  END IF;

  -- Direct (non-RPC) updates may only touch updated_at. Everything else must go
  -- through SECURITY DEFINER functions that set app.booking_bypass.
  IF to_jsonb(NEW) - 'updated_at' IS DISTINCT FROM to_jsonb(OLD) - 'updated_at' THEN
    RAISE EXCEPTION 'Booking changes must go through server-side functions';
  END IF;

  RETURN NEW;
END;$function$;

CREATE OR REPLACE FUNCTION public.users_before_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _bypass text;
BEGIN
  BEGIN _bypass := current_setting('app.users_bypass', true); EXCEPTION WHEN OTHERS THEN _bypass := NULL; END;
  IF _bypass = 'on' THEN RETURN NEW; END IF;

  -- Whitelist of self-editable profile columns; all others are locked.
  IF (to_jsonb(NEW) - 'full_name' - 'email' - 'phone' - 'avatar_url'
        - 'notification_preferences' - 'preferred_language' - 'updated_at')
     IS DISTINCT FROM
     (to_jsonb(OLD) - 'full_name' - 'email' - 'phone' - 'avatar_url'
        - 'notification_preferences' - 'preferred_language' - 'updated_at')
  THEN
    RAISE EXCEPTION 'Field not updatable';
  END IF;

  RETURN NEW;
END;$function$;

DROP POLICY IF EXISTS "Anyone can submit a support inquiry" ON public.support_inquiries;
CREATE POLICY "Anyone can submit a support inquiry"
ON public.support_inquiries FOR INSERT TO anon, authenticated
WITH CHECK (status = 'open');

GRANT INSERT ON public.support_inquiries TO anon, authenticated;