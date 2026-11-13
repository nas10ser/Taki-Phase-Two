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
import { useEffect, useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { primeAsyncMemo } from '../utils/memoAsync';
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

export const useStorePage = (storeId?: string | null): StorePageData => {
    const [data, setData] = useState<StorePageData>(EMPTY);

    useEffect(() => {
        if (!storeId) { setData({ ...EMPTY, ready: true }); return; }
        let alive = true;
        setData(EMPTY);
        (async () => {
            const { data: p, error } = await supabase.rpc('taki_store_page', { p_store_id: storeId });
            if (!alive) return;
            if (error || !p) { setData({ ...EMPTY, ready: true }); return; }
            const row: any = p;
            // تُزرع قبل التصيير، فلا يسبق مكوّنٌ الزرعَ بنداءٍ من عنده.
            primeAsyncMemo(`store_policies:${storeId}`, { data: row.policies ?? null, error: null });
            primeAsyncMemo(`store_is_verified:${storeId}`, { data: row.verified === true, error: null });
            primeAsyncMemo(`store_follower_count:${storeId}`, { data: Number(row.followers) || 0, error: null });
            setData({
                isOwner: row.is_owner === true,
                store: row.store ?? null,
                owner: row.owner ?? null,
                branches: (Array.isArray(row.branches) ? row.branches : []).map(branchFromRow),
                maxBranches: Number.isFinite(Number(row.max_branches)) ? Number(row.max_branches) : null,
                ready: true,
            });
        })().catch(() => { if (alive) setData({ ...EMPTY, ready: true }); });
        return () => { alive = false; };
    }, [storeId]);

    return data;
};

export default useStorePage;
