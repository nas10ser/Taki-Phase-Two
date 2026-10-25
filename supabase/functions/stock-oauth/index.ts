/**
 * stock-oauth — تفويضُ سلّة وزد وتحديثُ رموزهما (v15.18 → v15.21)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 ولماذا دالّةُ حافةٍ ولم يكفِ `pg_net` كما في إعادة قراءة المخزون:
 *    قِيس على الخادم الآن لا استُنتج —
 *      `POST https://accounts.salla.sa/oauth2/token` بجسمٍ **JSON** ⇒ 400
 *      `invalid_request` (لم يُقرأ)، وبجسمٍ **form-encoded** ⇒ 401
 *      `invalid_client` (قُرئ وفشل على العميل الوهميّ وحده). وزد مثلُها.
 *    و`pg_net` لا يُرسل إلا `jsonb`. ⇒ تبادلُ الرموز لا يمكن أن يجري داخل
 *    القاعدة إطلاقاً. والقاعدةُ تبقى صاحبةَ الأسرار والأقفال.
 *
 * ثلاثةُ مسارات:
 *   POST /stock-oauth/salla          ← عنوانُ تطبيق تاكي عند سلّة (app.store.*)
 *   GET  /stock-oauth/zid/callback   ← عودةُ تفويض زد (code + state)
 *   POST /stock-oauth/refresh        ← مهمّةُ التحديث (بسرٍّ من الكرون)
 *
 * 🔴 وأخطرُ قاعدةٍ هنا، من وثيقة سلّة حرفياً: **رمزُ التحديث يُستعمل مرّةً
 *    واحدة**، وإعادةُ استعماله تُبطل كلَّ التوكنات وتستلزم إعادةَ تثبيتٍ من
 *    متجرها. ⇒ لا إعادةَ محاولةٍ هنا أبداً: كلُّ نتيجةٍ غيرِ ناجحةٍ صريحاً
 *    تُبلَّغ `unknown` فتُوسَم في القاعدة «أعِد الربط» — والقفلُ `inflight`
 *    يُوضع في القاعدة **قبل** النداء لا بعده.
 */

const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const hdr = (req: Request, n: string): string =>
    req.headers.get(n) || req.headers.get(n.toLowerCase()) || '';

function sameSecret(a: string, b: string): boolean {
    const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
    if (x.length !== y.length) return false;
    let d = 0; for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
    return d === 0;
}

async function hmacHex(secret: string, raw: string): Promise<string> {
    const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const s = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(raw));
    return Array.from(new Uint8Array(s)).map(b => b.toString(16).padStart(2, '0')).join('');
}

const SUPA = Deno.env.get('SUPABASE_URL') || '';
const SRV = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const SITE = 'https://www.takisa.net';

async function rpc(fn: string, args: unknown): Promise<any> {
    const r = await fetch(`${SUPA}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', apikey: SRV, authorization: `Bearer ${SRV}` },
        body: JSON.stringify(args),
    });
    if (!r.ok) throw new Error(`${fn} -> ${r.status}`);
    return await r.json();
}

/** نقاطُ التوكن — ومُعاملاتُها **form-encoded** إلزاماً (قِيس). */
const TOKEN_URL: Record<string, string> = {
    salla: 'https://accounts.salla.sa/oauth2/token',
    zid: 'https://oauth.zid.sa/oauth/token',
};

async function postForm(url: string, fields: Record<string, string>) {
    const body = new URLSearchParams(fields).toString();
    return await fetch(url, {
        method: 'POST',
        headers: {
            'content-type': 'application/x-www-form-urlencoded',
            accept: 'application/json',
        },
        body,
    });
}

Deno.serve(async (req: Request) => {
    if (!SUPA || !SRV) return json(500, { error: 'NOT_CONFIGURED' });
    const url = new URL(req.url);
    const p = url.pathname;

    // ── ١) عنوانُ تطبيق تاكي عند سلّة ───────────────────────────────────
    if (req.method === 'POST' && p.endsWith('/salla')) {
        const raw = await req.text();
        if (raw.length > 256 * 1024) return json(413, { error: 'BODY_TOO_LARGE' });
        let app: any = null;
        try { app = await rpc('_taki_stock_app', { p_provider: 'salla' }); } catch { /* نُكمل */ }
        // 🔴 وقبل تسجيل التطبيق لا سرَّ توقيعٍ أصلاً ⇒ **يُرفض** ولا يُقبل
        //    مجهولاً: هذا العنوانُ عامٌّ، وقبولُ رسالةٍ بلا توقيعٍ يعني أن أيَّ
        //    أحدٍ يُرسل «توكناً» فيُربط بمتجر. وتاكي لا تملك سرَّه بعد.
        const wsec = app && typeof app.webhook_secret === 'string' ? app.webhook_secret : '';
        if (!wsec) return json(503, { error: 'APP_NOT_REGISTERED' });
        // 🪤 التوقيعُ فوق **الجسم الخام** — ومثالُ سلّة بـNode يُجزّئ
        //    `JSON.stringify(req.body)` وهو خطأٌ: إعادةُ الترميز تغيّر البايتات.
        const sent = hdr(req, 'X-Salla-Signature').trim().replace(/^sha256=/i, '');
        if (!sent || !sameSecret(sent.toLowerCase(), await hmacHex(wsec, raw))) {
            return json(401, { error: 'BAD_SIGNATURE' });
        }
        let b: any; try { b = JSON.parse(raw || '{}'); } catch { return json(400, { error: 'BAD_JSON' }); }
        const ev = String(b?.event || '');
        // 🪤 `merchant` عددٌ صحيحٌ في **جذر** الرسالة لا كائن (مؤكَّدٌ من
        //    docs.salla.dev/doc-421413.md) — ولا يوجد `store_id` إطلاقاً.
        const remote = b?.merchant === undefined || b?.merchant === null ? '' : String(b.merchant);

        if (ev === 'app.store.authorize' || ev === 'app.store.token.refreshed') {
            const d = b?.data || {};
            const out = await rpc('taki_stock_oauth_bind_salla', {
                p_remote_id: remote,
                p_tok: {
                    access_token: d.access_token, refresh_token: d.refresh_token,
                    expires: d.expires, scope: d.scope, token_type: d.token_type,
                },
            });
            // 🔴 ويُردّ 200 دائماً: سلّة تُعيد المحاولة على غير ذلك، و«لم نستطع
            //    نسبتَه» ليست خطأً عندها — التوكنُ محفوظٌ جانباً ويربطه التاجر.
            return json(200, { ok: true, bound: out?.ok === true, note: out?.error ?? null });
        }
        if (ev === 'app.store.uninstalled' || ev === 'app.uninstalled') {
            await rpc('taki_stock_oauth_revoke', { p_provider: 'salla', p_remote_id: remote });
            return json(200, { ok: true, revoked: true });
        }
        return json(200, { ok: true, ignored: ev });
    }

    // ── ٢) عودةُ تفويض زد ────────────────────────────────────────────────
    if (req.method === 'GET' && p.endsWith('/zid/callback')) {
        const code = (url.searchParams.get('code') || '').trim();
        const state = (url.searchParams.get('state') || '').trim();
        const back = (q: string) => Response.redirect(`${SITE}/seller?stock=${q}`, 302);
        if (!code || !state) return back('denied');
        let st: any;
        try { st = await rpc('taki_stock_oauth_resolve_state', { p_state: state }); }
        catch { return back('error'); }
        if (st?.ok !== true) return back(String(st?.error || 'error').toLowerCase());
        // 🪤 ويُبادَل الرمزُ **فوراً ومتزامناً**: رمزُ التفويض يُستعمل مرّةً
        //    وعمرُه قصيرٌ غيرُ موثَّقٍ بدقّة — فلا طابورَ ولا تأجيل.
        let r: Response;
        try {
            r = await postForm(TOKEN_URL.zid, {
                grant_type: 'authorization_code',
                client_id: String(st.client_id || ''),
                client_secret: String(st.client_secret || ''),
                redirect_uri: String(st.redirect_uri || ''),
                code,
            });
        } catch { return back('exchange_failed'); }
        const t = await r.json().catch(() => null) as any;
        if (!r.ok || !t?.access_token) return back('exchange_failed');
        // 🔴 قيمتان مختلفتان تُحفظان معاً: `authorization` توكنُ التطبيق (JWT)
        //    و`access_token` توكنُ المتجر. وحفظُ إحداهما وحدها = ٤٠١ دائماً.
        const out = await rpc('taki_stock_oauth_store', {
            p_id: st.integration_id,
            p_tok: {
                access_token: t.access_token, authorization: t.authorization,
                refresh_token: t.refresh_token, expires_in: t.expires_in,
                token_type: t.token_type,
            },
            p_remote_id: null,
        });
        return back(out?.ok === true ? 'connected' : 'save_failed');
    }

    // ── ٣) مهمّةُ التحديث ────────────────────────────────────────────────
    if (req.method === 'POST' && p.endsWith('/refresh')) {
        let want = '';
        try { want = String((await rpc('taki_stock_oauth_job_secret', {}))?.secret || ''); }
        catch { return json(500, { error: 'NO_JOB_SECRET' }); }
        const got = hdr(req, 'x-stock-oauth-secret').trim();
        if (!want || !got || !sameSecret(got, want)) return json(401, { error: 'FORBIDDEN' });

        const claim = await rpc('taki_stock_token_refresh_claim', { p_limit: 20 });
        const jobs: any[] = Array.isArray(claim?.jobs) ? claim.jobs : [];
        let ok = 0, parked = 0;
        for (const j of jobs) {
            const tu = TOKEN_URL[String(j.provider || '')];
            if (!tu) {
                await rpc('taki_stock_token_refresh_done',
                    { p_id: j.integration_id, p_outcome: 'auth_failed', p_tok: null, p_error: 'NO_TOKEN_URL' });
                parked++; continue;
            }
            let r: Response | null = null; let t: any = null; let err = '';
            try {
                r = await postForm(tu, {
                    grant_type: 'refresh_token',
                    refresh_token: String(j.refresh_token || ''),
                    client_id: String(j.client_id || ''),
                    client_secret: String(j.client_secret || ''),
                });
                t = await r.json().catch(() => null);
            } catch (e) { err = String((e as Error)?.message || e); }

            // 🔴 ثلاثُ حالاتٍ فقط، ولا رابعة — ولا إعادةَ محاولةٍ في أيٍّ منها:
            //    • نجاحٌ صريحٌ بتوكنٍ جديد ⇒ ok
            //    • رفضٌ صريحٌ من المزوّد (4xx بجسمٍ مقروء) ⇒ auth_failed
            //    • أيُّ شيءٍ آخر (شبكة · 5xx · جسمٌ غريب) ⇒ **unknown**
            //      لأنّ الرمزَ قد يكون استُهلك، ومحاولةٌ ثانيةٌ به تُبيد التفويض.
            if (r && r.ok && t?.access_token) {
                const res = await rpc('taki_stock_token_refresh_done', {
                    p_id: j.integration_id, p_outcome: 'ok',
                    p_tok: {
                        access_token: t.access_token, authorization: t.authorization,
                        refresh_token: t.refresh_token,
                        expires_in: t.expires_in, expires: t.expires, token_type: t.token_type,
                    },
                    p_error: null,
                });
                if (res?.ok === true) { ok++; continue; }
                parked++; continue;
            }
            const hard = !!r && r.status >= 400 && r.status < 500 && t !== null;
            await rpc('taki_stock_token_refresh_done', {
                p_id: j.integration_id,
                p_outcome: hard ? 'auth_failed' : 'unknown',
                p_tok: null,
                p_error: (err || `http_${r?.status ?? 0}:${String(t?.error || t?.message || '')}`).slice(0, 200),
            });
            parked++;
        }
        return json(200, { ok: true, claimed: jobs.length, refreshed: ok, parked });
    }

    return json(404, { error: 'NO_ROUTE' });
});
