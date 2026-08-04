// telegram-auth — verifies the Telegram Mini App initData signature, then either
// (mode 'login') logs in the Telegram-keyed account, or (mode 'link') binds this
// Telegram identity to the already-signed-in account.
//
// IMPORTANT (v11.71): mode 'login' is LOGIN-ONLY by default — it NEVER silently
// creates an account. If no account is linked to this telegram_id it returns
// { exists:false } so the app can offer a real choice (sign in to an existing
// account, or create a new one). An account is created ONLY when the caller
// explicitly passes allowCreate:true (the user tapped "create new via Telegram").
// This fixes the forced-new-account bug: a user who already has a TAKI account
// was being auto-registered as a separate Telegram buyer with no chance to log in.
//
// Robust verification: Telegram's initData format evolved (it now also ships a
// separate `signature` field, and value-encoding can be read more than one way).
// We therefore try every known-correct construction of the data-check-string and
// accept if ANY of them matches the HMAC. This is SAFE — every strategy still
// requires the bot's derived secret, so a forged request matches none of them.
// The matching strategy (or 'none') is recorded in tg_link_debug for diagnosis.
//
// verify_jwt=false is safe: login has no JWT yet (identity comes from the signed
// initData); link validates the caller JWT manually via admin.auth.getUser.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const json = (b: unknown, s: number) => new Response(JSON.stringify(b), { status: s, headers: CORS });

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}
async function hmacHex(keyBytes: Uint8Array, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function dec(v: string): string { try { return decodeURIComponent(v); } catch { return v; } }
function decPlus(v: string): string { try { return decodeURIComponent(v.replace(/\+/g, "%20")); } catch { return v; } }

// Try every known data-check-string construction; accept on first HMAC match.
async function verifyInitData(initData: string, secretKey: Uint8Array) {
  const usp = new URLSearchParams(initData);
  const recvHash = usp.get("hash") || "";
  const rawPairs: [string, string][] = initData.split("&").map((s) => {
    const i = s.indexOf("=");
    return i < 0 ? [s, ""] : [s.slice(0, i), s.slice(i + 1)];
  });
  const decoders: Array<[string, (v: string) => string]> = [["dec", dec], ["plus", decPlus], ["raw", (v) => v]];
  for (const exclSig of [true, false]) {
    for (const [dname, dfn] of decoders) {
      const dcs = rawPairs
        .filter(([k]) => k && k !== "hash" && !(exclSig && k === "signature"))
        .map(([k, v]) => [k, dfn(v)] as [string, string])
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        .map(([k, v]) => `${k}=${v}`)
        .join("\n");
      const computed = await hmacHex(secretKey, dcs);
      if (recvHash && computed === recvHash) {
        return { ok: true, recvHash, params: usp, strategy: `${exclSig ? "noSig" : "sig"}/${dname}` };
      }
    }
  }
  return { ok: false, recvHash, params: usp, strategy: "none" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let body: any = {};
    try { body = await req.json(); } catch { /* ignore */ }
    const initData: string = typeof body?.initData === "string" ? body.initData : "";
    const mode: string = body?.mode === "link" ? "link" : "login";
    // Login NEVER creates an account unless the caller explicitly opts in.
    const allowCreate: boolean = body?.allowCreate === true;
    if (!initData) return json({ error: "initData required" }, 400);

    const { data: secretRow, error: secErr } = await admin
      .from("app_secrets").select("value").eq("key", "telegram_secret_key").maybeSingle();
    if (secErr || !secretRow?.value) return json({ error: "server not configured" }, 500);
    const secretKey = hexToBytes(secretRow.value);

    const v = await verifyInitData(initData, secretKey);
    const callerPresent = !!req.headers.get("Authorization");
    try {
      await admin.from("tg_link_debug").insert({
        mode,
        keys: [...v.params.keys()].sort().join(","),
        has_signature: v.params.has("signature"),
        strategy: v.strategy,
        recv_hash_prefix: (v.recvHash || "").slice(0, 10),
        caller_present: callerPresent,
        outcome: v.ok ? "verified" : "bad_signature",
      });
    } catch { /* diagnostics are best-effort */ }

    if (!v.ok) return json({ error: "invalid signature" }, 401);
    const params = v.params;

    const authDate = parseInt(params.get("auth_date") || "0", 10);
    if (!authDate || Math.floor(Date.now() / 1000) - authDate > 86400) {
      return json({ error: "expired — reopen the app" }, 401);
    }

    let tgUser: any = {};
    try { tgUser = JSON.parse(params.get("user") || "{}"); } catch { /* ignore */ }
    const telegramId = Number(tgUser?.id);
    if (!telegramId || !Number.isFinite(telegramId)) return json({ error: "no telegram user" }, 400);
    const displayName = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(" ").trim()
      || tgUser.username || "مستخدم تيليجرام";

    // ── mode 'link' — bind this Telegram identity to the signed-in account ──
    if (mode === "link") {
      const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
      let callerId: string | null = null;
      if (jwt) {
        try { const { data: c } = await admin.auth.getUser(jwt); callerId = c?.user?.id || null; }
        catch { callerId = null; }
      }
      if (!callerId) return json({ success: false, code: "not_authenticated" }, 200);
      await admin.from("users").update({ telegram_id: null, telegram_chat_id: null })
        .or(`telegram_id.eq.${telegramId},telegram_chat_id.eq.${telegramId}`).neq("id", callerId);
      const { error: uErr } = await admin.from("users")
        .update({ telegram_id: telegramId, telegram_chat_id: telegramId, notify_via_telegram: true })
        .eq("id", callerId);
      if (uErr) return json({ success: false, error: "link_failed: " + uErr.message }, 500);
      return json({ success: true, linked: true, telegram_id: telegramId, name: displayName }, 200);
    }

    // ── mode 'login' — find this Telegram identity's account ──
    const syntheticEmail = `tg${telegramId}@telegram.taki.app`;
    let email: string | null = null;
    let userId: string | null = null;
    let isNew = false;

    const { data: existing } = await admin
      .from("users").select("id").eq("telegram_id", telegramId).maybeSingle();

    if (existing?.id) {
      userId = existing.id;
      const { data: au } = await admin.auth.admin.getUserById(userId);
      email = au?.user?.email || syntheticEmail;
      if (!au?.user?.email) {
        await admin.auth.admin.updateUserById(userId, { email: syntheticEmail, email_confirm: true });
        email = syntheticEmail;
      }
    } else if (!allowCreate) {
      // LOGIN-ONLY: no linked account for this telegram_id → do NOT create one.
      // The client shows the choice screen (sign in to an existing account, or
      // explicitly create a new one with allowCreate:true).
      return json({ exists: false }, 200);
    } else {
      email = syntheticEmail;
      const password = crypto.randomUUID() + crypto.randomUUID();
      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: { telegram_id: telegramId, name: displayName, source: "telegram" },
      });
      if (cErr || !created?.user) return json({ error: "could not create account: " + (cErr?.message || "") }, 500);
      userId = created.user.id;
      isNew = true;
      const { error: pErr } = await admin.from("users").upsert({
        id: userId, name: displayName, user_type: "buyer",
        telegram_id: telegramId, telegram_chat_id: telegramId, notify_via_telegram: true,
      }, { onConflict: "id" });
      if (pErr) {
        await admin.auth.admin.deleteUser(userId).catch(() => {});
        return json({ error: "could not link profile: " + pErr.message }, 500);
      }
    }

    const { data: link, error: lErr } = await admin.auth.admin.generateLink({
      type: "magiclink", email: email!,
    });
    if (lErr || !link?.properties?.hashed_token) {
      return json({ error: "could not start session: " + (lErr?.message || "") }, 500);
    }

    return json({
      hashed_token: link.properties.hashed_token,
      isNew,
      user: { id: userId, name: displayName, userType: "buyer" },
    }, 200);
  } catch (e) {
    return json({ error: "internal: " + ((e as Error)?.message || String(e)) }, 500);
  }
});
