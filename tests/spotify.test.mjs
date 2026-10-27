import { test } from "node:test";
import assert from "node:assert/strict";
import { nowPlaying } from "../supabase/functions/spotify/playing.ts";

const track = {
  is_playing: true,
  currently_playing_type: "track",
  item: {
    type: "track",
    name: "Weightless",
    artists: [{ name: "Marconi Union" }, { name: "Someone Else" }],
    external_urls: { spotify: "https://open.spotify.com/track/abc" },
    album: { images: [{ url: "https://i.scdn.co/image/640", width: 640 }, { url: "https://i.scdn.co/image/64", width: 64 }, { url: "https://i.scdn.co/image/300", width: 300 }] },
  },
};

test("a playing track becomes a small, stable summary", () => {
  assert.deepEqual(nowPlaying(track), {
    title: "Weightless", by: "Marconi Union, Someone Else", kind: "track",
    url: "https://open.spotify.com/track/abc", image: "https://i.scdn.co/image/64",
  });
});

test("paused, an ad or a private session shows nothing", () => {
  assert.equal(nowPlaying({ ...track, is_playing: false }), null);
  assert.equal(nowPlaying({ is_playing: true, currently_playing_type: "ad", item: null }), null);
  assert.equal(nowPlaying(null), null);
});

test("a podcast shows the episode and its show", () => {
  const episode = { is_playing: true, currently_playing_type: "episode", item: { type: "episode", name: "Deep work", show: { name: "Study Pod", images: [{ url: "https://i.scdn.co/image/s", width: 300 }] }, images: [], external_urls: { spotify: "https://open.spotify.com/episode/x" } } };
  const out = nowPlaying(episode);
  assert.equal(out.kind, "episode");
  assert.equal(out.by, "Study Pod");
});

test("links and pictures only from Spotify's own hosts", () => {
  const odd = { ...track, item: { ...track.item, external_urls: { spotify: "javascript:alert(1)" }, album: { images: [{ url: "http://evil.example/x.png", width: 64 }] } } };
  const out = nowPlaying(odd);
  assert.equal(out.url, null);
  assert.equal(out.image, null);
});
