/**
 * helpers.ts — أدوات مشتركة لدالة «الدفع المباشر لحساب التاجر» (v12.81)
 * تشفير/توقيع + ردود HTTP. لا تعتمد على أي مزود بعينه.
 */

const enc = new TextEncoder();

export async function sha256Hex(msg: string): Promise<string> {
    const buf = await crypto.subtle.digest('SHA-256', enc.encode(msg));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hmacSha256Hex(key: string, msg: string): Promise<string> {
    const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', k, enc.encode(msg));
    return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** مقارنة ثابتة الزمن — لا تكشف طول التطابق عبر التوقيت */
export function timingSafeEqual(a: string, b: string): boolean {
    const ab = enc.encode(a);
    const bb = enc.encode(b);
    if (ab.length !== bb.length) return false;
    let diff = 0;
    for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
    return diff === 0;
}

export const round2 = (n: number): number => Math.round(n * 100) / 100;
/** ريال → هللات (moyasar/payfort/checkout تتعامل بأصغر وحدة) */
export const toMinor = (sar: number): number => Math.round(sar * 100);
/** تطابق مبلغين بهامش قرش واحد */
export const amountsMatch = (a: number, b: number): boolean => Math.abs(a - b) < 0.011;

export const CORS_HEADERS: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-bot-secret',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

export function json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
}

export function seeOther(url: string): Response {
    return new Response(null, { status: 303, headers: { Location: url, ...CORS_HEADERS } });
}

export function htmlResponse(html: string): Response {
    return new Response(html, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', ...CORS_HEADERS },
    });
}

/** Basic auth header للمفاتيح السرية (Moyasar) */
export function basicAuth(user: string, pass = ''): string {
    return 'Basic ' + btoa(`${user}:${pass}`);
}
