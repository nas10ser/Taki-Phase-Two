/**
 * iap.ts — جسرُ الاشتراك **داخل التطبيق** (v15.67)
 * ═══════════════════════════════════════════════════════════════════════════
 * أمرُ ناصر: «اشتراكُ التاجر داخل التطبيق اريدها داخل التطبيق الاشتراك ايضا».
 *
 * 🔴 ولماذا لا خيارَ ثالث: البندُ ٣٫١٫١ عند أبل يُلزم بنظام دفعها لأيّ
 *    «محتوىً أو خصائصَ أو خدماتٍ رقميّة» تُشترى في التطبيق، **ويمنع حتى
 *    الإحالةَ** إلى شراءٍ خارجه. وقوقل تُلزم بالمِثل (Payments policy).
 *    فزرُّ «ادفع عبر البوّابة» داخل التطبيق = رفضٌ مباشر، وعمولةُ ١٥–٣٠٪ على
 *    الاشتراك هي ثمنُ وجود التطبيق في المتجرين — وهو قرارُ ناصر المعلن.
 *
 * 🔴 ولا يُفعَّل شيءٌ بما يقوله هذا الملفّ. كلُّ ما يفعله: يطلب الشراءَ من
 *    المتجر، ثمّ يُسلّم **مفتاحَ بحثٍ** إلى `iap-verify`، والخادمُ يسأل أبل
 *    أو قوقل ويُفعّل. فجهازٌ مكسورُ الحماية يُلفّق أيَّ إيصالٍ ولا ينال شيئاً.
 *
 * 🪤 وكلُّ استيرادٍ ديناميكيّ: الموقعُ يُحمَّل في متصفّحٍ لا يعرف الإضافة،
 *    وحزمةُ الدخول عند ٦١٣ ك.ب من سقف ٧٦٠. (نفسُ قاعدة `capacitor.ts`.)
 *
 * 🪤 و«استعادةُ المشتريات» ليست تحسيناً: البندُ ٣٫١٫١ **يُلزم** بها لكلّ
 *    اشتراكٍ قابلٍ للتجديد، ورفضُ التطبيق بسببها شائع. وهي الطريقُ نفسُه
 *    الذي يُنقذ تاجراً بدّل جهازه أو أعاد تثبيت التطبيق.
 */

import { isNative, nativePlatform } from './capacitor';
import { supabase } from '../services/supabaseClient';

export interface IapProduct {
    productId: string;
    title: string;
    description: string;
    /** السعرُ **كما يعرضه المتجر** بعملة المستخدم — لا يُصاغ عندنا. */
    priceLabel: string;
    /** معرّفُ الباقة عندنا، من `platform_settings.iap_products`. */
    packageId?: number;
}

export type IapResult =
    | { ok: true; expiresAt: string | null; maxBranches: number | null }
    | { ok: false; code: 'cancelled' | 'unavailable' | 'pending' | 'not_mapped'
                       | 'not_configured' | 'verify_failed' | 'nothing_to_restore';
        detail?: string };

interface TakiIapPlugin {
    products(o: { productIds: string[] }): Promise<{ products: IapProduct[] }>;
    purchase(o: { productId: string }): Promise<{ transactionId?: string; purchaseToken?: string;
                                                  state?: string }>;
    restore(): Promise<{ transactionId?: string; purchaseToken?: string }>;
    /** الإقرار/الإنهاء — **بعد** تحقّق الخادم وحده. */
    finalizePurchase(o: { transactionId?: string; purchaseToken?: string }): Promise<unknown>;
}

async function plugin(): Promise<TakiIapPlugin | null> {
    if (!isNative()) return null;
    try {
        const { registerPlugin } = await import('@capacitor/core');
        return registerPlugin<TakiIapPlugin>('TakiIap');
    } catch { return null; }
}

/** هل يُعرض الشراءُ داخل التطبيق؟ (متزامنة — تُستعمل في التصيير) */
export const iapIsStoreFlow = (): boolean => isNative();

/**
 * خريطةُ «معرّفُ منتَج المتجر ⇄ باقتنا» من الإعدادات.
 * 🪤 وتُقرأ من القاعدة لا تُكتب في الكود: إنشاءُ منتَجٍ جديد في المتجرين
 *    يجب ألّا يحتاج نشرَ تطبيقٍ ومراجعةً أسبوعاً.
 * 🪤 والمفتاحُ مُدرَجٌ في قائمة سماح RLS (هجرة v15.67) — ولولاه عاد
 *    `SELECT` بصفر صفوفٍ **بلا خطأ** فظهرت الشاشةُ «لا باقات».
 */
export async function iapProductMap(): Promise<Record<string, number>> {
    const { data } = await supabase.from('platform_settings')
        .select('value').eq('key', 'iap_products').maybeSingle();
    const out: Record<string, number> = {};
    const v = (data?.value ?? {}) as Record<string, { package_id?: number }>;
    for (const [pid, meta] of Object.entries(v)) {
        const n = Number(meta?.package_id);
        if (Number.isFinite(n)) out[pid] = n;
    }
    return out;
}

/** قائمةُ المنتجات **بأسعار المتجر** — لا تُعرض أسعارُنا في التطبيق. */
export async function iapProducts(): Promise<IapProduct[]> {
    const p = await plugin();
    if (!p) return [];
    const map = await iapProductMap();
    const ids = Object.keys(map);
    if (!ids.length) return [];
    try {
        const r = await p.products({ productIds: ids });
        return (r?.products || []).map((x) => ({ ...x, packageId: map[x.productId] }));
    } catch { return []; }
}

/**
 * يُسلّم مفتاحَ البحث للخادم — ولا يقرأ حالةً من الإيصال — ثمّ **يُقِرّ**.
 *
 * 🔴 والإقرارُ بعد التحقّق لا قبله، وهو ترتيبٌ يحمي من الجهتين:
 *    • **قوقل تستردّ المالَ تلقائياً** إن لم يُقَرّ الشراءُ خلال ثلاثة أيّام
 *      وتُلغي الاشتراك — بلا أيّ رسالة. فالإقرارُ واجب.
 *    • و**أبل تُعيد تسليم** المعاملة غير المنتهية عند كل إقلاع — وهي شبكةُ
 *      الأمان الوحيدة لو مات الاتّصالُ بين الدفع والتفعيل. فإنهاؤها قبل
 *      التفعيل يعني تاجراً دفع ولا اشتراكَ له.
 *    ⇒ تحقّقٌ أوّلاً، ثمّ إقرار. وعكسُه يُنتج عيبين كلاهما صامت.
 *
 * 🪤 وفشلُ الإقرار **لا يُبطل الاشتراك**: التفعيلُ وقع في القاعدة فعلاً،
 *    ومنعُه هنا يحرم تاجراً دفع. ويُسجَّل في السجلّ ليُعاد عند أوّل
 *    «استعادة مشتريات» (وهي آمنةُ التكرار في المنصّتين).
 */
async function verifyWithServer(
    platform: 'apple' | 'google',
    ref: { transactionId?: string; purchaseToken?: string },
): Promise<IapResult> {
    const body = platform === 'apple'
        ? { platform, transactionId: ref.transactionId }
        : { platform, purchaseToken: ref.purchaseToken };
    const { data, error } = await supabase.functions.invoke('iap-verify', { body });
    if (error) {
        // 🪤 ورمزُ «غير مضبوط» لا يُخلط بـ«فشل التحقّق»: الأوّلُ ينتظر حسابَ
        //    المتجر، والثاني عيبٌ أو تلاعب. وخلطُهما يُرسل ناصراً يبحث عن
        //    عطلٍ حيث لا عطل.
        const m = String(error.message || '');
        if (/NOT_CONFIGURED/.test(m)) return { ok: false, code: 'not_configured', detail: m };
        return { ok: false, code: 'verify_failed', detail: m };
    }
    if (data?.error === 'unmapped_product') return { ok: false, code: 'not_mapped' };
    if (!data?.success) return { ok: false, code: 'verify_failed', detail: String(data?.error || '') };

    // التفعيلُ وقع ⇒ يُقَرّ الشراءُ الآن عند المتجر.
    try {
        const p = await plugin();
        await p?.finalizePurchase(ref);
    } catch (e) {
        console.warn('[iap] الإقرارُ فشل — الاشتراكُ مفعَّل، ويُعاد الإقرارُ عند الاستعادة.',
                     (e as Error)?.message || e);
    }
    return { ok: true, expiresAt: data?.expires_at ?? null,
             maxBranches: Number(data?.max_branches) || null };
}

/** الشراء. يُرجع `cancelled` حين يُغلق المستخدمُ ورقةَ المتجر — لا خطأً. */
export async function iapPurchase(productId: string): Promise<IapResult> {
    const p = await plugin();
    if (!p) return { ok: false, code: 'unavailable' };
    const platform = nativePlatform() === 'ios' ? 'apple' : 'google';
    let ref: { transactionId?: string; purchaseToken?: string; state?: string };
    try {
        ref = await p.purchase({ productId });
    } catch (e) {
        const m = String((e as Error)?.message || e);
        if (/cancel/i.test(m)) return { ok: false, code: 'cancelled' };
        return { ok: false, code: 'unavailable', detail: m };
    }
    if (!ref || ref.state === 'cancelled') return { ok: false, code: 'cancelled' };
    // 🪤 و«معلّق» حالةٌ حقيقيّة لا خطأ: قوقل تسمح بالدفع نقداً في متجرٍ فعليّ
    //    فيبقى الشراءُ أيّاماً، وأبل تطلب موافقةَ وليٍّ في حساب العائلة.
    //    والتفعيلُ يأتي من إشعار الخادم لا من هنا.
    if (ref.state === 'pending') return { ok: false, code: 'pending' };
    if (!ref.transactionId && !ref.purchaseToken) {
        return { ok: false, code: 'unavailable', detail: 'no_reference' };
    }
    return verifyWithServer(platform, ref);
}

/** استعادةُ المشتريات — **يُلزم بها البند ٣٫١٫١**، وتُنقذ من تبديل الجهاز. */
export async function iapRestore(): Promise<IapResult> {
    const p = await plugin();
    if (!p) return { ok: false, code: 'unavailable' };
    const platform = nativePlatform() === 'ios' ? 'apple' : 'google';
    let ref: { transactionId?: string; purchaseToken?: string };
    try { ref = await p.restore(); } catch (e) {
        return { ok: false, code: 'unavailable', detail: String((e as Error)?.message || e) };
    }
    if (!ref?.transactionId && !ref?.purchaseToken) {
        return { ok: false, code: 'nothing_to_restore' };
    }
    return verifyWithServer(platform, ref);
}
