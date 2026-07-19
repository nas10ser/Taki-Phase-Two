import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { adminService } from '../../services/adminService';
import { useApp } from '../../context/AppContext';
import { CATEGORIES } from '../../data/mock';

/**
 * AdminAnalyst (v12.38) — «🧠 المحلل الذكي».
 *
 * شركة تحليل بيانات كاملة تعمل آلياً بلا تدخل بشري (طلب ناصر):
 *  - يقرأ كل نشاط المنصة عبر admin_ai_analyst (حجوزات/مشاهدات/اشتراكات/تجديد)
 *  - يولّد «رؤى» عربية جاهزة مرتبة بالخطورة (عزوف التجار أولاً)
 *  - صحة كل تاجر على حدة + تقرير معمّق + توصية مخصصة يعتمدها المالك
 *    قبل إرسالها (admin_notify_user) — الإرسال دائماً بقرار ناصر
 *  - فرص المدن/التصنيفات/المولات (طلب عالٍ بعرض قليل = فرصة استقطاب)
 *  - تنبيه أسبوعي تلقائي (cron: analyst_weekly_pulse) عند بدء العزوف أو القفزات
 *
 * كل الأرقام تُحسب في القاعدة؛ هذا الملف يحوّلها لقرارات مفهومة وبسيطة.
 */

// ─── أنواع البيانات القادمة من الـRPC ───────────────────────────────────────
interface HourRow { h: number; n: number }
interface DowRow { dow: number; n: number }
interface MonthRow { mon: string; new_sellers: number; new_buyers: number; bookings: number; revenue: number }
interface RenewRow { mon: string; expired: number; renewed: number }
interface SellerRow {
    id: string; shop: string; city: string | null;
    created_at: string; last_active_at: string | null;
    plan: string | null; expires_at: string | null;
    active_deals: number; inactive_deals: number;
    bookings_30: number; bookings_prev30: number;
    deal_views_30: number; store_views_30: number;
    rating_avg: number | null; rating_count: number;
    /** v12.39 — growth/content-quality fields */
    top_category: string | null;
    avg_images: number | null;
    weak_image_deals: number;
    weak_desc_deals: number;
    has_hours: boolean;
}
interface GeoRow { city?: string; region?: string; category?: string; mall?: string; deals: number; bookings: number }
interface BuyerCityRow { city: string; buyers: number; bookings: number }

interface Insight {
    id: string;
    severity: 'critical' | 'warn' | 'good' | 'info';
    icon: string;
    title: string;
    body: string;
    action?: string;
}

const DOW_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const catLabel = (id?: string | null): string =>
    CATEGORIES.find((c) => c.id === id)?.ar || id || 'غير محدد';
const fmtHour = (h: number): string => {
    const p = h < 12 ? 'ص' : 'م';
    const v = h % 12 === 0 ? 12 : h % 12;
    return `${v} ${p}`;
};
const arNum = (n: number): string => (Number(n) || 0).toLocaleString('ar-SA');
const daysLeft = (iso: string | null): number | null =>
    iso ? Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000) : null;

// ─── درجة خطر التاجر (0-100، الأعلى = أخطر) + السبب المرجّح ─────────────────
const sellerRisk = (s: SellerRow): { score: number; reasons: string[] } => {
    let score = 0;
    const reasons: string[] = [];
    const dl = daysLeft(s.expires_at);
    if (dl !== null && dl < 0) { score += 40; reasons.push('اشتراكه منتهٍ ولم يجدّد'); }
    else if (dl !== null && dl <= 7) { score += 25; reasons.push(`اشتراكه ينتهي خلال ${arNum(dl)} يوم`); }
    if (s.active_deals === 0) { score += 25; reasons.push('لا يملك أي عرض نشط'); }
    if (s.bookings_30 === 0) { score += 20; reasons.push('صفر حجوزات آخر ٣٠ يوماً'); }
    else if (s.bookings_prev30 > 0 && s.bookings_30 < s.bookings_prev30 / 2) {
        score += 15; reasons.push('حجوزاته انخفضت أكثر من النصف عن الشهر السابق');
    }
    if (s.deal_views_30 + s.store_views_30 === 0) { score += 10; reasons.push('لا زيارات لعروضه أو صفحته (لا يظهر للمشترين)'); }
    else if (s.deal_views_30 >= 20 && s.bookings_30 === 0) {
        score += 10; reasons.push('يُشاهَد لكن بلا حجوزات — الأسعار أو جاذبية العروض تحتاج مراجعة');
    }
    const lastActive = s.last_active_at ? Date.now() - new Date(s.last_active_at).getTime() : null;
    if (lastActive !== null && lastActive > 14 * 86400000) { score += 10; reasons.push('لم يفتح المنصة منذ أسبوعين+'); }
    if (s.rating_avg !== null && s.rating_count >= 3 && s.rating_avg < 3) { score += 10; reasons.push(`تقييمه منخفض (${s.rating_avg}★)`); }
    // v12.39 — جودة المحتوى تدخل في الخطر (صور/وصف/دوام)
    if (s.active_deals > 0 && s.weak_image_deals >= s.active_deals) { score += 5; reasons.push('كل عروضه بصورة واحدة أو بلا صور'); }
    if (s.active_deals > 0 && !s.has_hours) { score += 5; reasons.push('لم يفعّل ساعات عمل متجره'); }
    return { score: Math.min(100, score), reasons };
};

// ─── التوصية المخصصة للتاجر (المسودة التي يعتمدها ناصر قبل الإرسال) ─────────
const buildSellerTip = (s: SellerRow, report: any | null): { title: string; body: string } => {
    const lines: string[] = [];
    const peak: HourRow | undefined = report?.cat_city_hours?.length
        ? [...report.cat_city_hours].sort((a: HourRow, b: HourRow) => b.n - a.n)[0]
        : undefined;
    const peakDay: DowRow | undefined = report?.days?.length
        ? [...report.days].sort((a: DowRow, b: DowRow) => b.n - a.n)[0]
        : undefined;
    if (s.active_deals === 0) lines.push('• أضف عروضاً نشطة الآن — المتاجر التي لديها ٣ عروض فأكثر تحصل على حجوزات أعلى بوضوح.');
    if (peak) lines.push(`• ذروة الطلب على تصنيفك في مدينتك حوالي الساعة ${fmtHour(peak.h)} — انشر عروضك وجدّدها قبلها بساعة.`);
    if (peakDay) lines.push(`• أقوى أيامك هو ${DOW_AR[peakDay.dow]} — ركّز كمياتك وخصوماتك فيه.`);
    if (s.deal_views_30 >= 20 && s.bookings_30 === 0) lines.push('• عروضك تُشاهد ولا تُحجز — جرّب خصماً أوضح (٣٠٪+) أو صوراً أجود للمنتج.');
    if (s.deal_views_30 + s.store_views_30 < 10) lines.push('• زياراتك قليلة — شارك رابط متجرك وباركود الدعوة مع عملائك في واتساب وحسابات التواصل.');
    // v12.39 — جودة المحتوى (صور/وصف/دوام)
    if (s.weak_image_deals > 0) lines.push(`• ${s.weak_image_deals} من عروضك بصورة واحدة أو بلا صور — أضف ٣ صور واضحة بزوايا مختلفة لكل عرض؛ العروض متعددة الصور تُحجز أكثر بوضوح.`);
    if (s.weak_desc_deals > 0) lines.push(`• ${s.weak_desc_deals} من عروضك بلا وصف كافٍ — اكتب المقاسات والمميزات وحالة المنتج؛ الوصف الجيد يرفع الثقة ويقلل الإلغاء.`);
    if (s.active_deals > 0 && !s.has_hours) lines.push('• فعّل «ساعات العمل» من لوحتك — تظهر للمشتري وتمنع حجوزات تصلك والمحل مغلق.');
    if (s.rating_avg !== null && s.rating_count >= 3 && s.rating_avg < 3.5) lines.push('• حسّن تجربة الاستلام والرد على التقييمات — التقييم العالي يرفع ترتيبك وثقة المشترين.');
    if (report?.top_deal?.item_name && Number(report?.top_deal?.bookings) > 0) lines.push(`• أفضل منتجاتك أداءً «${report.top_deal.item_name}» — كرّر عروضاً مشابهة له.`);
    if (!lines.length) lines.push('• استمر — أداؤك جيد. جرّب زيادة عدد العروض النشطة وتنويع التصنيفات لنمو أكبر.');
    return {
        title: '💡 توصيات لزيادة حجوزات متجرك',
        body: `مرحباً ${s.shop} 👋\nبناءً على تحليل بيانات منصة تاكي:\n${lines.join('\n')}\n\nفريق تاكي 🤝`,
    };
};

// ─── مولّد رؤى المنصة ────────────────────────────────────────────────────────
const buildInsights = (d: any): Insight[] => {
    const out: Insight[] = [];
    if (!d) return out;
    const sellers: SellerRow[] = d.sellers || [];
    const ren: RenewRow[] = d.renewals || [];
    const monthly: MonthRow[] = d.monthly || [];
    const funnel = d.funnel || {};

    // ١) العزوف — أهم شيء عند ناصر
    const expiredNoRenew = sellers.filter((s) => { const dl = daysLeft(s.expires_at); return dl !== null && dl < 0; });
    if (expiredNoRenew.length > 0) {
        out.push({
            id: 'churn-now', severity: 'critical', icon: '🚨',
            title: `${arNum(expiredNoRenew.length)} تاجر منتهي الاشتراك ولم يجدّد`,
            body: expiredNoRenew.slice(0, 5).map((s) => `«${s.shop}»${sellerRisk(s).reasons[1] ? ' — ' + sellerRisk(s).reasons[1] : ''}`).join(' • '),
            action: 'افتح «صحة التجار» بالأسفل، راجع السبب المرجّح لكل تاجر، وأرسل له التوصية أو خصماً من تبويب البائعين.',
        });
    }
    if (ren.length >= 2) {
        const last = ren[ren.length - 1]; const prev = ren[ren.length - 2];
        const rl = last.expired ? last.renewed / last.expired : 1;
        const rp = prev.expired ? prev.renewed / prev.expired : 1;
        if (last.expired >= 2 && rl < rp - 0.15) {
            out.push({
                id: 'renew-drop', severity: 'critical', icon: '📉',
                title: `معدل تجديد الاشتراكات هبط إلى ${Math.round(rl * 100)}٪`,
                body: `كان ${Math.round(rp * 100)}٪ الشهر السابق. هذا أول مؤشر عزوف — عالجه قبل أن يتوسع.`,
                action: 'الأسباب الشائعة: قلة الحجوزات مقابل سعر الباقة. راجع أسعار الباقات أو قدّم خصم تجديد مؤقتاً.',
            });
        } else if (last.expired >= 2 && rl > rp + 0.15) {
            out.push({ id: 'renew-up', severity: 'good', icon: '📈', title: `معدل التجديد ارتفع إلى ${Math.round(rl * 100)}٪`, body: 'التجار يرون قيمة حقيقية — استمر على نفس النهج.' });
        }
    }

    // ٢) تجار على وشك الانتهاء
    const expiringSoon = sellers.filter((s) => { const dl = daysLeft(s.expires_at); return dl !== null && dl >= 0 && dl <= 7; });
    if (expiringSoon.length > 0) {
        out.push({
            id: 'expiring', severity: 'warn', icon: '⏳',
            title: `${arNum(expiringSoon.length)} تاجر ينتهي اشتراكه خلال أسبوع`,
            body: expiringSoon.slice(0, 5).map((s) => `«${s.shop}» (${arNum(daysLeft(s.expires_at) || 0)} يوم)`).join(' • '),
            action: 'من ينتهي وهو ضعيف الحجوزات غالباً لن يجدّد — أرسل له توصية تحسين الآن قبل قرار التجديد.',
        });
    }

    // ٣) القمع: مشاهدات ← حجوزات
    const views = Number(funnel.deal_views) || 0;
    const bookings = Number(funnel.bookings) || 0;
    if (views >= 50) {
        const conv = bookings / views;
        if (conv < 0.03) {
            out.push({
                id: 'conv-low', severity: 'warn', icon: '🔻',
                title: `نسبة تحويل المشاهدات لحجوزات منخفضة (${(conv * 100).toFixed(1)}٪)`,
                body: `${arNum(views)} مشاهدة عرض أنتجت ${arNum(bookings)} حجزاً فقط في الفترة.`,
                action: 'الأسباب المعتادة: خصومات غير مقنعة أو صور ضعيفة. شجّع التجار على خصومات ٣٠٪+ وصور واضحة.',
            });
        } else {
            out.push({ id: 'conv-ok', severity: 'good', icon: '✅', title: `نسبة التحويل صحية (${(conv * 100).toFixed(1)}٪)`, body: 'المعروض يقنع الزوار بالحجز.' });
        }
    } else if (views === 0 && bookings > 0) {
        out.push({ id: 'views-new', severity: 'info', icon: 'ℹ️', title: 'عدّاد الزيارات الزمني بدأ للتو', body: 'بدأنا اليوم تسجيل المشاهدات بوقتها (v12.38) — خلال أيام ستكتمل صورة الزيارات وساعات ذروتها.' });
    }

    // ٤) إلغاءات مرتفعة
    const cancelled = Number(funnel.cancelled) || 0;
    if (bookings >= 10 && cancelled / bookings > 0.35) {
        out.push({
            id: 'cancel-high', severity: 'warn', icon: '🚫',
            title: `نسبة الإلغاء/الانتهاء مرتفعة (${Math.round((cancelled / bookings) * 100)}٪)`,
            body: 'مشترون يحجزون ولا يستلمون — غالباً مهلة الاستلام قصيرة أو المتجر بعيد.',
            action: 'راجع مدد التحضير عند التجار كثيري الإلغاء، وذكّر المشترين بمهلة الساعتين.',
        });
    }

    // ٥) نمو المشترين
    if (monthly.length >= 2) {
        const lastM = monthly[monthly.length - 1]; const prevM = monthly[monthly.length - 2];
        if (lastM.new_buyers > prevM.new_buyers && lastM.new_buyers >= 3) {
            out.push({ id: 'buyers-up', severity: 'good', icon: '🛒', title: `نمو المشترين الجدد: ${arNum(lastM.new_buyers)} هذا الشهر`, body: `مقابل ${arNum(prevM.new_buyers)} الشهر السابق — التسويق يعمل.` });
        }
    }
    const b = d.buyers || {};
    const withB = Number(b.with_booking) || 0;
    if (withB >= 5) {
        const rep = Math.round(((Number(b.repeaters) || 0) / withB) * 100);
        out.push({
            id: 'repeat', severity: rep >= 40 ? 'good' : 'info', icon: '🔁',
            title: `${rep}٪ من المشترين يعودون للحجز مرة أخرى`,
            body: rep >= 40 ? 'ولاء ممتاز — المنصة تكسب ثقة المشترين.' : 'لرفع العودة: إشعارات العروض الجديدة والمسابقات تعيد المشتري الخامل.',
        });
    }

    // ٦) فرص العرض/الطلب
    const cities: GeoRow[] = d.cities || [];
    const hot = cities.filter((c) => c.bookings >= 5 && c.deals <= 2 && c.city !== 'غير محدد');
    if (hot.length) {
        out.push({
            id: 'geo-gap', severity: 'info', icon: '🗺',
            title: `طلب مرتفع بعرض قليل في: ${hot.map((c) => c.city).join('، ')}`,
            body: 'حجوزات كثيرة على عروض قليلة = فرصة ذهبية لاستقطاب تجار جدد هناك.',
            action: 'استهدف تجار هذه المدن برابط الدعوة أو بحملة — سيجدون طلباً جاهزاً.',
        });
    }

    // ٧) v12.39 — جودة محتوى المنصة (صور/أوصاف العروض)
    const content = d.content || {};
    const activeDeals = Number(content.active_deals) || 0;
    const weakImgs = (Number(content.no_image) || 0) + (Number(content.one_image) || 0);
    if (activeDeals >= 3 && weakImgs / activeDeals > 0.3) {
        out.push({
            id: 'content-imgs', severity: 'warn', icon: '🖼',
            title: `${Math.round((weakImgs / activeDeals) * 100)}٪ من العروض النشطة صورها ضعيفة`,
            body: `${arNum(weakImgs)} من ${arNum(activeDeals)} عرضاً بصورة واحدة أو بلا صور — الصور أول ما يقنع المشتري.`,
            action: 'استخدم «الإرسال المستهدف» بالأسفل مع قالب «جودة الصور» لتنبيه المتاجر المعنية دفعة واحدة.',
        });
    }
    if (activeDeals >= 3 && (Number(content.no_desc) || 0) / activeDeals > 0.4) {
        out.push({
            id: 'content-desc', severity: 'info', icon: '📝',
            title: `${arNum(Number(content.no_desc) || 0)} عرضاً بلا وصف كافٍ`,
            body: 'الوصف الناقص يزيد أسئلة الشات والإلغاءات — ذكّر التجار بكتابة المقاسات والتفاصيل.',
        });
    }

    // ٨) v12.39 — مدن فيها مشترون نشطون بلا عرض كافٍ (من حجوزاتهم الفعلية)
    const bbc: BuyerCityRow[] = d.buyers_by_city || [];
    const cityDeals = new Map(cities.map((c) => [c.city, c.deals]));
    const demandNoSupply = bbc.filter((b) => b.city !== 'غير محدد' && b.buyers >= 2 && (cityDeals.get(b.city) ?? 0) <= 1);
    if (demandNoSupply.length) {
        out.push({
            id: 'buyer-city-gap', severity: 'info', icon: '🎯',
            title: `مشترون نشطون بعرض شبه معدوم في: ${demandNoSupply.map((b) => b.city).join('، ')}`,
            body: 'هؤلاء يحجزون فعلاً لكن الخيارات أمامهم قليلة — أول تاجر تستقطبه هناك سيحصد الطلب كله.',
            action: 'ركّز حملات استقطاب التجار على هذه المدن أولاً (أعلى عائد على الجهد).',
        });
    }
    return out;
};

// ─── v12.42 — «العقل المشخّص»: تحليل + تسويق + حلول في تقرير واحد ────────────
// يقرأ كل مصادر البيانات معاً (التحليل العام + تفاعل الأقسام + القمع
// والإلغاءات) ويُخرج: درجة صحة المنصة، أضعف النقاط، وقائمة تشخيصات — لكل
// واحدة: الدليل بالأرقام، مكمن الخلل الجذري، خطوات العلاج (تشغيل + تسويق)،
// والأثر المتوقع. هذا يحل محل «الرؤى» المتفرقة السابقة (طلب ناصر: لا تكرار).
interface Diagnosis {
    id: string;
    severity: 'critical' | 'warn' | 'good' | 'info';
    icon: string;
    title: string;
    evidence: string;
    why?: string;
    fix?: string[];
    impact?: string;
}

const buildDiagnosis = (
    d: any, p2: any, fn: any,
): { health: number; weakest: string[]; items: Diagnosis[] } => {
    const items: Diagnosis[] = [];
    const penalties: { label: string; pts: number }[] = [];
    if (!d) return { health: 100, weakest: [], items };

    const sellers: SellerRow[] = d.sellers || [];
    const f = fn?.funnel || {};
    const b = Number(f.bookings) || 0;
    const canc = Number(f.cancelled) || 0;

    // ١) العزوف: منتهون بلا تجديد — مع السبب المهيمن بينهم
    const expired = sellers.filter((s) => { const dl = daysLeft(s.expires_at); return dl !== null && dl < 0; });
    if (expired.length > 0) {
        penalties.push({ label: 'عزوف تجار', pts: 18 });
        const noDeals = expired.filter((s) => s.active_deals === 0).length;
        const noBookings = expired.filter((s) => s.bookings_30 === 0).length;
        const dominantWhy = noDeals >= expired.length / 2
            ? 'أغلبهم توقف عن النشر أصلاً قبل الانتهاء — فقدوا الحافز مبكراً ولم يروا قيمة.'
            : noBookings >= expired.length / 2
                ? 'أغلبهم لم يحصل على حجوزات كافية — دفعوا ولم يروا مبيعات، فالتجديد صار خسارة في نظرهم.'
                : 'أسباب متفاوتة — افتح بطاقة كل تاجر في «صحة التجار» لسببه الفردي.';
        items.push({
            id: 'dg-churn', severity: 'critical', icon: '🚨',
            title: `${arNum(expired.length)} تاجر انتهى اشتراكه ولم يجدّد`,
            evidence: expired.slice(0, 5).map((s) => `«${s.shop}» (${arNum(s.bookings_30)} حجز/٣٠ي، ${arNum(s.active_deals)} عرض نشط)`).join(' • '),
            why: dominantWhy,
            fix: [
                'أرسل لكل واحد توصيته الجاهزة من بطاقته (سبب ضعفه بالضبط) قبل عرض أي خصم.',
                'قدّم «خصم عودة» مؤقتاً من لوحة البائعين لمن كانت حجوزاته ضعيفة رغم نشاطه.',
                'من توقف عن النشر: أرسل قالب «تنشيط متجر خامل» من الإرسال المستهدف.',
            ],
            impact: 'استرجاع تاجر قائم أرخص ٥ أضعاف من استقطاب جديد — كل تاجر يعود = إيراد شهري مستمر.',
        });
    }

    // ٢) تجار يلغون حجوزات عملائهم بأنفسهم
    const selfCancelers = ((fn?.by_store || []) as any[]).filter((s) => Number(s.c_seller) > 0);
    if (selfCancelers.length > 0) {
        penalties.push({ label: 'إلغاء من التجار', pts: 10 });
        items.push({
            id: 'dg-seller-cancel', severity: 'critical', icon: '⛔',
            title: 'تجار يلغون حجوزات عملائهم بأنفسهم',
            evidence: selfCancelers.map((s) => `«${s.shop}» ألغى ${arNum(Number(s.c_seller))} حجزاً`).join(' • '),
            why: 'السلعة غير متوفرة فعلاً وقت وصول العميل (كمية وهمية أو عرض شكلي) — هذا أسرع طريق لفقدان ثقة المشترين.',
            fix: [
                'أرسل تنبيهاً مباشراً لهؤلاء التجار من الإرسال المستهدف (فلتر «الأكثر إلغاءً من التاجر» في راصد الأسوأ).',
                'راقبهم أسبوعين — التكرار يستحق إنذاراً رسمياً من تبويب الإنذارات.',
                'وجّههم لاستخدام «الكمية المحدودة» الفعلية بدل أرقام مبالغ فيها.',
            ],
            impact: 'كل إلغاء من تاجر = مشترٍ غالباً لن يعود — وقف هذا النزيف يرفع الاحتفاظ مباشرة.',
        });
    }

    // ٣) حجوزات تموت بانتهاء المهلة (مشترون لا يستلمون)
    const sysCanc = Number(f.cancel_system) || 0;
    if (b >= 10 && sysCanc / Math.max(1, b) > 0.15) {
        penalties.push({ label: 'عدم استلام', pts: 8 });
        items.push({
            id: 'dg-noshow', severity: 'warn', icon: '⏱',
            title: `${arNum(sysCanc)} حجزاً ماتت بانتهاء المهلة دون استلام`,
            evidence: `${Math.round((sysCanc / Math.max(1, b)) * 100)}٪ من حجوزات الفترة انتهت تلقائياً.`,
            why: 'المشتري يحجز بحماس ثم ينسى أو يستصعب الوصول — أو مدة التحضير لدى التاجر أطول من صبره.',
            fix: [
                'رسائل التذكير قبل انتهاء المهلة تعمل — راجع نصها وتوقيتها في «الإشعارات والرسائل».',
                'شجّع التجار على مدد تحضير واقعية قصيرة (توصية جاهزة من بطاقاتهم).',
            ],
            impact: 'كل حجز يُستلم بدل أن يموت = مبيعة حقيقية وتقييم وثقة.',
        });
    }

    // ٤) تركّز خطير: المنصة تقف على متجر/مدينة واحدة
    const byStore = (fn?.by_store || []) as any[];
    const topStore = [...byStore].sort((a, c) => Number(c.bookings) - Number(a.bookings))[0];
    if (topStore && b >= 10 && Number(topStore.bookings) / b > 0.6) {
        penalties.push({ label: 'تركّز على متجر واحد', pts: 12 });
        items.push({
            id: 'dg-concentration', severity: 'warn', icon: '🎯',
            title: `«${topStore.shop}» وحده يمثل ${Math.round((Number(topStore.bookings) / b) * 100)}٪ من كل الحجوزات`,
            evidence: `${arNum(Number(topStore.bookings))} من أصل ${arNum(b)} حجزاً في الفترة.`,
            why: 'الاعتماد على متجر واحد هشّ — لو توقف أو غادر تنهار أرقام المنصة كلها.',
            fix: [
                'كثّف استقطاب تجار في المدن والأقسام ذات العلامة «⚡» و«🔥» (الطلب جاهز).',
                'استخدم خطة التسويق أدناه — هدفك: لا يتجاوز أي متجر ٣٠٪ من الحجوزات.',
            ],
            impact: 'توزيع أوسع = نمو أثبت وإيراد اشتراكات أعلى.',
        });
    }

    // ٥) أقسام عليها طلب فعلي بلا معروض (من تفاعل الأقسام)
    const hungryCats = ((p2?.cat_engagement || []) as any[]).filter((c) => Number(c.bookings_30) > 0 && Number(c.active_deals) === 0);
    if (hungryCats.length > 0) {
        items.push({
            id: 'dg-hungry-cats', severity: 'warn', icon: '🔥',
            title: `${arNum(hungryCats.length)} قسم عليه طلب حقيقي بلا أي عرض نشط الآن`,
            evidence: hungryCats.map((c) => `${catLabel(c.category)} (${arNum(Number(c.bookings_30))} حجزاً سابقاً)`).join(' • '),
            why: 'مشترون جرّبوا وحجزوا في هذه الأقسام ثم اختفى المعروض — طلب مثبت بالمال يضيع يومياً.',
            fix: [
                'استقطب تاجراً واحداً على الأقل لكل قسم منها (نص الإقناع جاهز في خطة التسويق).',
                'اسأل تجارك الحاليين القريبين من هذه الأقسام إضافة عروض فيها.',
            ],
            impact: 'أول تاجر في قسم جائع يحصد كل طلبه — وأسرع نمو لأرقامك.',
        });
    }

    // ٦) الاحتفاظ بالمشترين
    const ret = (fn?.retention || []) as any[];
    const retTot = ret.reduce((a: number, r: any) => a + Number(r.buyers || 0), 0);
    const retBack = ret.reduce((a: number, r: any) => a + Number(r.returned || 0), 0);
    if (retTot >= 5) {
        const rr = retBack / retTot;
        if (rr < 0.3) {
            penalties.push({ label: 'احتفاظ ضعيف', pts: 10 });
            items.push({
                id: 'dg-retention', severity: 'warn', icon: '🔁',
                title: `فقط ${Math.round(rr * 100)}٪ من المشترين يعودون لحجز ثانٍ`,
                evidence: `${arNum(retBack)} عادوا من أصل ${arNum(retTot)} مشترياً جرّبوا الحجز.`,
                why: 'التجربة الأولى لا تخلق عادة — غالباً لقلة العروض الجديدة أو غياب سبب للعودة.',
                fix: [
                    'مسابقة شهرية بجائزة (تبويب المسابقات + إشعار تلقائي) — أقوى أداة عودة.',
                    'حملة أسبوعية «جديد هذا الأسبوع في مدينتك» من الإشعارات والرسائل.',
                    'شجّع المتابعة: من يتابع متجراً يصله كل عرض جديد تلقائياً.',
                ],
                impact: 'رفع العودة ١٠٪ يضاعف الحجوزات بلا ريال تسويق واحد.',
            });
        } else if (rr >= 0.4) {
            items.push({ id: 'dg-retention-good', severity: 'good', icon: '🔁', title: `ولاء ممتاز: ${Math.round(rr * 100)}٪ من المشترين يعودون`, evidence: `${arNum(retBack)} من ${arNum(retTot)} عادوا لحجز جديد.` });
        }
    }

    // ٧) توقف النمو (آخر شهرين بلا مسجلين جدد)
    const mons: MonthRow[] = d.monthly || [];
    if (mons.length >= 2) {
        const l1 = mons[mons.length - 1]; const l2 = mons[mons.length - 2];
        if (l1.new_buyers + l1.new_sellers === 0 && l2.new_buyers + l2.new_sellers === 0) {
            penalties.push({ label: 'توقف النمو', pts: 12 });
            items.push({
                id: 'dg-stagnation', severity: 'warn', icon: '📉',
                title: 'شهران بلا أي تاجر أو مشترٍ جديد',
                evidence: `${l2.mon} و${l1.mon}: صفر تسجيلات جديدة.`,
                why: 'لا قنوات اكتساب نشطة حالياً — المنصة تعيش على مستخدميها الحاليين فقط.',
                fix: [
                    'نفّذ خطوة واحدة من «خطة التسويق» أسبوعياً (ابدأ بمجموعات واتساب مدينتك الأقوى).',
                    'فعّل باركود الدعوة: اطلب من كل تاجر تعليقه عند الكاشير هذا الأسبوع.',
                ],
                impact: 'قناة اكتساب واحدة منتظمة تكسر الركود خلال أسبوعين.',
            });
        }
    }

    // ٨) دمج قواعد الرؤى السابقة (تجديد، تحويل، جودة صور، فرص مدن...) بلا تكرار
    for (const ins of buildInsights(d)) {
        if (items.some((x) => x.id === 'dg-churn' && ins.id === 'churn-now')) continue;
        items.push({
            id: 'ins-' + ins.id, severity: ins.severity, icon: ins.icon,
            title: ins.title, evidence: ins.body,
            fix: ins.action ? [ins.action] : undefined,
        });
        if (ins.id === 'renew-drop') penalties.push({ label: 'هبوط التجديد', pts: 15 });
        if (ins.id === 'conv-low') penalties.push({ label: 'تحويل منخفض', pts: 8 });
        if (ins.id === 'cancel-high') penalties.push({ label: 'إلغاءات مرتفعة', pts: 8 });
        if (ins.id === 'content-imgs') penalties.push({ label: 'صور ضعيفة', pts: 6 });
    }

    // الدرجة النهائية + أضعف النقاط
    const health = Math.max(5, Math.min(100, 100 - penalties.reduce((a, p) => a + p.pts, 0)));
    const weakest = [...penalties].sort((a, c) => c.pts - a.pts).slice(0, 3).map((p) => p.label);
    const order = { critical: 0, warn: 1, info: 2, good: 3 } as const;
    items.sort((a, c) => order[a.severity] - order[c.severity]);
    return { health, weakest, items };
};

// v12.39 — التقويم الموسمي السعودي لخطة النمو (إرشادي ثابت + بياناتك تحدد ذروتك الفعلية)
const SAUDI_SEASONS: { icon: string; name: string; when: string; tip: string }[] = [
    { icon: '🌙', name: 'رمضان والعيد', when: 'رمضان القادم يبدأ تقريباً فبراير ٢٠٢٧ (يتقدم ~١١ يوماً كل سنة)', tip: 'أقوى موسم تخفيضات في السعودية — جهّز التجار قبله بأسبوعين: عروض سحور/عيديات/ملابس عيد.' },
    { icon: '🎒', name: 'العودة للمدارس', when: 'منتصف أغسطس - أول سبتمبر', tip: 'قرطاسية، ملابس أطفال، أحذية — استقطب متاجر هذه الأصناف قبلها بشهر.' },
    { icon: '🇸🇦', name: 'اليوم الوطني', when: '٢٣ سبتمبر', tip: 'خصومات وطنية ضخمة متوقعة من المشترين — نظّم حملة «عروض اليوم الوطني» ومسابقة.' },
    { icon: '🏜', name: 'يوم التأسيس', when: '٢٢ فبراير', tip: 'موسم خصومات صاعد — فرصة لحملة بنرات مبكرة قبل المنافسين.' },
    { icon: '🛍', name: 'الجمعة البيضاء', when: 'نهاية نوفمبر', tip: 'ذروة التسوق السنوية — افتح باب «عروض الجمعة البيضاء» وشجّع خصومات ٥٠٪+.' },
    { icon: '☀️', name: 'إجازة الصيف', when: 'يونيو - أغسطس', tip: 'نشاط المولات يرتفع مساءً — وجّه التجار للنشر قبل المغرب وتمديد ساعات العمل.' },
];

// ─── مكوّنات عرض صغيرة ──────────────────────────────────────────────────────
const SEV_STYLE: Record<Insight['severity'], { bg: string; border: string }> = {
    critical: { bg: 'rgba(239,68,68,0.08)',  border: 'rgba(239,68,68,0.45)' },
    warn:     { bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.45)' },
    good:     { bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.4)' },
    info:     { bg: 'var(--card-bg)',        border: 'var(--border-color)' },
};

const Tile: React.FC<{ icon: string; label: string; value: string; sub?: string }> = ({ icon, label, value, sub }) => (
    <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl p-3 text-center">
        <div className="text-xl">{icon}</div>
        <div className="text-lg font-black text-[var(--text-primary)] mt-1 tabular-nums">{value}</div>
        <div className="text-[11px] font-bold text-[var(--text-secondary)]">{label}</div>
        {sub && <div className="text-[10px] text-[var(--text-secondary)] mt-0.5">{sub}</div>}
    </div>
);

/** أعمدة SVG بسيطة (بدون مكتبات) — تُستخدم للساعات والأيام والأشهر. */
const Bars: React.FC<{ data: { label: string; n: number }[]; color?: string; height?: number }> = ({ data, color = '#10b981', height = 120 }) => {
    const max = Math.max(1, ...data.map((d) => d.n));
    const bw = 100 / Math.max(1, data.length);
    return (
        <svg viewBox={`0 0 100 ${height / 2 + 14}`} className="w-full" style={{ direction: 'ltr' }} preserveAspectRatio="none" role="img">
            {data.map((d, i) => {
                const h = (d.n / max) * (height / 2 - 6);
                return (
                    <g key={i}>
                        <rect x={i * bw + bw * 0.15} y={height / 2 - h} width={bw * 0.7} height={Math.max(h, d.n > 0 ? 1 : 0)} rx={1} fill={color} opacity={d.n === max ? 1 : 0.55} />
                        <text x={i * bw + bw / 2} y={height / 2 + 8} fontSize={2.8} textAnchor="middle" fill="var(--text-secondary)">{d.label}</text>
                    </g>
                );
            })}
        </svg>
    );
};

// ─── المكوّن الرئيسي ─────────────────────────────────────────────────────────
const AdminAnalyst: React.FC = () => {
    const { customAlert, customConfirm } = useApp();
    const [days, setDays] = useState(30);
    const [data, setData] = useState<any | null>(null);
    const [loading, setLoading] = useState(true);
    const [openSeller, setOpenSeller] = useState<string | null>(null);
    const [report, setReport] = useState<any | null>(null);
    const [reportLoading, setReportLoading] = useState(false);
    const [tipDraft, setTipDraft] = useState('');
    const [tipEmail, setTipEmail] = useState(false);
    const [sending, setSending] = useState(false);
    // v12.39 — فلاتر (مدينة/تصنيف/حالة) تُطبَّق على قائمة الصحة وعلى الإرسال المستهدف
    const [fCity, setFCity] = useState('all');
    const [fCat, setFCat] = useState('all');
    const [fStatus, setFStatus] = useState<'all' | 'weak' | 'risk' | 'expired' | 'nodeals'>('all');
    // v12.39 — الإرسال الجماعي المستهدف (بموافقة ناصر دائماً)
    const [bulkMsg, setBulkMsg] = useState('');
    const [bulkEmail, setBulkEmail] = useState(false);
    const [bulkSending, setBulkSending] = useState(false);
    const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
    // v12.40 — تفاعل الأقسام + البحث + المستكشف + منافسو التاجر المفتوح
    const [pulse2, setPulse2] = useState<any | null>(null);
    // v12.41 — القمع والإلغاءات + فلاتر «الأسوأ» التنفيذية (ناصر يحدد الحد)
    const [funnelData, setFunnelData] = useState<any | null>(null);
    const [worstDim, setWorstDim] = useState<'by_city' | 'by_category' | 'by_store'>('by_city');
    const [worstMetric, setWorstMetric] = useState<'cancel_rate' | 'least_bookings' | 'seller_cancels'>('cancel_rate');
    const [worstMin, setWorstMin] = useState(3);
    const [mxCity, setMxCity] = useState<string>('all');
    const [mxCat, setMxCat] = useState<string>('all');
    const [matrix, setMatrix] = useState<any | null>(null);
    const [matrixLoading, setMatrixLoading] = useState(false);
    const [competitors, setCompetitors] = useState<any | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        const [d, p2, fn] = await Promise.all([
            adminService.getAiAnalyst(days),
            adminService.getAiPulse2(),
            adminService.getAiFunnel(days),
        ]);
        setData(d);
        setPulse2(p2);
        setFunnelData(fn);
        setLoading(false);
    }, [days]);
    useEffect(() => { load(); }, [load]);

    // المستكشف: أي تغيير في (المدينة × القسم) يجلب شريحته فوراً
    useEffect(() => {
        let alive = true;
        setMatrixLoading(true);
        adminService.getAiMatrix(mxCity === 'all' ? null : mxCity, mxCat === 'all' ? null : mxCat)
            .then((m) => { if (alive) { setMatrix(m); setMatrixLoading(false); } });
        return () => { alive = false; };
    }, [mxCity, mxCat]);

    // v12.42 — العقل المشخّص الموحّد (يحل محل الرؤى المتفرقة)
    const diagnosis = useMemo(() => buildDiagnosis(data, pulse2, funnelData), [data, pulse2, funnelData]);
    // v12.43 — «المحلل المخصص»: شريحة حرة يحددها ناصر يدوياً وتتحلل تلقائياً
    const isoDay = (offset: number) => {
        const dt = new Date(Date.now() + offset * 86400000);
        return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    };
    const [cuStart, setCuStart] = useState(() => isoDay(-30));
    const [cuEnd, setCuEnd] = useState(() => isoDay(0));
    const [cuFrom, setCuFrom] = useState(0);
    const [cuTo, setCuTo] = useState(23);
    const [cuDow, setCuDow] = useState<number | 'all'>('all');
    const [cuCity, setCuCity] = useState('all');
    const [cuCat, setCuCat] = useState('all');
    const [cuData, setCuData] = useState<any | null>(null);
    const [cuLoading, setCuLoading] = useState(false);
    useEffect(() => {
        if (!cuStart || !cuEnd) return;
        let alive = true;
        setCuLoading(true);
        // debounce بسيط: أي تغيير متتابع في الفلاتر يرسل طلباً واحداً
        const tm = setTimeout(() => {
            adminService.getAiCustom({
                start: cuStart, end: cuEnd, hourFrom: cuFrom, hourTo: cuTo,
                dow: cuDow === 'all' ? null : cuDow,
                city: cuCity === 'all' ? null : cuCity,
                category: cuCat === 'all' ? null : cuCat,
            }).then((r) => { if (alive) { setCuData(r); setCuLoading(false); } });
        }, 400);
        return () => { alive = false; clearTimeout(tm); };
    }, [cuStart, cuEnd, cuFrom, cuTo, cuDow, cuCity, cuCat]);

    // v12.42 — التحكم الكامل بالساعات
    const [hrFrom, setHrFrom] = useState(16);
    const [hrTo, setHrTo] = useState(22);
    const [hrDow, setHrDow] = useState<number | 'all'>('all');
    const [hoursData, setHoursData] = useState<any | null>(null);
    const [hoursLoading, setHoursLoading] = useState(false);
    useEffect(() => {
        let alive = true;
        setHoursLoading(true);
        adminService.getAiHours(hrFrom, hrTo, hrDow === 'all' ? null : hrDow, days)
            .then((h) => { if (alive) { setHoursData(h); setHoursLoading(false); } });
        return () => { alive = false; };
    }, [hrFrom, hrTo, hrDow, days]);
    const sellers: SellerRow[] = useMemo(() => {
        const list: SellerRow[] = (data?.sellers || []).map((s: SellerRow) => s);
        return list.sort((a, b) => sellerRisk(b).score - sellerRisk(a).score);
    }, [data]);

    // v12.39 — خيارات الفلاتر + القائمة المفلترة (تُغذي الصحة والإرسال المستهدف)
    const cityOptions = useMemo(() => Array.from(new Set(sellers.map((s) => s.city).filter(Boolean))) as string[], [sellers]);
    const catOptions = useMemo(() => Array.from(new Set(sellers.map((s) => s.top_category).filter(Boolean))) as string[], [sellers]);
    const filteredSellers = useMemo(() => sellers.filter((s) => {
        if (fCity !== 'all' && s.city !== fCity) return false;
        if (fCat !== 'all' && s.top_category !== fCat) return false;
        const risk = sellerRisk(s).score;
        const dl = daysLeft(s.expires_at);
        if (fStatus === 'weak' && risk < 30) return false;
        if (fStatus === 'risk' && risk < 60) return false;
        if (fStatus === 'expired' && !(dl !== null && dl < 0)) return false;
        if (fStatus === 'nodeals' && s.active_deals !== 0) return false;
        return true;
    }), [sellers, fCity, fCat, fStatus]);

    // قوالب رسائل جاهزة للإرسال المستهدف — كلها قابلة للتعديل قبل الإرسال
    const bulkTemplates = useMemo(() => {
        const topH: HourRow | null = (data?.peak_hours || []).length
            ? [...data.peak_hours].sort((a: HourRow, b: HourRow) => b.n - a.n)[0] : null;
        return [
            { id: 'photos', label: '🖼 جودة الصور والوصف', text: 'مرحباً 👋\nنصيحة من فريق تاكي لزيادة حجوزاتك: أضف ٣ صور واضحة بزوايا مختلفة لكل عرض، واكتب وصفاً كاملاً (المقاسات/المميزات/الحالة) — العروض مكتملة الصور والوصف تُحجز أكثر بفارق واضح.\nفريق تاكي 🤝' },
            { id: 'peak', label: '⏰ ساعات الذروة', text: `مرحباً 👋\nتحليل منصة تاكي يُظهر أن ذروة الحجوزات حوالي الساعة ${topH ? fmtHour(topH.h) : '٧ مساءً'} — انشر عروضك وجدّد كمياتها قبل الذروة بساعة لتحصد أكبر عدد من الحجوزات.\nفريق تاكي 🤝` },
            { id: 'renew', label: '💳 تشجيع التجديد', text: 'مرحباً 👋\nنذكّرك بتجديد اشتراكك في تاكي حتى لا تتوقف عروضك عن الظهور للمشترين — المتاجر المستمرة تبني قاعدة عملاء ومتابعين تكبر شهراً بعد شهر.\nفريق تاكي 🤝' },
            { id: 'activate', label: '🚀 تنشيط متجر خامل', text: 'مرحباً 👋\nلاحظنا أن متجرك بلا عروض نشطة حالياً — المشترون في مدينتك يبحثون يومياً عن التخفيضات. أضف عرضاً واحداً اليوم (يستغرق دقيقتين من لوحتك أو من بوت تيليجرام) وسيظهر فوراً.\nفريق تاكي 🤝' },
            { id: 'custom', label: '✍️ رسالة حرة', text: '' },
        ];
    }, [data]);

    const sendBulk = async () => {
        if (bulkSending || !bulkMsg.trim() || filteredSellers.length === 0) return;
        const ok = await customConfirm(`سيتم إرسال هذه الرسالة إلى ${filteredSellers.length} تاجراً (${fCity === 'all' ? 'كل المدن' : fCity} / ${fCat === 'all' ? 'كل التصنيفات' : catLabel(fCat)})${bulkEmail ? ' + بريد إلكتروني' : ''}. متابعة؟`);
        if (!ok) return;
        setBulkSending(true);
        setBulkProgress({ done: 0, total: filteredSellers.length });
        let done = 0, failed = 0;
        for (const s of filteredSellers) {
            const r = await adminService.notifyUser({ userId: s.id, titleAr: '💡 رسالة من فريق تاكي', bodyAr: bulkMsg.trim(), email: bulkEmail });
            if (r.success) done++; else failed++;
            setBulkProgress({ done: done + failed, total: filteredSellers.length });
        }
        setBulkSending(false);
        setBulkProgress(null);
        await customAlert(failed === 0 ? `✅ أُرسلت الرسالة لـ${arNum(done)} تاجراً.` : `⚠️ نجح ${arNum(done)} وفشل ${arNum(failed)}.`);
    };

    const openReport = async (s: SellerRow) => {
        if (openSeller === s.id) { setOpenSeller(null); setReport(null); setCompetitors(null); return; }
        setOpenSeller(s.id);
        setReport(null);
        setCompetitors(null);
        setReportLoading(true);
        const [r, comp] = await Promise.all([
            adminService.getAiSellerReport(s.id),
            adminService.getAiCompetitors(s.id),
        ]);
        setReport(r);
        setCompetitors(comp);
        setReportLoading(false);
        setTipDraft(buildSellerTip(s, r).body);
        setTipEmail(false);
    };

    const sendTip = async (s: SellerRow) => {
        if (sending || !tipDraft.trim()) return;
        setSending(true);
        const r = await adminService.notifyUser({
            userId: s.id,
            titleAr: buildSellerTip(s, report).title,
            bodyAr: tipDraft.trim(),
            email: tipEmail,
        });
        setSending(false);
        if (r.success) await customAlert(`✅ أُرسلت التوصية لـ«${s.shop}» كإشعار داخل الموقع${tipEmail ? ' + بريد إلكتروني' : ''} (تصل أيضاً لبوته المرتبط).`);
        else await customAlert('❌ تعذّر الإرسال: ' + (r.error || ''));
    };

    // بيانات الرسوم
    const hourBars = useMemo(() => {
        const arr: HourRow[] = data?.peak_hours || [];
        const map = new Map(arr.map((r) => [r.h, r.n]));
        return Array.from({ length: 24 }, (_, h) => ({ label: h % 3 === 0 ? String(h) : '', n: map.get(h) || 0 }));
    }, [data]);
    const dayBars = useMemo(() => {
        const arr: DowRow[] = data?.peak_days || [];
        const map = new Map(arr.map((r) => [r.dow, r.n]));
        return Array.from({ length: 7 }, (_, i) => ({ label: DOW_AR[i].slice(0, 3), n: map.get(i) || 0 }));
    }, [data]);
    const monthBars = useMemo(() => {
        const arr: MonthRow[] = data?.monthly || [];
        return arr.map((m) => ({ label: m.mon.slice(5), n: m.bookings }));
    }, [data]);

    const funnel = data?.funnel || {};
    const buyers = data?.buyers || {};
    const topHour: HourRow | null = (data?.peak_hours || []).length
        ? [...data.peak_hours].sort((a: HourRow, b: HourRow) => b.n - a.n)[0] : null;
    const renew: RenewRow[] = data?.renewals || [];
    const lastRenew = renew.length ? renew[renew.length - 1] : null;

    if (loading) {
        return <div className="space-y-3">{[0, 1, 2, 3].map((i) => <div key={i} className="h-28 bg-[var(--gray-100)] rounded-2xl animate-pulse" />)}</div>;
    }
    if (!data) {
        return <div className="text-center py-16 text-[var(--text-secondary)]">تعذّر تحميل التحليلات — أعد المحاولة.<div><button onClick={load} className="mt-3 px-4 py-2 rounded-xl bg-emerald-500 text-white font-bold text-sm">🔄 إعادة المحاولة</button></div></div>;
    }

    return (
        <div dir="rtl" className="space-y-4">
            {/* الرأس + اختيار الفترة */}
            <div className="bg-gradient-to-l from-indigo-600 to-violet-700 text-white rounded-3xl p-5">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                        <div className="text-xl font-black">🧠 المحلل الذكي — التجار والسوق</div>
                        <div className="text-[12px] opacity-90 mt-1 leading-relaxed max-w-xl">
                            هذا التبويب يحلل <b>التجار وصحة السوق</b>: عزوف التجار وأسبابه، ساعات الذروة، الفرص بالمدن
                            والتصنيفات، وتوصية جاهزة لكل تاجر <b>لا تُرسل إلا بموافقتك</b>.
                            (أرقام <b>المشترين</b> في تبويب «جمهور المدن»، والأرقام المالية العامة في «التحليلات».)
                        </div>
                        <div className="text-[11px] opacity-80 mt-1.5 font-bold">
                            ⬅️ الأزرار جانباً تحدد فترة التحليل لكل الأقسام أدناه — واللوحة المخصصة تتبعها تلقائياً.
                        </div>
                    </div>
                    <div className="flex gap-1.5 items-center">
                        {[7, 30, 90].map((d) => (
                            <button key={d}
                                onClick={() => {
                                    // v12.52 — إنهاء «تضارب التواريخ»: الزر يضبط الفترة لكل
                                    // الأقسام ويُزامن تواريخ اللوحة المخصصة معه فلا يتعارضان.
                                    setDays(d);
                                    setCuStart(isoDay(-d));
                                    setCuEnd(isoDay(0));
                                }}
                                className={`px-3 py-1.5 rounded-lg text-xs font-extrabold ${days === d ? 'bg-white text-indigo-700' : 'bg-white/15 text-white'}`}>
                                {arNum(d)} يوم
                            </button>
                        ))}
                        <button onClick={load} className="px-3 py-1.5 rounded-lg text-xs font-extrabold bg-white/15" title="تحديث">🔄</button>
                    </div>
                </div>
            </div>

            {/* 🎛 v12.43 — المحلل المخصص: أي تاريخ/ساعة/مدينة/تصنيف يدوياً → تحليل تلقائي */}
            <section className="bg-[var(--card-bg)] border-2 border-violet-300 rounded-2xl p-4 space-y-3">
                <h3 className="font-extrabold text-[var(--text-primary)] text-sm">🎛 المحلل المخصص — حدد أي شيء وسيتحلل فوراً</h3>
                <p className="text-[10px] font-bold text-[var(--text-secondary)] leading-relaxed -mt-1.5">
                    هذه اللوحة <b>تتبع أزرار الفترة في الأعلى تلقائياً</b> (٧/٣٠/٩٠ يوم). وإذا عدّلت أي حقل هنا يدوياً،
                    فالنتائج داخل هذه اللوحة فقط تتبع اختيارك — بقية الأقسام تبقى على فترة الأزرار العلوية.
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
                    <label className="block">
                        <span className="font-bold text-[var(--text-secondary)] block mb-1">من تاريخ</span>
                        <input type="date" value={cuStart} max={cuEnd} onChange={(e) => setCuStart(e.target.value)}
                            className="w-full px-2 py-2 rounded-lg text-xs font-bold bg-[var(--body-bg)] border border-[var(--border-color)] text-[var(--text-primary)] outline-none" />
                    </label>
                    <label className="block">
                        <span className="font-bold text-[var(--text-secondary)] block mb-1">إلى تاريخ</span>
                        <input type="date" value={cuEnd} min={cuStart} onChange={(e) => setCuEnd(e.target.value)}
                            className="w-full px-2 py-2 rounded-lg text-xs font-bold bg-[var(--body-bg)] border border-[var(--border-color)] text-[var(--text-primary)] outline-none" />
                    </label>
                    <label className="block">
                        <span className="font-bold text-[var(--text-secondary)] block mb-1">من الساعة</span>
                        <select value={cuFrom} onChange={(e) => setCuFrom(Number(e.target.value))}
                            className="w-full px-2 py-2 rounded-lg text-xs font-bold bg-[var(--body-bg)] border border-[var(--border-color)] text-[var(--text-primary)] outline-none">
                            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{fmtHour(h)}</option>)}
                        </select>
                    </label>
                    <label className="block">
                        <span className="font-bold text-[var(--text-secondary)] block mb-1">إلى الساعة</span>
                        <select value={cuTo} onChange={(e) => setCuTo(Number(e.target.value))}
                            className="w-full px-2 py-2 rounded-lg text-xs font-bold bg-[var(--body-bg)] border border-[var(--border-color)] text-[var(--text-primary)] outline-none">
                            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{fmtHour(h)}</option>)}
                        </select>
                    </label>
                    <select value={cuDow === 'all' ? 'all' : String(cuDow)} onChange={(e) => setCuDow(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                        className="px-2 py-2 rounded-lg text-xs font-bold bg-[var(--body-bg)] border border-[var(--border-color)] text-[var(--text-primary)] outline-none">
                        <option value="all">📅 كل الأيام</option>
                        {DOW_AR.map((d0, i) => <option key={i} value={i}>{d0}</option>)}
                    </select>
                    <select value={cuCity} onChange={(e) => setCuCity(e.target.value)}
                        className="px-2 py-2 rounded-lg text-xs font-bold bg-[var(--body-bg)] border border-[var(--border-color)] text-[var(--text-primary)] outline-none">
                        <option value="all">🏙 كل المدن</option>
                        {((data.cities || []) as GeoRow[]).filter((c) => c.city && c.city !== 'غير محدد').map((c) => <option key={c.city} value={c.city}>{c.city}</option>)}
                    </select>
                    <select value={cuCat} onChange={(e) => setCuCat(e.target.value)}
                        className="px-2 py-2 rounded-lg text-xs font-bold bg-[var(--body-bg)] border border-[var(--border-color)] text-[var(--text-primary)] outline-none">
                        <option value="all">🏷 كل الأقسام</option>
                        {((data.categories || []) as GeoRow[]).filter((c) => c.category).map((c) => <option key={c.category} value={c.category}>{catLabel(c.category)}</option>)}
                    </select>
                    <button type="button"
                        onClick={() => { setCuStart(isoDay(-30)); setCuEnd(isoDay(0)); setCuFrom(0); setCuTo(23); setCuDow('all'); setCuCity('all'); setCuCat('all'); }}
                        className="px-2 py-2 rounded-lg text-xs font-extrabold bg-[var(--body-bg)] border border-[var(--border-color)] text-[var(--text-secondary)] active:scale-95">
                        ↺ إعادة الضبط
                    </button>
                </div>

                {cuLoading ? (
                    <div className="h-24 bg-[var(--gray-100)] rounded-xl animate-pulse" />
                ) : cuData?.totals ? (() => {
                    const tt = cuData.totals;
                    const b = Number(tt.bookings) || 0;
                    const ok = Number(tt.completed) || 0;
                    const bad = Number(tt.cancelled) || 0;
                    const attributed = (Number(tt.cancel_buyer) || 0) + (Number(tt.cancel_seller) || 0) + (Number(tt.cancel_system) || 0);
                    const domCancel = attributed === 0 ? null
                        : Number(tt.cancel_seller) >= Number(tt.cancel_buyer) && Number(tt.cancel_seller) >= Number(tt.cancel_system) ? 'التاجر 🏪'
                        : Number(tt.cancel_system) >= Number(tt.cancel_buyer) ? 'انتهاء المهلة ⏱' : 'المشتري 🛒';
                    const daily: { d: string; n: number }[] = cuData.daily || [];
                    const half = Math.floor(daily.length / 2);
                    const firstHalf = daily.slice(0, half).reduce((a, r) => a + r.n, 0);
                    const secondHalf = daily.slice(half).reduce((a, r) => a + r.n, 0);
                    const trend = daily.length < 4 ? null : secondHalf > firstHalf * 1.2 ? '📈 صاعد' : secondHalf < firstHalf * 0.8 ? '📉 هابط' : '➡️ مستقر';
                    const topStore = (cuData.top_stores || [])[0];
                    const topCat0 = (cuData.top_categories || [])[0];
                    const hrs: HourRow[] = cuData.hours || [];
                    const bestH = hrs.length ? [...hrs].sort((a, c) => c.n - a.n)[0] : null;
                    return (
                        <>
                            <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
                                <Tile icon="📦" label="حجوزات" value={arNum(b)} sub={`${arNum(Number(tt.qty) || 0)} قطعة`} />
                                <Tile icon="✅" label="مكتمل" value={arNum(ok)} sub={b ? `${Math.round((ok / b) * 100)}٪` : '—'} />
                                <Tile icon="🚫" label="ملغى" value={arNum(bad)} sub={b ? `${Math.round((bad / b) * 100)}٪` : '—'} />
                                <Tile icon="🛒" label="مشترون" value={arNum(Number(tt.buyers) || 0)} />
                                <Tile icon="🏪" label="تجار مستفيدون" value={arNum(Number(tt.sellers) || 0)} />
                            </div>
                            <div className="grid grid-cols-3 md:grid-cols-4 gap-2">
                                <Tile icon="👁" label="مشاهدات" value={arNum(Number(tt.views) || 0)} />
                                <Tile icon="👆" label="نقرات" value={arNum(Number(tt.clicks) || 0)} />
                                <Tile icon="🔎" label="عمليات بحث" value={arNum(Number(tt.searches) || 0)} />
                                <Tile icon="🏷" label="عروض نُشرت" value={arNum(Number(tt.deals_published) || 0)} />
                            </div>

                            {daily.length > 1 && (
                                <div>
                                    <div className="font-bold text-[11px] text-[var(--text-primary)] mb-1">📈 الاتجاه اليومي للشريحة</div>
                                    <Bars data={daily.map((r, i) => ({ label: daily.length <= 14 || i % Math.ceil(daily.length / 10) === 0 ? r.d.slice(5) : '', n: r.n }))} color="#8b5cf6" height={80} />
                                </div>
                            )}
                            {hrs.length > 0 && (
                                <div>
                                    <div className="font-bold text-[11px] text-[var(--text-primary)] mb-1">⏰ توزيع ساعات الشريحة</div>
                                    <Bars data={(() => { const m = new Map(hrs.map((r) => [r.h, r.n])); return Array.from({ length: 24 }, (_, h) => ({ label: h % 3 === 0 ? String(h) : '', n: m.get(h) || 0 })); })()} color="#10b981" height={80} />
                                </div>
                            )}

                            {/* أقوى عناصر الشريحة */}
                            <div className="grid md:grid-cols-2 gap-2 text-[11px]">
                                {([
                                    ['🏙 المدن', cuData.top_cities], ['🏷 الأقسام', cuData.top_categories],
                                    ['🏬 المولات', cuData.top_malls], ['🏪 المتاجر', cuData.top_stores],
                                ] as [string, any[]][]).filter(([, rows]) => (rows || []).length > 0).map(([label, rows]) => (
                                    <div key={label} className="bg-[var(--body-bg)] rounded-xl p-2.5">
                                        <div className="font-extrabold text-[var(--text-primary)] mb-1">{label}</div>
                                        {(rows as any[]).slice(0, 4).map((r, i) => (
                                            <div key={i} className="flex items-center justify-between text-[var(--text-secondary)]">
                                                <span className="truncate ml-2">{label === '🏷 الأقسام' ? catLabel(r.name) : r.name}</span>
                                                <span className="tabular-nums whitespace-nowrap">📦 {arNum(Number(r.n))} • ✅ {arNum(Number(r.ok))} • 🚫 {arNum(Number(r.bad))}</span>
                                            </div>
                                        ))}
                                    </div>
                                ))}
                            </div>
                            {(cuData.top_deals || []).length > 0 && (
                                <div className="flex flex-wrap gap-1.5 text-[11px]">
                                    {(cuData.top_deals as any[]).map((r, i) => (
                                        <span key={i} className="font-bold bg-[var(--body-bg)] border border-[var(--border-color)] rounded-full px-3 py-1.5 text-[var(--text-primary)]">🏆 «{r.name}» — {r.shop} ×{arNum(Number(r.n))}</span>
                                    ))}
                                </div>
                            )}

                            {/* 🤖 حكم المحلل الآلي على الشريحة */}
                            <div className="bg-[var(--body-bg)] rounded-xl p-3 text-[11px] leading-relaxed">
                                <div className="font-extrabold text-[var(--text-primary)] mb-1">🤖 حكم المحلل على هذه الشريحة:</div>
                                <ul className="pr-4 list-disc text-[var(--text-secondary)] space-y-0.5">
                                    {b === 0 && <li>لا حجوزات في هذه الشريحة — إن كان فيها مشاهدات/بحث فهي طلب كامن بلا معروض مناسب، وإلا فهي شريحة خاملة لا تستحق ميزانية الآن.</li>}
                                    {b > 0 && <li>الاكتمال {Math.round((ok / b) * 100)}٪ {ok / b >= 0.7 ? '— صحي ✅' : ok / b >= 0.5 ? '— مقبول، راقبه 👀' : '— ضعيف: راجع مدد التحضير والتذكيرات ⚠️'}.</li>}
                                    {bad > 0 && <li>الإلغاء {Math.round((bad / b) * 100)}٪{domCancel ? ` — الأكثر إلغاءً هنا: ${domCancel}` : ' — كلها قبل بدء تتبع «من ألغى»'}.</li>}
                                    {trend && <li>الاتجاه خلال الفترة: {trend}.</li>}
                                    {bestH && <li>أفضل ساعة في الشريحة: {fmtHour(bestH.h)} ({arNum(bestH.n)} حجزاً) — اجدول حملاتك قبلها بساعة.</li>}
                                    {topStore && <li>الأقوى هنا: «{topStore.name}» بـ{arNum(Number(topStore.n))} حجزاً{topCat0 ? ` — وأنشط قسم: ${catLabel(topCat0.name)}` : ''}.</li>}
                                    {b > 0 && Number(tt.sellers) === 1 && <li>⚠️ كل حجوزات الشريحة من تاجر واحد — الشريحة هشة، استقطب منافساً له.</li>}
                                </ul>
                            </div>
                        </>
                    );
                })() : <div className="text-[11px] text-[var(--text-secondary)]">تعذّر التحليل — عدّل الفلاتر للمحاولة.</div>}
            </section>

            {/* 📋 v12.41 — الخلاصة التنفيذية (تقرير الرئيس التنفيذي) */}
            {(() => {
                const fn = funnelData?.funnel || {};
                const b = Number(fn.bookings) || 0;
                const comp = Number(fn.completed) || 0;
                const canc = Number(fn.cancelled) || 0;
                const compPct = b ? Math.round((comp / b) * 100) : 0;
                const cancPct = b ? Math.round((canc / b) * 100) : 0;
                const topCity = ((data.cities || []) as GeoRow[])[0];
                const topCat = ((data.categories || []) as GeoRow[])[0];
                const critical = diagnosis.items.find((i) => i.severity === 'critical');
                const ret = funnelData?.retention || [];
                const retTot = ret.reduce((a: number, r: any) => a + Number(r.buyers || 0), 0);
                const retBack = ret.reduce((a: number, r: any) => a + Number(r.returned || 0), 0);
                return (
                    <section className="bg-[var(--card-bg)] border-2 border-slate-400/40 rounded-2xl p-4">
                        <h3 className="font-extrabold text-[var(--text-primary)] text-sm mb-1.5">📋 الخلاصة التنفيذية — قرارك في سطور</h3>
                        <div className="text-xs text-[var(--text-primary)] leading-relaxed">
                            خلال آخر {arNum(days)} يوماً: <b>{arNum(b)}</b> حجزاً، اكتمل استلام <b>{arNum(comp)}</b> ({arNum(compPct)}٪)
                            وأُلغي <b>{arNum(canc)}</b> ({arNum(cancPct)}٪). أقوى مدينة <b>{topCity?.city ?? '—'}</b> وأقوى قسم <b>{catLabel(topCat?.category)}</b>.
                            {retTot > 0 && <> من كل من جرّب الشراء، عاد <b>{arNum(retBack)}</b> من <b>{arNum(retTot)}</b> للحجز مجدداً.</>}
                        </div>
                        <div className="text-xs mt-2 font-bold" style={{ color: critical ? '#ef4444' : '#10b981' }}>
                            {critical
                                ? <>🎯 القرار الأهم الآن: {critical.title} — {critical.fix?.[0] || critical.evidence}</>
                                : '🎯 لا يوجد خطر عاجل — القرار الأنسب: نفّذ خطوة واحدة من خطة التسويق أدناه لتسريع النمو.'}
                        </div>
                    </section>
                );
            })()}

            {/* مؤشرات سريعة */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Tile icon="📦" label={`حجوزات آخر ${arNum(days)} يوم`} value={arNum(Number(funnel.bookings) || 0)}
                    sub={`${arNum(Number(funnel.completed) || 0)} مكتمل`} />
                <Tile icon="⏰" label="أقوى ٣ ساعات" value={(data?.peak_hours || []).length
                        ? [...data.peak_hours].sort((a: HourRow, b: HourRow) => b.n - a.n).slice(0, 3).map((r: HourRow) => fmtHour(r.h)).join(' · ')
                        : '—'}
                    sub={topHour ? `الأعلى: ${arNum(topHour.n)} حجزاً — التفصيل الكامل في «التحكم بالساعات»` : 'لا بيانات بعد'} />
                <Tile icon="🔁" label="معدل عودة المشترين" value={`${Number(buyers.with_booking) ? Math.round(((Number(buyers.repeaters) || 0) / Number(buyers.with_booking)) * 100) : 0}٪`}
                    sub={`${arNum(Number(buyers.active_30) || 0)} نشط آخر ٣٠ يوم`} />
                <Tile icon="💳" label="تجديد الشهر الحالي" value={lastRenew && lastRenew.expired ? `${Math.round((lastRenew.renewed / lastRenew.expired) * 100)}٪` : '—'}
                    sub={lastRenew ? `${arNum(lastRenew.renewed)} من ${arNum(lastRenew.expired)} جدّدوا` : 'لا انتهاءات بعد'} />
            </div>

            {/* 🧠 v12.42 — التشخيص الشامل: درجة الصحة + مكمن الخلل + العلاج */}
            <section className="space-y-2">
                <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl p-4">
                    <div className="flex items-center gap-4 flex-wrap">
                        <div className="text-center">
                            <div className="text-3xl font-black tabular-nums" style={{ color: diagnosis.health >= 75 ? '#10b981' : diagnosis.health >= 50 ? '#f59e0b' : '#ef4444' }}>
                                {arNum(diagnosis.health)}٪
                            </div>
                            <div className="text-[10px] font-bold text-[var(--text-secondary)]">صحة المنصة</div>
                        </div>
                        <div className="flex-1 min-w-[180px]">
                            <div className="h-3 bg-[var(--body-bg)] rounded-full overflow-hidden">
                                <div className="h-full rounded-full transition-all" style={{ width: `${diagnosis.health}%`, background: diagnosis.health >= 75 ? '#10b981' : diagnosis.health >= 50 ? '#f59e0b' : '#ef4444' }} />
                            </div>
                            <div className="text-[11px] text-[var(--text-secondary)] mt-1.5">
                                {diagnosis.weakest.length
                                    ? <>أضعف النقاط حالياً: <b className="text-[var(--text-primary)]">{diagnosis.weakest.join(' • ')}</b> — علاجها مفصّل في التشخيصات أدناه.</>
                                    : 'لا نقاط ضعف جوهرية — المؤشرات كلها ضمن الصحي.'}
                            </div>
                        </div>
                    </div>
                </div>

                <h3 className="font-extrabold text-[var(--text-primary)] text-sm">🧠 التشخيص الشامل — مكمن الخلل والعلاج (الأخطر أولاً)</h3>
                {diagnosis.items.length === 0 && <div className="text-xs text-[var(--text-secondary)] bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl p-4">لا توجد مشاكل مرصودة حالياً.</div>}
                {diagnosis.items.map((dg) => (
                    <div key={dg.id} className="rounded-2xl p-3.5" style={{ background: SEV_STYLE[dg.severity].bg, border: `1.5px solid ${SEV_STYLE[dg.severity].border}` }}>
                        <div className="font-extrabold text-sm text-[var(--text-primary)]">{dg.icon} {dg.title}</div>
                        <div className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">📌 <b>الدليل:</b> {dg.evidence}</div>
                        {dg.why && <div className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">🔍 <b className="text-[var(--text-primary)]">مكمن الخلل:</b> {dg.why}</div>}
                        {dg.fix && dg.fix.length > 0 && (
                            <div className="text-xs mt-1.5">
                                <b className="text-[var(--text-primary)]">🛠 العلاج:</b>
                                <ol className="pr-5 list-decimal text-[var(--text-secondary)] leading-relaxed mt-0.5 space-y-0.5">
                                    {dg.fix.map((s, i) => <li key={i}>{s}</li>)}
                                </ol>
                            </div>
                        )}
                        {dg.impact && <div className="text-[11px] mt-1.5 font-bold" style={{ color: '#10b981' }}>📈 الأثر المتوقع: <span className="font-normal">{dg.impact}</span></div>}
                    </div>
                ))}
            </section>

            {/* 📉 v12.41 — قمع التحويل: من دخل الصفحة حتى الاستلام + من ألغى */}
            {funnelData && (() => {
                const fn = funnelData.funnel || {};
                const steps = [
                    { label: 'دخل صفحة متجر', n: Number(fn.store_views) || 0, icon: '🏪' },
                    { label: 'شاهد عرضاً', n: Number(fn.deal_views) || 0, icon: '👁' },
                    { label: 'نقر على عرض', n: Number(fn.clicks) || 0, icon: '👆' },
                    { label: 'حجز', n: Number(fn.bookings) || 0, icon: '📦' },
                    { label: 'استلم (مكتمل)', n: Number(fn.completed) || 0, icon: '✅' },
                ];
                const maxStep = Math.max(1, ...steps.map((s) => s.n));
                const canc = Number(fn.cancelled) || 0;
                return (
                    <section className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl p-4 space-y-3">
                        <h3 className="font-extrabold text-[var(--text-primary)] text-sm">📉 قمع التحويل — من الدخول حتى الاستلام</h3>
                        <div className="space-y-1.5">
                            {steps.map((s, i) => (
                                <div key={s.label} className="flex items-center gap-2 text-[11px]">
                                    <span className="w-28 shrink-0 font-bold text-[var(--text-primary)]">{s.icon} {s.label}</span>
                                    <div className="flex-1 bg-[var(--body-bg)] rounded-full h-5 overflow-hidden">
                                        <div className="h-full rounded-full flex items-center px-2 text-[10px] font-black text-white"
                                            style={{ width: `${Math.max(6, (s.n / maxStep) * 100)}%`, background: i === 4 ? '#10b981' : '#6366f1', minWidth: 34 }}>
                                            {arNum(s.n)}
                                        </div>
                                    </div>
                                    {i > 0 && steps[i - 1].n > 0 && (
                                        <span className="w-12 shrink-0 text-[10px] text-[var(--text-secondary)] tabular-nums">{Math.round((s.n / steps[i - 1].n) * 100)}٪</span>
                                    )}
                                </div>
                            ))}
                        </div>
                        <div className="text-[10px] text-[var(--text-secondary)]">مراحل الدخول والمشاهدة والنقر بدأ تسجيلها الزمني في v12.38 — تكتمل خلال أيام. الحجوزات والاستلام تاريخ كامل.</div>

                        <div className="font-bold text-xs text-[var(--text-primary)]">🚫 الإلغاءات ({arNum(canc)}) — من ألغى؟</div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                            <Tile icon="🛒" label="ألغاها المشتري" value={arNum(Number(fn.cancel_buyer) || 0)} />
                            <Tile icon="🏪" label="ألغاها التاجر" value={arNum(Number(fn.cancel_seller) || 0)} />
                            <Tile icon="⏱" label="انتهت المهلة (تلقائي)" value={arNum(Number(fn.cancel_system) || 0)} />
                            <Tile icon="🗂" label="قديمة (قبل التتبع)" value={arNum(Number(fn.cancel_legacy) || 0)} />
                        </div>
                        <div className="text-[10px] text-[var(--text-secondary)]">
                            بدأنا اليوم تسجيل «من ألغى» لكل إلغاء جديد (موقع + بوتات + انتهاء المهلة) — القديمة تظهر «قبل التتبع».
                            إلغاء التاجر المتكرر مؤشر خطير (سلعة غير متوفرة فعلياً)، وانتهاء المهلة يعني مشترين يحجزون ولا يستلمون.
                        </div>

                        {(funnelData.retention || []).length > 0 && (
                            <>
                                <div className="font-bold text-xs text-[var(--text-primary)]">🔁 الاحتفاظ بالمشترين (حسب شهر أول حجز)</div>
                                <div className="space-y-1">
                                    {(funnelData.retention as any[]).map((r) => (
                                        <div key={r.cohort} className="flex items-center justify-between text-[11px] bg-[var(--body-bg)] rounded-lg px-2.5 py-1.5">
                                            <span className="font-bold text-[var(--text-primary)]">{r.cohort}</span>
                                            <span className="text-[var(--text-secondary)] tabular-nums">
                                                {arNum(Number(r.buyers) || 0)} مشترٍ جديد • عاد منهم {arNum(Number(r.returned) || 0)}
                                                {Number(r.buyers) > 0 && ` (${Math.round((Number(r.returned) / Number(r.buyers)) * 100)}٪)`}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}
                    </section>
                );
            })()}

            {/* 🚨 v12.41 — فلاتر «الأسوأ» التنفيذية: أنت تحدد البعد والمقياس والحد */}
            {funnelData && (() => {
                const rows: any[] = (funnelData[worstDim] || []).filter((r: any) => Number(r.bookings) >= worstMin);
                const sorted = [...rows].sort((a, b) => {
                    if (worstMetric === 'least_bookings') return Number(a.bookings) - Number(b.bookings);
                    if (worstMetric === 'seller_cancels') return Number(b.c_seller || 0) - Number(a.c_seller || 0);
                    return (Number(b.cancelled) / Math.max(1, Number(b.bookings))) - (Number(a.cancelled) / Math.max(1, Number(a.bookings)));
                }).slice(0, 10);
                const nameOf = (r: any) => worstDim === 'by_city' ? r.city : worstDim === 'by_category' ? catLabel(r.category) : `${r.shop}${r.city ? ` (${r.city})` : ''}`;
                return (
                    <section className="bg-[var(--card-bg)] border-2 border-rose-200 rounded-2xl p-4 space-y-2.5">
                        <h3 className="font-extrabold text-[var(--text-primary)] text-sm">🚨 راصد الأسوأ — أنت تحدد المعيار</h3>
                        <div className="flex flex-wrap gap-2 items-center">
                            <select value={worstDim} onChange={(e) => setWorstDim(e.target.value as any)}
                                className="flex-1 min-w-[110px] px-2.5 py-2 rounded-lg text-xs font-bold bg-[var(--body-bg)] border border-[var(--border-color)] text-[var(--text-primary)] outline-none">
                                <option value="by_city">🏙 المدن</option>
                                <option value="by_category">🏷 الأقسام</option>
                                <option value="by_store">🏪 المتاجر</option>
                            </select>
                            <select value={worstMetric} onChange={(e) => setWorstMetric(e.target.value as any)}
                                className="flex-1 min-w-[150px] px-2.5 py-2 rounded-lg text-xs font-bold bg-[var(--body-bg)] border border-[var(--border-color)] text-[var(--text-primary)] outline-none">
                                <option value="cancel_rate">الأعلى نسبة إلغاء</option>
                                <option value="least_bookings">الأقل حجوزات (الأقل استفادة)</option>
                                <option value="seller_cancels">الأكثر إلغاءً من التاجر نفسه</option>
                            </select>
                            <label className="flex items-center gap-1.5 text-[11px] font-bold text-[var(--text-secondary)]">
                                حد أدنى للحجوزات:
                                <input type="number" min={0} value={worstMin}
                                    onChange={(e) => setWorstMin(Math.max(0, Number(e.target.value) || 0))}
                                    className="w-16 px-2 py-1.5 rounded-lg bg-[var(--body-bg)] border border-[var(--border-color)] text-center text-[var(--text-primary)] outline-none" />
                            </label>
                        </div>
                        <div className="space-y-1.5">
                            {sorted.map((r, i) => {
                                const rate = Math.round((Number(r.cancelled) / Math.max(1, Number(r.bookings))) * 100);
                                return (
                                    <div key={i} className="flex items-center justify-between text-[11px] bg-[var(--body-bg)] rounded-lg px-2.5 py-2 gap-2 flex-wrap">
                                        <span className="font-bold text-[var(--text-primary)]">{i + 1}. {nameOf(r)}</span>
                                        <span className="text-[var(--text-secondary)] tabular-nums">
                                            📦 {arNum(Number(r.bookings))} • ✅ {arNum(Number(r.completed))} • 🚫 {arNum(Number(r.cancelled))} ({arNum(rate)}٪)
                                            {Number(r.c_seller) > 0 && <span className="text-rose-500 font-bold"> • التاجر ألغى {arNum(Number(r.c_seller))}</span>}
                                        </span>
                                    </div>
                                );
                            })}
                            {sorted.length === 0 && <div className="text-[11px] text-[var(--text-secondary)]">لا نتائج فوق الحد المحدد — خفّض «الحد الأدنى».</div>}
                        </div>
                        <div className="text-[10px] text-[var(--text-secondary)]">💡 متجر يكثر إلغاؤه بنفسه = سلعة غير متوفرة فعلاً (أرسل له تنبيهاً من الإرسال المستهدف). مدينة عالية الإلغاء = راجع مدد التحضير ومواعيد المحلات فيها.</div>
                    </section>
                );
            })()}

            {/* ⏰ v12.42 — التحكم الكامل بالساعات (كل الساعات + مدى تختاره أنت) */}
            <section className="bg-[var(--card-bg)] border-2 border-emerald-200 rounded-2xl p-4 space-y-3">
                <h3 className="font-extrabold text-[var(--text-primary)] text-sm">⏰ التحكم الكامل بالساعات — كل ساعة بكل تفاصيلها</h3>
                <div>
                    <div className="font-bold text-xs text-[var(--text-primary)] mb-1">كل الساعات الـ٢٤ (حجوزات، توقيت الرياض)</div>
                    <Bars data={hourBars} color="#10b981" />
                    <div className="font-bold text-xs text-[var(--text-primary)] mb-1 mt-2">📅 أيام الأسبوع</div>
                    <Bars data={dayBars} color="#6366f1" />
                </div>

                {/* خريطة الأسبوع الحرارية: يوم × ساعة — اضغط أي خلية لتحليلها فوراً */}
                {hoursData?.heatmap && (
                    <div>
                        <div className="font-bold text-xs text-[var(--text-primary)] mb-1.5">🗓 خريطة الأسبوع (يوم × ساعة) — الأغمق = الأنشط، واضغط أي خلية لتحليلها</div>
                        <div className="overflow-x-auto" style={{ direction: 'ltr' }}>
                            {(() => {
                                const hm = new Map<string, number>((hoursData.heatmap as any[]).map((c) => [`${c.dow}-${c.h}`, Number(c.n)]));
                                const maxN = Math.max(1, ...(hoursData.heatmap as any[]).map((c) => Number(c.n)));
                                return (
                                    <div className="inline-block min-w-full">
                                        {Array.from({ length: 7 }, (_, dow) => (
                                            <div key={dow} className="flex items-center gap-[2px] mb-[2px]">
                                                <span className="w-12 shrink-0 text-[9px] font-bold text-[var(--text-secondary)] text-right pl-1" style={{ direction: 'rtl' }}>{DOW_AR[dow]}</span>
                                                {Array.from({ length: 24 }, (_, h) => {
                                                    const n = hm.get(`${dow}-${h}`) || 0;
                                                    const active = hrDow !== 'all' ? hrDow === dow : true;
                                                    return (
                                                        <button key={h} type="button"
                                                            onClick={() => { setHrDow(dow); setHrFrom(h); setHrTo(h); }}
                                                            title={`${DOW_AR[dow]} ${fmtHour(h)} — ${n} حجز`}
                                                            className="flex-1 rounded-[3px]"
                                                            style={{
                                                                minWidth: 10, height: 16, cursor: 'pointer',
                                                                background: n === 0 ? 'var(--body-bg)' : `rgba(16,185,129,${0.25 + 0.75 * (n / maxN)})`,
                                                                outline: active ? 'none' : '1px solid transparent',
                                                                opacity: active ? 1 : 0.45,
                                                            }} />
                                                    );
                                                })}
                                            </div>
                                        ))}
                                        <div className="flex items-center gap-[2px]">
                                            <span className="w-12 shrink-0" />
                                            {Array.from({ length: 24 }, (_, h) => (
                                                <span key={h} className="flex-1 text-center text-[8px] text-[var(--text-secondary)]" style={{ minWidth: 10 }}>{h % 3 === 0 ? h : ''}</span>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>
                    </div>
                )}

                {/* أدوات التحكم: من / إلى / اليوم */}
                <div className="flex flex-wrap gap-2 items-center bg-[var(--body-bg)] rounded-xl p-2.5">
                    <span className="text-[11px] font-bold text-[var(--text-primary)]">حلّل المدى:</span>
                    <label className="flex items-center gap-1 text-[11px] font-bold text-[var(--text-secondary)]">
                        من
                        <select value={hrFrom} onChange={(e) => setHrFrom(Number(e.target.value))}
                            className="px-2 py-1.5 rounded-lg text-xs font-bold bg-[var(--card-bg)] border border-[var(--border-color)] text-[var(--text-primary)] outline-none">
                            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{fmtHour(h)}</option>)}
                        </select>
                    </label>
                    <label className="flex items-center gap-1 text-[11px] font-bold text-[var(--text-secondary)]">
                        إلى
                        <select value={hrTo} onChange={(e) => setHrTo(Number(e.target.value))}
                            className="px-2 py-1.5 rounded-lg text-xs font-bold bg-[var(--card-bg)] border border-[var(--border-color)] text-[var(--text-primary)] outline-none">
                            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{fmtHour(h)}</option>)}
                        </select>
                    </label>
                    <select value={hrDow === 'all' ? 'all' : String(hrDow)} onChange={(e) => setHrDow(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                        className="px-2 py-1.5 rounded-lg text-xs font-bold bg-[var(--card-bg)] border border-[var(--border-color)] text-[var(--text-primary)] outline-none">
                        <option value="all">📅 كل الأيام</option>
                        {DOW_AR.map((d0, i) => <option key={i} value={i}>{d0}</option>)}
                    </select>
                    <span className="text-[10px] text-[var(--text-secondary)]">— يدعم الالتفاف عبر منتصف الليل (مثل ١٠م → ٤ص)</span>
                </div>

                {/* نتائج المدى المحدد */}
                {hoursLoading ? (
                    <div className="h-20 bg-[var(--gray-100)] rounded-xl animate-pulse" />
                ) : hoursData?.totals ? (
                    <>
                        <div className="font-bold text-xs text-[var(--text-primary)]">
                            نتائج {hrDow === 'all' ? 'كل الأيام' : DOW_AR[hrDow as number]} من {fmtHour(hrFrom)} إلى {fmtHour(hrTo)} (آخر {arNum(days)} يوماً):
                        </div>
                        <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
                            <Tile icon="📦" label="حجوزات" value={arNum(Number(hoursData.totals.bookings) || 0)} sub={`✅ ${arNum(Number(hoursData.totals.completed) || 0)} • 🚫 ${arNum(Number(hoursData.totals.cancelled) || 0)}`} />
                            <Tile icon="🛒" label="مشترون نشطون" value={arNum(Number(hoursData.totals.buyers) || 0)} />
                            <Tile icon="🏪" label="تجار مستفيدون" value={arNum(Number(hoursData.totals.sellers) || 0)} />
                            <Tile icon="👁" label="مشاهدات ونقرات" value={arNum((Number(hoursData.totals.views) || 0) + (Number(hoursData.totals.clicks) || 0))} sub={`🔎 ${arNum(Number(hoursData.totals.searches) || 0)} بحث`} />
                            <Tile icon="🏷" label="عروض نُشرت" value={arNum(Number(hoursData.totals.deals_published) || 0)} />
                        </div>
                        {(((hoursData.top_categories || []) as any[]).length > 0 || ((hoursData.top_cities || []) as any[]).length > 0) && (
                            <div className="flex flex-wrap gap-1.5 text-[11px]">
                                {(hoursData.top_categories as any[]).map((c) => (
                                    <span key={c.category} className="font-bold bg-[var(--body-bg)] border border-[var(--border-color)] rounded-full px-3 py-1.5 text-[var(--text-primary)]">🏷 {catLabel(c.category)} ×{arNum(Number(c.n))}</span>
                                ))}
                                {(hoursData.top_cities as any[]).map((c) => (
                                    <span key={c.city} className="font-bold bg-[var(--body-bg)] border border-[var(--border-color)] rounded-full px-3 py-1.5 text-[var(--text-primary)]">🏙 {c.city} ×{arNum(Number(c.n))}</span>
                                ))}
                            </div>
                        )}
                    </>
                ) : null}
                <div className="text-[10px] text-[var(--text-secondary)]">💡 استخدمه لقرارات دقيقة: متى تجدول الحملات، أي ساعات تنصح تجار مدينة معينة بالنشر فيها، ومتى يكون البث الجماعي أعلى وصولاً.</div>
            </section>

            {/* 📈 النمو الشهري */}
            <section className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl p-4">
                <h3 className="font-extrabold text-[var(--text-primary)] text-sm mb-1">📈 الحجوزات شهرياً (٦ أشهر)</h3>
                <Bars data={monthBars} color="#f59e0b" height={100} />
                <div className="grid grid-cols-3 gap-2 mt-2 text-center text-[11px]">
                    {(data.monthly || []).slice(-3).map((m: MonthRow) => (
                        <div key={m.mon} className="bg-[var(--body-bg)] rounded-xl p-2">
                            <div className="font-black text-[var(--text-primary)]">{m.mon.slice(5)}/{m.mon.slice(2, 4)}</div>
                            <div className="text-[var(--text-secondary)]">🏪 {arNum(m.new_sellers)} تاجر جديد</div>
                            <div className="text-[var(--text-secondary)]">🛒 {arNum(m.new_buyers)} مشترٍ جديد</div>
                        </div>
                    ))}
                </div>
            </section>

            {/* 🏪 صحة التجار */}
            <section className="space-y-2">
                <h3 className="font-extrabold text-[var(--text-primary)] text-sm">🏪 صحة التجار (الأخطر أولاً) — اضغط تاجراً للتقرير والتوصية</h3>
                {/* v12.39 — فلترة: مدينة / تصنيف / حالة (تنعكس أيضاً على الإرسال المستهدف بالأسفل) */}
                <div className="flex flex-wrap gap-2 bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl p-2.5">
                    <select value={fCity} onChange={(e) => setFCity(e.target.value)}
                        className="flex-1 min-w-[110px] px-2.5 py-2 rounded-lg text-xs font-bold bg-[var(--body-bg)] border border-[var(--border-color)] text-[var(--text-primary)] outline-none">
                        <option value="all">🏙 كل المدن</option>
                        {cityOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <select value={fCat} onChange={(e) => setFCat(e.target.value)}
                        className="flex-1 min-w-[110px] px-2.5 py-2 rounded-lg text-xs font-bold bg-[var(--body-bg)] border border-[var(--border-color)] text-[var(--text-primary)] outline-none">
                        <option value="all">🏷 كل التصنيفات</option>
                        {catOptions.map((c) => <option key={c} value={c}>{catLabel(c)}</option>)}
                    </select>
                    <select value={fStatus} onChange={(e) => setFStatus(e.target.value as any)}
                        className="flex-1 min-w-[130px] px-2.5 py-2 rounded-lg text-xs font-bold bg-[var(--body-bg)] border border-[var(--border-color)] text-[var(--text-primary)] outline-none">
                        <option value="all">📋 كل الحالات</option>
                        <option value="weak">🟡 الضعاف (خطر ٣٠+)</option>
                        <option value="risk">🔴 الخطرون (خطر ٦٠+)</option>
                        <option value="expired">⛔ منتهو الاشتراك</option>
                        <option value="nodeals">📭 بلا عروض نشطة</option>
                    </select>
                    <span className="text-[11px] font-bold text-[var(--text-secondary)] self-center whitespace-nowrap">= {arNum(filteredSellers.length)} تاجر</span>
                </div>
                {filteredSellers.map((s) => {
                    const risk = sellerRisk(s);
                    const dl = daysLeft(s.expires_at);
                    const trend = s.bookings_30 > s.bookings_prev30 ? '↗️' : s.bookings_30 < s.bookings_prev30 ? '↘️' : '→';
                    const riskColor = risk.score >= 60 ? '#ef4444' : risk.score >= 30 ? '#f59e0b' : '#10b981';
                    const isOpen = openSeller === s.id;
                    return (
                        <div key={s.id} className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl overflow-hidden">
                            <button onClick={() => openReport(s)} className="w-full text-right p-3.5">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-extrabold text-sm text-[var(--text-primary)]">{s.shop}</span>
                                    {s.city && <span className="text-[10px] text-[var(--text-secondary)]">📍 {s.city}</span>}
                                    <span className="text-[10px] font-black text-white px-2 py-0.5 rounded-full mr-auto" style={{ background: riskColor }}>
                                        {risk.score >= 60 ? 'خطر عالٍ' : risk.score >= 30 ? 'انتبه' : 'سليم'} {arNum(risk.score)}
                                    </span>
                                </div>
                                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[var(--text-secondary)] mt-1.5">
                                    <span>📦 {arNum(s.bookings_30)} حجز/٣٠ي {trend}</span>
                                    <span>👁 {arNum(s.deal_views_30 + s.store_views_30)} زيارة</span>
                                    <span>🏷 {arNum(s.active_deals)} عرض نشط</span>
                                    <span>⭐ {s.rating_avg ?? '—'}</span>
                                    <span>{dl === null ? '🆓 بلا اشتراك مؤقت' : dl < 0 ? `⛔ منتهٍ منذ ${arNum(-dl)} يوم` : `⏳ ${arNum(dl)} يوم متبقٍ`}</span>
                                </div>
                                {risk.reasons.length > 0 && (
                                    <div className="text-[11px] mt-1.5" style={{ color: riskColor }}>
                                        السبب المرجّح: {risk.reasons.slice(0, 2).join(' + ')}
                                    </div>
                                )}
                            </button>

                            {isOpen && (
                                <div className="border-t border-[var(--border-color)] p-3.5 space-y-3 bg-[var(--body-bg)]">
                                    {reportLoading ? (
                                        <div className="h-16 bg-[var(--gray-100)] rounded-xl animate-pulse" />
                                    ) : report ? (
                                        <>
                                            <div className="grid grid-cols-2 gap-2 text-[11px]">
                                                <div className="bg-[var(--card-bg)] rounded-xl p-2.5">
                                                    <div className="font-bold text-[var(--text-primary)] mb-1">⏰ أفضل ساعة لتصنيفه بمدينته</div>
                                                    <div className="text-[var(--text-secondary)]">
                                                        {report.cat_city_hours?.length
                                                            ? fmtHour([...report.cat_city_hours].sort((a: HourRow, b: HourRow) => b.n - a.n)[0].h) + ` (${catLabel(report.top_category)})`
                                                            : 'لا بيانات كافية بعد'}
                                                    </div>
                                                </div>
                                                <div className="bg-[var(--card-bg)] rounded-xl p-2.5">
                                                    <div className="font-bold text-[var(--text-primary)] mb-1">⚖️ مقارنة بمنافسيه (نفس المدينة/التصنيف)</div>
                                                    <div className="text-[var(--text-secondary)]">
                                                        هو: {arNum(s.bookings_30)} حجز • متوسطهم: {report.cat_city_avg_bookings_30 ?? '—'} حجز/٣٠ يوم
                                                    </div>
                                                </div>
                                                {report.top_deal?.item_name && (
                                                    <div className="bg-[var(--card-bg)] rounded-xl p-2.5 col-span-2">
                                                        <div className="font-bold text-[var(--text-primary)] mb-1">🏆 أفضل منتجاته</div>
                                                        <div className="text-[var(--text-secondary)]">«{report.top_deal.item_name}» — {arNum(report.top_deal.bookings)} حجزاً، {arNum(report.top_deal.views)} مشاهدة</div>
                                                    </div>
                                                )}
                                                {/* v12.40 — أقرب منافسيه المباشرين (نفس المدينة + التصنيف) */}
                                                {(competitors?.competitors || []).length > 0 && (
                                                    <div className="bg-[var(--card-bg)] rounded-xl p-2.5 col-span-2">
                                                        <div className="font-bold text-[var(--text-primary)] mb-1">⚔️ منافسوه المباشرون ({competitors.city || '—'} / {catLabel(competitors.category)})</div>
                                                        <div className="space-y-1">
                                                            {competitors.competitors.map((c: any) => (
                                                                <div key={c.id} className="flex items-center justify-between text-[var(--text-secondary)]">
                                                                    <span className="font-bold text-[var(--text-primary)]">{c.shop}</span>
                                                                    <span className="tabular-nums">📦 {arNum(c.bookings_30)}/٣٠ي • 🏷 {arNum(c.active_deals)} • ⭐ {c.rating_avg ?? '—'} • 👁 {arNum(c.views_30)}</span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                        <div className="text-[10px] text-[var(--text-secondary)] mt-1">قارن أرقامه بهم — إن كان أضعف منهم فتوصيتك له أدناه هي الفرق.</div>
                                                    </div>
                                                )}
                                            </div>

                                            <div>
                                                <div className="font-bold text-xs text-[var(--text-primary)] mb-1.5">📨 التوصية المقترحة (عدّلها كما تريد — لن تُرسل إلا بضغطتك)</div>
                                                <textarea value={tipDraft} onChange={(e) => setTipDraft(e.target.value)} rows={7}
                                                    className="w-full text-xs p-3 rounded-xl bg-[var(--card-bg)] border border-[var(--border-color)] text-[var(--text-primary)] leading-relaxed outline-none focus:border-indigo-500" />
                                                <div className="flex items-center gap-3 mt-2 flex-wrap">
                                                    <label className="flex items-center gap-1.5 text-[11px] text-[var(--text-primary)] cursor-pointer">
                                                        <input type="checkbox" className="w-4 h-4 accent-indigo-600" checked={tipEmail} onChange={(e) => setTipEmail(e.target.checked)} />
                                                        📧 أرسل نسخة بريدية أيضاً
                                                    </label>
                                                    <button onClick={() => sendTip(s)} disabled={sending || !tipDraft.trim()}
                                                        className="mr-auto px-4 py-2 rounded-xl text-xs font-extrabold text-white bg-indigo-600 disabled:opacity-50">
                                                        {sending ? '⏳ جاري الإرسال…' : `📨 إرسال التوصية لـ«${s.shop}»`}
                                                    </button>
                                                </div>
                                            </div>
                                        </>
                                    ) : (
                                        <div className="text-xs text-[var(--text-secondary)]">تعذّر تحميل التقرير.</div>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
                {filteredSellers.length === 0 && <div className="text-xs text-[var(--text-secondary)]">لا تجار مطابقين لهذه الفلاتر.</div>}
            </section>

            {/* 📣 v12.39 — الإرسال المستهدف: نفس الفلاتر أعلاه تحدد المستقبلين */}
            <section className="bg-[var(--card-bg)] border-2 border-indigo-200 rounded-2xl p-4 space-y-2.5">
                <h3 className="font-extrabold text-[var(--text-primary)] text-sm">📣 إرسال مستهدف للتجار (حسب الفلاتر أعلاه)</h3>
                <div className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                    اختر المدينة/التصنيف/الحالة من فلاتر «صحة التجار»، ثم اختر قالباً أو اكتب رسالتك — تصل
                    للمحددين فقط ({arNum(filteredSellers.length)} تاجر حالياً) إشعاراً داخل الموقع وبوتاتهم المرتبطة. <b>لن تُرسل إلا بتأكيدك.</b>
                </div>
                <div className="flex flex-wrap gap-1.5">
                    {bulkTemplates.map((t) => (
                        <button key={t.id} onClick={() => setBulkMsg(t.text)}
                            className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-[var(--body-bg)] border border-[var(--border-color)] text-[var(--text-primary)] active:scale-95">
                            {t.label}
                        </button>
                    ))}
                </div>
                <textarea value={bulkMsg} onChange={(e) => setBulkMsg(e.target.value)} rows={5}
                    placeholder="اكتب الرسالة أو اختر قالباً..."
                    className="w-full text-xs p-3 rounded-xl bg-[var(--body-bg)] border border-[var(--border-color)] text-[var(--text-primary)] leading-relaxed outline-none focus:border-indigo-500" />
                <div className="flex items-center gap-3 flex-wrap">
                    <label className="flex items-center gap-1.5 text-[11px] text-[var(--text-primary)] cursor-pointer">
                        <input type="checkbox" className="w-4 h-4 accent-indigo-600" checked={bulkEmail} onChange={(e) => setBulkEmail(e.target.checked)} />
                        📧 بريد إلكتروني أيضاً
                    </label>
                    <button onClick={sendBulk} disabled={bulkSending || !bulkMsg.trim() || filteredSellers.length === 0}
                        className="mr-auto px-4 py-2 rounded-xl text-xs font-extrabold text-white bg-indigo-600 disabled:opacity-50">
                        {bulkSending && bulkProgress
                            ? `⏳ ${arNum(bulkProgress.done)}/${arNum(bulkProgress.total)}...`
                            : `📨 إرسال لـ${arNum(filteredSellers.length)} تاجر`}
                    </button>
                </div>
            </section>

            {/* 🌱 v12.39 — خطة نمو المنصة (لناصر شخصياً) */}
            <section className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl p-4 space-y-3">
                <h3 className="font-extrabold text-[var(--text-primary)] text-sm">🌱 خطة نمو المنصة (لك)</h3>

                <div>
                    <div className="font-bold text-xs text-[var(--text-primary)] mb-1">📆 موسمية حجوزاتك (١٢ شهراً)</div>
                    <Bars data={(data.seasonal || []).map((m: { mon: string; bookings: number }) => ({ label: m.mon.slice(5), n: m.bookings }))} color="#8b5cf6" height={90} />
                </div>

                <div>
                    <div className="font-bold text-xs text-[var(--text-primary)] mb-1.5">🗓 المواسم السعودية القادمة — استعد قبلها بأسبوعين</div>
                    <div className="grid md:grid-cols-2 gap-2">
                        {SAUDI_SEASONS.map((s) => (
                            <div key={s.name} className="bg-[var(--body-bg)] rounded-xl p-2.5 text-[11px]">
                                <div className="font-extrabold text-[var(--text-primary)]">{s.icon} {s.name} <span className="font-normal text-[var(--text-secondary)]">— {s.when}</span></div>
                                <div className="text-[var(--text-secondary)] mt-0.5 leading-relaxed">{s.tip}</div>
                            </div>
                        ))}
                    </div>
                </div>

                <div>
                    <div className="font-bold text-xs text-[var(--text-primary)] mb-1.5">🎯 أين تركّز جهدك؟ (طلب المشترين الفعلي مقابل عرض التجار — ٩٠ يوماً)</div>
                    <div className="space-y-1.5">
                        {((data.buyers_by_city || []) as BuyerCityRow[]).slice(0, 8).map((b) => {
                            const supply = ((data.cities || []) as GeoRow[]).find((c) => c.city === b.city)?.deals ?? 0;
                            const verdict = supply <= 1 && b.buyers >= 2 ? { t: '⚡ استقطب تجاراً هنا فوراً', c: '#f59e0b' }
                                : b.bookings >= 10 && supply >= 3 ? { t: '✅ سوق متوازن — نمّه بالحملات', c: '#10b981' }
                                : { t: '👀 راقب', c: 'var(--text-secondary)' };
                            return (
                                <div key={b.city} className="flex items-center justify-between text-[11px] bg-[var(--body-bg)] rounded-lg px-2.5 py-2">
                                    <span className="font-bold text-[var(--text-primary)]">{b.city}</span>
                                    <span className="text-[var(--text-secondary)] tabular-nums">🛒 {arNum(b.buyers)} مشترٍ • 📦 {arNum(b.bookings)} حجز • 🏷 {arNum(supply)} عرض</span>
                                    <span className="font-bold" style={{ color: verdict.c }}>{verdict.t}</span>
                                </div>
                            );
                        })}
                        {(data.buyers_by_city || []).length === 0 && <div className="text-[11px] text-[var(--text-secondary)]">لا حجوزات بعد.</div>}
                    </div>
                </div>

                <div>
                    <div className="font-bold text-xs text-[var(--text-primary)] mb-1.5">🧭 توصيات جذرية للمنصة (من بياناتك الفعلية)</div>
                    <ul className="text-[11px] text-[var(--text-secondary)] leading-relaxed space-y-1 pr-4 list-disc">
                        {Number(buyers.dormant_30) > 0 && <li><b className="text-[var(--text-primary)]">{arNum(Number(buyers.dormant_30))} مشترٍ خامل +٣٠ يوماً</b> — أعدهم بحملة من «الإشعارات والرسائل» (عروض المدينة الجديدة) أو مسابقة بجائزة.</li>}
                        <li><b className="text-[var(--text-primary)]">استقطاب التجار الأثمن نمواً:</b> ركّز على مدن «⚡» أعلاه وتصنيفات «فرصة» — أرسل باركود دعوة التاجر لهم عبر واتساب المحلات مباشرة.</li>
                        <li><b className="text-[var(--text-primary)]">حافظ على المجدّدين:</b> راقب بطاقة «تجديد الشهر الحالي» بالأعلى — أي هبوط تحت ٧٠٪ عالجه بخصم تجديد مؤقت من لوحة البائعين.</li>
                        <li><b className="text-[var(--text-primary)]">المواسم تصنع القفزات:</b> جهّز حملة + مسابقة قبل كل موسم أعلاه بأسبوعين — البنرات والرعاة جاهزون في أدواتك.</li>
                        {Number((data.content || {}).no_image) + Number((data.content || {}).one_image) > 0 && <li><b className="text-[var(--text-primary)]">جودة المحتوى تسويق مجاني:</b> استخدم قالب «جودة الصور» بالإرسال المستهدف — منصة صورها جميلة تبيع نفسها.</li>}
                    </ul>
                </div>
            </section>

            {/* 🎯 v12.40 — المستكشف: مدينة × قسم × ساعة */}
            <section className="bg-[var(--card-bg)] border-2 border-emerald-200 rounded-2xl p-4 space-y-2.5">
                <h3 className="font-extrabold text-[var(--text-primary)] text-sm">🎯 المستكشف: أي قسم؟ أي مدينة؟ أي ساعة؟</h3>
                <div className="text-[11px] text-[var(--text-secondary)]">اختر الشريحة وسيعرض لك حركتها بالساعة (حجوزات ٩٠ يوماً + مشاهدات/نقرات) وأفضل عروضها — هكذا تعرف أين الطلب ومتى بالضبط.</div>
                <div className="flex flex-wrap gap-2">
                    <select value={mxCity} onChange={(e) => setMxCity(e.target.value)}
                        className="flex-1 min-w-[120px] px-2.5 py-2 rounded-lg text-xs font-bold bg-[var(--body-bg)] border border-[var(--border-color)] text-[var(--text-primary)] outline-none">
                        <option value="all">🏙 كل المدن</option>
                        {((data.cities || []) as GeoRow[]).filter((c) => c.city && c.city !== 'غير محدد').map((c) => <option key={c.city} value={c.city}>{c.city}</option>)}
                    </select>
                    <select value={mxCat} onChange={(e) => setMxCat(e.target.value)}
                        className="flex-1 min-w-[120px] px-2.5 py-2 rounded-lg text-xs font-bold bg-[var(--body-bg)] border border-[var(--border-color)] text-[var(--text-primary)] outline-none">
                        <option value="all">🏷 كل الأقسام</option>
                        {((data.categories || []) as GeoRow[]).filter((c) => c.category).map((c) => <option key={c.category} value={c.category}>{catLabel(c.category)}</option>)}
                    </select>
                </div>
                {matrixLoading ? (
                    <div className="h-24 bg-[var(--gray-100)] rounded-xl animate-pulse" />
                ) : matrix ? (
                    <>
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                            <Tile icon="📦" label="حجوزات ٣٠ي" value={arNum(Number(matrix.totals?.bookings_30) || 0)} />
                            <Tile icon="👁" label="مشاهدات ٣٠ي" value={arNum(Number(matrix.totals?.views_30) || 0)} />
                            <Tile icon="👆" label="نقرات ٣٠ي" value={arNum(Number(matrix.totals?.clicks_30) || 0)} />
                            <Tile icon="🏷" label="عروض نشطة" value={arNum(Number(matrix.totals?.active_deals) || 0)} />
                            <Tile icon="🏪" label="متاجر" value={arNum(Number(matrix.totals?.stores) || 0)} />
                        </div>
                        <div className="font-bold text-xs text-[var(--text-primary)]">⏰ حجوزات هذه الشريحة بالساعة (٩٠ يوماً، توقيت الرياض)</div>
                        <Bars data={(() => { const m = new Map(((matrix.hours || []) as HourRow[]).map((r) => [r.h, r.n])); return Array.from({ length: 24 }, (_, h) => ({ label: h % 3 === 0 ? String(h) : '', n: m.get(h) || 0 })); })()} color="#10b981" height={90} />
                        {((matrix.view_hours || []) as HourRow[]).length > 0 && (
                            <>
                                <div className="font-bold text-xs text-[var(--text-primary)]">👁 المشاهدات/النقرات بالساعة</div>
                                <Bars data={(() => { const m = new Map(((matrix.view_hours || []) as HourRow[]).map((r) => [r.h, r.n])); return Array.from({ length: 24 }, (_, h) => ({ label: h % 3 === 0 ? String(h) : '', n: m.get(h) || 0 })); })()} color="#0ea5e9" height={90} />
                            </>
                        )}
                        {((matrix.top_deals || []) as any[]).length > 0 && (
                            <div className="text-[11px] space-y-1">
                                <div className="font-bold text-[var(--text-primary)]">🏆 أفضل عروض الشريحة</div>
                                {(matrix.top_deals as any[]).map((t, i) => (
                                    <div key={i} className="flex items-center justify-between text-[var(--text-secondary)] bg-[var(--body-bg)] rounded-lg px-2.5 py-1.5">
                                        <span className="truncate ml-2">«{t.item_name}» — {t.shop_name}</span>
                                        <span className="tabular-nums whitespace-nowrap">📦 {arNum(t.bookings)} • 👁 {arNum(t.views)}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </>
                ) : <div className="text-[11px] text-[var(--text-secondary)]">تعذّر التحميل — غيّر الاختيار للمحاولة مجدداً.</div>}
            </section>

            {/* 💸 v12.40 — أقسام تحتاج تخفيضات / أقسام عليها طلب بلا معروض */}
            <section className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl p-4">
                <h3 className="font-extrabold text-[var(--text-primary)] text-sm mb-2">💸 أين يجب أن تتركز التخفيضات؟ (تفاعل كل قسم)</h3>
                <div className="space-y-1.5">
                    {(((pulse2?.cat_engagement || []) as any[])).map((c) => {
                        const eng = (Number(c.views_30) || 0) + (Number(c.clicks_30) || 0);
                        const b30 = Number(c.bookings_30) || 0;
                        const verdict = b30 > 0 && Number(c.active_deals) === 0
                            ? { t: '🔥 طلب بلا معروض — استقطب تجاراً فوراً', col: '#ef4444' }
                            : eng >= 10 && b30 / Math.max(eng, 1) < 0.05
                            ? { t: '💸 يُشاهَد ولا يُحجز — يحتاج تخفيضات أقوى', col: '#f59e0b' }
                            : b30 >= 5
                            ? { t: '✅ قسم رائج', col: '#10b981' }
                            : { t: '👀 هادئ', col: 'var(--text-secondary)' };
                        return (
                            <div key={c.category} className="flex items-center justify-between text-[11px] bg-[var(--body-bg)] rounded-lg px-2.5 py-2 gap-2 flex-wrap">
                                <span className="font-bold text-[var(--text-primary)]">{catLabel(c.category)}</span>
                                <span className="text-[var(--text-secondary)] tabular-nums">👁 {arNum(Number(c.views_30) || 0)} • 👆 {arNum(Number(c.clicks_30) || 0)} • 📦 {arNum(b30)} • 🏷 {arNum(Number(c.active_deals) || 0)}</span>
                                <span className="font-bold" style={{ color: verdict.col }}>{verdict.t}</span>
                            </div>
                        );
                    })}
                    {((pulse2?.cat_engagement || []) as any[]).length === 0 && <div className="text-[11px] text-[var(--text-secondary)]">لا بيانات بعد.</div>}
                </div>
                <div className="text-[10px] text-[var(--text-secondary)] mt-2">المشاهدات/النقرات الزمنية بدأ تسجيلها في v12.38 — تكتمل دقتها خلال أيام. الحكم «طلب بلا معروض» فوري ودقيق من الحجوزات.</div>
            </section>

            {/* 🔎 v12.40 — عمليات البحث */}
            <section className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl p-4">
                <h3 className="font-extrabold text-[var(--text-primary)] text-sm mb-2">🔎 ماذا يبحث الزوار؟ (آخر ٣٠ يوماً — {arNum(Number(pulse2?.search_total_30) || 0)} عملية بحث)</h3>
                {((pulse2?.searches || []) as any[]).length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                        {(pulse2.searches as any[]).map((s) => (
                            <span key={s.q} className="text-[11px] font-bold bg-[var(--body-bg)] border border-[var(--border-color)] rounded-full px-3 py-1.5 text-[var(--text-primary)]">
                                {s.q} <span className="text-[var(--text-secondary)]">×{arNum(Number(s.n) || 0)}</span>
                            </span>
                        ))}
                    </div>
                ) : (
                    <div className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                        بدأنا اليوم تسجيل كل كلمة بحث في الرئيسية وقائمة العروض — خلال أيام سترى هنا <b>أعلى الكلمات المبحوثة</b>:
                        كل كلمة تتكرر بلا عروض تلبّيها = طلب جاهز تستقطب له تاجراً أو تطلب من تجارك توفيره.
                    </div>
                )}
            </section>

            {/* 📢 v12.40 — خطة التسويق الجاهزة */}
            <section className="bg-[var(--card-bg)] border-2 border-amber-200 rounded-2xl p-4 space-y-2.5">
                <h3 className="font-extrabold text-[var(--text-primary)] text-sm">📢 خطة التسويق الجاهزة (خطوة بخطوة — انسخ ونفّذ)</h3>
                <div className="grid md:grid-cols-2 gap-2 text-[11px]">
                    <div className="bg-[var(--body-bg)] rounded-xl p-3 leading-relaxed">
                        <div className="font-extrabold text-[var(--text-primary)] mb-1">🏪 جذب التجار (رتّبها المحلل بأولوية العائد)</div>
                        <ol className="pr-4 list-decimal space-y-1 text-[var(--text-secondary)]">
                            <li>ابدأ بشرائح «🔥 طلب بلا معروض» و«⚡» أعلاه — الطلب موجود والمنافسة صفر.</li>
                            <li>زر السوق/المول المستهدف وقت الذروة (انظر المستكشف) وكلّم المحلات مباشرة، أو أرسل لواتساب المحل.</li>
                            <li>أرسل لهم النص الجاهز أدناه + باركود دعوة تاجر من لوحتك.</li>
                            <li>قدّم «أول ١٤ يوماً مجاناً» (زر التجربة في وضع الاشتراك العام) — يزيل التردد.</li>
                            <li>بعد انضمامه أرسل له توصية «تنشيط متجر خامل» من الإرسال المستهدف ليبدأ صح.</li>
                        </ol>
                        <div className="mt-2 p-2 bg-[var(--card-bg)] rounded-lg border border-dashed border-[var(--border-color)] text-[var(--text-primary)]" style={{ userSelect: 'all' }}>
                            «أهلاً 👋 منصة تاكي توصل عروض محلك لمشترين يبحثون فعلاً في مدينتك — تحليلنا يُظهر طلباً على قسمك الآن. التسجيل دقائق وأول ١٤ يوماً مجاناً: taki-test-eight.vercel.app»
                        </div>
                    </div>
                    <div className="bg-[var(--body-bg)] rounded-xl p-3 leading-relaxed">
                        <div className="font-extrabold text-[var(--text-primary)] mb-1">🛒 جذب المشترين (بتوقيت الذروة)</div>
                        <ol className="pr-4 list-decimal space-y-1 text-[var(--text-secondary)]">
                            <li>انشر إعلانات سناب/تيك توك مستهدفة جغرافياً على مدن «✅ متوازن» — قبل ساعة الذروة بساعتين.</li>
                            <li>مجموعات واتساب/تيليجرام الخاصة بكل مدينة — انشر أقوى ٣ عروض بصورها + رابط مباشر.</li>
                            <li>شغّل مسابقة بجائزة من تبويب المسابقات + إشعار تلقائي — أفضل أداة إرجاع للخاملين ({arNum(Number(buyers.dormant_30) || 0)} خامل حالياً).</li>
                            <li>اطلب من كل تاجر تعليق باركود متجره عند الكاشير — كل زبون يمسحه يصبح مستخدماً.</li>
                            <li>قبل كل موسم (انظر التقويم أعلاه): بانر + حملة مجدولة من «الإشعارات والرسائل».</li>
                        </ol>
                        <div className="mt-2 p-2 bg-[var(--card-bg)] rounded-lg border border-dashed border-[var(--border-color)] text-[var(--text-primary)]" style={{ userSelect: 'all' }}>
                            «خصومات حقيقية في {(((data.cities || [])[0] as GeoRow | undefined)?.city) || 'مدينتك'} تصل ٥٠٪ 🔥 احجز قبل نفاد الكمية — بدون تحميل تطبيق: taki-test-eight.vercel.app»
                        </div>
                    </div>
                </div>
                <div className="text-[10px] text-[var(--text-secondary)]">النصوص قابلة للنسخ (اضغط عليها مطولاً) — وتتحدث تلقائياً بأقوى مدنك الحالية.</div>
            </section>

            {/* 🖼 v12.39 — جودة محتوى العروض */}
            <section className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl p-4">
                <h3 className="font-extrabold text-[var(--text-primary)] text-sm mb-2">🖼 جودة محتوى العروض النشطة</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <Tile icon="🏷" label="عروض نشطة" value={arNum(Number((data.content || {}).active_deals) || 0)} />
                    <Tile icon="🚫" label="بلا صور إطلاقاً" value={arNum(Number((data.content || {}).no_image) || 0)} />
                    <Tile icon="🖼" label="بصورة واحدة فقط" value={arNum(Number((data.content || {}).one_image) || 0)} />
                    <Tile icon="📝" label="بلا وصف كافٍ" value={arNum(Number((data.content || {}).no_desc) || 0)} />
                </div>
                <div className="text-[11px] text-[var(--text-secondary)] mt-2 leading-relaxed">
                    💡 نقيس اكتمال الصور والوصف وساعات العمل (وفلتر المحتوى يرفض الصور غير اللائقة تلقائياً منذ v12.31).
                    المتاجر ضعيفة المحتوى تظهر أسبابها داخل بطاقتها في «صحة التجار» وتوصيتها الجاهزة تتضمن علاجها.
                </div>
            </section>

            {/* 🗺 الفرص */}
            <section className="grid md:grid-cols-3 gap-3">
                {[
                    { title: '🏙 المدن', rows: (data.cities || []).map((c: GeoRow) => ({ name: c.city!, ...c })) },
                    { title: '🏷 التصنيفات', rows: (data.categories || []).map((c: GeoRow) => ({ name: catLabel(c.category), ...c })) },
                    { title: '🏬 المولات والأسواق', rows: (data.malls || []).map((c: GeoRow) => ({ name: c.mall!, ...c })) },
                ].map((sec) => (
                    <div key={sec.title} className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl p-3.5">
                        <h4 className="font-extrabold text-xs text-[var(--text-primary)] mb-2">{sec.title} — الطلب مقابل العرض</h4>
                        <div className="space-y-1.5">
                            {sec.rows.slice(0, 8).map((r: any, i: number) => (
                                <div key={i} className="flex items-center justify-between text-[11px]">
                                    <span className="text-[var(--text-primary)] font-bold truncate ml-2">{r.name}</span>
                                    <span className="text-[var(--text-secondary)] whitespace-nowrap tabular-nums">
                                        📦 {arNum(r.bookings)} • 🏷 {arNum(r.deals)}
                                        {r.bookings >= 5 && r.deals <= 2 && <span className="text-amber-500 font-black"> ⚡فرصة</span>}
                                    </span>
                                </div>
                            ))}
                            {sec.rows.length === 0 && <div className="text-[11px] text-[var(--text-secondary)]">لا بيانات بعد.</div>}
                        </div>
                    </div>
                ))}
            </section>

            <div className="text-[11px] text-[var(--text-secondary)] bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl p-3 leading-relaxed">
                🤖 يعمل المحلل آلياً بالكامل: يفحص المنصة كل أحد صباحاً ويرسل لك إشعاراً تلقائياً إن بدأ عزوف للتجار أو حدثت قفزة انضمام —
                بدون أي تدخل. إرسال التوصيات للتجار فقط هو ما يبقى بيدك (بضغطة واحدة من هنا).
            </div>
        </div>
    );
};

export default AdminAnalyst;
