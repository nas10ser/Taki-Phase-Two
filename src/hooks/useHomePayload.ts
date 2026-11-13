/**
 * useHomePayload — حمولةُ الصفحة الرئيسية في نداءٍ واحد (v16.16)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 **ما قِيس قبل هذا** (بلاغُ ناصر «الموقع ثقيل والتنقّل ثقيل»، ١٢ نوفمبر):
 *    فتحةُ الرئيسية تُطلق **١٩ نداءً**، ستّةٌ منها لبناء ما فوق الشبكة وحده:
 *    أربعةُ أشرطةٍ (`browse_deals`) والبنراتُ والمسابقات. وكلُّ شريطٍ كان
 *    يوسّع نطاقَه **متتابعاً** (مدينتُك ← منطقتُك ← المملكة)، أي حتّى
 *    **اثنتي عشرة جولةَ شبكةٍ متتابعة** قبل أن تكتمل الصفحة لمن له مدينة.
 *    وعلى شبكة جوّالٍ (٣٠٠ م.ث للجولة) = ثلاثُ ثوانٍ انتظارٍ صافية.
 *
 * ⇒ `taki_home_payload` على القاعدة تُجري **نفسَ الحلقة** بلا جولةِ شبكةٍ
 *   بينها، وتُعيد الأشرطةَ والبنراتِ والمسابقاتِ معاً. والمقيسُ من الإنتاج
 *   كزائرٍ مجهول: **٢٢٬٦٧٢ بايتاً في ١٢٥–٢٦٠ م.ث · نداءٌ واحد**.
 *
 * 🔴 ولا منطقَ جديد: الدالّةُ تنادي `browse_deals` **نفسَها** و`SECURITY
 *    INVOKER` فتُطبَّق RLS على الزائر حرفياً كما قبلها. فما يصل هنا لا يزيد
 *    بايتاً عمّا كانت الستّةُ تجلبه.
 *
 * 🪤 والبذرةُ المحلّية باقيةٌ لنفس سبب v13.04: العودةُ إلى الرئيسية ترسم
 *    البنرَ فوراً بلا وميضٍ، ثمّ يصل الجديدُ فيُبدّلها.
 * 🪤 و**الفرزُ والسقوفُ مثبَّتةٌ في الدالّة** (reliability/discount/soon ·
 *    ٨ و١٢). فتغييرُ أيٍّ منها يكون هناك لا هنا، وإلّا اختلف ما يُطلب عمّا
 *    يُعاد. و`scripts/check-home-payload.js` يقارن الاثنين.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { Deal } from '../data/mock';
import { dealRepository } from '../repositories/dealRepository';
import { Banner } from '../repositories/bannerRepository';
import { Contest, sanitizeContestRow } from '../repositories/contestRepository';

export interface HomePayload {
    trending: Deal[];
    discount: Deal[];
    season: Deal[];
    coming: Deal[];
    banners: Banner[];
    contests: Contest[];
}

const EMPTY: HomePayload = { trending: [], discount: [], season: [], coming: [], banners: [], contests: [] };

/** كاشُ الوحدة — يُبقي الرئيسيةَ مرسومةً عند العودة إليها (v13.04). */
let _cache: HomePayload = EMPTY;

export interface HomePayloadParams {
    city?: string | null;
    region?: string | null;
    expand?: boolean;
    mall?: string | null;
    /** مُمرَّرٌ فقط حين يكون الموسمُ حيّاً — وإلّا لا يُستعلَم عنه أصلاً. */
    seasonId?: string | null;
    blocked?: string[] | null;
}

const toDeals = (rows: any): Deal[] =>
    (Array.isArray(rows) ? rows : []).map(dealRepository.mapRowToDeal);

export const useHomePayload = (p: HomePayloadParams): {
    payload: HomePayload; loading: boolean; reload: () => void;
} => {
    const [payload, setPayload] = useState<HomePayload>(_cache);
    const [loading, setLoading] = useState(true);

    // توقيعُ المعاملات: تغيّرُه وحده يُعيد الجلب (لا هويّةُ الكائن).
    const sig = [p.city, p.region, p.expand, p.mall, p.seasonId,
                 (p.blocked || []).join(',')].map(v => String(v ?? '')).join('|');
    const sigRef = useRef(sig);
    sigRef.current = sig;
    const paramsRef = useRef(p);
    paramsRef.current = p;

    const fetchNow = useCallback(async () => {
        const mine = sigRef.current;
        const q = paramsRef.current;
        const { data, error } = await supabase.rpc('taki_home_payload', {
            p_city:      q.city || null,
            p_region:    q.region || null,
            p_expand:    q.expand !== false,
            p_mall:      q.mall || null,
            p_season_id: q.seasonId || null,
            p_blocked:   (q.blocked && q.blocked.length) ? q.blocked : null,
        });
        // وصل جوابُ طلبٍ قديمٍ بعد تغيّر النطاق ⇒ يُهمَل.
        if (sigRef.current !== mine) return;
        if (error || !data) { setLoading(false); return; }
        const next: HomePayload = {
            trending: toDeals((data as any).trending),
            discount: toDeals((data as any).discount),
            season:   toDeals((data as any).season),
            coming:   toDeals((data as any).coming),
            banners:  Array.isArray((data as any).banners) ? (data as any).banners : [],
            contests: (Array.isArray((data as any).contests) ? (data as any).contests : [])
                        .map(sanitizeContestRow),
        };
        _cache = next;
        setPayload(next);
        setLoading(false);
    }, []);

    useEffect(() => {
        setLoading(true);
        void fetchNow();
        // العودةُ إلى التطبيق تُجدّد المسابقةَ المنتهيةَ والبنرَ الجديد —
        // وهو سببُ وجود هذه المستمعات منذ v11.49، وقد صارت نداءً واحداً.
        const onVisible = () => { if (document.visibilityState === 'visible') void fetchNow(); };
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('focus', onVisible);
        window.addEventListener('pageshow', onVisible);
        return () => {
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener('focus', onVisible);
            window.removeEventListener('pageshow', onVisible);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sig]);

    return { payload, loading, reload: fetchNow };
};

export default useHomePayload;
