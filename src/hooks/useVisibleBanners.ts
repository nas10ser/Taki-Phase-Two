import { useEffect, useMemo, useState } from 'react';
import { bannerVisibleAt, nextBannerChangeAt } from '../utils/bannerSchedule';
import type { BannerWindow } from '../utils/bannerSchedule';

/**
 * يُرشِّح البانراتِ بمدّتها، **ويُجدِّد نفسَه في ثانية التغيّر بالضبط** (v16.49)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 بلاغُ ناصر: «المفروض يتوقّف بالوقت بالضبط» — وكان يتأخّر لأن حمولةَ
 *    الرئيسية لا تُعاد إلّا عند العودة من الخفاء (وبكابحِ ثلاثين ثانية)،
 *    فبانرٌ انتهى والصفحةُ مفتوحةٌ أمامه يبقى حتّى يُصغَّر التطبيقُ ويعود.
 *
 * 🪤 ولا استطلاعَ دوريّ: تُحسب **لحظةُ أوّل تغيّرٍ قادم** ويُضبط مؤقّتٌ واحدٌ
 *    عليها. فصفرُ عملٍ بين اللحظتين، والدقّةُ بالثانية لا بدورةِ تنبّه.
 * 🪤 و`setTimeout` يُقصّ عند ٢١٤٧٤٨٣٦٤٧ م.ث (نحو ٢٤ يوماً) فيقع **فوراً**
 *    لأيّ مدّةٍ أطول — وبانرٌ «يبدأ بعد شهرين» مدّتُه أطول. فيُسقَّف الانتظارُ
 *    بيومٍ واحد ثمّ يُعاد الحساب.
 */
const MAX_WAIT_MS = 86_400_000;   // يوم — سقفُ انتظارٍ آمنٌ دون قصّ المؤقّت

export const useVisibleBanners = <T extends BannerWindow>(list: T[]): T[] => {
    const [now, setNow] = useState(() => Date.now());

    // يُعاد الضبطُ كلّما تغيّرت القائمةُ أو مرّت لحظةُ تغيّر.
    const nextAt = useMemo(() => nextBannerChangeAt(list, now), [list, now]);

    useEffect(() => {
        if (nextAt === null) return;
        const wait = Math.min(Math.max(nextAt - Date.now(), 0) + 250, MAX_WAIT_MS);
        const id = setTimeout(() => setNow(Date.now()), wait);
        return () => clearTimeout(id);
    }, [nextAt]);

    return useMemo(() => (list || []).filter(b => bannerVisibleAt(b, now)), [list, now]);
};

export default useVisibleBanners;
