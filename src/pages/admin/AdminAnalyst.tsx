/**
 * AdminAnalyst — «🧠 المحلل الذكي» (v14.89 — أُعيد تنظيمها على نظام لوحة الإدارة)
 * ═══════════════════════════════════════════════════════════════════════════
 * القاعدة الحاكمة: هذه الشاشة **تشخيصٌ وتوصية**، لا جداول أرقامٍ عامّة.
 * «التحليلات» للأرقام على فترة، و«جمهور المدن» للجغرافيا. وكل قسمٍ هنا يجيب
 * ثلاثة أسئلة: من يضعف؟ لماذا؟ وماذا أفعل؟
 *
 * 🔴 مكرّرٌ داخل الشاشة نفسها — قِيس على v14.88 ثم حُذف:
 *  • «الحجوزات شهرياً (٦ أشهر)» — رسمُ الموسميّة (١٢ شهراً) يحتويه كلّه.
 *  • **خمسة** تمثيلات لساعات الذروة (بطاقة «أقوى ٣ ساعات» · رسم ٢٤ ساعة ·
 *    خريطة ٧×٢٤ · رسمٌ في المحلل المخصّص · ورسمان في المستكشف) ⇐ بقي
 *    **اثنان**: الخريطة (الأغنى) والبطاقة (الخلاصة). ورسمُ أيام الأسبوع هو
 *    صفوفُ الخريطة نفسها فسقط معها.
 *  • **ثلاث** لوحات «أين الفرصة» بثلاثة رموز (⚡/⚡/🔥) لفكرةٍ واحدة ⇐ لوحةٌ
 *    واحدة بثلاثة محاور (مدن · تصنيفات · مواقع) ووسمٍ واحد «⚡ فرصة».
 *  • الإلغاءات في **أربعة** مواضع ⇐ التشخيص + قسمٌ واحد يضمّ «من ألغى؟»
 *    و«راصد الأسوأ» معاً (وبطاقة «ملغى» في المحلل المخصّص حُذفت).
 *  • بطاقتا «⚖️ مقارنة بمنافسيه» و«⚔️ منافسوه المباشرون» ⇐ بطاقةٌ واحدة.
 *
 * 🔴 ومكرّرٌ مع شاشةٍ أخرى ⇐ حُذف وبقي سطرُ إحالةٍ مكانه: «قمع التحويل»
 *    والاحتفاظ بالكوهورت (في «التحليلات») · الجداول الجغرافية (في «جمهور
 *    المدن»، وبقيت **التوصية** وحدها) · و«المواسم السعودية» التي كانت
 *    **تواريخ مكتوبة في الكود** («٢٣ سبتمبر»، «رمضان تقريباً فبراير ٢٠٢٧»)
 *    بينما تقويم الفعاليات الحقيقي يكتبه ناصر في «البانرات والحملات» —
 *    وتقويمٌ ثانٍ يناقض الأول أسوأ من غيابه.
 *
 * 🔴 ورقمان متناقضان لنفس المقياس: «حجوزات آخر N يوم» من `admin_ai_analyst`
 *    و«الخلاصة التنفيذية» من `admin_ai_funnel` — على بُعد شاشةٍ واحدة. الآن
 *    **مصدرٌ واحد** (`admin_ai_funnel`) يُعرض **مرّةً واحدة**.
 *
 * 🔴 والإرسال الجماعي كان حلقةَ `admin_notify_user` لكل تاجر. حين يكون
 *    الجمهور **كل التجار** صار بثّاً واحداً على الخادم
 *    (`admin_broadcast_notification`)؛ وتبقى الحلقة للشريحة المفلترة وحدها،
 *    لأن دالّة البثّ لا تعرف مرشّحات المدينة/التصنيف/الحالة — فاستعمالها
 *    لشريحةٍ كان سيُرسل إلى **كل** التجار بصمت، وهو كذبٌ في عدد المستقبِلين.
 *
 * 🪤 ولا `dark:` ولا `bg-white` ولا تدرّجات: الألوان رموز `--adm-*` واللون
 *    للدلالة وحدها. ولا عنوان محلّي هنا — القشرة تطبعه من `adminNav.ts`.
 */

import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { adminService } from '../../services/adminService';
import { useApp } from '../../context/AppContext';
import { CATEGORIES } from '../../data/mock';
import {
    AdmCard, AdmSection, AdmStat, AdmStatGrid, AdmPill, AdmEmpty,
    AdmSkeleton, AdmError, AdmButton, AdmTable, AdmSelect, AdmToolbar,
    AdmDateRange, admNum,
} from '../../components/admin/ui';
import type { Tone } from '../../components/admin/ui';

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
const daysLeft = (iso: string | null): number | null =>
    iso ? Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000) : null;

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: fmtHour(h) }));
const DOW_OPTIONS = [{ value: 'all', label: 'كل الأيام' }, ...DOW_AR.map((d, i) => ({ value: String(i), label: d }))];

/** نغمةُ الدلالة لكل درجة خطورة — لا لون خارج النغمات الخمس. */
const TONE_OF: Record<Insight['severity'], Tone> = { critical: 'bad', warn: 'warn', good: 'ok', info: 'info' };

// ─── درجة خطر التاجر (0-100، الأعلى = أخطر) + السبب المرجّح ─────────────────
const sellerRisk = (s: SellerRow): { score: number; reasons: string[] } => {
    let score = 0;
    const reasons: string[] = [];
    const dl = daysLeft(s.expires_at);
    if (dl !== null && dl < 0) { score += 40; reasons.push('اشتراكه منتهٍ ولم يجدّد'); }
    else if (dl !== null && dl <= 7) { score += 25; reasons.push(`اشتراكه ينتهي خلال ${admNum(dl)} يوم`); }
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

// ─── مولّد رؤى المنصة (يغذّي التشخيص — لا يُعرض وحده) ────────────────────────
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
            title: `${admNum(expiredNoRenew.length)} تاجر منتهي الاشتراك ولم يجدّد`,
            body: expiredNoRenew.slice(0, 5).map((s) => `«${s.shop}»${sellerRisk(s).reasons[1] ? ' — ' + sellerRisk(s).reasons[1] : ''}`).join(' • '),
            action: 'افتح «صحة التجار» بالأسفل، راجع السبب المرجّح لكل تاجر، وأرسل له التوصية أو خصماً من شاشة التجّار.',
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
            title: `${admNum(expiringSoon.length)} تاجر ينتهي اشتراكه خلال أسبوع`,
            body: expiringSoon.slice(0, 5).map((s) => `«${s.shop}» (${admNum(daysLeft(s.expires_at) || 0)} يوم)`).join(' • '),
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
                body: `${admNum(views)} مشاهدة عرض أنتجت ${admNum(bookings)} حجزاً فقط في الفترة.`,
                action: 'الأسباب المعتادة: خصومات غير مقنعة أو صور ضعيفة. شجّع التجار على خصومات ٣٠٪+ وصور واضحة.',
            });
        } else {
            out.push({ id: 'conv-ok', severity: 'good', icon: '✅', title: `نسبة التحويل صحية (${(conv * 100).toFixed(1)}٪)`, body: 'المعروض يقنع الزوار بالحجز.' });
        }
    }

    // ٤) إلغاءات مرتفعة
    const cancelled = Number(funnel.cancelled) || 0;
    if (bookings >= 10 && cancelled / bookings > 0.35) {
        out.push({
            id: 'cancel-high', severity: 'warn', icon: '🚫',
            title: `نسبة الإلغاء/الانتهاء مرتفعة (${Math.round((cancelled / bookings) * 100)}٪)`,
            body: 'مشترون يحجزون ولا يستلمون — غالباً مهلة الاستلام قصيرة أو المتجر بعيد.',
            action: 'راجع مدد التحضير عند التجار كثيري الإلغاء، وذكّر المشترين بمهلة الاستلام.',
        });
    }

    // ٥) نمو المشترين
    if (monthly.length >= 2) {
        const lastM = monthly[monthly.length - 1]; const prevM = monthly[monthly.length - 2];
        if (lastM.new_buyers > prevM.new_buyers && lastM.new_buyers >= 3) {
            out.push({ id: 'buyers-up', severity: 'good', icon: '🛒', title: `نمو المشترين الجدد: ${admNum(lastM.new_buyers)} هذا الشهر`, body: `مقابل ${admNum(prevM.new_buyers)} الشهر السابق — التسويق يعمل.` });
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

    // ٦) جودة محتوى المنصة (صور/أوصاف العروض)
    const content = d.content || {};
    const activeDeals = Number(content.active_deals) || 0;
    const weakImgs = (Number(content.no_image) || 0) + (Number(content.one_image) || 0);
    if (activeDeals >= 3 && weakImgs / activeDeals > 0.3) {
        out.push({
            id: 'content-imgs', severity: 'warn', icon: '🖼',
            title: `${Math.round((weakImgs / activeDeals) * 100)}٪ من العروض النشطة صورها ضعيفة`,
            body: `${admNum(weakImgs)} من ${admNum(activeDeals)} عرضاً بصورة واحدة أو بلا صور — الصور أول ما يقنع المشتري.`,
            action: 'استخدم «الإرسال المستهدف» مع قالب «جودة الصور» لتنبيه المتاجر المعنية دفعة واحدة.',
        });
    }
    if (activeDeals >= 3 && (Number(content.no_desc) || 0) / activeDeals > 0.4) {
        out.push({
            id: 'content-desc', severity: 'info', icon: '📝',
            title: `${admNum(Number(content.no_desc) || 0)} عرضاً بلا وصف كافٍ`,
            body: 'الوصف الناقص يزيد أسئلة الشات والإلغاءات — ذكّر التجار بكتابة المقاسات والتفاصيل.',
        });
    }
    return out;
};

// ─── «العقل المشخّص»: تحليل + تسويق + حلول في تقرير واحد ─────────────────────
// يقرأ كل مصادر البيانات معاً ويُخرج: درجة صحة المنصة، أضعف النقاط، وقائمة
// تشخيصات — لكل واحدة: الدليل بالأرقام، مكمن الخلل، خطوات العلاج، والأثر.
interface Diagnosis {
    id: string;
    severity: Insight['severity'];
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
            title: `${admNum(expired.length)} تاجر انتهى اشتراكه ولم يجدّد`,
            evidence: expired.slice(0, 5).map((s) => `«${s.shop}» (${admNum(s.bookings_30)} حجز/٣٠ي، ${admNum(s.active_deals)} عرض نشط)`).join(' • '),
            why: dominantWhy,
            fix: [
                'أرسل لكل واحد توصيته الجاهزة من بطاقته (سبب ضعفه بالضبط) قبل عرض أي خصم.',
                'قدّم «خصم عودة» مؤقتاً من شاشة التجّار لمن كانت حجوزاته ضعيفة رغم نشاطه.',
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
            evidence: selfCancelers.map((s) => `«${s.shop}» ألغى ${admNum(Number(s.c_seller))} حجزاً`).join(' • '),
            why: 'السلعة غير متوفرة فعلاً وقت وصول العميل (كمية وهمية أو عرض شكلي) — هذا أسرع طريق لفقدان ثقة المشترين.',
            fix: [
                'أرسل تنبيهاً مباشراً لهؤلاء التجار من الإرسال المستهدف (فلتر «الأكثر إلغاءً من التاجر» في راصد الأسوأ).',
                'راقبهم أسبوعين — التكرار يستحق إنذاراً رسمياً من شاشة الإنذارات.',
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
            title: `${admNum(sysCanc)} حجزاً ماتت بانتهاء المهلة دون استلام`,
            evidence: `${Math.round((sysCanc / Math.max(1, b)) * 100)}٪ من حجوزات الفترة انتهت تلقائياً.`,
            why: 'المشتري يحجز بحماس ثم ينسى أو يستصعب الوصول — أو مدة التحضير لدى التاجر أطول من صبره.',
            fix: [
                'رسائل التذكير قبل انتهاء المهلة تعمل — راجع نصها وتوقيتها في «الإشعارات والبريد».',
                'شجّع التجار على مدد تحضير واقعية قصيرة (توصية جاهزة من بطاقاتهم).',
            ],
            impact: 'كل حجز يُستلم بدل أن يموت = مبيعة حقيقية وتقييم وثقة.',
        });
    }

    // ٤) تركّز خطير: المنصة تقف على متجر واحد
    const byStore = (fn?.by_store || []) as any[];
    const topStore = [...byStore].sort((a, c) => Number(c.bookings) - Number(a.bookings))[0];
    if (topStore && b >= 10 && Number(topStore.bookings) / b > 0.6) {
        penalties.push({ label: 'تركّز على متجر واحد', pts: 12 });
        items.push({
            id: 'dg-concentration', severity: 'warn', icon: '🎯',
            title: `«${topStore.shop}» وحده يمثل ${Math.round((Number(topStore.bookings) / b) * 100)}٪ من كل الحجوزات`,
            evidence: `${admNum(Number(topStore.bookings))} من أصل ${admNum(b)} حجزاً في الفترة.`,
            why: 'الاعتماد على متجر واحد هشّ — لو توقف أو غادر تنهار أرقام المنصة كلها.',
            fix: [
                'كثّف استقطاب تجار في المدن والأقسام الموسومة «⚡ فرصة» في لوحة «أين الفرصة؟».',
                'استخدم خطة النمو والتسويق أدناه — هدفك: لا يتجاوز أي متجر ٣٠٪ من الحجوزات.',
            ],
            impact: 'توزيع أوسع = نمو أثبت وإيراد اشتراكات أعلى.',
        });
    }

    // ٥) أقسام عليها طلب فعلي بلا معروض (من تفاعل الأقسام)
    const hungryCats = ((p2?.cat_engagement || []) as any[]).filter((c) => Number(c.bookings_30) > 0 && Number(c.active_deals) === 0);
    if (hungryCats.length > 0) {
        items.push({
            id: 'dg-hungry-cats', severity: 'warn', icon: '⚡',
            title: `${admNum(hungryCats.length)} قسم عليه طلب حقيقي بلا أي عرض نشط الآن`,
            evidence: hungryCats.map((c) => `${catLabel(c.category)} (${admNum(Number(c.bookings_30))} حجزاً سابقاً)`).join(' • '),
            why: 'مشترون جرّبوا وحجزوا في هذه الأقسام ثم اختفى المعروض — طلب مثبت بالمال يضيع يومياً.',
            fix: [
                'استقطب تاجراً واحداً على الأقل لكل قسم منها (نص الإقناع جاهز في خطة النمو والتسويق).',
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
                evidence: `${admNum(retBack)} عادوا من أصل ${admNum(retTot)} مشترياً جرّبوا الحجز (التفصيل بالكوهورت في «التحليلات»).`,
                why: 'التجربة الأولى لا تخلق عادة — غالباً لقلة العروض الجديدة أو غياب سبب للعودة.',
                fix: [
                    'مسابقة شهرية بجائزة (شاشة المسابقات + إشعار تلقائي) — أقوى أداة عودة.',
                    'حملة أسبوعية «جديد هذا الأسبوع في مدينتك» من «الإشعارات والبريد».',
                    'شجّع المتابعة: من يتابع متجراً يصله كل عرض جديد تلقائياً.',
                ],
                impact: 'رفع العودة ١٠٪ يضاعف الحجوزات بلا ريال تسويق واحد.',
            });
        } else if (rr >= 0.4) {
            items.push({ id: 'dg-retention-good', severity: 'good', icon: '🔁', title: `ولاء ممتاز: ${Math.round(rr * 100)}٪ من المشترين يعودون`, evidence: `${admNum(retBack)} من ${admNum(retTot)} عادوا لحجز جديد.` });
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
                    'نفّذ خطوة واحدة من «خطة النمو والتسويق» أسبوعياً (ابدأ بمجموعات واتساب مدينتك الأقوى).',
                    'فعّل باركود الدعوة: اطلب من كل تاجر تعليقه عند الكاشير هذا الأسبوع.',
                ],
                impact: 'قناة اكتساب واحدة منتظمة تكسر الركود خلال أسبوعين.',
            });
        }
    }

    // ٨) دمج قواعد الرؤى (تجديد، تحويل، جودة صور...) بلا تكرار
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

// ═══════════════════════════════════════════════════════════════════════════
// مكوّنات عرض صغيرة
// ═══════════════════════════════════════════════════════════════════════════

/** أعمدة SVG بسيطة (بلا مكتبات) — بقي منها رسمان: الموسميّة والاتجاه اليومي. */
const Bars: React.FC<{ data: { label: string; n: number }[]; color?: string; height?: number }> = memo(
    ({ data, color = 'var(--adm-accent)', height = 100 }) => {
        const max = Math.max(1, ...data.map((d) => d.n));
        const bw = 100 / Math.max(1, data.length);
        return (
            <svg viewBox={`0 0 100 ${height / 2 + 14}`} style={{ width: '100%', direction: 'ltr' }} preserveAspectRatio="none" role="img">
                {data.map((d, i) => {
                    const h = (d.n / max) * (height / 2 - 6);
                    return (
                        <g key={i}>
                            <rect x={i * bw + bw * 0.15} y={height / 2 - h} width={bw * 0.7} height={Math.max(h, d.n > 0 ? 1 : 0)} rx={1} fill={color} opacity={d.n === max ? 1 : 0.5} />
                            <text x={i * bw + bw / 2} y={height / 2 + 8} fontSize={2.8} textAnchor="middle" fill="var(--adm-fg-3)">{d.label}</text>
                        </g>
                    );
                })}
            </svg>
        );
    },
);
Bars.displayName = 'Bars';

/** سطرٌ مضغوط: اسمٌ على اليمين وأرقامٌ على اليسار — بدل أحد عشر تنسيقاً. */
const MiniRow = memo<{ label: React.ReactNode; value: React.ReactNode }>(({ label, value }) => (
    <div style={{
        display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center',
        fontSize: '.78rem', padding: '5px 0', borderBottom: '1px solid var(--adm-border)',
    }}>
        <span style={{ fontWeight: 700, color: 'var(--adm-fg)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        <span style={{ color: 'var(--adm-fg-2)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{value}</span>
    </div>
));
MiniRow.displayName = 'MiniRow';

/** بطاقة تشخيص: الدليل ← مكمن الخلل ← العلاج ← الأثر. */
const DiagnosisCard = memo<{ dg: Diagnosis }>(({ dg }) => {
    const tone = TONE_OF[dg.severity];
    return (
        <div style={{
            borderRadius: 'var(--adm-r)', padding: '14px 15px',
            background: 'var(--adm-surface)',
            border: '1px solid var(--adm-border)',
            borderInlineStart: `4px solid var(--adm-${tone}-fg)`,
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span aria-hidden="true">{dg.icon}</span>
                <span style={{ fontWeight: 800, fontSize: '.92rem', color: 'var(--adm-fg)' }}>{dg.title}</span>
            </div>
            <p style={{ margin: '7px 0 0', fontSize: '.8rem', lineHeight: 1.8, color: 'var(--adm-fg-2)' }}>
                <b style={{ color: 'var(--adm-fg)' }}>الدليل:</b> {dg.evidence}
            </p>
            {dg.why && (
                <p style={{ margin: '5px 0 0', fontSize: '.8rem', lineHeight: 1.8, color: 'var(--adm-fg-2)' }}>
                    <b style={{ color: 'var(--adm-fg)' }}>مكمن الخلل:</b> {dg.why}
                </p>
            )}
            {dg.fix && dg.fix.length > 0 && (
                <div style={{ marginTop: 8 }}>
                    <b style={{ fontSize: '.8rem', color: 'var(--adm-fg)' }}>العلاج:</b>
                    <ol style={{ margin: '4px 0 0', paddingInlineStart: 18, fontSize: '.8rem', lineHeight: 1.85, color: 'var(--adm-fg-2)' }}>
                        {dg.fix.map((s, i) => <li key={i}>{s}</li>)}
                    </ol>
                </div>
            )}
            {dg.impact && (
                <p style={{ margin: '8px 0 0', fontSize: '.76rem', lineHeight: 1.7, color: 'var(--adm-ok-fg)', fontWeight: 700 }}>
                    الأثر المتوقع: <span style={{ fontWeight: 500 }}>{dg.impact}</span>
                </p>
            )}
        </div>
    );
});
DiagnosisCard.displayName = 'DiagnosisCard';

const noteStyle: React.CSSProperties = { margin: '10px 0 0', fontSize: '.75rem', lineHeight: 1.8, color: 'var(--adm-fg-3)' };
const panelStyle: React.CSSProperties = {
    background: 'var(--adm-surface)', border: '1px solid var(--adm-border)',
    borderRadius: 'var(--adm-r-sm)', padding: '10px 12px',
};
const softPanelStyle: React.CSSProperties = { background: 'var(--adm-surface-2)', borderRadius: 'var(--adm-r-sm)', padding: '11px 13px' };
const panelTitleStyle: React.CSSProperties = { fontWeight: 800, fontSize: '.78rem', color: 'var(--adm-fg)', marginBottom: 5 };
const panelBodyStyle: React.CSSProperties = { fontSize: '.78rem', color: 'var(--adm-fg-2)', lineHeight: 1.8 };
const subTitleStyle: React.CSSProperties = { fontWeight: 800, fontSize: '.82rem', color: 'var(--adm-fg)', marginBottom: 7 };
const areaStyle: React.CSSProperties = {
    width: '100%', padding: '11px 12px', fontSize: '.82rem', lineHeight: 1.85, fontWeight: 600,
    borderRadius: 'var(--adm-r-sm)', border: '1px solid var(--adm-border)',
    background: 'var(--adm-surface-2)', color: 'var(--adm-fg)', resize: 'vertical',
};
const checkBoxStyle: React.CSSProperties = { width: 16, height: 16, accentColor: 'var(--adm-accent)' };
const checkStyle: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: '.8rem',
    fontWeight: 700, color: 'var(--adm-fg)', cursor: 'pointer',
};
const copyBoxStyle: React.CSSProperties = {
    marginTop: 9, padding: '9px 11px', borderRadius: 'var(--adm-r-sm)',
    border: '1px dashed var(--adm-border-strong)', background: 'var(--adm-surface)',
    color: 'var(--adm-fg)', fontSize: '.78rem', lineHeight: 1.85, userSelect: 'all',
};

/**
 * خريطة الأسبوع (يوم × ساعة) — **التمثيل الوحيد الغنيّ للذروة** في الشاشة.
 * كانت إلى جانبها أربعة رسومٍ أخرى تقول الشيء نفسه بتفصيلٍ أقلّ.
 */
const WeekHeatmap = memo<{
    cells: any[];
    activeDow: number | 'all';
    onPick: (dow: number, h: number) => void;
}>(({ cells, activeDow, onPick }) => {
    const hm = new Map<string, number>(cells.map((c) => [`${c.dow}-${c.h}`, Number(c.n)]));
    const maxN = Math.max(1, ...cells.map((c) => Number(c.n)));
    return (
        <div className="adm-table-wrap" style={{ direction: 'ltr' }}>
            <div style={{ display: 'inline-block', minWidth: '100%' }}>
                {Array.from({ length: 7 }, (_, dow) => (
                    <div key={dow} style={{ display: 'flex', alignItems: 'center', gap: 2, marginBottom: 2 }}>
                        <span style={{ width: 52, flexShrink: 0, direction: 'rtl', textAlign: 'right', paddingInlineEnd: 4, fontSize: '.62rem', fontWeight: 800, color: 'var(--adm-fg-3)' }}>
                            {DOW_AR[dow]}
                        </span>
                        {Array.from({ length: 24 }, (_, h) => {
                            const n = hm.get(`${dow}-${h}`) || 0;
                            const active = activeDow === 'all' || activeDow === dow;
                            return (
                                <button
                                    key={h} type="button" onClick={() => onPick(dow, h)} className="adm-focusable"
                                    title={`${DOW_AR[dow]} ${fmtHour(h)} — ${n} حجز`}
                                    style={{
                                        flex: 1, minWidth: 10, height: 16, borderRadius: 3, border: 'none', cursor: 'pointer',
                                        background: n === 0 ? 'var(--adm-surface-3)' : 'var(--adm-accent)',
                                        opacity: n === 0 ? (active ? 1 : .45) : (active ? .2 + .8 * (n / maxN) : .3),
                                    }}
                                />
                            );
                        })}
                    </div>
                ))}
                <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <span style={{ width: 52, flexShrink: 0 }} />
                    {Array.from({ length: 24 }, (_, h) => (
                        <span key={h} style={{ flex: 1, minWidth: 10, textAlign: 'center', fontSize: '.55rem', color: 'var(--adm-fg-3)' }}>
                            {h % 3 === 0 ? h : ''}
                        </span>
                    ))}
                </div>
            </div>
        </div>
    );
});
WeekHeatmap.displayName = 'WeekHeatmap';

/** لوحة التاجر المفتوحة: تقريره، بطاقة المنافسة **الواحدة**، ثم التوصية. */
const SellerPanel: React.FC<{
    s: SellerRow; report: any | null; competitors: any | null; loading: boolean;
    draft: string; onDraft: (v: string) => void;
    email: boolean; onEmail: (v: boolean) => void;
    sending: boolean; onSend: () => void; onRetry: () => void;
}> = ({ s, report, competitors, loading, draft, onDraft, email, onEmail, sending, onSend, onRetry }) => {
    if (loading) return <AdmSkeleton rows={2} height={46} />;
    if (!report) return <AdmError message="تعذّر تحميل تقرير هذا التاجر." onRetry={onRetry} />;
    const bestHour: HourRow | null = report.cat_city_hours?.length
        ? [...report.cat_city_hours].sort((a: HourRow, b: HourRow) => b.n - a.n)[0] : null;
    return (
        <>
            <div style={panelStyle}>
                <div style={panelTitleStyle}>⏰ أفضل ساعة لتصنيفه في مدينته</div>
                <div style={panelBodyStyle}>
                    {bestHour ? `${fmtHour(bestHour.h)} (${catLabel(report.top_category)})` : 'لا بيانات كافية بعد'}
                </div>
            </div>

            {/* بطاقةٌ واحدة للمنافسة — كانتا بطاقتين متجاورتين تقولان الشيء نفسه
                بمستويَي تفصيل: متوسط المنافسين، ثم المنافسون المباشرون. */}
            <div style={panelStyle}>
                <div style={panelTitleStyle}>
                    ⚔️ موقعه بين منافسيه {competitors?.city ? `(${competitors.city} / ${catLabel(competitors.category)})` : '(نفس المدينة والتصنيف)'}
                </div>
                <MiniRow label={<b>{s.shop} (هو)</b>} value={`📦 ${admNum(s.bookings_30)}/٣٠ي • 🏷 ${admNum(s.active_deals)} • ⭐ ${s.rating_avg ?? '—'}`} />
                <MiniRow label="متوسط منافسيه" value={`📦 ${report.cat_city_avg_bookings_30 ?? '—'}/٣٠ي`} />
                {((competitors?.competitors || []) as any[]).map((c: any) => (
                    <MiniRow key={c.id} label={c.shop}
                        value={`📦 ${admNum(c.bookings_30)}/٣٠ي • 🏷 ${admNum(c.active_deals)} • ⭐ ${c.rating_avg ?? '—'} • 👁 ${admNum(c.views_30)}`} />
                ))}
                <p style={noteStyle}>إن كان أضعف منهم فالتوصية أدناه هي الفرق.</p>
            </div>

            {report.top_deal?.item_name && (
                <div style={panelStyle}>
                    <div style={panelTitleStyle}>🏆 أفضل منتجاته</div>
                    <div style={panelBodyStyle}>«{report.top_deal.item_name}» — {admNum(report.top_deal.bookings)} حجزاً، {admNum(report.top_deal.views)} مشاهدة</div>
                </div>
            )}

            <div>
                <div style={panelTitleStyle}>📨 التوصية المقترحة — عدّلها كما تريد، ولن تُرسل إلا بضغطتك</div>
                <textarea value={draft} onChange={(e) => onDraft(e.target.value)} rows={7}
                    className="adm-focusable" style={areaStyle} aria-label={`نص التوصية لـ${s.shop}`} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 9, flexWrap: 'wrap' }}>
                    <label style={checkStyle}>
                        <input type="checkbox" checked={email} onChange={(e) => onEmail(e.target.checked)} style={checkBoxStyle} />
                        📧 أرسل نسخة بريدية أيضاً
                    </label>
                    <span style={{ flex: 1 }} />
                    <AdmButton variant="primary" onClick={onSend} disabled={sending || !draft.trim()}>
                        {sending ? '⏳ جاري الإرسال…' : `📨 إرسال التوصية لـ«${s.shop}»`}
                    </AdmButton>
                </div>
            </div>
        </>
    );
};

// ═══════════════════════════════════════════════════════════════════════════
// المكوّن الرئيسي
// ═══════════════════════════════════════════════════════════════════════════
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
    // مرشّحات (مدينة/تصنيف/حالة) تُطبَّق على قائمة الصحة وعلى الإرسال المستهدف
    const [fCity, setFCity] = useState('all');
    const [fCat, setFCat] = useState('all');
    const [fStatus, setFStatus] = useState<'all' | 'weak' | 'risk' | 'expired' | 'nodeals'>('all');
    // الإرسال الجماعي المستهدف (بموافقة ناصر دائماً)
    const [bulkMsg, setBulkMsg] = useState('');
    const [bulkEmail, setBulkEmail] = useState(false);
    const [bulkSending, setBulkSending] = useState(false);
    const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
    const [pulse2, setPulse2] = useState<any | null>(null);
    const [funnelData, setFunnelData] = useState<any | null>(null);
    // راصد الأسوأ: أنت تحدد البعد والمقياس والحد
    const [worstDim, setWorstDim] = useState<'by_city' | 'by_category' | 'by_store'>('by_city');
    const [worstMetric, setWorstMetric] = useState<'cancel_rate' | 'least_bookings' | 'seller_cancels'>('cancel_rate');
    const [worstMin, setWorstMin] = useState(3);
    const [mxCity, setMxCity] = useState<string>('all');
    const [mxCat, setMxCat] = useState<string>('all');
    const [matrix, setMatrix] = useState<any | null>(null);
    const [matrixLoading, setMatrixLoading] = useState(false);
    /** 🪤 «إعادة المحاولة» بإعادة ضبط نفس المدينة لا تفعل شيئاً — React تتجاهل
        القيمة المطابقة فلا يعمل التأثير. عدّادٌ صريح هو ما يُعيد الجلب فعلاً. */
    const [matrixNonce, setMatrixNonce] = useState(0);
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
    }, [mxCity, mxCat, matrixNonce]);

    const diagnosis = useMemo(() => buildDiagnosis(data, pulse2, funnelData), [data, pulse2, funnelData]);

    // «المحلل المخصص»: شريحة حرة يحددها ناصر يدوياً وتتحلل تلقائياً
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

    // التحكم الكامل بالساعات (خريطة ٧×٢٤ + تحليل مدى تختاره)
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

    const cityOptions = useMemo(
        () => [{ value: 'all', label: 'كل المدن' }, ...Array.from(new Set(sellers.map((s) => s.city).filter(Boolean) as string[])).map((c) => ({ value: c, label: c }))],
        [sellers],
    );
    const catOptions = useMemo(
        () => [{ value: 'all', label: 'كل التصنيفات' }, ...Array.from(new Set(sellers.map((s) => s.top_category).filter(Boolean) as string[])).map((c) => ({ value: c, label: catLabel(c) }))],
        [sellers],
    );
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

    // خيارات المدن/الأقسام للوحات الاستكشاف (من بيانات المنصّة لا من التجار)
    const geoCityOptions = useMemo(
        () => [{ value: 'all', label: 'كل المدن' }, ...((data?.cities || []) as GeoRow[]).filter((c) => c.city && c.city !== 'غير محدد').map((c) => ({ value: c.city!, label: c.city! }))],
        [data],
    );
    const geoCatOptions = useMemo(
        () => [{ value: 'all', label: 'كل الأقسام' }, ...((data?.categories || []) as GeoRow[]).filter((c) => c.category).map((c) => ({ value: c.category!, label: catLabel(c.category) }))],
        [data],
    );

    // ── أين الفرصة؟ — محورٌ واحد لكل بُعد، ووسمٌ واحد «⚡ فرصة» ───────────────
    /** المدن: **توصية فقط** — الجداول الجغرافية مكانها «جمهور المدن». */
    const cityOpportunities = useMemo(() => {
        const cities = (data?.cities || []) as GeoRow[];
        const supply = new Map(cities.map((c) => [c.city, Number(c.deals) || 0]));
        const names = new Set<string>();
        cities.forEach((c) => { if (c.city && c.city !== 'غير محدد' && c.bookings >= 5 && c.deals <= 2) names.add(c.city); });
        ((data?.buyers_by_city || []) as BuyerCityRow[]).forEach((b) => {
            if (b.city && b.city !== 'غير محدد' && b.buyers >= 2 && (supply.get(b.city) ?? 0) <= 1) names.add(b.city);
        });
        return Array.from(names);
    }, [data]);

    /** التصنيفات: تفاعل ٣٠ يوماً (المصدر الأغنى) مدموجاً بطلب/عرض كل قسم. */
    const catRows = useMemo(() => {
        const eng = new Map<string, any>(((pulse2?.cat_engagement || []) as any[]).map((c) => [String(c.category), c]));
        const base = new Map<string, GeoRow>(((data?.categories || []) as GeoRow[]).map((c) => [String(c.category), c]));
        return Array.from(new Set([...eng.keys(), ...base.keys()])).map((id) => {
            const e = eng.get(id); const g = base.get(id);
            const deals = Number(e?.active_deals ?? g?.deals ?? 0);
            const b30 = Number(e?.bookings_30 ?? 0);
            const bAll = Number(g?.bookings ?? 0);
            const views = Number(e?.views_30 || 0);
            const clicks = Number(e?.clicks_30 || 0);
            const engagement = views + clicks;
            const verdict: { text: string; tone: Tone } =
                (b30 > 0 && deals === 0) || (bAll >= 5 && deals <= 2)
                    ? { text: '⚡ فرصة', tone: 'warn' }
                    : engagement >= 10 && b30 / Math.max(engagement, 1) < 0.05
                        ? { text: 'يُشاهَد ولا يُحجز', tone: 'info' }
                        : b30 >= 5 ? { text: 'رائج', tone: 'ok' } : { text: 'هادئ', tone: 'neutral' };
            return { id, deals, b30, bAll, views, clicks, verdict };
        }).sort((a, b) => (b.b30 + b.bAll) - (a.b30 + a.bAll));
    }, [data, pulse2]);

    /** المواقع (المولات والأسواق): طلبٌ مقابل عرض. */
    const mallRows = useMemo(() => ((data?.malls || []) as GeoRow[]).map((m) => ({
        name: m.mall || 'غير محدد',
        bookings: Number(m.bookings) || 0,
        deals: Number(m.deals) || 0,
        opportunity: Number(m.bookings) >= 5 && Number(m.deals) <= 2,
    })), [data]);

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

    /**
     * 🔴 الجمهور هنا جمهوران لا واحد:
     *  • بلا أي مرشّح ⇒ «كل التجار» ⇐ **بثٌّ واحد على الخادم**.
     *  • مع مرشّح ⇒ شريحةٌ لا تعرفها دالّة البثّ (لا مدينة ولا تصنيف ولا حالة)
     *    ⇐ تبقى الحلقة المفردة، وإلا وصلت الرسالة إلى **كل** التجار بصمت.
     */
    const wholeAudience = fCity === 'all' && fCat === 'all' && fStatus === 'all';

    const sendBulk = async () => {
        if (bulkSending || !bulkMsg.trim() || filteredSellers.length === 0) return;
        const title = '💡 رسالة من فريق تاكي';
        if (wholeAudience) {
            const ok = await customConfirm(`ستصل هذه الرسالة إلى كل التجار على المنصّة دفعةً واحدة${bulkEmail ? ' + بريد إلكتروني' : ''}. متابعة؟`);
            if (!ok) return;
            setBulkSending(true);
            const r = await adminService.broadcastNotification({
                titleAr: title, bodyAr: bulkMsg.trim(), audience: 'sellers', email: bulkEmail,
            });
            setBulkSending(false);
            await customAlert(r.success
                ? `✅ وصلت إلى ${admNum(r.notified)} تاجراً${r.emailed ? ` (و${admNum(r.emailed)} بريداً)` : ''}.`
                : `❌ تعذّر الإرسال: ${r.error || ''}`);
            return;
        }
        const ok = await customConfirm(`سيتم إرسال هذه الرسالة إلى ${filteredSellers.length} تاجراً (${fCity === 'all' ? 'كل المدن' : fCity} / ${fCat === 'all' ? 'كل التصنيفات' : catLabel(fCat)})${bulkEmail ? ' + بريد إلكتروني' : ''}. متابعة؟`);
        if (!ok) return;
        setBulkSending(true);
        setBulkProgress({ done: 0, total: filteredSellers.length });
        let done = 0, failed = 0;
        for (const s of filteredSellers) {
            const r = await adminService.notifyUser({ userId: s.id, titleAr: title, bodyAr: bulkMsg.trim(), email: bulkEmail });
            if (r.success) done++; else failed++;
            setBulkProgress({ done: done + failed, total: filteredSellers.length });
        }
        setBulkSending(false);
        setBulkProgress(null);
        await customAlert(failed === 0 ? `✅ أُرسلت الرسالة لـ${admNum(done)} تاجراً.` : `⚠️ نجح ${admNum(done)} وفشل ${admNum(failed)}.`);
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

    // ─── أرقام الخلاصة: **مصدرٌ واحد** (`admin_ai_funnel`) وعرضٌ واحد ─────────
    const fn = funnelData?.funnel || {};
    const bookings = Number(fn.bookings) || 0;
    const completed = Number(fn.completed) || 0;
    const cancelled = Number(fn.cancelled) || 0;
    const buyers = data?.buyers || {};
    const peakHours: HourRow[] = useMemo(
        () => [...((data?.peak_hours || []) as HourRow[])].sort((a, b) => b.n - a.n).slice(0, 3),
        [data],
    );
    const renew: RenewRow[] = data?.renewals || [];
    const lastRenew = renew.length ? renew[renew.length - 1] : null;
    const criticalItem = diagnosis.items.find((i) => i.severity === 'critical');
    /** نسبةُ رقمٍ من حجوزات الفترة — تُكتب مرّةً وتُقرأ في كل بطاقة. */
    const shareOfPeriod = (n: number) => (bookings ? `${admNum(Math.round((n / bookings) * 100))}٪ من حجوزات الفترة` : 'لا حجوزات بعد');
    const healthTone: Tone = diagnosis.health >= 75 ? 'ok' : diagnosis.health >= 50 ? 'warn' : 'bad';

    if (loading) return <AdmSkeleton rows={5} height={96} />;
    if (!data) return <AdmError message="تعذّر تحميل بيانات المحلل — القاعدة لم تُجب." onRetry={load} />;

    return (
        <div dir="rtl" style={{ display: 'grid', gap: 14 }}>

            {/* ── فترة التحليل: زرٌّ واحد يحكم كل الأقسام ───────────────────── */}
            <AdmCard>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{ fontSize: '.72rem', fontWeight: 800, color: 'var(--adm-fg-3)' }}>فترة التحليل</span>
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                        {[7, 30, 90].map((d) => (
                            <button key={d} type="button" aria-pressed={days === d} className="adm-focusable"
                                onClick={() => { setDays(d); setCuStart(isoDay(-d)); setCuEnd(isoDay(0)); }}
                                style={{
                                    padding: '6px 13px', fontSize: '.78rem', fontWeight: 800, borderRadius: 999, cursor: 'pointer',
                                    border: `1px solid ${days === d ? 'transparent' : 'var(--adm-border)'}`,
                                    background: days === d ? 'var(--adm-accent)' : 'var(--adm-surface-2)',
                                    color: days === d ? '#ffffff' : 'var(--adm-fg-2)',
                                }}>
                                {admNum(d)} يوماً
                            </button>
                        ))}
                    </div>
                    <span style={{ flex: 1 }} />
                    <AdmButton onClick={load} size="sm" title="إعادة جلب كل الأقسام">🔄 تحديث</AdmButton>
                </div>
                <p style={{ ...noteStyle, marginTop: 9 }}>
                    تسري على كل الأقسام، وتُزامِن تواريخ «المحلل المخصّص» معها — فلا يتعارض رقمان.
                </p>
            </AdmCard>

            {/* ── ١) الخلاصة التنفيذية: صحة المنصّة + المؤشرات + القرار ──────── */}
            <AdmSection title="الخلاصة التنفيذية" icon="📋" badge={{ text: `${admNum(diagnosis.health)}٪ صحة`, tone: healthTone }}
                desc="حالة المنصّة في سطرٍ وأرقامٍ قليلة، ثم القرار الأهم الآن.">
                <div style={{ display: 'grid', gap: 14 }}>
                    <div>
                        <div style={{ height: 10, borderRadius: 999, background: 'var(--adm-surface-3)', overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${diagnosis.health}%`, background: `var(--adm-${healthTone}-fg)`, transition: 'width .25s' }} />
                        </div>
                        <p style={{ margin: '8px 0 0', fontSize: '.8rem', lineHeight: 1.8, color: 'var(--adm-fg-2)' }}>
                            {diagnosis.weakest.length
                                ? <>أضعف النقاط حالياً: <b style={{ color: 'var(--adm-fg)' }}>{diagnosis.weakest.join(' • ')}</b> — علاجها مفصّل في التشخيص أدناه.</>
                                : 'لا نقاط ضعف جوهرية — المؤشرات كلها ضمن الصحي.'}
                        </p>
                    </div>

                    <AdmStatGrid cols={3}>
                        <AdmStat icon="📦" label="حجوزات الفترة" value={admNum(bookings)} scope={`آخر ${admNum(days)} يوماً`} />
                        <AdmStat icon="✅" label="اكتمل استلامها" value={admNum(completed)} tone="ok" scope={shareOfPeriod(completed)} />
                        <AdmStat icon="🚫" label="أُلغيت" value={admNum(cancelled)} scope={shareOfPeriod(cancelled)}
                            tone={bookings && cancelled / bookings > 0.35 ? 'bad' : 'neutral'} />
                        <AdmStat icon="⏰" label="أقوى ٣ ساعات" value={peakHours.length ? fmtHour(peakHours[0].h) : '—'}
                            scope={peakHours.length > 1 ? `ثم ${peakHours.slice(1).map((r) => fmtHour(r.h)).join(' · ')} — كل المنصّة` : 'لا بيانات ساعات بعد'} />
                        <AdmStat icon="🔁" label="عودة المشترين" scope={`${admNum(Number(buyers.active_30) || 0)} مشترياً نشطاً آخر ٣٠ يوماً`}
                            value={`${Number(buyers.with_booking) ? Math.round(((Number(buyers.repeaters) || 0) / Number(buyers.with_booking)) * 100) : 0}٪`} />
                        <AdmStat icon="💳" label="تجديد الشهر الحالي" scope={lastRenew ? `${admNum(lastRenew.renewed)} من ${admNum(lastRenew.expired)} جدّدوا` : 'لا اشتراكات انتهت بعد'}
                            value={lastRenew && lastRenew.expired ? `${Math.round((lastRenew.renewed / lastRenew.expired) * 100)}٪` : '—'} />
                    </AdmStatGrid>

                    <div style={{
                        padding: '12px 14px', borderRadius: 'var(--adm-r-sm)',
                        background: criticalItem ? 'var(--adm-bad-bg)' : 'var(--adm-ok-bg)',
                        color: criticalItem ? 'var(--adm-bad-fg)' : 'var(--adm-ok-fg)',
                        fontSize: '.83rem', fontWeight: 700, lineHeight: 1.8,
                    }}>
                        {criticalItem
                            ? <>🎯 القرار الأهم الآن: {criticalItem.title} — {criticalItem.fix?.[0] || criticalItem.evidence}</>
                            : '🎯 لا يوجد خطر عاجل — القرار الأنسب: نفّذ خطوة واحدة من «خطة النمو والتسويق» أدناه.'}
                    </div>

                    <p style={noteStyle}>
                        أرقام الحجوزات هنا مصدرها واحد (تحليل القمع) ولا تتكرّر في أي بطاقةٍ أخرى بهذه الشاشة.
                        قمع التحويل الكامل والاحتفاظ بالكوهورت في شاشة <b>«التحليلات»</b>، والأرقام الجغرافية في <b>«جمهور المدن»</b>.
                    </p>
                </div>
            </AdmSection>

            {/* ── ٢) التشخيص: مكمن الخلل والعلاج ───────────────────────────── */}
            <AdmSection title="التشخيص — مكمن الخلل والعلاج" icon="🧠"
                badge={diagnosis.items.length ? { text: `${admNum(diagnosis.items.length)} تشخيصاً`, tone: 'neutral' } : undefined}
                desc="الأخطر أولاً. كل بطاقة: الدليل بالأرقام، ثم السبب الجذري، ثم خطوات العلاج.">
                {diagnosis.items.length === 0 ? (
                    <AdmEmpty icon="✅" title="لا مشاكل مرصودة حالياً" hint="كل القواعد التي يفحصها المحلل ضمن الحدود الصحية — عاود الفحص بعد تغيّر الفترة." />
                ) : (
                    <div style={{ display: 'grid', gap: 10 }}>
                        {diagnosis.items.map((dg) => <DiagnosisCard key={dg.id} dg={dg} />)}
                    </div>
                )}
            </AdmSection>

            {/* ── ٣) صحة التجار ─────────────────────────────────────────────── */}
            <AdmSection title="صحة التجار" icon="🏪" badge={{ text: `${admNum(filteredSellers.length)} من ${admNum(sellers.length)}`, tone: 'neutral' }}
                desc="الأخطر أولاً. اضغط أي تاجر لتقريره المعمّق وتوصيةٍ جاهزة لا تُرسل إلا بضغطتك.">
                <AdmToolbar>
                    <AdmSelect label="المدينة" value={fCity} onChange={setFCity} options={cityOptions} />
                    <AdmSelect label="التصنيف" value={fCat} onChange={setFCat} options={catOptions} />
                    <AdmSelect
                        label="الحالة" value={fStatus} onChange={(v) => setFStatus(v as typeof fStatus)}
                        options={[
                            { value: 'all', label: 'كل الحالات' },
                            { value: 'weak', label: 'الضعاف (خطر ٣٠+)' },
                            { value: 'risk', label: 'الخطرون (خطر ٦٠+)' },
                            { value: 'expired', label: 'منتهو الاشتراك' },
                            { value: 'nodeals', label: 'بلا عروض نشطة' },
                        ]}
                    />
                </AdmToolbar>

                {filteredSellers.length === 0 ? (
                    <AdmEmpty icon="🔎" title="لا تجار مطابقين" hint="لا أحد يطابق هذه المرشّحات — وسّعها أو أعدها إلى «كل الحالات»." />
                ) : (
                    <div style={{ display: 'grid', gap: 9 }}>
                        {filteredSellers.map((s) => {
                            const risk = sellerRisk(s);
                            const dl = daysLeft(s.expires_at);
                            const trend = s.bookings_30 > s.bookings_prev30 ? '↗︎' : s.bookings_30 < s.bookings_prev30 ? '↘︎' : '→';
                            const riskTone: Tone = risk.score >= 60 ? 'bad' : risk.score >= 30 ? 'warn' : 'ok';
                            const isOpen = openSeller === s.id;
                            return (
                                <div key={s.id} style={{
                                    border: '1px solid var(--adm-border)', borderRadius: 'var(--adm-r)',
                                    background: 'var(--adm-surface)', overflow: 'hidden',
                                }}>
                                    <button
                                        type="button" onClick={() => openReport(s)} aria-expanded={isOpen}
                                        className="adm-focusable"
                                        style={{ width: '100%', textAlign: 'right', padding: '13px 14px', background: 'transparent', border: 'none', cursor: 'pointer' }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                            <span style={{ fontWeight: 800, fontSize: '.9rem', color: 'var(--adm-fg)' }}>{s.shop}</span>
                                            {s.city && <span style={{ fontSize: '.72rem', color: 'var(--adm-fg-3)' }}>📍 {s.city}</span>}
                                            <span style={{ marginInlineStart: 'auto' }}>
                                                <AdmPill tone={riskTone}>
                                                    {risk.score >= 60 ? 'خطر عالٍ' : risk.score >= 30 ? 'انتبه' : 'سليم'} {admNum(risk.score)}
                                                </AdmPill>
                                            </span>
                                        </div>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 14px', marginTop: 7, fontSize: '.76rem', color: 'var(--adm-fg-2)', fontVariantNumeric: 'tabular-nums' }}>
                                            <span>📦 {admNum(s.bookings_30)} حجز/٣٠ي {trend}</span>
                                            <span>👁 {admNum(s.deal_views_30 + s.store_views_30)} زيارة</span>
                                            <span>🏷 {admNum(s.active_deals)} عرض نشط</span>
                                            <span>⭐ {s.rating_avg ?? '—'}</span>
                                            <span>{dl === null ? '🆓 بلا اشتراك' : dl < 0 ? `⛔ منتهٍ منذ ${admNum(-dl)} يوم` : `⏳ ${admNum(dl)} يوم متبقٍ`}</span>
                                        </div>
                                        {risk.reasons.length > 0 && (
                                            <div style={{ marginTop: 6, fontSize: '.76rem', fontWeight: 700, color: `var(--adm-${riskTone}-fg)` }}>
                                                السبب المرجّح: {risk.reasons.slice(0, 2).join(' + ')}
                                            </div>
                                        )}
                                    </button>

                                    {isOpen && (
                                        <div style={{ borderTop: '1px solid var(--adm-border)', background: 'var(--adm-surface-2)', padding: 14, display: 'grid', gap: 10 }}>
                                            <SellerPanel
                                                s={s} report={report} competitors={competitors} loading={reportLoading}
                                                draft={tipDraft} onDraft={setTipDraft}
                                                email={tipEmail} onEmail={setTipEmail}
                                                sending={sending} onSend={() => sendTip(s)} onRetry={() => openReport(s)}
                                            />
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </AdmSection>

            {/* ── ٤) الإرسال المستهدف ───────────────────────────────────────── */}
            <AdmSection title="إرسال مستهدف للتجار" icon="📣" collapsible defaultOpen={false}
                badge={{ text: wholeAudience ? 'كل التجار' : `${admNum(filteredSellers.length)} تاجراً`, tone: wholeAudience ? 'warn' : 'info' }}
                desc="المستقبِلون هم نتيجة مرشّحات «صحة التجار» أعلاه. لا شيء يُرسل إلا بتأكيدك.">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                    {bulkTemplates.map((t) => (
                        <AdmButton key={t.id} size="sm" onClick={() => setBulkMsg(t.text)}>{t.label}</AdmButton>
                    ))}
                </div>
                <textarea value={bulkMsg} onChange={(e) => setBulkMsg(e.target.value)} rows={5} placeholder="اكتب الرسالة أو اختر قالباً…"
                    className="adm-focusable" style={areaStyle} aria-label="نص الرسالة الجماعية" />
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 9, flexWrap: 'wrap' }}>
                    <label style={checkStyle}>
                        <input type="checkbox" checked={bulkEmail} onChange={(e) => setBulkEmail(e.target.checked)} style={checkBoxStyle} />
                        📧 بريد إلكتروني أيضاً
                    </label>
                    <span style={{ flex: 1 }} />
                    <AdmButton variant="primary" onClick={sendBulk} disabled={bulkSending || !bulkMsg.trim() || filteredSellers.length === 0}>
                        {bulkSending && bulkProgress
                            ? `⏳ ${admNum(bulkProgress.done)}/${admNum(bulkProgress.total)}…`
                            : wholeAudience ? '📨 إرسال لكل التجار' : `📨 إرسال لـ${admNum(filteredSellers.length)} تاجراً`}
                    </AdmButton>
                </div>
                <p style={noteStyle}>
                    {wholeAudience
                        ? 'بلا مرشّحات = بثٌّ واحد ينفّذه الخادم دفعةً واحدة (أسرع وأدقّ من إرسالٍ لكل تاجر على حدة).'
                        : 'مع مرشّح = إرسالٌ لكل تاجر في الشريحة على حدة، لأن البثّ الجماعي لا يفهم المرشّحات.'}
                    {' '}تصل الرسالة إشعاراً داخل الموقع وإلى بوت التاجر المرتبط.
                </p>
            </AdmSection>

            {/* ── ٥) أين الفرصة؟ — لوحةٌ واحدة بثلاثة محاور ووسمٍ واحد ──────── */}
            <AdmSection title="أين الفرصة؟" icon="⚡"
                desc="موضعٌ واحد لكل فجوةٍ بين الطلب والعرض — بثلاثة محاور ووسمٍ واحد «⚡ فرصة».">
                <div style={{ display: 'grid', gap: 16 }}>
                    <div>
                        <div style={subTitleStyle}>🏙 محور المدن — التوصية</div>
                        {cityOpportunities.length ? (
                            <p style={{ margin: 0, fontSize: '.82rem', lineHeight: 1.85, color: 'var(--adm-fg-2)' }}>
                                ركّز استقطاب التجار على <b style={{ color: 'var(--adm-warn-fg)' }}>{cityOpportunities.join('، ')}</b> —
                                الطلب فيها يفوق المعروض، وأول تاجر تستقطبه سيحصد الطلب كله.
                            </p>
                        ) : (
                            <p style={{ margin: 0, fontSize: '.82rem', lineHeight: 1.85, color: 'var(--adm-fg-2)' }}>
                                لا فجوة جغرافية واضحة الآن — الطلب والعرض متقاربان في مدنك.
                            </p>
                        )}
                        <p style={noteStyle}>أرقام المدن والمناطق كاملةً في شاشة <b>«جمهور المدن»</b> — لا تُكرَّر هنا.</p>
                    </div>

                    <div>
                        <div style={subTitleStyle}>🏷 محور التصنيفات — الطلب مقابل المعروض</div>
                        <AdmTable
                            caption="تفاعل كل تصنيف: مشاهدات ونقرات وحجوزات مقابل العروض النشطة"
                            rows={catRows}
                            keyOf={(r) => r.id}
                            empty={{ icon: '🏷', title: 'لا تفاعل مسجّل بعد', hint: 'يظهر هذا المحور بعد أول مشاهدات وحجوزات على الأقسام.' }}
                            columns={[
                                { header: 'التصنيف', cell: (r) => catLabel(r.id) },
                                { header: 'مشاهدات ٣٠ي', numeric: true, secondary: true, cell: (r) => admNum(r.views) },
                                { header: 'نقرات ٣٠ي', numeric: true, secondary: true, cell: (r) => admNum(r.clicks) },
                                { header: 'حجوزات ٣٠ي', numeric: true, cell: (r) => admNum(r.b30) },
                                { header: 'عروض نشطة', numeric: true, cell: (r) => admNum(r.deals) },
                                { header: 'الحكم', cell: (r) => <AdmPill tone={r.verdict.tone}>{r.verdict.text}</AdmPill> },
                            ]}
                        />
                    </div>

                    <div>
                        <div style={subTitleStyle}>🏬 محور المواقع — المولات والأسواق</div>
                        <AdmTable
                            caption="المولات والأسواق: حجوزات مقابل عروض نشطة"
                            rows={mallRows.slice(0, 10)}
                            keyOf={(r) => r.name}
                            empty={{ icon: '🏬', title: 'لا مواقع مسجّلة بعد', hint: 'تظهر هنا حين يربط التجار عروضهم بمولٍّ أو سوق.' }}
                            columns={[
                                { header: 'الموقع', cell: (r) => r.name },
                                { header: 'حجوزات', numeric: true, cell: (r) => admNum(r.bookings) },
                                { header: 'عروض', numeric: true, cell: (r) => admNum(r.deals) },
                                { header: 'الحكم', cell: (r) => (r.opportunity ? <AdmPill tone="warn">⚡ فرصة</AdmPill> : <AdmPill>—</AdmPill>) },
                            ]}
                        />
                    </div>
                </div>
            </AdmSection>

            {/* ── ٦) الإلغاءات: من ألغى، وأين تتركّز ────────────────────────── */}
            <AdmSection title="الإلغاءات — من ألغى وأين تتركّز" icon="🚫"
                desc="موضعٌ واحد للإلغاء في هذه الشاشة: الفاعل أولاً، ثم أسوأ المدن والأقسام والمتاجر.">
                {!funnelData ? <AdmSkeleton rows={2} height={70} /> : (
                    <div style={{ display: 'grid', gap: 16 }}>
                        <AdmStatGrid cols={4}>
                            <AdmStat icon="🛒" label="ألغاها المشتري" value={admNum(Number(fn.cancel_buyer) || 0)} scope={`آخر ${admNum(days)} يوماً`} />
                            <AdmStat icon="🏪" label="ألغاها التاجر" value={admNum(Number(fn.cancel_seller) || 0)} tone={Number(fn.cancel_seller) > 0 ? 'bad' : 'neutral'} scope="مؤشّر خطير: سلعة غير متوفرة" />
                            <AdmStat icon="⏱" label="انتهت المهلة" value={admNum(Number(fn.cancel_system) || 0)} scope="حجز لم يُستلم" />
                            <AdmStat icon="🗂" label="قديمة" value={admNum(Number(fn.cancel_legacy) || 0)} scope="قبل تتبّع «من ألغى»" />
                        </AdmStatGrid>

                        <div>
                            <div style={subTitleStyle}>🚨 راصد الأسوأ — أنت تحدد المعيار</div>
                            <AdmToolbar>
                                <AdmSelect
                                    label="البُعد" value={worstDim} onChange={(v) => setWorstDim(v as typeof worstDim)}
                                    options={[
                                        { value: 'by_city', label: 'المدن' },
                                        { value: 'by_category', label: 'الأقسام' },
                                        { value: 'by_store', label: 'المتاجر' },
                                    ]}
                                />
                                <AdmSelect
                                    label="المقياس" value={worstMetric} onChange={(v) => setWorstMetric(v as typeof worstMetric)}
                                    options={[
                                        { value: 'cancel_rate', label: 'الأعلى نسبة إلغاء' },
                                        { value: 'least_bookings', label: 'الأقل حجوزات' },
                                        { value: 'seller_cancels', label: 'الأكثر إلغاءً من التاجر' },
                                    ]}
                                />
                                <label style={{ display: 'inline-flex', flexDirection: 'column', gap: 3 }}>
                                    <span style={{ fontSize: '.68rem', fontWeight: 800, color: 'var(--adm-fg-3)' }}>حد أدنى للحجوزات</span>
                                    <input
                                        type="number" min={0} value={worstMin}
                                        onChange={(e) => setWorstMin(Math.max(0, Number(e.target.value) || 0))}
                                        className="adm-focusable"
                                        style={{
                                            width: 84, padding: '7px 10px', fontSize: '.82rem', fontWeight: 700, textAlign: 'center',
                                            borderRadius: 'var(--adm-r-sm)', border: '1px solid var(--adm-border)',
                                            background: 'var(--adm-surface)', color: 'var(--adm-fg)',
                                        }}
                                    />
                                </label>
                            </AdmToolbar>
                            {(() => {
                                const rows: any[] = ((funnelData[worstDim] || []) as any[]).filter((r: any) => Number(r.bookings) >= worstMin);
                                const sorted = [...rows].sort((a, b) => {
                                    if (worstMetric === 'least_bookings') return Number(a.bookings) - Number(b.bookings);
                                    if (worstMetric === 'seller_cancels') return Number(b.c_seller || 0) - Number(a.c_seller || 0);
                                    return (Number(b.cancelled) / Math.max(1, Number(b.bookings))) - (Number(a.cancelled) / Math.max(1, Number(a.bookings)));
                                }).slice(0, 10);
                                const nameOf = (r: any) => worstDim === 'by_city' ? r.city : worstDim === 'by_category' ? catLabel(r.category) : `${r.shop}${r.city ? ` (${r.city})` : ''}`;
                                return (
                                    <AdmTable
                                        caption="أسوأ عشرة صفوف حسب البُعد والمقياس المختارين"
                                        rows={sorted}
                                        keyOf={(_r, i) => String(i)}
                                        empty={{ icon: '🔎', title: 'لا نتائج فوق الحد المحدد', hint: 'خفّض «الحد الأدنى للحجوزات» ليظهر صفٌّ.' }}
                                        columns={[
                                            { header: '#', numeric: true, width: '42px', cell: (_r, i) => admNum(i + 1) },
                                            { header: 'الاسم', cell: (r) => nameOf(r) },
                                            { header: 'حجوزات', numeric: true, cell: (r) => admNum(Number(r.bookings)) },
                                            { header: 'مكتملة', numeric: true, secondary: true, cell: (r) => admNum(Number(r.completed)) },
                                            { header: 'ملغاة', numeric: true, cell: (r) => `${admNum(Number(r.cancelled))} (${admNum(Math.round((Number(r.cancelled) / Math.max(1, Number(r.bookings))) * 100))}٪)` },
                                            {
                                                header: 'ألغاها التاجر', numeric: true,
                                                cell: (r) => (Number(r.c_seller) > 0
                                                    ? <AdmPill tone="bad">{admNum(Number(r.c_seller))}</AdmPill>
                                                    : <span style={{ color: 'var(--adm-fg-3)' }}>—</span>),
                                            },
                                        ]}
                                    />
                                );
                            })()}
                            <p style={noteStyle}>
                                متجر يكثر إلغاؤه بنفسه = سلعة غير متوفرة فعلاً (أرسل له تنبيهاً من الإرسال المستهدف).
                                ومدينة عالية الإلغاء = راجع مدد التحضير ومواعيد المحلات فيها.
                            </p>
                        </div>
                    </div>
                )}
            </AdmSection>

            {/* ── ٧) ساعات الذروة: خريطة ٧×٢٤ + تحليل مدى ──────────────────── */}
            <AdmSection title="ساعات الذروة" icon="⏰"
                desc="الخريطة تقول متى يشتري الناس بالضبط؛ اضغط أي خلية لتحليل ساعتها، أو حدّد مدى بنفسك.">
                <div style={{ display: 'grid', gap: 16 }}>
                    {hoursData?.heatmap ? (
                        <div>
                            <div style={subTitleStyle}>
                                🗓 خريطة الأسبوع (يوم × ساعة) — الأغمق أنشط، والضغط يحلّل الخلية
                            </div>
                            <WeekHeatmap
                                cells={(hoursData.heatmap || []) as any[]}
                                activeDow={hrDow}
                                onPick={(dow, h) => { setHrDow(dow); setHrFrom(h); setHrTo(h); }}
                            />
                        </div>
                    ) : hoursLoading ? <AdmSkeleton rows={2} height={60} /> : null}

                    <div>
                        <AdmToolbar>
                            <AdmSelect label="من الساعة" value={String(hrFrom)} onChange={(v) => setHrFrom(Number(v))} options={HOUR_OPTIONS} />
                            <AdmSelect label="إلى الساعة" value={String(hrTo)} onChange={(v) => setHrTo(Number(v))} options={HOUR_OPTIONS} />
                            <AdmSelect label="اليوم" value={hrDow === 'all' ? 'all' : String(hrDow)} onChange={(v) => setHrDow(v === 'all' ? 'all' : Number(v))} options={DOW_OPTIONS} />
                        </AdmToolbar>
                        {hoursLoading ? <AdmSkeleton rows={1} height={70} /> : hoursData?.totals ? (
                            <>
                                <div style={{ fontSize: '.78rem', fontWeight: 700, color: 'var(--adm-fg-2)', marginBottom: 9 }}>
                                    {hrDow === 'all' ? 'كل الأيام' : DOW_AR[hrDow as number]} من {fmtHour(hrFrom)} إلى {fmtHour(hrTo)} — آخر {admNum(days)} يوماً
                                    {' '}(يدعم الالتفاف عبر منتصف الليل، مثل ١٠م ← ٤ص).
                                </div>
                                <AdmStatGrid cols={3}>
                                    <AdmStat icon="📦" label="حجوزات" value={admNum(Number(hoursData.totals.bookings) || 0)} scope="في هذا المدى" />
                                    <AdmStat icon="🛒" label="مشترون نشطون" value={admNum(Number(hoursData.totals.buyers) || 0)} scope="في هذا المدى" />
                                    <AdmStat icon="🏪" label="تجار مستفيدون" value={admNum(Number(hoursData.totals.sellers) || 0)} scope="في هذا المدى" />
                                    <AdmStat icon="👁" label="مشاهدات ونقرات" value={admNum((Number(hoursData.totals.views) || 0) + (Number(hoursData.totals.clicks) || 0))} scope={`${admNum(Number(hoursData.totals.searches) || 0)} عملية بحث`} />
                                    <AdmStat icon="✅" label="اكتملت" value={admNum(Number(hoursData.totals.completed) || 0)} tone="ok" scope="في هذا المدى" />
                                    <AdmStat icon="🏷" label="عروض نُشرت" value={admNum(Number(hoursData.totals.deals_published) || 0)} scope="في هذا المدى" />
                                </AdmStatGrid>
                                {(((hoursData.top_categories || []) as any[]).length > 0 || ((hoursData.top_cities || []) as any[]).length > 0) && (
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                                        {((hoursData.top_categories || []) as any[]).map((c) => (
                                            <AdmPill key={`c-${c.category}`} tone="info">🏷 {catLabel(c.category)} ×{admNum(Number(c.n))}</AdmPill>
                                        ))}
                                        {((hoursData.top_cities || []) as any[]).map((c) => (
                                            <AdmPill key={`t-${c.city}`}>🏙 {c.city} ×{admNum(Number(c.n))}</AdmPill>
                                        ))}
                                    </div>
                                )}
                            </>
                        ) : null}
                        <p style={noteStyle}>
                            استخدمه لقرارات دقيقة: متى تجدول الحملات، وأي ساعاتٍ تنصح تجار مدينةٍ معيّنة بالنشر فيها.
                        </p>
                    </div>
                </div>
            </AdmSection>

            {/* ── ٨) المحلل المخصّص ─────────────────────────────────────────── */}
            <AdmSection title="المحلل المخصّص" icon="🎛" collapsible defaultOpen={false}
                desc="حدّد أي تاريخ وساعة ومدينة وقسم — وسيتحلّل فوراً. هذه اللوحة وحدها تتبع اختيارك، وبقية الشاشة تتبع فترة الأعلى.">
                <div style={{ display: 'grid', gap: 12 }}>
                    <AdmDateRange value={{ from: cuStart, to: cuEnd }} onChange={(r) => { setCuStart(r.from); setCuEnd(r.to); }} />
                    <AdmToolbar>
                        <AdmSelect label="من الساعة" value={String(cuFrom)} onChange={(v) => setCuFrom(Number(v))} options={HOUR_OPTIONS} />
                        <AdmSelect label="إلى الساعة" value={String(cuTo)} onChange={(v) => setCuTo(Number(v))} options={HOUR_OPTIONS} />
                        <AdmSelect label="اليوم" value={cuDow === 'all' ? 'all' : String(cuDow)} onChange={(v) => setCuDow(v === 'all' ? 'all' : Number(v))} options={DOW_OPTIONS} />
                        <AdmSelect label="المدينة" value={cuCity} onChange={setCuCity} options={geoCityOptions} />
                        <AdmSelect label="القسم" value={cuCat} onChange={setCuCat} options={geoCatOptions} />
                        <AdmButton
                            size="sm"
                            onClick={() => { setCuStart(isoDay(-days)); setCuEnd(isoDay(0)); setCuFrom(0); setCuTo(23); setCuDow('all'); setCuCity('all'); setCuCat('all'); }}
                        >
                            ↺ إعادة الضبط
                        </AdmButton>
                    </AdmToolbar>

                    {cuLoading ? <AdmSkeleton rows={2} height={70} /> : cuData?.totals ? (() => {
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
                                <AdmStatGrid cols={4}>
                                    <AdmStat icon="📦" label="حجوزات" value={admNum(b)} scope={`${admNum(Number(tt.qty) || 0)} قطعة — في هذه الشريحة`} />
                                    <AdmStat icon="✅" label="مكتمل" value={admNum(ok)} tone="ok" scope={b ? `${admNum(Math.round((ok / b) * 100))}٪ من الشريحة` : 'لا حجوزات'} />
                                    <AdmStat icon="🛒" label="مشترون" value={admNum(Number(tt.buyers) || 0)} scope="في هذه الشريحة" />
                                    <AdmStat icon="🏪" label="تجار مستفيدون" value={admNum(Number(tt.sellers) || 0)} scope="في هذه الشريحة" />
                                    <AdmStat icon="👁" label="مشاهدات" value={admNum(Number(tt.views) || 0)} scope="في هذه الشريحة" />
                                    <AdmStat icon="👆" label="نقرات" value={admNum(Number(tt.clicks) || 0)} scope="في هذه الشريحة" />
                                    <AdmStat icon="🔎" label="عمليات بحث" value={admNum(Number(tt.searches) || 0)} scope="في هذه الشريحة" />
                                    <AdmStat icon="🏷" label="عروض نُشرت" value={admNum(Number(tt.deals_published) || 0)} scope="في هذه الشريحة" />
                                </AdmStatGrid>

                                {daily.length > 1 && (
                                    <div>
                                        <div style={panelTitleStyle}>📈 الاتجاه اليومي للشريحة</div>
                                        <Bars height={80} data={daily.map((r, i) => ({ label: daily.length <= 14 || i % Math.ceil(daily.length / 10) === 0 ? r.d.slice(5) : '', n: r.n }))} />
                                    </div>
                                )}

                                <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))' }}>
                                    {([
                                        ['🏙 المدن', cuData.top_cities], ['🏷 الأقسام', cuData.top_categories],
                                        ['🏬 المولات', cuData.top_malls], ['🏪 المتاجر', cuData.top_stores],
                                    ] as [string, any[]][]).filter(([, rows]) => (rows || []).length > 0).map(([label, rows]) => (
                                        <div key={label} style={softPanelStyle}>
                                            <div style={panelTitleStyle}>{label}</div>
                                            {(rows as any[]).slice(0, 4).map((r, i) => (
                                                <MiniRow
                                                    key={i}
                                                    label={label === '🏷 الأقسام' ? catLabel(r.name) : r.name}
                                                    value={`📦 ${admNum(Number(r.n))} • ✅ ${admNum(Number(r.ok))} • 🚫 ${admNum(Number(r.bad))}`}
                                                />
                                            ))}
                                        </div>
                                    ))}
                                </div>

                                {((cuData.top_deals || []) as any[]).length > 0 && (
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                        {(cuData.top_deals as any[]).map((r, i) => (
                                            <AdmPill key={i} tone="info">🏆 «{r.name}» — {r.shop} ×{admNum(Number(r.n))}</AdmPill>
                                        ))}
                                    </div>
                                )}

                                <div style={softPanelStyle}>
                                    <div style={panelTitleStyle}>🤖 حكم المحلل على هذه الشريحة</div>
                                    <ul style={{ margin: 0, paddingInlineStart: 18, fontSize: '.78rem', lineHeight: 1.9, color: 'var(--adm-fg-2)' }}>
                                        {b === 0 && <li>لا حجوزات هنا — إن كانت فيها مشاهدات أو بحث فهي طلبٌ كامن بلا معروضٍ مناسب، وإلا فشريحةٌ خاملة لا تستحق ميزانية الآن.</li>}
                                        {b > 0 && <li>الاكتمال {Math.round((ok / b) * 100)}٪ {ok / b >= 0.7 ? '— صحي ✅' : ok / b >= 0.5 ? '— مقبول، راقبه 👀' : '— ضعيف: راجع مدد التحضير والتذكيرات ⚠️'}.</li>}
                                        {bad > 0 && <li>الإلغاء {Math.round((bad / b) * 100)}٪{domCancel ? ` — الأكثر إلغاءً هنا: ${domCancel}` : ' — كلها قبل بدء تتبّع «من ألغى»'}.</li>}
                                        {trend && <li>الاتجاه خلال الفترة: {trend}.</li>}
                                        {bestH && <li>أفضل ساعة في الشريحة: {fmtHour(bestH.h)} ({admNum(bestH.n)} حجزاً) — اجدول حملاتك قبلها بساعة.</li>}
                                        {topStore && <li>الأقوى هنا: «{topStore.name}» بـ{admNum(Number(topStore.n))} حجزاً{topCat0 ? ` — وأنشط قسم: ${catLabel(topCat0.name)}` : ''}.</li>}
                                        {b > 0 && Number(tt.sellers) === 1 && <li>⚠️ كل حجوزات الشريحة من تاجرٍ واحد — الشريحة هشّة، استقطب منافساً له.</li>}
                                    </ul>
                                </div>
                            </>
                        );
                    })() : <AdmEmpty icon="🎛" title="لا نتيجة لهذه الشريحة" hint="عدّل التواريخ أو الساعات أو المدينة والقسم ثم انتظر لحظة." />}
                </div>
            </AdmSection>

            {/* ── ٩) المستكشف: مدينة × قسم ─────────────────────────────────── */}
            <AdmSection title="المستكشف: مدينة × قسم" icon="🔭" collapsible defaultOpen={false}
                desc="حجم شريحةٍ بعينها خلال ٩٠ يوماً وأفضل عروضها — لمعرفة أين الطلب الحقيقي قبل استقطاب تاجر.">
                <AdmToolbar>
                    <AdmSelect label="المدينة" value={mxCity} onChange={setMxCity} options={geoCityOptions} />
                    <AdmSelect label="القسم" value={mxCat} onChange={setMxCat} options={geoCatOptions} />
                </AdmToolbar>
                {matrixLoading ? <AdmSkeleton rows={2} height={70} /> : matrix ? (
                    <div style={{ display: 'grid', gap: 12 }}>
                        <AdmStatGrid cols={3}>
                            <AdmStat icon="📦" label="حجوزات" value={admNum(Number(matrix.totals?.bookings_30) || 0)} scope="آخر ٣٠ يوماً — في هذه الشريحة" />
                            <AdmStat icon="👁" label="مشاهدات" value={admNum(Number(matrix.totals?.views_30) || 0)} scope="آخر ٣٠ يوماً — في هذه الشريحة" />
                            <AdmStat icon="👆" label="نقرات" value={admNum(Number(matrix.totals?.clicks_30) || 0)} scope="آخر ٣٠ يوماً — في هذه الشريحة" />
                            <AdmStat icon="🏷" label="عروض نشطة" value={admNum(Number(matrix.totals?.active_deals) || 0)} scope="في هذه الشريحة الآن" />
                            <AdmStat icon="🏪" label="متاجر" value={admNum(Number(matrix.totals?.stores) || 0)} scope="في هذه الشريحة الآن" />
                        </AdmStatGrid>
                        <AdmTable
                            caption="أفضل عروض الشريحة خلال ٩٠ يوماً"
                            rows={(matrix.top_deals || []) as any[]}
                            keyOf={(_r, i) => String(i)}
                            empty={{ icon: '🔭', title: 'لا عروض في هذه الشريحة', hint: 'وهذه بذاتها إشارة: طلبٌ محتمل بلا معروض — جرّب مدينةً أو قسماً آخر للمقارنة.' }}
                            columns={[
                                { header: 'العرض', cell: (t: any) => `«${t.item_name}»` },
                                { header: 'المتجر', secondary: true, cell: (t: any) => t.shop_name },
                                { header: 'حجوزات', numeric: true, cell: (t: any) => admNum(t.bookings) },
                                { header: 'مشاهدات', numeric: true, cell: (t: any) => admNum(t.views) },
                            ]}
                        />
                        <p style={noteStyle}>ساعات هذه الشريحة تُقرأ من خريطة «ساعات الذروة» أعلاه — لا يُرسم لها رسمٌ ثالث.</p>
                    </div>
                ) : <AdmError message="تعذّر تحميل شريحة المستكشف." onRetry={() => setMatrixNonce((n) => n + 1)} />}
            </AdmSection>

            {/* ── ١٠) جودة محتوى العروض ─────────────────────────────────────── */}
            <AdmSection title="جودة محتوى العروض النشطة" icon="🖼"
                desc="الصور والوصف أول ما يقنع المشتري — وضعفهما يظهر في توصية كل تاجر تلقائياً.">
                <AdmStatGrid cols={4}>
                    <AdmStat icon="🏷" label="عروض نشطة" value={admNum(Number((data.content || {}).active_deals) || 0)} scope="كل المنصّة" />
                    <AdmStat icon="🚫" label="بلا صور إطلاقاً" value={admNum(Number((data.content || {}).no_image) || 0)} tone={Number((data.content || {}).no_image) > 0 ? 'bad' : 'neutral'} scope="كل المنصّة" />
                    <AdmStat icon="🖼" label="بصورة واحدة" value={admNum(Number((data.content || {}).one_image) || 0)} tone={Number((data.content || {}).one_image) > 0 ? 'warn' : 'neutral'} scope="كل المنصّة" />
                    <AdmStat icon="📝" label="بلا وصف كافٍ" value={admNum(Number((data.content || {}).no_desc) || 0)} tone={Number((data.content || {}).no_desc) > 0 ? 'warn' : 'neutral'} scope="كل المنصّة" />
                </AdmStatGrid>
                <p style={noteStyle}>
                    المتاجر ضعيفة المحتوى تظهر أسبابها داخل بطاقتها في «صحة التجار»، وتوصيتها الجاهزة تتضمّن علاجها.
                    (وفلتر المحتوى يرفض الصور غير اللائقة تلقائياً.)
                </p>
            </AdmSection>

            {/* ── ١١) ماذا يبحث الزوار؟ ─────────────────────────────────────── */}
            <AdmSection title="ماذا يبحث الزوار؟" icon="🔎" collapsible defaultOpen={false}
                badge={{ text: `${admNum(Number(pulse2?.search_total_30) || 0)} عملية بحث / ٣٠ يوماً`, tone: 'neutral' }}
                desc="كل كلمةٍ تتكرّر بلا عروضٍ تلبّيها = طلبٌ جاهز تستقطب له تاجراً أو تطلبه من تجارك.">
                {((pulse2?.searches || []) as any[]).length > 0 ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {(pulse2.searches as any[]).map((s) => (
                            <AdmPill key={s.q}>{s.q} ×{admNum(Number(s.n) || 0)}</AdmPill>
                        ))}
                    </div>
                ) : (
                    <AdmEmpty icon="🔎" title="لا كلمات بحث بعد" hint="تُسجَّل كل كلمة بحثٍ في الرئيسية وقائمة العروض — تظهر هنا فور تراكمها." />
                )}
            </AdmSection>

            {/* ── ١٢) موسمية الحجوزات ───────────────────────────────────────── */}
            <AdmSection title="موسمية حجوزاتك" icon="📆"
                desc="اثنا عشر شهراً من حجوزاتك الفعلية — ذروتك الحقيقية تُقرأ من هنا لا من تقويمٍ عام.">
                <Bars height={90} color="var(--adm-info-fg)" data={(data.seasonal || []).map((m: { mon: string; bookings: number }) => ({ label: m.mon.slice(5), n: m.bookings }))} />
                <div style={{ marginTop: 12 }}>
                    <AdmStatGrid cols={3}>
                        {((data.monthly || []) as MonthRow[]).slice(-3).map((m) => (
                            <AdmStat
                                key={m.mon}
                                label={`${m.mon.slice(5)}/${m.mon.slice(2, 4)}`}
                                value={`${admNum(m.new_sellers)} 🏪 · ${admNum(m.new_buyers)} 🛒`}
                                scope="تسجيلات جديدة في الشهر"
                            />
                        ))}
                    </AdmStatGrid>
                </div>
                <p style={noteStyle}>
                    مواعيد المواسم والفعاليات يكتبها تقويم <b>«البانرات والحملات»</b> — ولا تُكتب في هذه الشاشة حتى لا يوجد تقويمان متناقضان.
                </p>
            </AdmSection>

            {/* ── ١٣) خطة النمو والتسويق ────────────────────────────────────── */}
            <AdmSection title="خطة النمو والتسويق" icon="🌱" collapsible defaultOpen={false}
                desc="ما تفعله أنت هذا الأسبوع — توصياتٌ من بياناتك الفعلية، ونصوصٌ جاهزة للنسخ.">
                <div style={{ display: 'grid', gap: 14 }}>
                    <div>
                        <div style={subTitleStyle}>🧭 توصيات جذرية</div>
                        <ul style={{ margin: 0, paddingInlineStart: 18, fontSize: '.8rem', lineHeight: 1.95, color: 'var(--adm-fg-2)' }}>
                            {Number(buyers.dormant_30) > 0 && (
                                <li><b style={{ color: 'var(--adm-fg)' }}>{admNum(Number(buyers.dormant_30))} مشترٍ خامل +٣٠ يوماً</b> — أعدهم بحملةٍ من «الإشعارات والبريد» أو بمسابقةٍ بجائزة.</li>
                            )}
                            <li><b style={{ color: 'var(--adm-fg)' }}>استقطاب التجار الأثمن نمواً:</b> ابدأ بما وُسم «⚡ فرصة» في لوحة «أين الفرصة؟» — أرسل باركود دعوة التاجر لهم عبر واتساب المحلات مباشرة.</li>
                            <li><b style={{ color: 'var(--adm-fg)' }}>حافظ على المجدّدين:</b> راقب «تجديد الشهر الحالي» في الخلاصة — أي هبوطٍ تحت ٧٠٪ عالجه بخصم تجديد مؤقت من شاشة التجّار.</li>
                            <li><b style={{ color: 'var(--adm-fg)' }}>المواسم تصنع القفزات:</b> جهّز حملةً ومسابقة قبل كل فعاليةٍ في تقويم «البانرات والحملات» بأسبوعين.</li>
                            {Number((data.content || {}).no_image) + Number((data.content || {}).one_image) > 0 && (
                                <li><b style={{ color: 'var(--adm-fg)' }}>جودة المحتوى تسويقٌ مجاني:</b> استخدم قالب «جودة الصور» في الإرسال المستهدف.</li>
                            )}
                        </ul>
                    </div>

                    <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(270px, 1fr))' }}>
                        <div style={softPanelStyle}>
                            <div style={{ fontWeight: 800, fontSize: '.8rem', color: 'var(--adm-fg)', marginBottom: 5 }}>🏪 جذب التجار — بأولوية العائد</div>
                            <ol style={{ margin: 0, paddingInlineStart: 18, fontSize: '.78rem', lineHeight: 1.9, color: 'var(--adm-fg-2)' }}>
                                <li>ابدأ بما وُسم «⚡ فرصة» — الطلب موجود والمنافسة صفر.</li>
                                <li>زر السوق أو المول وقت الذروة (خريطة الساعات) وكلّم المحلات مباشرة.</li>
                                <li>أرسل لهم النص الجاهز أدناه + باركود دعوة تاجر من لوحتك.</li>
                                <li>قدّم «أول ١٤ يوماً مجاناً» — يزيل التردد.</li>
                                <li>بعد انضمامه أرسل له قالب «تنشيط متجر خامل» ليبدأ صح.</li>
                            </ol>
                            <div style={copyBoxStyle}>
                                «أهلاً 👋 منصة تاكي توصل عروض محلك لمشترين يبحثون فعلاً في مدينتك — تحليلنا يُظهر طلباً على قسمك الآن. التسجيل دقائق وأول ١٤ يوماً مجاناً: www.takisa.net»
                            </div>
                        </div>
                        <div style={softPanelStyle}>
                            <div style={{ fontWeight: 800, fontSize: '.8rem', color: 'var(--adm-fg)', marginBottom: 5 }}>🛒 جذب المشترين — بتوقيت الذروة</div>
                            <ol style={{ margin: 0, paddingInlineStart: 18, fontSize: '.78rem', lineHeight: 1.9, color: 'var(--adm-fg-2)' }}>
                                <li>إعلانات مستهدفة جغرافياً قبل ساعة الذروة بساعتين.</li>
                                <li>مجموعات واتساب/تيليجرام لكل مدينة — أقوى ٣ عروض بصورها + رابط مباشر.</li>
                                <li>مسابقة بجائزة + إشعار تلقائي — أفضل أداة إرجاع للخاملين ({admNum(Number(buyers.dormant_30) || 0)} خاملاً حالياً).</li>
                                <li>باركود المتجر عند الكاشير — كل زبونٍ يمسحه يصبح مستخدماً.</li>
                                <li>قبل كل فعاليةٍ في تقويم «البانرات والحملات»: بانر + حملة مجدولة.</li>
                            </ol>
                            <div style={copyBoxStyle}>
                                «خصومات حقيقية في {(((data.cities || [])[0] as GeoRow | undefined)?.city) || 'مدينتك'} تصل ٥٠٪ 🔥 احجز قبل نفاد الكمية — بدون تحميل تطبيق: www.takisa.net»
                            </div>
                        </div>
                    </div>
                    <p style={noteStyle}>النصّان قابلان للنسخ (اضغط عليهما مطولاً) ويتحدّثان تلقائياً بأقوى مدنك الحالية.</p>
                </div>
            </AdmSection>

            <AdmCard>
                <p style={{ margin: 0, fontSize: '.78rem', lineHeight: 1.9, color: 'var(--adm-fg-2)' }}>
                    🤖 يعمل المحلل آلياً بالكامل: يفحص المنصّة كل أحدٍ صباحاً ويرسل لك إشعاراً إن بدأ عزوفُ تجارٍ أو حدثت قفزة انضمام — بلا أي تدخّل.
                    والذي يبقى بيدك وحدك هو إرسال التوصيات للتجار.
                </p>
            </AdmCard>
        </div>
    );
};

export default AdminAnalyst;
