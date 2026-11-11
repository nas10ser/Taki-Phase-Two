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

/**
 * تقنيعُ البريد — **مطابقٌ حرفياً** لـ`maskEmail` في `src/pages/Register.tsx`،
 * فما يراه المستخدمُ لا يتغيّر بانتقال الحساب إلى الخادم.
 */
function maskEmail(e: string): string {
  const [u, d] = String(e || "").split("@");
  if (!d) return e;
  return `${u.slice(0, 2)}${"•".repeat(Math.max(2, u.length - 2))}@${d}`;
}

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

  let phone = "", password = "", captchaToken = "", action = "login", otp = "", redirectTo = "";
  try {
    const body = await req.json();
    phone = String(body?.phone || "").trim();
    password = String(body?.password || "");
    captchaToken = String(body?.captchaToken || "");
    action = String(body?.action || "login");
    otp = String(body?.code || "").trim();
    redirectTo = String(body?.redirectTo || "");
  } catch {
    return json({ ok: false, error: "bad_body" }, 400);
  }
  if (!["login", "recover", "verify"].includes(action)) return json({ ok: false, error: "bad_action" }, 400);
  if (!phone) return json(DENIED, 400);
  if (action === "login" && !password) return json(DENIED, 400);
  if (action === "verify" && !otp) return json(DENIED, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: xff ? { "x-forwarded-for": xff } : {} },
  });

  // ── ١) حسمُ البريد بالخدمة. وحرّاسُ المعدّل داخل الدالّة ترفع استثناءً. ──
  let email: string | null = null;
  try {
    const { data, error } = await admin.rpc("taki_phone_login_gate", { p_phone: phone });
    if (error) {
      // 🪤 يُعرَف حدُّ المحاولات **برمزه** لا بنصّه: `taki_rate_check` ترفع
      //    `P0001` وتحمل `P0011` في `HINT` (رمزٌ واحدٌ يعبر PostgREST، والباقي
      //    يسافر في HINT). ومطابقةُ النصّ العربيّ تنكسر بأوّل تعديلِ صياغة —
      //    وهو عينُ الفخّ المسجَّل في هذا المشروع.
      const msg = String(error.message || "");
      const hint = String((error as { hint?: string }).hint || "");
      if (hint.includes("P0011") || /محاولات كثيرة/.test(msg)) {
        return json({ ok: false, error: "rate_limited", message: msg }, 429);
      }
      return json({ ok: false, error: "gate_failed" }, 503);   // ⇒ ارتدادٌ للمسار القديم
    }
    const e = (data as any)?.email;
    email = e ? String(e) : null;
  } catch {
    return json({ ok: false, error: "gate_failed" }, 503);
  }

  // ── ١ب) «نسيت كلمة المرور» بالجوّال — نفسُ التسريب، نفسُ العلاج ─────────
  // 🔴 كان المتصفّحُ يسأل `find_email_by_phone` هنا أيضاً فيصله البريدُ كاملاً،
  //    ثمّ **تُقنّعه الشاشةُ للعرض وحده** — والتقنيعُ في الشاشة لا يمنع من
  //    ينادي الدالّةَ مباشرةً. الآن: الخادمُ يُرسل الرسالة، ولا يعود للمتصفّح
  //    إلّا البريدُ **مُقنَّعاً** (وهو ما كان يُعرض أصلاً).
  // 🪤 وحالةُ «لا حساب» تبقى كما هي في سلوك الواجهة — تغييرُها قرارُ منتجٍ
  //    لا أمنٍ، وهو بندٌ مستقلٌّ بيد ناصر («رسالةُ الدخول تكشف وجود الحساب»).
  if (action === "recover") {
    if (!email) return json({ ok: true, found: false }, 200);
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
        method: "POST",
        headers: {
          "apikey": ANON_KEY,
          "Authorization": `Bearer ${ANON_KEY}`,
          "Content-Type": "application/json",
          ...(redirectTo ? { "redirect_to": redirectTo } : {}),
          ...(xff ? { "x-forwarded-for": xff } : {}),
        },
        body: JSON.stringify({
          email,
          ...(captchaToken ? { gotrue_meta_security: { captcha_token: captchaToken } } : {}),
        }),
      });
      if (res.status === 200) return json({ ok: true, found: true, masked: maskEmail(email) }, 200);
      const b = await res.json().catch(() => null);
      if (String(b?.error_code || "") === "captcha_failed") {
        return json({ ok: false, error: "captcha_failed", message: String(b?.msg || "") }, 400);
      }
      return json({ ok: false, error: "recover_failed" }, 503);   // ⇒ ارتدادٌ للمسار القديم
    } catch {
      return json({ ok: false, error: "recover_failed" }, 503);
    }
  }

  // ── ١ج) تحقّقُ رمز الاستعادة — بالجوّال، فلا يحتاج المتصفّحُ البريدَ أصلاً ─
  // 🔴 ولولا هذا الفرعِ لبقي التسريبُ مفتوحاً: الشاشةُ تحتاج البريدَ **بعد**
  //    الإرسال لتُدخل الرمز، فنقلُ الإرسال وحده لا يُغني.
  // 🪤 و`/verify` ليست من مسارات الكابتشا عند GoTrue (هي `/signup` و`/token`
  //    و`/recover` و`/resend`)، فالرمزُ يُمرَّر إن وُجد ولا يُشترط.
  if (action === "verify") {
    if (!email) return json(DENIED, 400);
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
        method: "POST",
        headers: {
          "apikey": ANON_KEY,
          "Authorization": `Bearer ${ANON_KEY}`,
          "Content-Type": "application/json",
          ...(xff ? { "x-forwarded-for": xff } : {}),
        },
        body: JSON.stringify({
          type: "recovery", email, token: otp,
          ...(captchaToken ? { gotrue_meta_security: { captcha_token: captchaToken } } : {}),
        }),
      });
      const b = await res.json().catch(() => null);
      if (res.status === 200 && b?.access_token && b?.refresh_token) {
        return json({ ok: true, session: b }, 200);
      }
      if (res.status >= 500) return json({ ok: false, error: "auth_unavailable" }, 503);
      return json({ ok: false, error: "bad_code" }, 400);
    } catch {
      return json({ ok: false, error: "auth_unreachable" }, 503);
    }
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
    // 🔴 v15.88 — تُسجَّل بلا أيّ بيانٍ شخصيّ. المفصلُ الوحيدُ غيرُ المقيس في
    //    هذا المسار هو قَبولُ Cloudflare لرمزٍ مرّ عبر الوسيط؛ وهذا العدّادُ
    //    يجعل الجوابَ مقروءاً من القاعدة بعد أوّل ساعةٍ من الاستعمال بدل
    //    انتظارِ بلاغٍ من مستخدم.
    try { await admin.rpc("taki_phone_login_mark", { p_kind: "captcha" }); } catch { /* لا يُفشل ردّاً */ }
    return json({ ok: false, error: "captcha_failed", message: String(gotrueBody?.msg || "") }, 400);
  }

  if (gotrueStatus === 200 && gotrueBody?.access_token && gotrueBody?.refresh_token && email) {
    // علامةٌ بلا أيّ بيانٍ شخصيّ: عدّادٌ يُثبت أن المسار عمل فعلاً.
    try { await admin.rpc("taki_phone_login_mark", { p_kind: "ok" }); } catch { /* لا يُفشل دخولاً ناجحاً */ }
    return json({ ok: true, session: gotrueBody }, 200);
  }

  // 🪤 و٥xx من GoTrue ليست «كلمةً خاطئة» — ولا هي سببٌ للارتداد: الطلبُ بلغ
  //    GoTrue فقد يكون رمزُ الكابتشا **أُنفق**، والارتدادُ حينها فشلٌ ثانٍ
  //    مؤكَّد. فالرمزُ `auth_unavailable` يقوله المتصفّحُ للمستخدم ولا يرتدّ،
  //    بخلاف `auth_unreachable` أعلاه (لم يبلغ GoTrue ⇒ الرمزُ سليم).
  if (gotrueStatus >= 500) return json({ ok: false, error: "auth_unavailable" }, 503);

  return json(DENIED, 400);
});
