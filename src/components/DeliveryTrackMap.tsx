/**
 * DeliveryTrackMap — «أين طلبي؟» (v14.07)
 *
 * طبقة يفتحها **المشتري** فوق صفحة الطلبات لمتابعة مندوب التوصيل على الخريطة.
 *
 * ثلاثة مبادئ حكمت التصميم:
 *
 *  1. **الخادم وحده يحسب.** `remaining_km` و`eta_min` يعودان من
 *     `delivery_track_get` كما هما. أي حساب في المتصفح يعني رقمين مختلفين
 *     على جهازَي المشتري والتاجر لنفس اللحظة — وهذا ما يولّد الشكاوى.
 *
 *  2. **لا دبّوس قديم يُعرض كأنه الآن.** حين `live === false` لا يُرجع الخادم
 *     إحداثيات أصلاً (النبضة أقدم من دقيقتين أو انتهى التوصيل)، فنقول للمشتري
 *     صراحةً «آخر تحديث قبل X دقيقة» بدل أن نترك دبّوساً جامداً يوهمه بأن
 *     المندوب واقف في الشارع. الاتصال ينقطع في الطريق كثيراً، وقول ذلك
 *     أصدق من تجميل الشاشة.
 *
 *  3. **لا استنزاف بطارية.** التحديث كل ١٠ ثوانٍ ما دامت الطبقة مفتوحة
 *     **والصفحة ظاهرة**؛ يتوقّف المؤقّت عند إخفاء التبويب أو قفل الشاشة
 *     ويستأنف عند العودة بجلب فوري (لا ينتظر دورة كاملة).
 *
 * الخريطة لا «تطارد» المستخدم: أول سحب بإصبعه يُطفئ التتبّع التلقائي ويظهر
 * زرّ لإعادته — فلا يُنتزع الإطار من يده كل عشر ثوانٍ وهو يتفحّص الطريق.
 * وكل حركة خريطة داخل try/catch لأن استثناء Leaflet يقع **خارج** شجرة React
 * فيُسقط الصفحة كلها عبر ErrorBoundary.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import { supabase } from '../services/supabaseClient';
import { useApp } from '../context/AppContext';
import useEscClose from '../hooks/useEscClose';

type LatLng = [number, number];

type TrackPoint = {
    lat?: number | null;
    lng?: number | null;
    label?: string | null;
    details?: string | null;
    phone?: string | null;
    name?: string | null;
};

type TrackData = {
    ok?: boolean;
    reason?: string;
    role?: 'seller' | 'buyer';
    status?: string;
    live?: boolean;
    lat?: number | null;
    lng?: number | null;
    heading?: number | null;
    accuracy_m?: number | null;
    remaining_km?: number | null;
    eta_min?: number | null;
    updated_at?: string | null;
    started_at?: string | null;
    ended_at?: string | null;
    age_sec?: number | null;
    destination?: TrackPoint | null;
    store?: TrackPoint | null;
    booking_status?: string | null;
};

interface Props {
    barcode: string;
    isRTL: boolean;
    onClose: () => void;
}

/**
 * رقم صالح فقط — أي شيء آخر يعود `null` فلا يصل NaN إلى Leaflet أبداً.
 *
 * 🪤 `Number(null) === 0` و`Number('') === 0` و`Number(true) === 1`: لو مررنا
 * القيمة إلى `Number` ثم اكتفينا بـ`isFinite` لتحوّل كل حقل غائب إلى صفر —
 * عنوانٌ بلا إحداثيات يصير دبّوساً عند (0,0) في خليج غينيا فتمتدّ الخريطة
 * نصفَ الكرة، و`remaining_km: null` يصير «تبقّى ٥٠ متراً» وهو خبر لم يقله
 * الخادم. لذلك نقبل العدد أو النصّ الرقمي فقط ونرفض ما عداهما صراحةً.
 */
const num = (v: unknown): number | null => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'string' && v.trim() !== '') {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    }
    return null;
};

/** نقطة صالحة أو `null` — الحارس الوحيد بين بيانات الخادم وإحداثيات الخريطة. */
const pointOf = (p?: TrackPoint | null): LatLng | null => {
    const lat = num(p?.lat);
    const lng = num(p?.lng);
    return lat !== null && lng !== null ? [lat, lng] : null;
};

const RIYADH: LatLng = [24.7136, 46.6753];

/**
 * ألوان الحالة بدرجتين لا بدرجة واحدة: `#1d4ed8` على خلفية `--body-bg`
 * الليلية (#18222e) تباينُه ١٫٩:١ — عنوانٌ لا يكاد يُقرأ. الدرجة الفاتحة
 * تُقرأ ليلاً والداكنة نهاراً، فالنصّ مقروء في الوضعين بلا لون سطح ثابت.
 */
const TONES = {
    blue: { light: '#1d4ed8', dark: '#93c5fd' },
    teal: { light: '#0d9488', dark: '#5eead4' },
    green: { light: '#059669', dark: '#6ee7b7' },
    sky: { light: '#0284c7', dark: '#7dd3fc' },
    amber: { light: '#b45309', dark: '#fcd34d' },
} as const;

const courierIcon = (heading: number | null) => L.divIcon({
    className: '',
    html: `<div style="
        width:40px;height:40px;border-radius:50%;
        background:linear-gradient(135deg,#3b82f6,#1d4ed8);
        display:flex;align-items:center;justify-content:center;
        font-size:19px;line-height:1;
        border:3px solid #fff;
        box-shadow:0 0 0 6px rgba(59,130,246,0.22), 0 4px 12px rgba(0,0,0,0.45);
        transform:rotate(${heading === null ? 0 : heading}deg);
    ">🚗</div>`,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
});

const homeIcon = L.divIcon({
    className: '',
    html: `<div style="
        width:34px;height:34px;border-radius:50%;
        background:linear-gradient(135deg,#0d9488,#0f766e);
        display:flex;align-items:center;justify-content:center;
        font-size:16px;line-height:1;
        border:3px solid #fff;box-shadow:0 3px 10px rgba(0,0,0,0.45);
    ">🏠</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
});

const storeIcon = L.divIcon({
    className: '',
    html: `<div style="
        width:30px;height:30px;border-radius:50%;
        background:linear-gradient(135deg,#f59e0b,#d97706);
        display:flex;align-items:center;justify-content:center;
        font-size:14px;line-height:1;
        border:2.5px solid #fff;box-shadow:0 3px 8px rgba(0,0,0,0.4);
    ">🏪</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
});

/**
 * قائد الخريطة — مفصول عن الحاوية لأن `useMap` لا يعمل إلا داخل `MapContainer`.
 * `fitSeq` عدّاد لا شرط منطقي: الضغط على «إعادة التوسيط» مرتين متتاليتين يجب
 * أن يعيد الإطار في المرتين.
 */
const TrackController: React.FC<{
    points: LatLng[];
    fitSeq: number;
    follow: boolean;
    onUserDrag: () => void;
}> = ({ points, fitSeq, follow, onUserDrag }) => {
    const map = useMap();

    useEffect(() => {
        // السحب بالإصبع فقط يُطفئ التتبّع — الحركة البرمجية تُطلق `movestart`
        // لا `dragstart`، فلا تُطفئ نفسها بنفسها.
        const onDrag = () => onUserDrag();
        map.on('dragstart', onDrag);
        // الطبقة تُفتح فوق صفحة ظاهرة، فالحاوية تأخذ مقاسها بعد أول رسم.
        const t = window.setTimeout(() => { try { map.invalidateSize(); } catch { /* لا شيء */ } }, 0);
        return () => { map.off('dragstart', onDrag); window.clearTimeout(t); };
    }, [map, onUserDrag]);

    useEffect(() => {
        if (!follow || points.length === 0) return;
        try {
            map.invalidateSize();
            if (points.length === 1) {
                map.setView(points[0], Math.max(map.getZoom() || 15, 15), { animate: true, duration: 0.6 });
                return;
            }
            map.fitBounds(L.latLngBounds(points), { padding: [56, 56], maxZoom: 16, animate: true });
        } catch {
            // حركة خريطة لا تُسقط الصفحة أبداً.
        }
    }, [map, points, fitSeq, follow]);

    return null;
};

/** الحالتان النهائيتان: لا شيء بعدهما يتغيّر، فلا داعي لمواصلة السؤال. */
const TERMINAL = new Set(['delivered', 'cancelled']);

const DeliveryTrackMap: React.FC<Props> = ({ barcode, isRTL, onClose }) => {
    const t = (ar: string, en: string) => (isRTL ? ar : en);
    const { darkMode } = useApp();
    const tone = useCallback(
        (k: keyof typeof TONES) => (darkMode ? TONES[k].dark : TONES[k].light),
        [darkMode],
    );

    const [data, setData] = useState<TrackData | null>(null);
    const [reason, setReason] = useState<string | null>(null);   // رفض من الخادم (ok:false)
    const [netFail, setNetFail] = useState(false);               // انقطاع شبكة — لا يمسح آخر حالة
    const [loading, setLoading] = useState(true);

    const [follow, setFollow] = useState(true);
    const [fitSeq, setFitSeq] = useState(0);
    const [retrySeq, setRetrySeq] = useState(0);                 // «حاول مجدداً» يعيد تشغيل الدورة

    const aliveRef = useRef(true);
    // ردّ بطيء قد يصل بعد ردٍّ أحدث منه؛ الرقم التسلسلي يمنع أن يدهس
    // الأقدمُ الأحدثَ فيعود المندوب إلى الوراء أمام عين المشتري.
    const seqRef = useRef(0);
    // آخر حالة معروفة — يقرأها المؤقّت ليتوقّف بعد التسليم بلا أن يُعيد
    // بناء نفسه عند كل تغيّر حالة (وإعادةُ بنائه تعني جلباً فورياً كل ١٠ ثوانٍ).
    const statusRef = useRef<string | null>(null);

    useEscClose(true, onClose);

    // قفل تمرير الصفحة خلف الطبقة: مستمعو PullToRefresh على `document` نفسه،
    // فبلا القفل (ولا `aria-modal`) كان سحبُ الخريطة بالإصبع يُترجَم «سحباً
    // للتحديث» فتقفز صفحة الطلبات تحت الخريطة.
    useEffect(() => {
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = prev; };
    }, []);

    // مُعرَّف هنا لا داخل JSX: الجسم يتفرّع على حالة التحميل والخطأ، وأي نداء
    // خطّاف داخل فرع يختلّ ترتيبه بين رسمتين.
    const stopFollowing = useCallback(() => setFollow(false), []);

    const fetchOnce = useCallback(async () => {
        const mine = ++seqRef.current;
        let res: unknown = null;
        let failed = false;
        try {
            const r = await supabase.rpc('delivery_track_get', { p_barcode: barcode });
            if (r.error) failed = true; else res = r.data;
        } catch {
            // انقطاع شبكة يصل أحياناً كاستثناء لا كـ`error`؛ بلا هذا المصيدة
            // يتحوّل إلى unhandledRejection داخل مؤقّت.
            failed = true;
        }
        // ردّ متأخّر تجاوزه ردٌّ أحدث، أو الطبقة أُغلقت — يُهمَل بلا أي كتابة حالة.
        if (!aliveRef.current || mine !== seqRef.current) return;

        setLoading(false);
        if (failed) {
            // نُبقي آخر حالة معروفة ونضع شارة «تعذّر التحديث» — إخفاء الخريطة
            // لأجل خلل شبكة لحظي أسوأ من إبقائها مع تنبيه صادق.
            setNetFail(true);
            return;
        }
        setNetFail(false);
        const d = (res || null) as TrackData | null;
        if (!d || d.ok === false) {
            statusRef.current = null;
            setReason(String(d?.reason || 'unknown'));
            setData(null);
            return;
        }
        statusRef.current = d.status || null;
        setReason(null);
        setData(d);
    }, [barcode]);

    // مؤقّت العشر ثوانٍ — يتوقّف مع إخفاء الصفحة ويستأنف بجلب فوري.
    useEffect(() => {
        aliveRef.current = true;
        let timer: number | undefined;

        const stop = () => {
            if (timer !== undefined) { window.clearInterval(timer); timer = undefined; }
        };
        const tick = () => {
            // بعد التسليم أو الإلغاء لا يتغيّر شيء: نوقف السؤال ونُبقي آخر
            // شاشة كما هي، فلا نستنزف بيانات المشتري بلا فائدة.
            if (statusRef.current && TERMINAL.has(statusRef.current)) { stop(); return; }
            void fetchOnce();
        };
        const start = () => {
            stop();
            tick();
            // العودة إلى تبويب طلبٍ سُلِّم أصلاً: لا مؤقّت يُنشأ من جديد.
            if (statusRef.current && TERMINAL.has(statusRef.current)) return;
            timer = window.setInterval(tick, 10000);
        };

        const onVisibility = () => {
            if (document.visibilityState === 'hidden') stop();
            else start();
        };

        if (document.visibilityState === 'hidden') void fetchOnce();
        else start();

        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            aliveRef.current = false;
            stop();
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [fetchOnce, retrySeq]);

    const status = data?.status || null;
    const live = data?.live === true;

    const courier = useMemo<LatLng | null>(
        // الخادم لا يُرجع إحداثيات حين `live=false`، والحارس هنا يمنع تسرّب
        // أي بقايا إلى الخريطة لو تغيّر ذلك يوماً.
        () => (live ? pointOf({ lat: data?.lat, lng: data?.lng }) : null),
        [live, data?.lat, data?.lng],
    );
    const dest = useMemo<LatLng | null>(() => pointOf(data?.destination), [data?.destination]);

    // المتجر يُعرض **قبل الانطلاق فقط**: هناك يشرح المسافة القادمة. أما بعد
    // الانطلاق فعرضُه — ولو انقطعت النبضة — يوحي بأن الطلب ما زال في المتجر،
    // وهذا عكس الحقيقة. عند الانقطاع نكتفي بعنوان المشتري ونقول ذلك بالنصّ.
    // ملاحظة: قبل أن يلمس التاجرُ الطلبَ لا يوجد صفّ تتبّع أصلاً، فالخادم يردّ
    // بـ`{status:'preparing'}` بلا `store` — عندها يظهر دبّوس العنوان وحده،
    // وهذا مقصود لا نقص.
    const storeRaw = useMemo<LatLng | null>(() => pointOf(data?.store), [data?.store]);
    const store = data?.status === 'preparing' ? storeRaw : null;

    const points = useMemo<LatLng[]>(
        () => [courier, dest, store].filter((p): p is LatLng => p !== null),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [courier?.[0], courier?.[1], dest?.[0], dest?.[1], store?.[0], store?.[1]],
    );

    const center = points[0] || RIYADH;

    const remainingKm = num(data?.remaining_km);
    const etaMin = num(data?.eta_min);
    const ageSec = num(data?.age_sec);
    const accuracy = num(data?.accuracy_m);

    const distanceText = remainingKm === null
        ? null
        : remainingKm < 1
            ? t(`${Math.max(50, Math.round(remainingKm * 1000))} متر`, `${Math.max(50, Math.round(remainingKm * 1000))} m`)
            : t(`${remainingKm.toFixed(1)} كم`, `${remainingKm.toFixed(1)} km`);

    const etaText = etaMin === null
        ? null
        : etaMin < 1
            ? t('أقل من دقيقة', 'less than a minute')
            : t(`${Math.round(etaMin)} دقيقة`, `${Math.round(etaMin)} min`);

    const ageText = ageSec === null
        ? null
        : ageSec < 90
            ? t('قبل لحظات', 'moments ago')
            : t(`قبل ${Math.round(ageSec / 60)} دقيقة`, `${Math.round(ageSec / 60)} min ago`);

    /** الحالة بلغة المشتري — لا مصطلحات ولا رموز حالة خام. */
    const headline = (): { icon: string; title: string; sub: string; tone: string } => {
        if (status === 'delivered') {
            return {
                icon: '✅',
                title: t('سُلِّم الطلب', 'Order delivered'),
                sub: t('وصلك الطلب وانتهى التوصيل.', 'Your order arrived and delivery is complete.'),
                tone: tone('green'),
            };
        }
        if (status === 'cancelled') {
            return {
                icon: '⛔',
                title: t('أُلغي التوصيل', 'Delivery cancelled'),
                sub: t('تواصل مع المتجر من داخل الطلب لمعرفة التفاصيل.', 'Message the store from the order for details.'),
                tone: 'var(--danger)',
            };
        }
        if (status === 'arrived') {
            return {
                icon: '📍',
                title: t('وصل موقعك', 'Arrived at your location'),
                sub: t('المندوب عند عنوانك الآن — استعدّ لاستلام طلبك.', 'The courier is at your address now — get ready to receive your order.'),
                tone: tone('sky'),
            };
        }
        if (status === 'on_the_way') {
            if (!live) {
                return {
                    icon: '📶',
                    title: t('في الطريق إليك — انقطع تحديث الموقع', 'On the way — location updates paused'),
                    sub: ageText
                        ? t(`آخر تحديث ${ageText}. انقطاع الشبكة في الطريق أمر معتاد، والطلب في طريقه إليك.`,
                            `Last update ${ageText}. Losing signal on the road is normal — your order is still on its way.`)
                        : t('انقطع تحديث الموقع مؤقتاً، والطلب في طريقه إليك.',
                            'Location updates paused for now — your order is still on its way.'),
                    tone: tone('amber'),
                };
            }
            return {
                icon: '🚗',
                title: t('في الطريق إليك', 'On the way to you'),
                sub: [
                    distanceText && t(`تبقّى ${distanceText}`, `${distanceText} left`),
                    etaText && t(`وصول متوقّع خلال ${etaText}`, `arriving in about ${etaText}`),
                ].filter(Boolean).join(' · ') || t('يتحرّك المندوب نحو عنوانك.', 'The courier is moving toward your address.'),
                tone: tone('blue'),
            };
        }
        // 'preparing' وأي حالة غير متوقّعة — الأسلم رسالة الانتظار لا رسالة خطأ.
        return {
            icon: '📦',
            title: t('قيد التجهيز — لم ينطلق بعد', 'Being prepared — not on the road yet'),
            sub: t('سيظهر موقع المندوب هنا فور انطلاقه.', "The courier's location will appear here as soon as they set off."),
            tone: 'var(--text-secondary)',
        };
    };

    const errorText = (r: string): string => {
        if (r === 'not_delivery') return t('هذا الطلب للاستلام من المتجر، فلا يوجد توصيل لتتبّعه.', 'This is a pickup order, so there is no delivery to track.');
        if (r === 'forbidden') return t('هذا الطلب ليس ضمن طلباتك.', 'This order is not one of yours.');
        if (r === 'not_found') return t('لم نجد هذا الطلب.', 'We could not find this order.');
        if (r === 'auth') return t('سجّل الدخول أولاً لمتابعة طلبك.', 'Sign in first to follow your order.');
        return t('تعذّر عرض التتبّع الآن. حاول بعد قليل.', 'Tracking is unavailable right now. Please try again shortly.');
    };

    const head = headline();
    const destLabel = data?.destination?.label || null;
    const destDetails = data?.destination?.details || null;
    const storeName = data?.store?.name || null;

    return (
        <div
            dir={isRTL ? 'rtl' : 'ltr'}
            role="dialog"
            aria-modal="true"
            aria-label={t('تتبّع الطلب', 'Track order')}
            onClick={onClose}
            style={{
                position: 'fixed', inset: 0, zIndex: 1400,
                background: 'rgba(0,0,0,0.62)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: 'max(env(safe-area-inset-top, 12px), 12px) 12px max(env(safe-area-inset-bottom, 12px), 12px)',
            }}
        >
            <div
                onClick={e => e.stopPropagation()}
                style={{
                    background: 'var(--card-bg)', borderRadius: 20, overflow: 'hidden',
                    width: '100%', maxWidth: 560, maxHeight: '100%',
                    display: 'flex', flexDirection: 'column',
                    border: '1px solid var(--border-color)', boxShadow: '0 18px 50px rgba(0,0,0,0.45)',
                }}
            >
                {/* الرأس */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--border-color)', flexShrink: 0 }}>
                    <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 900, fontSize: '0.95rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            🚚 {t('أين طلبي؟', 'Where is my order?')}
                        </div>
                        <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {storeName
                                ? t(`من ${storeName} إلى عنوانك`, `From ${storeName} to your address`)
                                : t('متابعة مباشرة لطلبك', 'Live view of your order')}
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        aria-label={t('إغلاق', 'Close')}
                        style={{ background: 'var(--gray-100)', color: 'var(--text-primary)', border: 'none', borderRadius: 12, width: 38, height: 38, fontSize: '1.05rem', fontWeight: 900, cursor: 'pointer', flexShrink: 0 }}
                    >
                        ✕
                    </button>
                </div>

                {/* الجسم */}
                {loading && !data && !reason ? (
                    <div style={{ padding: '56px 20px', textAlign: 'center' }}>
                        <div className="spinner" style={{ width: 34, height: 34, border: '3px solid var(--gray-200)', borderTopColor: 'var(--primary)', borderRadius: '50%', margin: '0 auto 14px', animation: 'spin 0.8s linear infinite' }} />
                        <div style={{ fontWeight: 800, color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                            {t('جاري متابعة طلبك…', 'Locating your order…')}
                        </div>
                    </div>
                ) : reason ? (
                    <div style={{ padding: '46px 22px', textAlign: 'center' }}>
                        <div style={{ fontSize: '2.6rem', marginBottom: 14 }}>🤷</div>
                        <div style={{ fontWeight: 800, color: 'var(--text-primary)', fontSize: '0.92rem', lineHeight: 1.8 }}>
                            {errorText(reason)}
                        </div>
                        <button
                            onClick={onClose}
                            style={{ marginTop: 22, padding: '11px 30px', borderRadius: 14, background: 'var(--primary)', color: '#fff', border: 'none', fontWeight: 900, fontSize: '0.85rem', cursor: 'pointer' }}
                        >
                            {t('إغلاق', 'Close')}
                        </button>
                    </div>
                ) : !data && netFail ? (
                    /* فشل أول جلب ولا حالة معروفة بعد. المهم هنا ألّا نكذب: كنّا
                       نسقط إلى شاشة «قيد التجهيز» ونحن لا نعلم شيئاً أصلاً —
                       والمشتري يقرأها كخبرٍ عن طلبه لا كعطل شبكة عندنا. */
                    <div style={{ padding: '46px 22px', textAlign: 'center' }}>
                        <div style={{ fontSize: '2.6rem', marginBottom: 14 }}>📡</div>
                        <div style={{ fontWeight: 800, color: 'var(--text-primary)', fontSize: '0.92rem', lineHeight: 1.8 }}>
                            {t('تعذّر الوصول إلى حالة الطلب. تحقّق من اتصالك وحاول مجدداً.',
                                'We could not reach your order status. Check your connection and try again.')}
                        </div>
                        <button
                            onClick={() => { setLoading(true); setNetFail(false); setRetrySeq(s => s + 1); }}
                            style={{ marginTop: 22, padding: '11px 30px', borderRadius: 14, background: 'var(--primary)', color: '#fff', border: 'none', fontWeight: 900, fontSize: '0.85rem', cursor: 'pointer' }}
                        >
                            {t('حاول مجدداً', 'Try again')}
                        </button>
                    </div>
                ) : (
                    <>
                        {/* شريط الحالة — أول ما تقع عليه العين قبل الخريطة */}
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: 11, padding: '12px 14px',
                            background: 'var(--body-bg)', borderBottom: '1px solid var(--border-color)',
                            flexShrink: 0,
                        }}>
                            <span style={{ fontSize: '1.5rem', lineHeight: 1, flexShrink: 0 }}>{head.icon}</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontWeight: 900, fontSize: '0.9rem', color: head.tone }}>{head.title}</div>
                                <div style={{ fontWeight: 700, fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 3, lineHeight: 1.7 }}>
                                    {head.sub}
                                </div>
                            </div>
                        </div>

                        {/* المسافة والوقت — من الخادم كما هما بلا أي حساب هنا */}
                        {live && (remainingKm !== null || etaMin !== null) && (
                            <div style={{ display: 'flex', gap: 10, padding: '11px 14px', borderBottom: '1px solid var(--border-color)', flexShrink: 0 }}>
                                <div style={{ flex: 1, textAlign: 'center', background: 'rgba(59,130,246,0.10)', border: '1px solid rgba(59,130,246,0.32)', borderRadius: 14, padding: '9px 8px' }}>
                                    <div style={{ fontSize: '0.68rem', fontWeight: 800, color: 'var(--text-secondary)' }}>{t('المسافة المتبقّية', 'Remaining')}</div>
                                    <div style={{ fontSize: '1rem', fontWeight: 900, color: tone('blue'), marginTop: 3 }}>{distanceText || '—'}</div>
                                </div>
                                <div style={{ flex: 1, textAlign: 'center', background: 'rgba(13,148,136,0.10)', border: '1px solid rgba(13,148,136,0.32)', borderRadius: 14, padding: '9px 8px' }}>
                                    <div style={{ fontSize: '0.68rem', fontWeight: 800, color: 'var(--text-secondary)' }}>{t('الوصول المتوقّع', 'Arriving in')}</div>
                                    <div style={{ fontSize: '1rem', fontWeight: 900, color: tone('teal'), marginTop: 3 }}>{etaText || '—'}</div>
                                </div>
                            </div>
                        )}

                        {/* الخريطة */}
                        <div style={{ height: 'min(52vh, 380px)', width: '100%', position: 'relative', flexShrink: 0 }}>
                            <MapContainer center={center} zoom={13} attributionControl={false} style={{ height: '100%', width: '100%' }}>
                                <TileLayer
                                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                                    subdomains="abc"
                                    detectRetina={true}
                                    maxZoom={19}
                                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                                />
                                <TrackController
                                    points={points}
                                    fitSeq={fitSeq}
                                    follow={follow}
                                    onUserDrag={stopFollowing}
                                />
                                {/* الخط بين المندوب وعنوانك — مؤشّر اتجاه لا مسار قيادة */}
                                {courier && dest && (
                                    <Polyline
                                        positions={[courier, dest]}
                                        pathOptions={{ color: '#3b82f6', weight: 4, opacity: 0.65, dashArray: '9 9' }}
                                    />
                                )}
                                {!courier && store && dest && (
                                    <Polyline
                                        positions={[store, dest]}
                                        pathOptions={{ color: '#94a3b8', weight: 3, opacity: 0.5, dashArray: '5 9' }}
                                    />
                                )}
                                {courier && <Marker position={courier} icon={courierIcon(num(data?.heading))} />}
                                {!courier && store && <Marker position={store} icon={storeIcon} />}
                                {dest && <Marker position={dest} icon={homeIcon} />}
                            </MapContainer>

                            {/* إعادة التتبّع بعد أن يسحب المستخدم الخريطة بيده */}
                            {!follow && points.length > 0 && (
                                <button
                                    onClick={() => { setFollow(true); setFitSeq(s => s + 1); }}
                                    style={{
                                        position: 'absolute', insetInlineEnd: 12, bottom: 12, zIndex: 500,
                                        background: 'var(--card-bg)', color: 'var(--text-primary)',
                                        border: '1px solid var(--border-color)', borderRadius: 12,
                                        padding: '9px 14px', fontWeight: 900, fontSize: '0.78rem',
                                        cursor: 'pointer', boxShadow: '0 4px 14px rgba(0,0,0,0.28)',
                                    }}
                                >
                                    ⌖ {t('إعادة التوسيط', 'Recenter')}
                                </button>
                            )}
                        </div>

                        {/* التفاصيل أسفل الخريطة */}
                        {/* `minHeight:0` شرط أن ينكمش هذا العمود داخل flex فيتمرّر
                            بدلاً من أن يُقصّ سطر الخصوصية على شاشة قصيرة. */}
                        <div style={{ padding: '11px 14px', display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto', flex: '1 1 auto', minHeight: 0 }}>
                            {(destLabel || destDetails) && (
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
                                    <span style={{ fontSize: '0.95rem', lineHeight: 1.4, flexShrink: 0 }}>🏠</span>
                                    <div style={{ minWidth: 0 }}>
                                        <div style={{ fontWeight: 900, fontSize: '0.82rem', color: 'var(--text-primary)' }}>
                                            {destLabel || t('عنوان التوصيل', 'Delivery address')}
                                        </div>
                                        {destDetails && (
                                            <div style={{ fontWeight: 700, fontSize: '0.74rem', color: 'var(--text-secondary)', marginTop: 2, lineHeight: 1.7 }}>
                                                {destDetails}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* آخر تحديث + دقّة الموقع — صدقٌ في وصف ما نعرفه ومتى عرفناه */}
                            <div style={{ fontSize: '0.71rem', fontWeight: 700, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                                {netFail
                                    ? t('⚠️ تعذّر تحديث الموقع الآن — سنحاول تلقائياً بعد ثوانٍ.', '⚠️ Could not refresh right now — retrying automatically in a few seconds.')
                                    : live
                                        ? [
                                            t(`آخر تحديث ${ageText || t('الآن', 'now')}`, `Last update ${ageText || 'now'}`),
                                            accuracy !== null && accuracy > 0 ? t(`دقة الموقع ±${Math.round(accuracy)} م`, `accuracy ±${Math.round(accuracy)} m`) : null,
                                        ].filter(Boolean).join(' · ')
                                        : status === 'preparing'
                                            ? t('يبدأ التتبّع فور انطلاق المندوب.', 'Tracking starts the moment the courier sets off.')
                                            : ageText
                                                ? t(`آخر موقع معروف ${ageText}`, `Last known location ${ageText}`)
                                                : ''}
                            </div>

                            <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-secondary)', opacity: 0.8, lineHeight: 1.7 }}>
                                {t('🔒 موقع المندوب يظهر لك وحدك، ويتوقّف فور تسليم طلبك.',
                                    "🔒 The courier's location is visible only to you, and stops the moment your order is delivered.")}
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default DeliveryTrackMap;
