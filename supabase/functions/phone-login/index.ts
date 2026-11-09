/**
 * phone-login — الدخولُ بالجوّال يُحسم على الخادم (v15.86)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 **لماذا وُجدت:** كان المتصفّحُ ينادي `find_email_by_phone` **قبل** كلمةِ
 *    المرور ليحسم البريد، والدالّةُ ممنوحةٌ لـ`anon` — فمن يعرف رقمَ جوّالِ
 *    عميلٍ يعرف بريدَه. والبديلُ الظاهر (دخولُ GoTrue بالجوّال مباشرةً)
 *    **مستحيلٌ هنا**، قِيس في بيئة الحاوية:
 *      GOTRUE_EXTERNAL_PHONE_ENABLED=false · GOTRUE_SMS_AUTOCONFIRM=false
 *    وفتحُه يستلزم مزوّدَ رسائل ومسارات OTP كاملة.
 *    ⇒ البريدُ يُحسم هنا بالخدمة، ولا يراه المتصفّحُ إلّا إن صحّت الكلمة.
 *
 * 🔒 **`verify_jwt=false` صحيحٌ هنا**: الدخولُ لا يحمل توكناً بعد (نفسُ
 *    `telegram-auth`). والحراسةُ: حرّاسُ المعدّل في القاعدة + الكابتشا عند
 *    GoTrue + ردٌّ **واحدٌ لا يُفرّق** بين «رقمٌ غير مسجَّل» و«كلمةٌ خاطئة».
 *
 * 🪤 **`x-forwarded-for` تُمرَّر حرفياً — ولا تُحسب هنا.** `_taki_client_ip()`
 *    تعدّ من **آخر** الترويسة لا أوّلها (أوّلُها يُزوَّره العميل)، وGoTrue يأخذ
 *    أوّلَها ويُرسلها إلى Cloudflare مع رمز الكابتشا. فأيُّ «تنظيفٍ» هنا يُغيّر
 *    ما يصل الطرفين ⇒ دلوُ معدّلٍ خاطئ أو كابتشا مرفوضة. التمريرُ الحرفيُّ
 *    يُبقي ما يراه الطرفان **مطابقاً لما يريانه اليوم** بالضبط.
 *    🪤 ولو حُسب العنوانُ هنا لصار كلُّ المستخدمين في دلوٍ واحد (عنوانُ
 *       الحاوية) ⇒ ١٥ محاولةً في الساعة **للعالم كلّه**.
 *
 * 🪤 **وتُنادى GoTrue في الحالتين** — ولو لم يُعثر على بريد. فبلا ذلك يصير
 *    زمنُ الردّ واستهلاكُ رمز الكابتشا **عرّافَين** عن وجود الحساب، وهو عينُ
 *    ما جئنا نُغلقه.
 *
 * 🔇 ولا تُسجَّل كلمةُ المرور ولا البريدُ ولا الرقمُ في أيّ سجلّ.
 */

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const json = (b: unknown, s: number) => new Response(JSON.stringify(b), { status: s, headers: CORS });

/** ردٌّ واحدٌ لكلّ فشلٍ في الاعتماد — لا يُفرّق بين رقمٍ مجهولٍ وكلمةٍ خاطئة. */
const DENIED = { ok: false, error: "invalid_credentials" };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  if (!SUPABASE_URL || !SERVICE_ROLE || !ANON_KEY) {
    // 5xx عمداً: المتصفّحُ يرتدّ إلى المسار القديم، ورمزُ الكابتشا لم يُستهلك.
    return json({ ok: false, error: "not_configured" }, 503);
  }

  // الترويسةُ كما وصلت — حرفياً (انظر الفخَّ أعلاه).
  const xff = req.headers.get("x-forwarded-for") || "";

  let phone = "", password = "", captchaToken = "";
  try {
    const body = await req.json();
    phone = String(body?.phone || "").trim();
    password = String(body?.password || "");
    captchaToken = String(body?.captchaToken || "");
  } catch {
    return json({ ok: false, error: "bad_body" }, 400);
  }
  if (!phone || !password) return json(DENIED, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: xff ? { "x-forwarded-for": xff } : {} },
  });

  // ── ١) حسمُ البريد بالخدمة. وحرّاسُ المعدّل داخل الدالّة ترفع استثناءً. ──
  let email: string | null = null;
  try {
    const { data, error } = await admin.rpc("taki_phone_login_gate", { p_phone: phone });
    if (error) {
      // رسالةُ حدّ المحاولات عربيّةٌ مكتوبةٌ للمستخدم — تُمرَّر كما هي.
      const msg = String(error.message || "");
      if (/محاولات كثيرة|rate/i.test(msg)) return json({ ok: false, error: "rate_limited", message: msg }, 429);
      return json({ ok: false, error: "gate_failed" }, 503);   // ⇒ ارتدادٌ للمسار القديم
    }
    const e = (data as any)?.email;
    email = e ? String(e) : null;
  } catch {
    return json({ ok: false, error: "gate_failed" }, 503);
  }

  // ── ٢) تُنادى GoTrue في الحالتين — بريدٌ لا يوجد حين لا يُعثر على حساب ───
  //    🪤 نطاقُ `.invalid` محجوزٌ بـRFC 2606 فلا يملكه أحد، والعنوانُ عشوائيٌّ
  //       فلا يُنشئ دلوَ معدّلٍ ثابتاً عند GoTrue.
  const probeEmail = `${crypto.randomUUID()}@no-such-account.invalid`;
  const target = email || probeEmail;

  let gotrueStatus = 500;
  let gotrueBody: any = null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        "apikey": ANON_KEY,
        "Authorization": `Bearer ${ANON_KEY}`,
        "Content-Type": "application/json",
        ...(xff ? { "x-forwarded-for": xff } : {}),
      },
      body: JSON.stringify({
        email: target,
        password,
        ...(captchaToken ? { gotrue_meta_security: { captcha_token: captchaToken } } : {}),
      }),
    });
    gotrueStatus = res.status;
    gotrueBody = await res.json().catch(() => null);
  } catch {
    return json({ ok: false, error: "auth_unreachable" }, 503);   // ⇒ ارتدادٌ للمسار القديم
  }

  // ── ٣) الكابتشا تُفرَّق عمداً: الواجهةُ تحتاج تجديدَ الرمز (يُستهلك مرّة) ─
  const code = String(gotrueBody?.error_code || "");
  if (code === "captcha_failed") {
    return json({ ok: false, error: "captcha_failed", message: String(gotrueBody?.msg || "") }, 400);
  }

  if (gotrueStatus === 200 && gotrueBody?.access_token && gotrueBody?.refresh_token && email) {
    // علامةٌ بلا أيّ بيانٍ شخصيّ: عدّادٌ يُثبت أن المسار عمل فعلاً.
    try { await admin.rpc("taki_phone_login_mark"); } catch { /* لا يُفشل دخولاً ناجحاً */ }
    return json({ ok: true, session: gotrueBody }, 200);
  }

  // 🪤 و٥xx من GoTrue ليست «كلمةً خاطئة»: تُعاد ٥٠٣ ليرتدّ المتصفّحُ ولا
  //    يُقال للمستخدم «بياناتك خاطئة» وهي صحيحة.
  if (gotrueStatus >= 500) return json({ ok: false, error: "auth_unavailable" }, 503);

  return json(DENIED, 400);
});
