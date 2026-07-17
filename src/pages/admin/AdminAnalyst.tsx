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

    const load = useCallback(async () => {
        setLoading(true);
        const d = await adminService.getAiAnalyst(days);
        setData(d);
        setLoading(false);
    }, [days]);
    useEffect(() => { load(); }, [load]);

    const insights = useMemo(() => buildInsights(data), [data]);
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
        if (openSeller === s.id) { setOpenSeller(null); setReport(null); return; }
        setOpenSeller(s.id);
        setReport(null);
        setReportLoading(true);
        const r = await adminService.getAiSellerReport(s.id);
        setReport(r);
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
                        <div className="text-xl font-black">🧠 المحلل الذكي</div>
                        <div className="text-[12px] opacity-90 mt-1 leading-relaxed max-w-xl">
                            يحلل كل نشاط المنصة آلياً — عزوف التجار وأسبابه، ساعات الذروة، الفرص بالمدن والتصنيفات،
                            وتوصية جاهزة لكل تاجر <b>لا تُرسل إلا بموافقتك</b>. يراقب أسبوعياً ويُنبّهك عند بدء العزوف أو القفزات.
                        </div>
                    </div>
                    <div className="flex gap-1.5 items-center">
                        {[7, 30, 90].map((d) => (
                            <button key={d} onClick={() => setDays(d)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-extrabold ${days === d ? 'bg-white text-indigo-700' : 'bg-white/15 text-white'}`}>
                                {arNum(d)} يوم
                            </button>
                        ))}
                        <button onClick={load} className="px-3 py-1.5 rounded-lg text-xs font-extrabold bg-white/15" title="تحديث">🔄</button>
                    </div>
                </div>
            </div>

            {/* مؤشرات سريعة */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Tile icon="📦" label={`حجوزات آخر ${arNum(days)} يوم`} value={arNum(Number(funnel.bookings) || 0)}
                    sub={`${arNum(Number(funnel.completed) || 0)} مكتمل`} />
                <Tile icon="⏰" label="ساعة الذروة" value={topHour ? fmtHour(topHour.h) : '—'}
                    sub={topHour ? `${arNum(topHour.n)} حجزاً` : 'لا بيانات بعد'} />
                <Tile icon="🔁" label="معدل عودة المشترين" value={`${Number(buyers.with_booking) ? Math.round(((Number(buyers.repeaters) || 0) / Number(buyers.with_booking)) * 100) : 0}٪`}
                    sub={`${arNum(Number(buyers.active_30) || 0)} نشط آخر ٣٠ يوم`} />
                <Tile icon="💳" label="تجديد الشهر الحالي" value={lastRenew && lastRenew.expired ? `${Math.round((lastRenew.renewed / lastRenew.expired) * 100)}٪` : '—'}
                    sub={lastRenew ? `${arNum(lastRenew.renewed)} من ${arNum(lastRenew.expired)} جدّدوا` : 'لا انتهاءات بعد'} />
            </div>

            {/* 🚨 الرؤى والتنبيهات */}
            <section className="space-y-2">
                <h3 className="font-extrabold text-[var(--text-primary)] text-sm">🚨 رؤى المحلل (مرتبة بالأهمية)</h3>
                {insights.length === 0 && <div className="text-xs text-[var(--text-secondary)] bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl p-4">لا توجد ملاحظات مقلقة حالياً — كل المؤشرات ضمن الطبيعي.</div>}
                {insights.map((ins) => (
                    <div key={ins.id} className="rounded-2xl p-3.5" style={{ background: SEV_STYLE[ins.severity].bg, border: `1.5px solid ${SEV_STYLE[ins.severity].border}` }}>
                        <div className="font-extrabold text-sm text-[var(--text-primary)]">{ins.icon} {ins.title}</div>
                        <div className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">{ins.body}</div>
                        {ins.action && <div className="text-xs font-bold mt-1.5 text-[var(--text-primary)]">💡 الإجراء: <span className="font-normal text-[var(--text-secondary)]">{ins.action}</span></div>}
                    </div>
                ))}
            </section>

            {/* ⏰ الذروة */}
            <section className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl p-4">
                <h3 className="font-extrabold text-[var(--text-primary)] text-sm mb-1">⏰ ساعات الذروة (حجوزات، بتوقيت الرياض)</h3>
                <Bars data={hourBars} color="#10b981" />
                <h3 className="font-extrabold text-[var(--text-primary)] text-sm mb-1 mt-3">📅 أيام الأسبوع</h3>
                <Bars data={dayBars} color="#6366f1" />
                <div className="text-[11px] text-[var(--text-secondary)] mt-2">💡 انصح التجار بنشر وتجديد عروضهم قبل الذروة بساعة — وضع الحملات الترويجية فيها.</div>
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
