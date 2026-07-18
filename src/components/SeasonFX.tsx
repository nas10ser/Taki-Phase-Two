import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { getSeasonById } from '../data/seasons';

/**
 * v12.45 — «عمق الموسم»: طبقة ثابتة فوق الصفحة كلها تُمطر عناصر الموسم
 * (فوانيس رمضان تهبط، شموس الصيف تنزل من فوق لتحت، بالونات العيد تصعد…)
 * بأنيميشن CSS خالص — transform فقط، بلا أي مؤقّتات JS، وبتأخيرات سالبة
 * فتكون «السماء» ممتلئة من أول لحظة. pointer-events:none فلا تعيق أي ضغطة.
 * مخفية داخل لوحة المدير (/admin) حتى تبقى بيئة العمل صافية، وتختفي
 * تلقائياً لمن فعّل «تقليل الحركة» في نظامه.
 * v12.46-47 (طلب ناصر): «فرحة دخول» فقط — ٥ ثوانٍ من دخول عناصر جديدة عند
 * فتح التطبيق، وبعدها لا ينزل شيء جديد من الأعلى بينما تُكمل العناصر
 * النازلة رحلتها كاملة حتى خارج الشاشة (لا اختفاء مفاجئ في منتصف الهواء).
 * تعود الفرحة من جديد لحظة تفعيل/تبديل موسم من لوحة المدير (realtime).
 */
const COUNT = 16;
const SHOW_MS = 5_000;    // نافذة دخول عناصر جديدة من الأعلى

// مولّد شبه عشوائي حتمي (mulberry32) — نفس الموسم يعطي نفس التوزيع دائماً،
// فلا «تقفز» العناصر لمواضع جديدة مع كل re-render أو تنقّل بين الصفحات.
const mulberry32 = (seed: number) => () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const SeasonFX: React.FC = () => {
    const { platformSettings } = useApp();
    const location = useLocation();
    const season = getSeasonById(platformSettings.seasonalTheme);

    // ⚠️ flakes يُعرَّف قبل الـeffect الذي يقرأه في deps — فخ TDZ المعروف (v10.61).
    const flakes = useMemo(() => {
        if (!season) return [];
        let seed = 0;
        for (let i = 0; i < season.id.length; i++) seed = seed * 31 + season.id.charCodeAt(i);
        const rnd = mulberry32(seed);
        return Array.from({ length: COUNT }, (_, i) => {
            const dur = 11 + rnd() * 11;                       // 11–22s سقوط بطيء مريح
            return {
                key: i,
                item: season.fx.items[i % season.fx.items.length],
                x: `${Math.round(rnd() * 96)}%`,
                size: `${Math.round(14 + rnd() * 18)}px`,      // 14–32px
                dur: `${dur.toFixed(1)}s`,
                delay: `-${(rnd() * dur).toFixed(1)}s`,        // سالب = يبدأ منتصف الرحلة
                drift: `${Math.round((rnd() - 0.5) * 120)}px`, // انجراف جانبي ±60px
                op: (0.3 + rnd() * 0.3).toFixed(2),            // 0.30–0.60
            };
        });
    }, [season?.id]);

    // «فرحة الدخول» (v12.47): on = عناصر جديدة تدخل من الأعلى (animation
    // infinite). بعد ٥ ثوانٍ نمنح كل عنصر عدد دوراته الجارية فقط
    // (iteration-count محدود) فيُكمل نزوله الحالي حتى خارج الشاشة ثم يقف —
    // بلا اختفاء مفاجئ في منتصف الهواء — وبعد وصول آخر عنصر تُزال الطبقة
    // كلها (off). تغيير iteration-count لا يُعيد تشغيل الأنيميشن (بعكس
    // animation-name). تبديل الموسم من لوحة المدير يعيد الدورة من جديد.
    const containerRef = useRef<HTMLDivElement>(null);
    const [phase, setPhase] = useState<'on' | 'off'>('on');
    useEffect(() => {
        if (!season) return;
        setPhase('on');
        let t2: ReturnType<typeof setTimeout> | undefined;
        const t1 = setTimeout(() => {
            let maxEndMs = 0;
            const root = containerRef.current;
            if (root) {
                Array.from(root.children).forEach((el, i) => {
                    const f = flakes[i];
                    if (!f) return;
                    const dur = parseFloat(f.dur);
                    const delayAbs = Math.abs(parseFloat(f.delay));
                    // الدورة الجارية الآن = floor((الزمن المنقضي + |التأخير|) / المدة)؛
                    // نسمح بإكمالها فقط ثم يقف العنصر (opacity الأساس 0 = غير مرئي).
                    const iters = Math.floor((SHOW_MS / 1000 + delayAbs) / dur) + 1;
                    (el as HTMLElement).style.animationIterationCount = String(iters);
                    const endMs = (iters * dur - delayAbs) * 1000;
                    if (endMs > maxEndMs) maxEndMs = endMs;
                });
            }
            // إزالة الطبقة نهائياً بعد أن يُنهي آخر عنصر رحلته (+ هامش بسيط).
            t2 = setTimeout(() => setPhase('off'), Math.max(0, maxEndMs - SHOW_MS) + 800);
        }, SHOW_MS);
        return () => { clearTimeout(t1); if (t2) clearTimeout(t2); };
    }, [season?.id, flakes]);

    // داخل لوحة المدير الكثافة البصرية عالية أصلاً — نُبقيها صافية.
    if (!season || phase === 'off' || location.pathname.startsWith('/admin')) return null;

    return (
        <div ref={containerRef} className={`season-fx${season.fx.mode === 'rise' ? ' rise' : ''}`} aria-hidden>
            {flakes.map(f => (
                <span
                    key={f.key}
                    style={{
                        '--fx-x': f.x,
                        '--fx-size': f.size,
                        '--fx-dur': f.dur,
                        '--fx-delay': f.delay,
                        '--fx-drift': f.drift,
                        '--fx-op': f.op,
                    } as React.CSSProperties}
                >
                    {f.item}
                </span>
            ))}
        </div>
    );
};

export default SeasonFX;
