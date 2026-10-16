-- Add is_pinned to public.user_media
ALTER TABLE public.user_media ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT FALSE;
