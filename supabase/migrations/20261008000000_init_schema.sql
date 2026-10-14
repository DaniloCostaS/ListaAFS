-- Create the user_media table
CREATE TABLE public.user_media (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    tmdb_id INTEGER NOT NULL,
    media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'tv')),
    status TEXT NOT NULL CHECK (status IN ('watching', 'completed', 'plan_to_watch')),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    PRIMARY KEY (user_id, tmdb_id, media_type)
);

-- Set up Row Level Security (RLS)
ALTER TABLE public.user_media ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view their own media"
    ON public.user_media
    FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own media"
    ON public.user_media
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own media"
    ON public.user_media
    FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own media"
    ON public.user_media
    FOR DELETE
    USING (auth.uid() = user_id);

-- Function to auto-update the updated_at timestamp
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for updated_at
CREATE TRIGGER set_updated_at
    BEFORE UPDATE ON public.user_media
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();
