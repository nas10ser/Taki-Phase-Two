/**
 * iap-notify — إشعاراتُ خادمِ أبل (ASSN v2) وقوقل (RTDN) عن حالة الاشتراكات.
 * ═══════════════════════════════════════════════════════════════════════════
 * هنا تُعرف التجديداتُ والإلغاءاتُ والانتهاءاتُ والاستردادات. وبلا هذه
 * الدالّة يبقى اشتراكٌ أُلغي **ظاهراً سارياً** حتى يومه الأخير، واشتراكٌ
 * استُردّ مالُه يظلّ مفتوحاً إلى الأبد.
 *
 * 🔴 الإشعارُ **مُحرِّضٌ لا دليل.** لا تُقرأ حالةٌ من جسمه إطلاقاً: يُستخرج
 *    منه مفتاحُ البحث وحده، ثمّ يُسأل خادمُ أبل أو قوقل بمفتاحنا، والردُّ
 *    هو الحقيقة. فسطحٌ عامٌّ يثق بما يُرسَل إليه = اشتراكٌ مجّانيٌّ لمن
 *    يعرف العنوان، أو إلغاءُ اشتراكِ تاجرٍ بطلبٍ واحد.
 *    🪤 وأوّلُ كتابةٍ لهذه الدالّة **خالفت هذا السطرَ نفسَه**: قرأت
 *       `expiresDate` من جسم الإشعار ومرّرته، فتجديدٌ مُلفَّقٌ لمفتاحٍ
 *       معروفٍ كان يُمدّد السجلّ. والوثيقةُ كانت صحيحةً والتنفيذُ خالفها —
 *       وهذا أخطرُ من وثيقةٍ خاطئة، لأن القارئَ يطمئنّ.
 *    🔴 وكشف الإصلاحُ عيباً أكبر مختبئاً خلفه: **التجديدُ الحقيقيُّ لم يكن
 *       يُمدّد الاشتراكَ إطلاقاً.** `taki_iap_sync` تمسّ `store_profiles` عند
 *       الانقطاع وحده، فكان تاجرٌ يُجدَّد شهرياً عند أبل وينتهي اشتراكُه
 *       عندنا بعد شهر. الآن الحالةُ السارية تمرّ على `taki_iap_apply`.
 *
 * 🔴 ويُجاب بـ٢٠٠ على ما لا نعرفه. أبل تُعيد الإرسال على مدى أيّام حتى تأخذ
 *    ٢٠٠، وقوقل تُعيده أسبوعاً ثمّ تُعطّل الاشتراكَ في Pub/Sub. فردُّ خطأٍ
 *    على إشعارٍ عن شراءٍ لا يخصّنا يُنتج عاصفةَ إعاداتٍ ثمّ تعطيلَ القناة
 *    كلِّها — فتضيع الإشعاراتُ الحقيقيّة. (نفسُ درس ٤٢٩ مع زد في v15.22.)
 *
 * 🪤 والسرُّ في المسار لا في معامل: `?k=` يظهر في سجلّات الوسائط، وتدويرُه
 *    يكسر كلَّ شيء. هنا ترويسةٌ مخصَّصة أو مقطعُ مسار — ويبقى الأمانُ
 *    الحقيقيّ أن المحتوى **يُعاد التحقّقُ منه** فكشفُ العنوان لا يمنح شيئاً.
 *
 * ⏳ ينتظر: IAP_NOTIFY_SECRET + نفسُ مفاتيح iap-verify.
 */

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { appleState, googleState, jwsPayload } from "../_shared/iap.ts";

const J = (b: unknown, s: number) =>
    new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });


Deno.serve(async (req) => {
    if (req.method !== "POST") return J({ error: "method_not_allowed" }, 405);
    try {
        const SECRET = Deno.env.get("IAP_NOTIFY_SECRET");
        if (!SECRET) return J({ error: "IAP_NOTIFY_NOT_CONFIGURED" }, 503);
        const got = req.headers.get("x-taki-iap-secret")
            || new URL(req.url).pathname.split("/").pop() || "";
        // مقارنةٌ ثابتةُ الزمن — فالمقارنةُ القاصرة تُسرّب السرَّ حرفاً حرفاً.
        const a = new TextEncoder().encode(got);
        const b = new TextEncoder().encode(SECRET);
        let diff = a.length ^ b.length;
        for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
        if (diff !== 0) return J({ error: "forbidden" }, 403);

        const URL_ = Deno.env.get("SUPABASE_URL")!;
        const admin = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        const body = await req.json().catch(() => ({}));

        let platform: "apple" | "google" | "" = "";
        let key = "", event = "";

        if (body?.signedPayload) {
            // ── أبل: يُستخرج المفتاحُ والحدثُ فقط ────────────────────────
            platform = "apple";
            const p = jwsPayload(String(body.signedPayload));
            event = String(p?.notificationType || "") + (p?.subtype ? `/${p.subtype}` : "");
            const txn = p?.data?.signedTransactionInfo
                ? jwsPayload(p.data.signedTransactionInfo) : {};
            const ren = p?.data?.signedRenewalInfo
                ? jwsPayload(p.data.signedRenewalInfo) : {};
            // 🪤 ويُفضَّل معرّفُ المعاملة الأحدث للبحث: خادمُ أبل يقبل أيَّ
            //    معاملةٍ في السلسلة ويردّ بالأصليّ، أمّا الأصليُّ وحده فقد
            //    يكون قديماً جداً في اشتراكٍ طويل.
            key = String(txn?.transactionId || txn?.originalTransactionId
                      || ren?.originalTransactionId || "");
        } else if (body?.message?.data) {
            // ── قوقل (Pub/Sub push) ─────────────────────────────────────
            platform = "google";
            const d = JSON.parse(atob(String(body.message.data).replace(/-/g, "+").replace(/_/g, "/")));
            const sub = d?.subscriptionNotification;
            if (!sub) return J({ ok: true, ignored: Object.keys(d || {}).join(",") }, 200);
            key = String(sub.purchaseToken || "");
            event = `GOOGLE_${sub.notificationType}`;
        } else {
            return J({ ok: true, ignored: "unrecognised_envelope" }, 200);
        }
        if (!key) return J({ ok: true, ignored: "no_purchase_key" }, 200);

        // ── والحقيقةُ تُسأل من خادم المتجر، لا تُقرأ من الإشعار ──────────
        let st;
        try {
            st = platform === "apple" ? await appleState(key) : await googleState(key);
        } catch (e) {
            const m = (e as Error)?.message || String(e);
            // 🪤 ويُطلب الإعادةُ بـ٥٠٣ لا يُجاب بـ٢٠٠: إشعارٌ لم نقدر على
            //    التحقّق منه إن أُجيب بنجاحٍ ضاع أبداً. وأبل تُعيد ثلاثةَ
            //    أيّامٍ وقوقل أسبوعاً — فالإعادةُ تنجح بعد ضبط المفاتيح.
            //    🪤 و٤٠٤ استثناء: معاملةٌ لا يعرفها خادمُ أبل لن يعرفها غداً.
            if (/404/.test(m)) return J({ ok: true, ignored: "unknown_at_store" }, 200);
            console.error("[iap-notify] lookup failed", { platform, event, m });
            return J({ error: m, retry: true }, 503);
        }

        let data: unknown, err: { message: string } | null = null;
        if (st.active) {
            // سارٍ ⇒ يُمدَّد فعلاً (وهذا ما ينقص التجديدَ الشهريّ).
            const r = await admin.rpc("taki_iap_apply", {
                p_store_id: null, p_platform: st.platform, p_product_id: st.productId,
                p_purchase_key: st.key, p_latest_txn: st.latest, p_expires_at: st.expires,
                p_environment: st.environment, p_auto_renew: st.autoRenew,
                p_event: event, p_raw: st.raw,
            });
            data = r.data; err = r.error;
            // شراءٌ بلا مالكٍ مسجَّل: لا إعادةَ تُصلحه — يربطه التاجرُ من التطبيق.
            if (!err && (data as any)?.error === "no_owner") {
                return J({ ok: true, ignored: "no_owner" }, 200);
            }
            if (!err && (data as any)?.error === "unmapped_product") {
                console.error("[iap-notify] معرّفُ منتَجٍ غيرُ مربوط", st.productId);
                return J({ ok: true, ignored: "unmapped_product", product: st.productId }, 200);
            }
        } else {
            const r = await admin.rpc("taki_iap_sync", {
                p_platform: st.platform, p_purchase_key: st.key, p_status: st.status,
                p_expires_at: st.expires, p_auto_renew: st.autoRenew,
                p_event: event, p_raw: st.raw,
            });
            data = r.data; err = r.error;
        }
        if (err) {
            console.error("[iap-notify] rpc failed", { platform, event, msg: err.message });
            return J({ error: "rpc_failed", retry: true }, 503);
        }
        return J({ ok: true, status: st.status, applied: data }, 200);
    } catch (e) {
        console.error("[iap-notify] error", (e as Error)?.message || e);
        return J({ ok: true, error_logged: true }, 200);
    }
});
