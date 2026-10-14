-- Add user_rating and user_notes to public.user_media
ALTER TABLE public.user_media ADD COLUMN IF NOT EXISTS user_rating REAL;
ALTER TABLE public.user_media ADD COLUMN IF NOT EXISTS user_notes TEXT;
