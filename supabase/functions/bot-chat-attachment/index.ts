// bot-chat-attachment — مرفقات محادثة الطلب للبوتين (تيليجرام + واتساب) · v14.28
//
// لماذا دالة طرفية ولا يكفي نداءٌ عادي من البوت:
//   مستودع `chat` **خاصّ**، والبوت لا يملك إلا المفتاح العام. فهو لا يستطيع
//   أن يرفع فيه، ولا أن يوقّع رابط قراءة. والمفتاح الخدمي لا يجوز أن يسكن
//   خادم البوت (مستضاف خارجياً على Render). فتُوضع الصلاحية هنا، خلف السرّ
//   المشترك، ومحصورةً في فعلين اثنين لا ثالث لهما.
//
// نموذج الأمان (ولهذا verify_jwt=false مقبول هنا):
//   • السرّ `bot_gateway_secret` يعيش في `app_secrets` (RLS خدمي فقط) وفي بيئة
//     البوت وحدهما — لا في أي حزمة تصل المتصفّح. ويُقارن بمقارنة ثابتة الزمن.
//   • **كل فعل يتحقّق من العضوية**: هل هذا المستخدم مشتري هذا الحجز أو تاجره؟
//     بلا هذا يصير السرّ مفتاحاً لقراءة مرفقات كل المحادثات.
//   • التنزيل من مضيفَين مسموحَين فقط (تيليجرام وميتا) — فلا يمكن استدراج
//     الدالة لجلب عنوان داخلي.
//   • المسار يُبنى هنا دائماً `<barcode>/<uuid>.<ext>` ولا يُقبل من الطالب،
//     فلا يستطيع أحد أن يكتب في مجلّد محادثةٍ أخرى.

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
  return { mime: "image/jpeg", ext: "jpg" };
}

function hostAllowed(host: string): "telegram" | "whatsapp" | null {
  if (host === "api.telegram.org") return "telegram";
  if (host === "lookaside.fbsbx.com" || host.endsWith(".whatsapp.net") || host.endsWith(".fbsbx.com")) return "whatsapp";
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // v14.30 — نافذة تدوير: سرّان صالحان معاً حتى يُحدَّث متغيّر البيئة على
    // Render. قبولُ واحدٍ فقط هنا كان سيُسقط رفع الصور بينما بقيّة البوت تعمل،
    // وهو أسوأ من السقوط الكامل: عطبٌ جزئي لا يُلاحَظ.
    const { data: secretRows } = await admin
      .from("app_secrets").select("key,value")
      .in("key", ["bot_gateway_secret", "bot_gateway_secret_next"]);
    const provided = req.headers.get("x-bot-secret") || "";
    const accepted = (secretRows || [])
      .map((r: any) => String(r?.value || ""))
      .filter((v: string) => v.length > 0);
    let ok = false;
    for (const v of accepted) ok = timingSafeEqual(provided, v) || ok;
    if (!accepted.length || !ok) return json({ error: "unauthorized" }, 401);

    let body: any = {};
    try { body = await req.json(); } catch { /* ignore */ }
    const action: string = String(body?.action || "");
    const uid: string = String(body?.uid || "");
    const barcode: string = String(body?.barcode || "");
    if (!uid || !barcode) return json({ error: "uid_and_barcode_required" }, 400);

    // العضوية أولاً وقبل كل شيء — ولكل فعل على حدة.
    const { data: bk } = await admin
      .from("bookings").select("user_id, store_id").eq("barcode", barcode).maybeSingle();
    if (!bk) return json({ error: "booking_not_found" }, 404);
    if (bk.user_id !== uid && bk.store_id !== uid) return json({ error: "not_a_member" }, 403);

    // ── توقيع رابط قراءة مؤقّت ────────────────────────────────────────────
    if (action === "sign") {
      const path: string = String(body?.path || "");
      // المسار يجب أن يقع تحت مجلّد هذا الحجز — وإلا صار التوقيع بوابةً
      // لقراءة مرفقات محادثة أخرى بمجرّد أن تكون عضواً في أي حجز.
      if (!path || path.split("/")[0] !== barcode) return json({ error: "path_outside_booking" }, 400);
      const { data, error } = await admin.storage.from("chat").createSignedUrl(path, 900);
      if (error || !data?.signedUrl) return json({ error: "sign_failed" }, 500);
      return json({ success: true, url: data.signedUrl }, 200);
    }

    // ── رفع صورة وصلت من محادثة البوت ─────────────────────────────────────
    if (action === "upload") {
      const fileUrl: string = String(body?.file_url || "");
      const fetchAuth: string = String(body?.fetch_auth || "");
      if (!fileUrl) return json({ error: "file_url_required" }, 400);

      let parsed: URL;
      try { parsed = new URL(fileUrl); } catch { return json({ error: "bad_url" }, 400); }
      const kind = hostAllowed(parsed.hostname);
      if (parsed.protocol !== "https:" || !kind) return json({ error: "forbidden_host" }, 400);

      const headers: Record<string, string> = {};
      if (kind === "whatsapp" && fetchAuth) headers["Authorization"] = fetchAuth;
      const resp = await fetch(fileUrl, { headers });
      if (!resp.ok) return json({ error: "download_failed" }, 502);
      const bytes = new Uint8Array(await resp.arrayBuffer());
      // نفس سقف المستودع (٥ م.ب) — نرفضه هنا بدل أن ننزّل ثم يرفضه التخزين.
      if (bytes.length === 0 || bytes.length > 5 * 1024 * 1024) {
        return json({ error: "file_too_large_or_empty" }, 400);
      }

      const { mime, ext } = normaliseImageMime(parsed.pathname, resp.headers.get("content-type") || "");
      const path = `${barcode}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await admin.storage.from("chat").upload(path, bytes, {
        contentType: mime, upsert: false, cacheControl: "31536000",
      });
      if (upErr) return json({ error: "upload_failed: " + upErr.message }, 500);

      // المالك يُضبط صراحةً: الرفع بالمفتاح الخدمي يتركه فارغاً، ومع أن سياسة
      // القراءة لا تعتمد عليه، فالسجلّ الذي لا يقول من رفع الدليل سجلٌّ ناقص.
      await admin.from("objects").update({ owner: uid }).eq("bucket_id", "chat").eq("name", path)
        .then(() => {}, () => {});   // مخطّط storage غير مكشوف دائماً — فشلُه لا يُسقط الرفع

      return json({ success: true, path }, 200);
    }

    return json({ error: "unknown_action" }, 400);
  } catch (e) {
    return json({ error: "internal: " + ((e as Error)?.message || String(e)) }, 500);
  }
});
