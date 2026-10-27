// Public by design: the publishable key only lets a browser talk to the
// database as itself. What anyone can read or change is decided by the
// row-level security rules in supabase/migrations, not by hiding this.
export const SUPABASE_URL = "https://dmuzyednlvftkoxqhzed.supabase.co";
export const SUPABASE_KEY = "sb_publishable_zWtGh01UZSoYAWMZqZATNQ_z83Lhfjp";

// Music ("what's playing" for your crew), through Last.fm. Its API key is the
// music edge function's LASTFM_KEY secret; turn this off to hide it in the app.
export const MUSIC = true;
