// What crewmates see from Spotify's "currently playing" reply: the track or
// episode playing right now, or null. Kept small and stable (no progress or
// timestamps), so the row only changes when the song does.

type Image = { url?: string; width?: number | null };

const safe = (url: unknown, host: string): string | null =>
  typeof url === "string" && url.startsWith(`https://${host}/`) ? url : null;

const text = (value: unknown, max = 120) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** The smallest picture that's still at least 64px, for a 32px thumbnail on a sharp screen. */
function thumbnail(images: Image[] = []): string | null {
  const sorted = [...images].sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  const pick = sorted.find((i) => (i.width ?? 0) >= 64) ?? sorted.at(-1);
  return safe(pick?.url, "i.scdn.co");
}

// deno-lint-ignore no-explicit-any
export function nowPlaying(reply: any): { title: string; by: string; kind: "track" | "episode"; url: string | null; image: string | null } | null {
  const item = reply?.item;
  // Paused, an ad, or a private session: nothing to show.
  if (!reply?.is_playing || !item) return null;
  const episode = reply.currently_playing_type === "episode" || item.type === "episode";
  const title = text(item.name);
  if (!title) return null;
  return {
    title,
    by: episode ? text(item.show?.name) : text((item.artists ?? []).map((a: { name?: string }) => a.name).filter(Boolean).join(", ")),
    kind: episode ? "episode" : "track",
    url: safe(item.external_urls?.spotify, "open.spotify.com"),
    image: thumbnail(episode ? item.images ?? item.show?.images : item.album?.images),
  };
}
