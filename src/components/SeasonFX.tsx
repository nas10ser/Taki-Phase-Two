import React, { useEffect, useMemo, useState } from 'react';
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
 * v12.46 (طلب ناصر): «فرحة دخول» فقط — تعمل ٢٠ ثانية عند فتح التطبيق ثم
 * تتلاشى بنعومة حتى لا تزعج المتسوق أثناء التصفح. تعود للظهور ٢٠ ثانية
 * أخرى لحظة تفعيل/تبديل موسم من لوحة المدير (يصل عبر realtime).
 */
const COUNT = 16;
const SHOW_MS = 20_000;   // مدة العرض عند الدخول
const FADE_MS = 2_500;    // تلاشٍ نهائي ناعم بعدها

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

    // «فرحة الدخول»: on → fading (تلاشٍ CSS) → off (إزالة كاملة من الصفحة).
    // إعادة الضبط مربوطة بمعرّف الموسم: تفعيل موسم جديد والمستخدم داخل
    // التطبيق يعيد العرض ٢٠ ثانية — لحظة الاحتفال نفسها التي قصدها المالك.
    const [phase, setPhase] = useState<'on' | 'fading' | 'off'>('on');
    useEffect(() => {
        if (!season) return;
        setPhase('on');
        const t1 = setTimeout(() => setPhase('fading'), SHOW_MS);
        const t2 = setTimeout(() => setPhase('off'), SHOW_MS + FADE_MS);
        return () => { clearTimeout(t1); clearTimeout(t2); };
    }, [season?.id]);

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

    // داخل لوحة المدير الكثافة البصرية عالية أصلاً — نُبقيها صافية.
    if (!season || phase === 'off' || location.pathname.startsWith('/admin')) return null;

    return (
        <div className={`season-fx${season.fx.mode === 'rise' ? ' rise' : ''}${phase === 'fading' ? ' fx-out' : ''}`} aria-hidden>
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
