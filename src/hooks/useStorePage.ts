/**
 * useStorePage — صفحةُ المتجر في نداءٍ واحد (v16.20)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 **ما قِيس قبل هذا** (فتحٌ **مباشر** لـ`/store/<id>` على الإنتاج،
 *    ١٣ نوفمبر ٢٠٢٦): **١٩ نداءً**، سبعةٌ منها عن نفس المتجر:
 *      `users?select=*` · `sellers_public` (ثانيةً) · `store_is_verified`
 *      `store_policies` · `store_follower_count` · `store_branches`
 *      `store_profiles?select=max_branches`
 *
 * 🔴 وأغربُها: **`users?select=*` تعود `[]` لكلّ زائر** — RLS تحصر `users`
 *    في صفّك أو الأدمن. أي جولةُ شبكةٍ كاملةٌ تُهدر في كلّ فتحةٍ من كلّ
 *    زائرٍ ولا تُرجع بايتاً مفيداً. (وللمالك تُرجع صفَّه، فالحاجةُ له وحده.)
 *
 * ⇒ `taki_store_page` تجمعها كلَّها. والمقيسُ من الإنتاج كزائرٍ مجهول:
 *   **٢٨٢٦ بايتاً في ١٢٥ م.ث · نداءٌ واحد**.
 *
 * 🔴 ولا منطقَ جديد ولا امتيازَ جديد: الدالّةُ `SECURITY INVOKER` فكلُّ
 *    قراءةٍ تمرّ بـRLS **وبمنحِ الأعمدة** على المنادي — فما يصل هنا مجموعةٌ
 *    جزئيّةٌ ممّا كان المتصفّحُ يجلبه بسبعة نداءات، لا أكثر.
 *
 * 🪤 و`StorePolicies` و`VerifiedBadge` وعدّادُ المتابعين **لم تُمسّ**: تُزرع
 *    أجوبتُها في `memoAsync` بنفس مفاتيحها، فيصير سؤالُها إصابةً بلا شبكة.
 *    وهذا أقلُّ خطراً من إعادة توصيل ثلاثة مكوّناتٍ تعمل.
 */
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { reserveAsyncMemo } from '../utils/memoAsync';
import { branchFromRow } from '../repositories/branchRepository';
import type { StoreBranch } from '../repositories/branchRepository';

export interface StorePageData {
    isOwner: boolean;
    store: any | null;
    owner: { id: string; name?: string; shop?: string; lat?: number; lng?: number;
             google_maps_link?: string; address?: string } | null;
    branches: StoreBranch[];
    maxBranches: number | null;
    /** `true` بعد أوّل جوابٍ — تفرّق بين «لم يصل» و«لا متجر». */
    ready: boolean;
}

const EMPTY: StorePageData = {
    isOwner: false, store: null, owner: null, branches: [], maxBranches: null, ready: false,
};

/**
 * يُطلق الحمولةَ **مرّةً واحدةً لكلّ متجر** ويحجز مفاتيحَ الثلاثة فوراً.
 * 🪤 خريطةُ الطائر تُنظَّف عند الحسم: بقاؤها يجعل كلَّ فتحةٍ لاحقةٍ تُقدَّم
 *    من جوابٍ قديمٍ أبداً — وهو عيبٌ أهدأ من النداء المكرَّر وأسوأ منه.
 * 🪤 وكلُّ مفتاحٍ محجوزٍ له **ارتدادٌ إلى ندائه المستقلّ** عند فشل الحمولة،
 *    وإلّا سقطت السياسةُ والتوثيقُ والمتابعون معاً بسقوط نداءٍ واحد.
 */
const inflight = new Map<string, Promise<any>>();

const startStorePage = (storeId: string): Promise<any> => {
    const hit = inflight.get(storeId);
    if (hit) return hit;
    // 🪤 ومُنشئُ سوبابيس «شبيهُ وعد» (`PromiseLike`) لا وعدٌ كامل: بلا
    //    `Promise.resolve` لا `catch` ولا `finally` عليه.
    const p: Promise<any> = Promise.resolve(
        supabase.rpc('taki_store_page', { p_store_id: storeId }) as any,
    ).then(({ data, error }: any) => { if (error) throw error; return data || {}; });
    inflight.set(storeId, p);
    void p.catch(() => undefined).finally(() => { inflight.delete(storeId); });

    const fall = async (fn: string): Promise<any> => await supabase.rpc(fn, { p_store_id: storeId });
    reserveAsyncMemo(`store_policies:${storeId}`,
        p.then((r: any) => ({ data: r.policies ?? null, error: null }))
         .catch(() => fall('store_policies')));
    reserveAsyncMemo(`store_is_verified:${storeId}`,
        p.then((r: any) => ({ data: r.verified === true, error: null }))
         .catch(() => fall('store_is_verified')));
    reserveAsyncMemo(`store_follower_count:${storeId}`,
        p.then((r: any) => ({ data: Number(r.followers) || 0, error: null }))
         .catch(() => fall('store_follower_count')));
    return p;
};

export const useStorePage = (storeId?: string | null): StorePageData => {
    const [data, setData] = useState<StorePageData>(EMPTY);

    // 🔴 أثناء **التصيير** لا في الأثر: آثارُ الأبناء تسبق أثرَ الأب، فلو
    //    انتظرنا الأثرَ لخرجت نداءاتُهم الثلاثةُ قبل أن نحجز شيئاً.
    const promise = useMemo(
        () => (storeId ? startStorePage(storeId) : null), [storeId]);

    useEffect(() => {
        if (!promise) { setData({ ...EMPTY, ready: true }); return; }
        let alive = true;
        setData(EMPTY);
        promise.then((row: any) => {
            if (!alive) return;
            setData({
                isOwner: row.is_owner === true,
                store: row.store ?? null,
                owner: row.owner ?? null,
                branches: (Array.isArray(row.branches) ? row.branches : []).map(branchFromRow),
                maxBranches: Number.isFinite(Number(row.max_branches)) ? Number(row.max_branches) : null,
                ready: true,
            });
        }).catch(() => { if (alive) setData({ ...EMPTY, ready: true }); });
        return () => { alive = false; };
    }, [promise]);

    return data;
};

export default useStorePage;
