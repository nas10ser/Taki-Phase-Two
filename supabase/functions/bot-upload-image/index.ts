// bot-upload-image — lets the TAKI bot (Telegram + WhatsApp) attach product
// photos to deals without ever holding a service-role key itself.
//
// SECURITY MODEL (why verify_jwt=false is safe here):
//   - The bot is a trusted server, not an end user, so there is no Supabase JWT.
//     Instead the caller must present the shared secret in the x-bot-secret
//     header. That secret lives ONLY in app_secrets (service-role-only RLS) and
//     in the bot's server-side .env — never in any client bundle.
//   - We compare the header to the stored secret with a constant-time check.
//   - The function only DOWNLOADS from an allow-listed media host (Telegram's
//     file CDN, or WhatsApp/Meta's media CDN) and UPLOADS into the public
//     'deals' bucket. It cannot be coerced into fetching arbitrary internal URLs.
//
// v3 (WhatsApp parity): WhatsApp media URLs live on lookaside.fbsbx.com /
//   *.whatsapp.net and require an `Authorization: Bearer <WA token>` header to
//   download. We now accept an OPTIONAL `fetch_auth` body field used only as the
//   Authorization header when downloading, and allow-list the WA media hosts.
//   The Telegram path is byte-for-byte unchanged (api.telegram.org, no auth).
//
// v2 (mime hardening): the 'deals' bucket only allows image/* mime types, but
// the source CDN frequently serves photos as application/octet-stream. We ALWAYS
// normalise to a guaranteed-valid image mime before uploading.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-bot-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const json = (b: unknown, s: number) => new Response(JSON.stringify(b), { status: s, headers: CORS });

function timingSafeEqual(a: string, b: string): boolean {
  const ae = new TextEncoder().encode(a);
  const be = new TextEncoder().encode(b);
  if (ae.length !== be.length) return false;
  let diff = 0;
  for (let i = 0; i < ae.length; i++) diff |= ae[i] ^ be[i];
  return diff === 0;
}

function normaliseImageMime(urlPath: string, ctHeader: string): { mime: string; ext: string } {
  const ext = (urlPath.split(".").pop() || "").toLowerCase();
  const ct = (ctHeader || "").toLowerCase();
  if (ext === "png"  || ct.includes("png"))  return { mime: "image/png",  ext: "png" };
  if (ext === "webp" || ct.includes("webp")) return { mime: "image/webp", ext: "webp" };
  if (ext === "gif"  || ct.includes("gif"))  return { mime: "image/gif",  ext: "gif" };
  return { mime: "image/jpeg", ext: "jpg" };
}

// Allow-list: Telegram CDN (no auth) and WhatsApp/Meta media CDN (auth required).
function hostAllowed(host: string): "telegram" | "whatsapp" | null {
  if (host === "api.telegram.org") return "telegram";
  if (host === "lookaside.fbsbx.com" || host.endsWith(".whatsapp.net") || host.endsWith(".fbsbx.com")) return "whatsapp";
  return null;
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

    const { data: secretRow } = await admin
      .from("app_secrets").select("value").eq("key", "bot_gateway_secret").maybeSingle();
    const expected = secretRow?.value || "";
    const provided = req.headers.get("x-bot-secret") || "";
    if (!expected || !timingSafeEqual(provided, expected)) {
      return json({ error: "unauthorized" }, 401);
    }

    let body: any = {};
    try { body = await req.json(); } catch { /* ignore */ }
    const fileUrl: string = typeof body?.file_url === "string" ? body.file_url : "";
    const fetchAuth: string = typeof body?.fetch_auth === "string" ? body.fetch_auth : "";
    if (!fileUrl) return json({ error: "file_url required" }, 400);

    let parsed: URL;
    try { parsed = new URL(fileUrl); } catch { return json({ error: "bad url" }, 400); }
    const kind = hostAllowed(parsed.hostname);
    if (parsed.protocol !== "https:" || !kind) {
      return json({ error: "forbidden host" }, 400);
    }

    // Download. WhatsApp media needs the bearer token; Telegram needs none.
    const headers: Record<string, string> = {};
    if (kind === "whatsapp" && fetchAuth) headers["Authorization"] = fetchAuth;
    const resp = await fetch(fileUrl, { headers });
    if (!resp.ok) return json({ error: "download failed" }, 502);
    const bytes = new Uint8Array(await resp.arrayBuffer());
    if (bytes.length === 0 || bytes.length > 8 * 1024 * 1024) {
      return json({ error: "file too large or empty" }, 400);
    }

    const { mime, ext } = normaliseImageMime(parsed.pathname, resp.headers.get("content-type") || "");
    const rand = crypto.randomUUID().replace(/-/g, "").slice(0, 14);
    const path = `bot/${Date.now()}_${rand}.${ext}`;
    // v14.14 — ترويسة تخزين سنة كاملة. 🪤 بدونها يقع الملف على `no-cache`،
    // فيُعاد تحميل نفس الصورة من الخادم في كل فتحة للتطبيق. (مقيس: ١٧٢ ملفاً
    // بـ`no-cache` مجموعها ١٣٢ ميجابايت، مقابل ١٨ ملفاً فقط بترويسة سنة.)
    // الأسماء فريدة و`upsert:false`، فالتخزين الطويل آمن بلا احتمال بيات.
    const { error: upErr } = await admin.storage.from("deals").upload(path, bytes, {
      contentType: mime, upsert: false, cacheControl: "31536000",
    });
    if (upErr) return json({ error: "upload failed: " + upErr.message }, 500);

    const { data: pub } = admin.storage.from("deals").getPublicUrl(path);

    // v14.14 — توأم مصغّر بجوار الأصل (٦٠٠ بكسل) كما يفعل رفع الموقع تماماً،
    // نولّده من خدمة التصغير على الخادم نفسه. ونُعلّم الرابط بـ`t=1` **فقط**
    // بعد نجاح رفع المصغّرة فعلاً — التطبيق لا يطلب مصغّرة إلا بهذه العلامة،
    // فعلامةٌ كاذبة تعني صورة مكسورة للحظة في كل بطاقة (درس v13.71).
    let url = pub.publicUrl;
    try {
      const stem = path.replace(/\.[A-Za-z0-9]+$/, "");
      const rendered = await fetch(
        `${SUPABASE_URL}/storage/v1/render/image/public/deals/${path}?width=600&quality=70`,
      );
      if (rendered.ok) {
        const thumbBytes = new Uint8Array(await rendered.arrayBuffer());
        if (thumbBytes.length > 500) {
          const { error: tErr } = await admin.storage.from("deals").upload(
            `${stem}_t.jpg`, thumbBytes,
            { contentType: "image/jpeg", upsert: true, cacheControl: "31536000" },
          );
          if (!tErr) url += (url.includes("?") ? "&" : "?") + "t=1";
        }
      }
    } catch { /* المصغّرة تحسينٌ لا شرط — الأصل مرفوع ويعمل */ }

    return json({ success: true, url }, 200);
  } catch (e) {
    return json({ error: "internal: " + ((e as Error)?.message || String(e)) }, 500);
  }
});
