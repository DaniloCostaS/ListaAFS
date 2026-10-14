-- Create the user_episodes table
CREATE TABLE public.user_episodes (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    tmdb_id INTEGER NOT NULL,
    season_number INTEGER NOT NULL,
    episode_number INTEGER NOT NULL,
    watched BOOLEAN DEFAULT false NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    PRIMARY KEY (user_id, tmdb_id, season_number, episode_number)
);

-- Set up Row Level Security (RLS)
ALTER TABLE public.user_episodes ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view their own episodes"
    ON public.user_episodes
    FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own episodes"
    ON public.user_episodes
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own episodes"
    ON public.user_episodes
    FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own episodes"
    ON public.user_episodes
    FOR DELETE
    USING (auth.uid() = user_id);

-- Trigger for updated_at
CREATE TRIGGER set_updated_at_episodes
    BEFORE UPDATE ON public.user_episodes
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();
