/**
 * operatorIdentity.ts — قارئُ هويّةِ المُشغِّل للواجهة (v15.81)
 * ═══════════════════════════════════════════════════════════════════════════
 * القواعدُ كلُّها في `shared/operatorIdentity.js` (يقرؤها المتصفّحُ والخادمُ
 * والسكربتاتُ معاً)، وهذا الملفُّ **القارئُ وحده**: نوعٌ مُعلَن، وجلبٌ
 * بذاكرةٍ مشتركة، وحقنُ البياناتِ المنظّمة في `index.html`.
 *
 * 🪤 ولماذا قراءةٌ لحظيّةٌ لا قيمةٌ في الحزمة: المصدرُ
 *    `platform_settings.tax_settings` وناصرٌ يحرّره من لوحة المدير. فأيُّ
 *    حقنٍ وقتَ البناء يتجمّد عند لحظةِ النشر ويكذب بعد أوّل تعديلٍ منه —
 *    وهو نفسُ فخّ «رقمٌ في نصّ» الذي تمنعه القاعدةُ الثابتة في CLAUDE.md.
 *
 * ℹ️ والنمطُ منسوخٌ حرفياً من `src/hooks/useVatMode.ts` (v13.38) الذي يقرأ
 *    **المفتاحَ نفسَه** بنفسِ الطريقة ويعمل في الإنتاج منذ ذلك الحين:
 *    ذاكرةٌ على مستوى الوحدة + طلبٌ واحدٌ قائم + مُبطِلٌ صريح. فلا طلبَ
 *    شبكةٍ لكلّ صفحةٍ تعرض التذييل.
 *
 * 🔴 وقائمةُ السماح في RLS **تحمل `tax_settings` أصلاً** (قِيس بتنفيذٍ بدور
 *    `anon` على جدّة: الصفُّ يُقرأ) — فالزائرُ المجهول يرى البيانَ بلا دخول،
 *    وهو الغرضُ كلُّه. ولا مفتاحَ جديد ⇒ لا هجرة ⇒ لا قاعدةَ «ثلاثةِ مواضع».
 */
import { useEffect, useState } from 'react';
import { fetchPlatformSetting } from '../context/platformSettings';
import {
    normalizeOperatorIdentity,
    emptyOperatorIdentity,
    operatorIdentityIsComplete,
    operatorVatIsRegistered,
    operatorIdentityLd,
    operatorIdentityLabels,
} from '../../shared/operatorIdentity';

export interface OperatorIdentity {
    /** الاسمُ النظاميّ كما في الشهادة — `''` إن لم يُدخل أو كان علامةً تجاريّة. */
    legalName: string;
    /** رقمُ السجلّ التجاريّ أو وثيقةِ العمل الحرّ. */
    registryNumber: string;
    /** الرقمُ الضريبيّ — `''` ما لم تُسجَّل المنصّة. */
    vatNumber: string;
    /** العنوانُ الوطنيّ سطراً واحداً. */
    nationalAddress: string;
}

export interface OperatorIdentityState extends OperatorIdentity {
    /** مكتملةٌ ⇒ يُعرض البيان. ناقصةٌ ⇒ **لا يُعرض شيء**. */
    complete: boolean;
    /** الرقمُ الضريبيُّ موجودٌ فعلاً (لا يُعرض سطرُه بلا قيمة). */
    vatRegistered: boolean;
    loading: boolean;
}

const EMPTY: OperatorIdentityState = {
    ...(emptyOperatorIdentity() as OperatorIdentity),
    complete: false,
    vatRegistered: false,
    loading: true,
};

let cached: OperatorIdentityState | null = null;
let inflight: Promise<OperatorIdentityState> | null = null;

/** تسمياتُ البيان — تمريرٌ مباشرٌ لمصدرها الوحيد. */
export const identityLabels = (lang: string) => operatorIdentityLabels(lang);

/**
 * 🪤 يُحقن البيانُ في عقدةِ `Organization` **لحظياً** لا وقتَ البناء.
 *    والسببُ أعلاه: المصدرُ إعدادٌ حيٌّ يملكه ناصر.
 *
 * 🪤 ويُعثَر على الوسم بـ`id` أوّلاً ثمّ **بمحتواه** إن غاب: مُصغِّرُ Parcel
 *    يتصرّف في الوسوم، فحارسٌ يتعلّق بخاصّيةٍ واحدة قد يُحقن في لا شيء
 *    صامتاً — وهو فخُّ «الاستبدالُ على نصٍّ غائبٍ لا يُخطئ» (v14.86).
 *    ولذلك تُقرأ النتيجةُ بعد الكتابة ويُرجَع صوابُها.
 *
 * 🪤 وخاملةُ التكرار بالبناء: تُفكّ البطاقةُ وتُكتب المفاتيحُ فوق نفسها،
 *    فنداءان لا يُنتجان نسختين (درس `inject-csp.js` في v14.86).
 */
export const applyOperatorIdentityToJsonLd = (id: OperatorIdentity): boolean => {
    const extra = operatorIdentityLd(id);
    if (!extra) return false;                       // ناقصةٌ ⇒ لا يُكتب شيء
    try {
        const tags = Array.from(
            document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]'),
        );
        const tag = document.getElementById('taki-org-ld') as HTMLScriptElement | null
            || tags.find((s) => s.textContent && s.textContent.includes('#organization'))
            || null;
        if (!tag || !tag.textContent) return false;
        const doc = JSON.parse(tag.textContent);
        const graph: any[] = Array.isArray(doc && doc['@graph']) ? doc['@graph'] : [];
        const org = graph.find((n) => n && n['@type'] === 'Organization');
        if (!org) return false;
        Object.assign(org, extra);
        tag.textContent = JSON.stringify(doc);
        // 🪤 تُقرأ النتيجةُ بعد الكتابة: `replace` على غائبٍ لا يُخطئ.
        return (tag.textContent || '').includes('"legalName"');
    } catch {
        return false;                               // بياناتٌ منظّمةٌ ليست وظيفة
    }
};

const fetchIdentity = async (): Promise<OperatorIdentityState> => {
    try {
        // v16.25 — من دفعة الإعدادات الواحدة لا بنداءٍ خاصّ (انظر
        // `fetchPlatformSettingRows`): كلُّ صفحةٍ فيها تذييلٌ كانت تُطلقه.
        const value = await fetchPlatformSetting('tax_settings');
        const id = normalizeOperatorIdentity(value) as OperatorIdentity;
        const st: OperatorIdentityState = {
            ...id,
            complete: operatorIdentityIsComplete(id),
            vatRegistered: operatorVatIsRegistered(id),
            loading: false,
        };
        if (st.complete) applyOperatorIdentityToJsonLd(id);
        return st;
    } catch {
        return { ...EMPTY, loading: false };
    }
};

/**
 * هويّةُ المُشغِّل للواجهة. تُرجع `complete:false` حتى تصل القيم — فأيُّ سطحٍ
 * يعرضها **يُخفي نفسَه** في تلك اللحظة بدل أن يُظهر لافتاتٍ فارغة.
 */
export const useOperatorIdentity = (): OperatorIdentityState => {
    const [st, setSt] = useState<OperatorIdentityState>(cached || EMPTY);

    useEffect(() => {
        if (cached) { setSt(cached); return; }
        let alive = true;
        inflight = inflight || fetchIdentity();
        inflight.then((m) => { cached = m; inflight = null; if (alive) setSt(m); });
        return () => { alive = false; };
    }, []);

    return st;
};

/** يُنادى بعد حفظِ إعدادات الضريبة في لوحة المدير ليسري الأثرُ فوراً. */
export const invalidateOperatorIdentity = (): void => { cached = null; inflight = null; };

export default useOperatorIdentity;
