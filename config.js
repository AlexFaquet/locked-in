// Public by design: the publishable key only lets a browser talk to the
// database as itself. What anyone can read or change is decided by the
// row-level security rules in supabase/migrations, not by hiding this.
export const SUPABASE_URL = "https://dmuzyednlvftkoxqhzed.supabase.co";
export const SUPABASE_KEY = "sb_publishable_zWtGh01UZSoYAWMZqZATNQ_z83Lhfjp";

// Spotify ("what's playing" for your crew). Its Client ID lives in
// supabase/functions/spotify/index.ts; turn this off to hide it in the app.
export const SPOTIFY = true;
