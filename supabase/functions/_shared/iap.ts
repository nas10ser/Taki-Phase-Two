/**
 * _shared/iap.ts — سؤالُ خادمَي أبل وقوقل عن حالة اشتراك. **موضعٌ واحد.**
 * ═══════════════════════════════════════════════════════════════════════════
 * تستعملها `iap-verify` (بعد الشراء) و`iap-notify` (عند كل إشعار).
 *
 * 🔴 ولماذا موضعٌ واحد: نسختان تنحرفان. أوّلُ كتابةٍ قرأت `iap-notify`
 *    تاريخَ الانتهاء **من جسم الإشعار** بينما وثيقتُها تقول «الإشعارُ
 *    مُحرِّضٌ لا دليل» — فتجديدٌ مُلفَّقٌ لمفتاحٍ معروف كان يُمدّد السجلّ.
 *    وبموضعٍ واحدٍ لا يمكن لأحد المسارين أن ينسى السؤال.
 *
 * 🪤 ولا تُستعمل `jwsPayload` كمصدرِ حقيقةٍ أبداً — هي لاستخراج **مفتاح
 *    البحث** وحده. التحقّقُ من توقيع JWS يلزمه تتبّعُ سلسلة شهادات X.509
 *    إلى جذر أبل، وكودُ تشفيرٍ لا يمكن تجربتُه على بياناتٍ حقيقيّة أسوأُ من
 *    لا كود. والنمطُ هنا هو الموصى به عند أبل: اسأل خادمَها بمفتاحك.
 */

// deno-lint-ignore-file no-explicit-any
/** يفكّ جسمَ JWS بلا تحقّق — لاستخراج مفتاح البحث وحده، لا للثقة به. */
export function jwsPayload(jws: string): any {
    const p = jws.split(".");
    if (p.length !== 3) throw new Error("JWS_MALFORMED");
    const b = p[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(b + "=".repeat((4 - (b.length % 4)) % 4)));
}

/** توكنُ أبل: ES256 موقَّعٌ بمفتاح .p8 — صلاحيّتُه ساعةٌ عند أبل. */
export async function appleToken(): Promise<string> {
    const p8 = Deno.env.get("APPLE_IAP_KEY_P8");
    const kid = Deno.env.get("APPLE_IAP_KEY_ID");
    const iss = Deno.env.get("APPLE_IAP_ISSUER_ID");
    const bid = Deno.env.get("APPLE_BUNDLE_ID");
    if (!p8 || !kid || !iss || !bid) throw new Error("IAP_APPLE_NOT_CONFIGURED");

    const der = Uint8Array.from(
        atob(p8.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")),
        (c) => c.charCodeAt(0),
    );
    const key = await crypto.subtle.importKey(
        "pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"],
    );
    const now = Math.floor(Date.now() / 1000);
    const enc = (o: unknown) =>
        btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const head = enc({ alg: "ES256", kid, typ: "JWT" });
    const body = enc({ iss, iat: now, exp: now + 1500, aud: "appstoreconnect-v1", bid });
    const sig = await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" }, key,
        new TextEncoder().encode(`${head}.${body}`),
    );
    const s = btoa(String.fromCharCode(...new Uint8Array(sig)))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return `${head}.${body}.${s}`;
}

/**
 * يسأل خادمَ أبل عن معاملةٍ بعينها. و**يُجرَّب الإنتاجُ ثمّ الاختبار**:
 * 🪤 لا توجد طريقةٌ لمعرفة البيئة من الإيصال وحده بيقين، وأبل تردّ 404 على
 *    معاملةِ اختبارٍ سُئل عنها خادمُ الإنتاج. فالترتيبُ إنتاجٌ أوّلاً كي لا
 *    يُقبل شراءُ اختبارٍ في الإنتاج إلّا بعد أن يفشل الإنتاجُ فعلاً.
 */
export async function appleLookup(txnId: string): Promise<{ data: any; env: string }> {
    const tok = await appleToken();
    const hosts: [string, string][] = [
        ["https://api.storekit.itunes.apple.com", "Production"],
        ["https://api.storekit-sandbox.itunes.apple.com", "Sandbox"],
    ];
    let last = "";
    for (const [host, env] of hosts) {
        const r = await fetch(`${host}/inApps/v1/transactions/${encodeURIComponent(txnId)}`, {
            headers: { Authorization: `Bearer ${tok}` },
        });
        if (r.ok) {
            const body = await r.json();
            if (!body?.signedTransactionInfo) throw new Error("APPLE_NO_TXN_INFO");
            return { data: jwsPayload(body.signedTransactionInfo), env };
        }
        last = `${env}:${r.status}`;
        if (r.status !== 404) break;
    }
    throw new Error(`APPLE_LOOKUP_FAILED:${last}`);
}

/** توكنُ قوقل: JWT موقَّعٌ بمفتاح حساب الخدمة ثمّ يُبدَّل بتوكن وصول. */
export async function googleToken(): Promise<string> {
    const raw = Deno.env.get("GOOGLE_PLAY_SA_JSON");
    if (!raw) throw new Error("IAP_GOOGLE_NOT_CONFIGURED");
    const sa = JSON.parse(raw);
    const der = Uint8Array.from(
        atob(String(sa.private_key).replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")),
        (c) => c.charCodeAt(0),
    );
    const key = await crypto.subtle.importKey(
        "pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
    );
    const now = Math.floor(Date.now() / 1000);
    const enc = (o: unknown) =>
        btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const head = enc({ alg: "RS256", typ: "JWT" });
    const body = enc({
        iss: sa.client_email, scope: "https://www.googleapis.com/auth/androidpublisher",
        aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3500,
    });
    const sig = await crypto.subtle.sign(
        "RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${body}`),
    );
    const assertion = `${head}.${body}.` + btoa(String.fromCharCode(...new Uint8Array(sig)))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const r = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion,
        }),
    });
    if (!r.ok) throw new Error(`GOOGLE_TOKEN_FAILED:${r.status}`);
    return (await r.json()).access_token;
}

export async function googleLookup(token: string): Promise<any> {
    const pkg = Deno.env.get("GOOGLE_PLAY_PACKAGE");
    if (!pkg) throw new Error("IAP_GOOGLE_NOT_CONFIGURED");
    const at = await googleToken();
    const r = await fetch(
        `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/`
        + `${encodeURIComponent(pkg)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(token)}`,
        { headers: { Authorization: `Bearer ${at}` } },
    );
    if (!r.ok) throw new Error(`GOOGLE_LOOKUP_FAILED:${r.status}`);
    return await r.json();
}

/**
 * الحالةُ الموحَّدة لأي منصّة — تُسأل من خادم المتجر دائماً.
 * `key` هو المفتاحُ الثابت الذي لا يتغيّر مع التجديد.
 */
export interface IapState {
    platform: "apple" | "google";
    productId: string;
    key: string;
    latest: string;
    expires: string | null;
    environment: string;
    autoRenew: boolean;
    active: boolean;
    status: string;
    raw: any;
}

/** أبل: `transactionId` أيُّ معاملةٍ في السلسلة — الردُّ يحمل الأصليّ. */
export async function appleState(txnId: string): Promise<IapState> {
    const { data, env } = await appleLookup(txnId);
    const expires = data.expiresDate ? new Date(Number(data.expiresDate)).toISOString() : null;
    const revoked = !!data.revocationDate;
    // 🪤 و«سارٍ» يُحسب من التاريخ لا من نوع الحدث: إشعارُ تجديدٍ قد يسبق
    //    سريانَه بثوانٍ، وإشعارُ فشلٍ قد يأتي والمدّةُ المدفوعة باقية.
    const live = !revoked && !!expires && new Date(expires).getTime() > Date.now();
    return {
        platform: "apple", productId: String(data.productId || ""),
        key: String(data.originalTransactionId || txnId),
        latest: String(data.transactionId || txnId),
        expires, environment: env, autoRenew: true,
        active: live, status: revoked ? "revoked" : (live ? "active" : "expired"),
        raw: data,
    };
}

/** قوقل: الرمزُ نفسُه هو المفتاح الثابت. */
export async function googleState(token: string): Promise<IapState> {
    const data = await googleLookup(token);
    const line = (data?.lineItems || [])[0] || {};
    const st = String(data?.subscriptionState || "");
    const MAP: Record<string, string> = {
        SUBSCRIPTION_STATE_ACTIVE: "active",
        SUBSCRIPTION_STATE_IN_GRACE_PERIOD: "grace",
        SUBSCRIPTION_STATE_ON_HOLD: "on_hold",
        SUBSCRIPTION_STATE_PAUSED: "paused",
        SUBSCRIPTION_STATE_CANCELED: "canceled",
        SUBSCRIPTION_STATE_EXPIRED: "expired",
    };
    const status = MAP[st] || "expired";
    return {
        platform: "google", productId: String(line.productId || ""),
        key: token, latest: String(data?.latestOrderId || token),
        expires: line.expiryTime || null,
        environment: data?.testPurchase ? "Sandbox" : "Production",
        autoRenew: !!line?.autoRenewingPlan?.autoRenewEnabled,
        // 🪤 و«ملغًى» عند قوقل يعني **أُوقف التجديد** والمدّةُ المدفوعة باقية.
        //    فعدُّه انقطاعاً يقطع تاجراً دفع شهرَه. السريانُ من التاريخ.
        active: ["active", "grace", "canceled"].includes(status)
                && !!line.expiryTime && new Date(line.expiryTime).getTime() > Date.now(),
        status, raw: data,
    };
}
