// Public by design: the publishable key only lets a browser talk to the
// database as itself. What anyone can read or change is decided by the
// row-level security rules in supabase/migrations, not by hiding this.
export const SUPABASE_URL = "https://dmuzyednlvftkoxqhzed.supabase.co";
export const SUPABASE_KEY = "sb_publishable_zWtGh01UZSoYAWMZqZATNQ_z83Lhfjp";

// Spotify ("what's playing" for your crew) is on once the Spotify app exists
// and its Client ID is in supabase/functions/spotify/index.ts.
export const SPOTIFY = false;
