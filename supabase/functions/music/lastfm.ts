// What crewmates see from Last.fm's "recent tracks" reply: the track someone
// is playing right now, or null. Kept small and stable (no timestamps), so the
// row only changes when the song does.

type Image = { size?: string; "#text"?: string };

const text = (value: unknown, max = 120) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

// Last.fm's grey star, which it sends when it has no cover for a track.
const NO_COVER = "2a96cbd8b46e442fc41c2b86b821562f";

/** The 174px cover (sharp at 36px on any phone), from Last.fm's own image host only. */
function cover(images: Image[] = []): string | null {
  const url = (images.find((i) => i.size === "large") ?? images.at(-1))?.["#text"];
  return typeof url === "string" && url.startsWith("https://lastfm.freetls.fastly.net/") && !url.includes(NO_COVER) ? url : null;
}

/** A Last.fm username from what someone typed: the name, @name, or their profile's link. Null if it can't be one. */
export function lastfmName(input: unknown): string | null {
  let name = text(input, 200);
  const fromLink = name.match(/last\.fm\/(?:[a-z]{2}\/)?user\/([^/?#\s]+)/i);
  if (fromLink) name = fromLink[1];
  name = name.replace(/^@/, "");
  return /^[A-Za-z0-9][\w.-]{1,29}$/.test(name) ? name : null;
}

// deno-lint-ignore no-explicit-any
export function nowPlaying(reply: any): { title: string; by: string; kind: "track"; url: string; image: string | null } | null {
  const tracks = reply?.recenttracks?.track;
  // Several tracks come back as a list, one as a bare object; the one playing is always first.
  const first = Array.isArray(tracks) ? tracks[0] : tracks;
  if (first?.["@attr"]?.nowplaying !== "true") return null;
  const title = text(first.name);
  if (!title) return null;
  const by = text(first.artist?.["#text"] ?? first.artist?.name);
  return {
    title,
    by,
    kind: "track",
    // Last.fm doesn't say which app it's playing in, so this finds it on Spotify.
    url: `https://open.spotify.com/search/${encodeURIComponent(`${title} ${by}`.trim())}`,
    image: cover(first.image),
  };
}
