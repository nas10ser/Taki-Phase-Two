import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { iapProducts, iapPurchase, iapRestore, IapProduct, IapResult } from '../../native/iap';
import { branchesShort } from '../../data/packages';
import { nativePlatform } from '../../native/capacitor';

/**
 * StoreSubscription — لوحةُ الاشتراك **داخل التطبيق** (v15.67)
 * ═══════════════════════════════════════════════════════════════════════════
 * تُعرض بدل مسار البوّابة حين يكون التطبيقُ من المتجرين. وخرجت إلى ملفّها
 * لأن `Subscription.tsx` عند سقف السقّافة — **والسقّافة تُجبر على التصميم
 * الصحيح لا تعيقه**: فصلُ المسارين يجعل كلَّ واحدٍ مقروءاً، ويمنع أن يسرب
 * زرُّ بوّابةٍ إلى فرع التطبيق سهواً.
 *
 * 🔴 ولا يُعرض هنا سعرٌ نحسبه نحن ولا ضريبةٌ نضيفها: السعرُ **ما يعرضه
 *    المتجر** (`priceLabel`) بعملة المستخدم. أبل وقوقل يقبضان بدرجات أسعارهما
 *    ويتولّيان الضريبةَ المحليّة، فعرضُ «١٥٠ ر.س + ١٥٪» بجوار سعرٍ يقول
 *    المتجرُ غيرَه = شكوى «خُدعت» ومخالفةُ البند ٣٫١٫٢ (وجوبُ عرض السعر
 *    والمدّة بوضوح وصدق).
 *
 * 🔴 و«استعادةُ المشتريات» **إلزاميّة** لأي اشتراكٍ متجدّد (٣٫١٫١)، ورفضُ
 *    التطبيقات بسببها شائع. وهي الطريقُ الوحيد لتاجرٍ بدّل جهازه.
 *
 * 🪤 وإلغاءُ الاشتراك لا يُنفَّذ من عندنا ولا يُوعَد به: المتجرُ يملكه وحده،
 *    وزرٌّ يقول «إلغاء» ولا يُلغي أسوأُ من لا زرّ. يُقال للمستخدم **أين**
 *    يُلغي بنصٍّ يطابق واقعَ المنصّة.
 */

const t = (isRTL: boolean, ar: string, en: string) => (isRTL ? ar : en);

const MSG: Record<string, [string, string]> = {
    cancelled: ['أُلغيت العملية — لم يُخصم شيء.', 'Cancelled — nothing was charged.'],
    unavailable: ['متجرُ التطبيقات غيرُ متاحٍ الآن. أعِد المحاولة بعد قليل.',
                  'The app store is unavailable right now. Please try again shortly.'],
    pending: ['الشراءُ قيد المعالجة عند المتجر. سيُفعَّل اشتراكُك تلقائياً بمجرّد اكتماله.',
              'Your purchase is pending with the store. Your plan activates automatically once it completes.'],
    not_mapped: ['هذه الباقةُ غيرُ مربوطةٍ بعد. راسِلنا ولا تُعِد المحاولة.',
                 'This plan is not linked yet. Please contact us instead of retrying.'],
    not_configured: ['الاشتراكُ داخل التطبيق لم يُفعَّل بعد. اشترِك من الموقع مؤقّتاً.',
                     'In-app subscriptions are not live yet. Please subscribe from the website for now.'],
    verify_failed: ['تعذّر التحقّقُ من الشراء. لم يُفعَّل شيء — ولم يُفقَد شيء: اضغط «استعادة المشتريات».',
                    'We could not verify the purchase. Nothing was activated and nothing is lost — tap “Restore purchases”.'],
    nothing_to_restore: ['لا يوجد اشتراكٌ سابقٌ على هذا الحساب في المتجر.',
                         'No previous subscription was found on this store account.'],
};

const StoreSubscription: React.FC<{ isRTL: boolean; onActivated: () => void }> = ({ isRTL, onActivated }) => {
    const [products, setProducts] = useState<IapProduct[] | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [note, setNote] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
    const ios = nativePlatform() === 'ios';

    useEffect(() => {
        let alive = true;
        iapProducts().then((p) => { if (alive) setProducts(p); });
        return () => { alive = false; };
    }, []);

    const handle = useCallback((r: IapResult) => {
        if (r.ok) {
            setNote({ kind: 'ok', text: t(isRTL, '✅ تم تفعيل اشتراكك.', '✅ Your plan is active.') });
            onActivated();
            return;
        }
        const m = MSG[r.code] || MSG.verify_failed;
        setNote({ kind: r.code === 'pending' ? 'ok' : 'err', text: isRTL ? m[0] : m[1] });
    }, [isRTL, onActivated]);

    const buy = async (id: string) => {
        setNote(null); setBusy(id);
        try { handle(await iapPurchase(id)); } finally { setBusy(null); }
    };
    const restore = async () => {
        setNote(null); setBusy('restore');
        try { handle(await iapRestore()); } finally { setBusy(null); }
    };

    if (products === null) {
        return <div className="py-10 text-center text-[var(--text-secondary)]">
            {t(isRTL, 'جاري جلب الباقات من المتجر…', 'Loading plans from the store…')}
        </div>;
    }

    // 🪤 وقائمةٌ فارغةٌ ليست خطأً دائماً: قد تكون المنتجاتُ لم تُنشأ بعد في
    //    لوحة المتجر، أو لم تُعتمد. فالنصُّ يقول الحقيقةَ ولا يتّهم الشبكة.
    if (!products.length) {
        return <div className="py-10 px-4 text-center space-y-3">
            <p className="font-bold text-[var(--text-primary)]">
                {t(isRTL, 'لا توجد باقاتٌ متاحةٌ في المتجر الآن.',
                          'No plans are available from the store right now.')}
            </p>
            <p className="text-sm text-[var(--text-secondary)]">
                {t(isRTL, 'يمكنك الاشتراك من موقع تاكي على المتصفّح، أو إعادة المحاولة لاحقاً.',
                          'You can subscribe from the TAKI website in a browser, or try again later.')}
            </p>
            <button onClick={restore} disabled={busy !== null}
                className="px-5 py-2.5 rounded-full font-bold border-2 border-[var(--border-color)] text-[var(--text-primary)]">
                {t(isRTL, '↻ استعادة المشتريات', '↻ Restore purchases')}
            </button>
        </div>;
    }

    return (
        <div className="space-y-4">
            {note && (
                <div role="status" className={`rounded-2xl px-4 py-3 text-sm font-bold ${
                    note.kind === 'ok' ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                                       : 'bg-red-500/12 text-red-700 dark:text-red-300'}`}>
                    {note.text}
                </div>
            )}

            {products.map((p) => (
                <div key={p.productId} className="rounded-3xl p-5 bg-[var(--card-bg)] border-2 border-[var(--border-color)]">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <h3 className="font-extrabold text-lg text-[var(--text-primary)] truncate">{p.title}</h3>
                            {p.description && (
                                <p className="text-sm text-[var(--text-secondary)] mt-0.5">{p.description}</p>
                            )}
                        </div>
                        {/* السعرُ من المتجر حرفياً — لا يُصاغ ولا تُضاف عليه ضريبة. */}
                        <div className="shrink-0 text-end">
                            <div className="font-extrabold text-xl text-[var(--text-primary)]">{p.priceLabel}</div>
                            <div className="text-[11px] text-[var(--text-secondary)]">
                                {t(isRTL, 'شهرياً · يُجدَّد تلقائياً', 'per month · auto-renews')}
                            </div>
                        </div>
                    </div>
                    <button onClick={() => buy(p.productId)} disabled={busy !== null}
                        className="mt-4 w-full py-3 rounded-full font-extrabold text-white
                                   bg-gradient-to-r from-emerald-500 to-teal-600 disabled:opacity-60">
                        {busy === p.productId
                            ? t(isRTL, 'جاري الشراء…', 'Purchasing…')
                            : t(isRTL, 'اشترك الآن', 'Subscribe')}
                    </button>
                </div>
            ))}

            {/* ── الإفصاحاتُ التي يُلزم بها البند ٣٫١٫٢ ──────────────────── */}
            <div className="rounded-2xl p-4 bg-[var(--bg-secondary)] text-xs leading-7 text-[var(--text-secondary)] space-y-2">
                {/* 🪤 ولا يُكتب توقيتُ التجديد رقماً **من عندنا**: «قبل ٢٤ ساعة»
                    شرطُ أبل المنشور، ولا تقوله قوقل بنفس الصيغة — فعرضُه
                    لتاجرٍ على أندرويد يقول له موعداً لا يسري عليه. وقاعدةُ
                    ناصر الثابتة: لا مدّةَ برقمٍ ما لم يَنُصّ عليها نظامٌ
                    سعوديّ ويُسمّى. ⇒ يُنسب التوقيتُ إلى المتجر ويُحال إلى
                    شاشته، وهي الموضعُ الذي يُعلنه فعلاً. */}
                <p>
                    {t(isRTL,
                       'الاشتراكُ شهريٌّ ويُجدَّد تلقائياً بنفس السعر حتى تُلغيه، '
                     + 'ويُحصَّل المبلغُ من حساب متجر التطبيقات لا من تاكي. '
                     + 'وموعدُ التجديد والمهلةَ قبله يُحدّدهما المتجر ويُعلنهما على شاشة الشراء.',
                       'This is a monthly subscription that renews automatically at the same price '
                     + 'until you cancel, and you are charged through your app store account, not by TAKI. '
                     + 'The renewal date and the notice before it are set by the store and shown on its purchase screen.')}
                </p>
                <p>
                    {/* 🪤 ونصُّ الإلغاء يطابق واقعَ المنصّة: مكانُه مختلفٌ فيهما،
                        ونصٌّ واحدٌ لكليهما يُرسل المستخدمَ إلى شاشةٍ لا توجد. */}
                    {ios
                        ? t(isRTL, 'للإلغاء: الإعدادات ← اسمك ← الاشتراكات. والإلغاءُ من المتجر لا من تاكي.',
                                   'To cancel: Settings → your name → Subscriptions. Cancellation is handled by the store, not by TAKI.')
                        : t(isRTL, 'للإلغاء: تطبيقُ Google Play ← القائمة ← المدفوعات والاشتراكات. والإلغاءُ من المتجر لا من تاكي.',
                                   'To cancel: Google Play app → menu → Payments & subscriptions. Cancellation is handled by the store, not by TAKI.')}
                </p>
                <p className="flex flex-wrap gap-x-4 gap-y-1">
                    <Link to="/terms" className="underline font-bold">{t(isRTL, 'الشروط والأحكام', 'Terms of Use')}</Link>
                    <Link to="/privacy" className="underline font-bold">{t(isRTL, 'سياسة الخصوصية', 'Privacy Policy')}</Link>
                </p>
            </div>

            <button onClick={restore} disabled={busy !== null}
                className="w-full py-3 rounded-full font-bold border-2 border-[var(--border-color)]
                           text-[var(--text-primary)] disabled:opacity-60">
                {busy === 'restore'
                    ? t(isRTL, 'جاري الاستعادة…', 'Restoring…')
                    : t(isRTL, '↻ استعادة المشتريات', '↻ Restore purchases')}
            </button>
            <p className="text-center text-[11px] text-[var(--text-secondary)]">
                {t(isRTL, `كلُّ باقةٍ تحدّد عددَ المواقع المسموح بعرضها — ${branchesShort(1, true)} أو أكثر حسب الباقة.`,
                          'Each plan sets how many locations you may display.')}
            </p>
        </div>
    );
};

export default StoreSubscription;
