import { test } from "node:test";
import assert from "node:assert/strict";
import { lastfmName, nowPlaying } from "../supabase/functions/music/lastfm.ts";

const playing = {
  name: "Weightless",
  artist: { mbid: "", "#text": "Marconi Union" },
  album: { mbid: "", "#text": "Weightless" },
  image: [
    { size: "small", "#text": "https://lastfm.freetls.fastly.net/i/u/34s/abc.jpg" },
    { size: "medium", "#text": "https://lastfm.freetls.fastly.net/i/u/64s/abc.jpg" },
    { size: "large", "#text": "https://lastfm.freetls.fastly.net/i/u/174s/abc.jpg" },
    { size: "extralarge", "#text": "https://lastfm.freetls.fastly.net/i/u/300x300/abc.jpg" },
  ],
  "@attr": { nowplaying: "true" },
  url: "https://www.last.fm/music/Marconi+Union/_/Weightless",
};
const earlier = { ...playing, name: "Older song", "@attr": undefined, date: { uts: "1761570000", "#text": "27 Oct 2026, 13:00" } };
const reply = (track) => ({ recenttracks: { track, "@attr": { user: "RJ", page: "1", perPage: "1", totalPages: "100", total: "100" } } });

test("the track playing now becomes a small, stable summary", () => {
  assert.deepEqual(nowPlaying(reply([playing, earlier])), {
    title: "Weightless", by: "Marconi Union", kind: "track",
    url: "https://open.spotify.com/search/Weightless%20Marconi%20Union",
    image: "https://lastfm.freetls.fastly.net/i/u/174s/abc.jpg",
  });
});

test("a lone track comes back as an object, not a list", () => {
  assert.equal(nowPlaying(reply(playing))?.title, "Weightless");
});

test("nothing playing, no scrobbles or an error shows nothing", () => {
  assert.equal(nowPlaying(reply([earlier])), null);
  assert.equal(nowPlaying(reply([])), null);
  assert.equal(nowPlaying({ error: 6, message: "User not found" }), null);
  assert.equal(nowPlaying(null), null);
});

test("covers only from Last.fm's own host, and never its blank star", () => {
  const odd = { ...playing, image: [{ size: "large", "#text": "http://evil.example/x.png" }] };
  assert.equal(nowPlaying(reply([odd])).image, null);
  const star = { ...playing, image: [{ size: "large", "#text": "https://lastfm.freetls.fastly.net/i/u/174s/2a96cbd8b46e442fc41c2b86b821562f.png" }] };
  assert.equal(nowPlaying(reply([star])).image, null);
});

test("a Last.fm name from whatever someone types or pastes", () => {
  assert.equal(lastfmName("  RJ "), "RJ");
  assert.equal(lastfmName("@alex_f"), "alex_f");
  assert.equal(lastfmName("https://www.last.fm/user/alex-f99"), "alex-f99");
  assert.equal(lastfmName("last.fm/de/user/Someone?ref=x"), "Someone");
  assert.equal(lastfmName(""), null);
  assert.equal(lastfmName("x"), null);
  assert.equal(lastfmName("two words"), null);
  assert.equal(lastfmName("<script>"), null);
});
