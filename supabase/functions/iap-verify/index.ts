/**
 * iap-verify — يتحقّق من شراءٍ داخل التطبيق ثمّ يُفعّل الاشتراك.
 * ═══════════════════════════════════════════════════════════════════════════
 * يُنادى من التطبيق بعد نجاح الشراء في متجر أبل أو قوقل، وعند «استعادة
 * المشتريات». ولا يُفعّل شيئاً بما يقوله التطبيق: يسأل خادمَ المتجر نفسَه.
 *
 * 🔴 الحراسة: خادمُ الدوال عندنا `FUNCTIONS_VERIFY_JWT=false` — فكلُّ سطحٍ
 *    جديد يبدأ **بلا أيّ حماية** ويبني حارسَه بنفسه. وهنا حارسان:
 *      ١) توكنُ المستخدم يُتحقَّق منه ويُستخرج منه `store_id` — فالشراءُ
 *         يُنسَب إلى **صاحب التوكن** لا إلى معرّفٍ في جسم الطلب. ولو قُبل
 *         المعرّفُ من الجسم لأسند تاجرٌ شراءَه إلى متجر غيره أو العكس.
 *      ٢) و`user_type` يُقرأ من **الجدول** لا من مطالبات التوكن.
 *
 * 🔴 ولا تُقرأ حالةُ الاشتراك من الإيصال الذي يُرسله التطبيق: الإيصالُ
 *    **مِفتاحُ بحثٍ** لا مصدرَ حقيقة. تُستخرج منه هويّةُ المعاملة، ثمّ تُسأل
 *    أبل أو قوقل عن حالتها. فإيصالٌ قديمٌ أو معدَّلٌ أو من جهازٍ مُعدَّل لا
 *    يُنتج اشتراكاً — ومن يملك جهازاً مكسورَ الحماية يملك تعديلَ أيّ إيصال.
 *
 * 🪤 ولا يُهندَس توقيعُ أبل يدوياً هنا. إشعاراتُ أبل تأتي JWS موقَّعةً بسلسلة
 *    شهاداتٍ في ترويستها، والتحقّقُ الصحيح يلزمه تتبّعُ السلسلة إلى جذر أبل
 *    بتحليل X.509 — وكودُ تشفيرٍ لا أستطيع تجربته على بياناتٍ حقيقيّة أسوأُ
 *    من لا كود (يمرّ ما يجب أن يُرفض، ولا يظهر العيبُ إلا في حادثة).
 *    فالنمطُ المستعمل هنا هو الموصى به عند أبل نفسِها: الإشعارُ **مُحرِّضٌ**
 *    لا دليل — يُستخرج منه `transactionId` ثمّ يُسأل خادمُ أبل بمفتاحنا،
 *    والردُّ هو الحقيقة.
 *
 * ⏳ وما ينتظر حسابَي المتجرين (لا شيءَ تقنيٌّ غيره):
 *      APPLE_IAP_KEY_P8 · APPLE_IAP_KEY_ID · APPLE_IAP_ISSUER_ID · APPLE_BUNDLE_ID
 *      GOOGLE_PLAY_SA_JSON · GOOGLE_PLAY_PACKAGE
 *    وبغيابها تردّ الدالّةُ رمزاً صريحاً (`IAP_APPLE_NOT_CONFIGURED`) ولا
 *    تُفعّل شيئاً — **تفشل مغلقة**.
 */

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { appleState, googleState, jwsPayload } from "../_shared/iap.ts";

const CORS: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
};
const json = (b: unknown, s: number) => new Response(JSON.stringify(b), { status: s, headers: CORS });

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

    try {
        const URL_ = Deno.env.get("SUPABASE_URL")!;
        const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

        // ── حارسٌ ١: هويّةُ المنادي من توكنه، لا من جسم الطلب ──────────────
        const auth = req.headers.get("Authorization") || "";
        if (!auth.startsWith("Bearer ")) return json({ error: "not_authenticated" }, 401);
        const asUser = createClient(URL_, ANON, { global: { headers: { Authorization: auth } } });
        const { data: who, error: whoErr } = await asUser.auth.getUser();
        if (whoErr || !who?.user?.id) return json({ error: "not_authenticated" }, 401);
        const storeId = who.user.id;

        const admin = createClient(URL_, SR);
        // ── حارسٌ ٢: الدورُ من الجدول لا من مطالبات التوكن ─────────────────
        const { data: row } = await admin.from("users")
            .select("user_type, deleted_at").eq("id", storeId).maybeSingle();
        if (!row || row.deleted_at || !["seller", "admin"].includes(String(row.user_type))) {
            return json({ error: "not_a_merchant" }, 403);
        }

        const body = await req.json().catch(() => ({}));
        const platform = String(body?.platform || "");
        if (platform !== "apple" && platform !== "google") {
            return json({ error: "bad_platform" }, 400);
        }

        // ── الحقيقةُ من خادم المتجر، لا من جسم الطلب ──────────────────
        let st;
        if (platform === "apple") {
            let txn = String(body?.transactionId || "");
            if (!txn && body?.jws) {
                try { txn = String(jwsPayload(String(body.jws))?.transactionId || ""); } catch { /* */ }
            }
            if (!txn) return json({ error: "missing_transaction_id" }, 400);
            st = await appleState(txn);
        } else {
            const token = String(body?.purchaseToken || "");
            if (!token) return json({ error: "missing_purchase_token" }, 400);
            st = await googleState(token);
        }
        if (!st.active) return json({ error: "not_active", status: st.status }, 409);

        if (!st.productId) return json({ error: "no_product_id" }, 502);

        const { data: applied, error: rpcErr } = await admin.rpc("taki_iap_apply", {
            p_store_id: storeId, p_platform: st.platform, p_product_id: st.productId,
            p_purchase_key: st.key, p_latest_txn: st.latest, p_expires_at: st.expires,
            p_environment: st.environment, p_auto_renew: st.autoRenew,
            p_event: "VERIFY", p_raw: st.raw,
        });
        if (rpcErr) return json({ error: "apply_failed", detail: rpcErr.message }, 500);
        return json(applied, applied?.success ? 200 : 409);
    } catch (e) {
        const m = (e as Error)?.message || String(e);
        // 🪤 وتُعاد الرموزُ كما هي: «غير مضبوط» ليس «فشل التحقّق»، والخلطُ
        //    بينهما يُرسل ناصراً يبحث عن عيبٍ حيث لا عيب.
        const status = m.startsWith("IAP_") && m.endsWith("NOT_CONFIGURED") ? 503 : 502;
        return json({ error: m }, status);
    }
});
