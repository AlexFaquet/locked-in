// Pairing: trades a code from a signed-in device for a one-time sign-in on a
// new device, as the same person. It's a public endpoint because the code is
// the only credential; redeem_pairing_code() accepts each code once, within
// ten minutes. The secret key never leaves this function.
import { createClient } from "npm:@supabase/supabase-js@2.117.3";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, apikey, authorization, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });
const unavailable = () => json({ error: "Pairing isn't working right now. Try again in a minute." }, 500);

/** The project's secret key: the new kind if there is one, the legacy service-role key otherwise. */
function secretKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    if (keys.default) return keys.default;
  } catch (_) { /* fall back to the legacy key */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  let code = "";
  try { code = String((await req.json())?.code ?? ""); } catch (_) { return json({ error: "Send the code from your other device." }, 400); }
  if (!/^[A-Za-z0-9 -]{6,12}$/.test(code)) return json({ error: "Codes are six letters and numbers." }, 400);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, secretKey(), { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userId, error } = await admin.rpc("redeem_pairing_code", { p_code: code });
  if (error) {
    if (error.code === "P0002") return json({ error: error.message }, 404);
    console.error("pair: redeem failed", error.message);
    return unavailable();
  }

  // A one-time sign-in needs an email address, and these accounts don't have
  // one. They get an address on a reserved domain that can never receive mail.
  // Nothing is ever sent to it.
  const { data: found, error: lookupError } = await admin.auth.admin.getUserById(userId);
  if (lookupError || !found?.user) return json({ error: "That account no longer exists." }, 404);
  let email = found.user.email;
  if (!email) {
    email = `${userId}@device.locked-in.invalid`;
    const { error: updateError } = await admin.auth.admin.updateUserById(userId, { email, email_confirm: true });
    if (updateError) { console.error("pair: placeholder email failed", updateError.message); return unavailable(); }
  }
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (linkError || !link?.properties?.hashed_token) { console.error("pair: sign-in link failed", linkError?.message); return unavailable(); }
  return json({ token_hash: link.properties.hashed_token });
});
