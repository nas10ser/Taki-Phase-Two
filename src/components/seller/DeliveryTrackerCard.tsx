/**
 * DeliveryTrackerCard — تحكّم التاجر بتتبّع طلب التوصيل (v14.07)
 *
 * ── لماذا هذا المكوّن موجود أصلاً ─────────────────────────────────────────
 * المشتري الذي ينتظر طلبه عند الباب يسأل سؤالاً واحداً: «وين صار؟». الإجابة
 * الوحيدة الصادقة هي موقع المندوب لحظةً بلحظة. لكن موقع المندوب **موقع
 * إنسان**، فلا يجوز أن يُبثّ إلا بفعل صريح منه، ولا أن يراه إلا مشتري ذلك
 * الطلب، ولا أن يستمرّ لحظة بعد التسليم.
 *
 * لذلك بُنيت هذه البطاقة على ثلاث قواعد لا تُخرَق:
 *   ١) **لا بثّ تلقائي إطلاقاً.** حتى لو عادت القاعدة بحالة `on_the_way`
 *      (لأن التاجر بدأ التوصيل من جهاز آخر أو قبل تحديث الصفحة) لا نُشغّل
 *      `watchPosition` من تلقائنا — نعرض زرّ «استئناف البثّ» وننتظر ضغطته.
 *   ٢) **الشريط يقول الحقيقة.** حين يُبثّ الموقع يظهر شريط أخضر صريح
 *      «📡 موقعك يُبثّ الآن لهذا العميل»، ومعه زرّ إيقاف ظاهر دائماً — لا
 *      يُخفى خلف قائمة ولا يحتاج تمريراً.
 *   ٣) **المتتبّع يموت في كل مخرج.** ستّة مخارج محسوبة (انظر `stopWatcher`).
 *      متتبّعٌ ينجو بعد التسليم يستنزف بطارية المندوب **ويبثّ موقعه بلا سبب**.
 *
 * ── لماذا لا نحسب المسافة ولا الوقت هنا؟ ─────────────────────────────────
 * لأن الخادم هو مصدر الحقيقة: `delivery_track_ping` يُرجع `remaining_km`
 * و`eta_min` محسوبَين من إحداثيات العنوان المثبَّتة على الطلب. حسابٌ في
 * العميل يعني رقمين مختلفين على شاشتَي التاجر والمشتري — وهذا أسوأ من لا رقم.
 *
 * ── الخنق ─────────────────────────────────────────────────────────────────
 * `watchPosition` قد يطلق عشرات التحديثات في الدقيقة على جهاز يتحرّك، والخادم
 * يرفض ما دون أربع ثوانٍ بـ`throttled:true`. فنخنق محلياً عند **عشر ثوانٍ**
 * (دقّة أكثر من كافية لسيارة في المدينة) ونرسل نبضة دورية بآخر إحداثي معروف
 * حتى لو توقّف الجهاز عن إطلاق تحديثات — وإلا اعتبرت القاعدة النبضة قديمة
 * (أكثر من دقيقتين) وأطفأت `live` بينما المندوب واقف على إشارة فحسب.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../services/supabaseClient';
import { GeoError, geoErrorMessage } from '../../utils/helpers';

type TrackStatus = 'preparing' | 'on_the_way' | 'arrived' | 'delivered' | 'cancelled';

interface TrackState {
    status: TrackStatus;
    live: boolean;
    remainingKm: number | null;
    etaMin: number | null;
    ageSec: number | null;
    startedAt: string | null;
}

interface Fix {
    lat: number;
    lng: number;
    accuracy: number | null;
    heading: number | null;
    speedKmh: number | null;
}

interface Props {
    barcode: string;
    /** لا تُركّب البطاقة إلا لطلب توصيل — نفحص هنا أيضاً حتى لا يعتمد الأمان على موضع الاستدعاء. */
    fulfillment?: 'pickup' | 'delivery';
    /** حالة الحجز نفسه: طلب مكتمل أو ملغي لا تتبّع له. */
    bookingStatus?: string;
    isRTL: boolean;
    onAlert: (msg: string) => void;
}

/** نبضة كل عشر ثوانٍ: أكثر من كافية لسيارة، وأقل بكثير من سقف الخادم (٤ ثوانٍ). */
const PING_EVERY_MS = 10_000;

/** رسائل أخطاء القاعدة — التاجر لا يقرأ رموزاً إنجليزية. */
const ERRORS: Record<string, { ar: string; en: string }> = {
    AUTH_REQUIRED: { ar: 'انتهت جلستك — أعد تسجيل الدخول ثم حاول مجدداً', en: 'Your session expired — sign in again and retry' },
    NOT_STARTED: { ar: 'لم يبدأ التوصيل بعد — اضغط «🚚 بدء التوصيل» أولاً', en: 'Delivery has not started — press “🚚 Start delivery” first' },
    FORBIDDEN: { ar: 'هذا الطلب ليس من متجرك', en: 'This order does not belong to your store' },
    BOOKING_CLOSED: { ar: 'الطلب مُغلق (مكتمل أو ملغي) — لا يمكن تغيير حالة التوصيل', en: 'The order is closed (completed or cancelled) — delivery status is locked' },
    NOT_DELIVERY: { ar: 'هذا الطلب استلام من المتجر، وليس توصيلاً', en: 'This is a pickup order, not a delivery' },
    NOT_FOUND: { ar: 'لم يُعثر على هذا الطلب', en: 'Order not found' },
    BAD_STATUS: { ar: 'حالة توصيل غير معروفة', en: 'Unknown delivery status' },
    BAD_POINT: { ar: 'إحداثيات الموقع غير صالحة — تأكّد من تفعيل الـGPS', en: 'Invalid coordinates — make sure GPS is on' },
};

/** أي خطأ يعني أن الاستمرار في البثّ عبث: القاعدة لن تقبل نبضةً بعده. */
const FATAL_PING_ERRORS = ['NOT_STARTED', 'FORBIDDEN', 'BOOKING_CLOSED', 'NOT_DELIVERY', 'AUTH_REQUIRED'];

const errKey = (e: unknown): string => {
    const raw = String((e as { message?: string })?.message || e || '');
    return Object.keys(ERRORS).find(k => raw.includes(k)) || '';
};
const errText = (e: unknown, isRTL: boolean): string => {
    const key = errKey(e);
    if (key) return isRTL ? ERRORS[key].ar : ERRORS[key].en;
    const raw = String((e as { message?: string })?.message || e || '');
    return raw || (isRTL ? 'تعذّر إتمام العملية — حاول مجدداً' : 'Action failed — please retry');
};

const STATUS_UI: Record<TrackStatus, { icon: string; ar: string; en: string; color: string; bg: string }> = {
    preparing: { icon: '⏳', ar: 'قيد التجهيز', en: 'Preparing', color: '#b45309', bg: 'rgba(245,158,11,0.16)' },
    on_the_way: { icon: '🚚', ar: 'في الطريق', en: 'On the way', color: '#1d4ed8', bg: 'rgba(59,130,246,0.16)' },
    arrived: { icon: '📍', ar: 'وصل إلى العميل', en: 'Arrived', color: '#7c3aed', bg: 'rgba(124,58,237,0.16)' },
    delivered: { icon: '✅', ar: 'تم التسليم', en: 'Delivered', color: '#059669', bg: 'rgba(16,185,129,0.16)' },
    cancelled: { icon: '✖️', ar: 'أُلغي التوصيل', en: 'Delivery cancelled', color: '#dc2626', bg: 'rgba(220,38,38,0.14)' },
};

const isTrackStatus = (v: unknown): v is TrackStatus =>
    v === 'preparing' || v === 'on_the_way' || v === 'arrived' || v === 'delivered' || v === 'cancelled';

/** رقمٌ فقط إن كان رقماً فعلاً — `null` لا `NaN`، فالقاعدة ترفض NaN بـBAD_POINT. */
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** «قبل كذا» للنبضة الأخيرة — حين ينطفئ `live` يجب أن يعرف التاجر كم مضى. */
const agoText = (sec: number, isRTL: boolean): string => {
    if (sec < 60) return isRTL ? `قبل ${Math.max(1, Math.round(sec))} ثانية` : `${Math.max(1, Math.round(sec))}s ago`;
    const m = Math.round(sec / 60);
    if (m < 60) return isRTL ? `قبل ${m} دقيقة` : `${m}m ago`;
    const h = Math.round(m / 60);
    return isRTL ? `قبل ${h} ساعة` : `${h}h ago`;
};

const btn = (bg: string, fg = '#fff'): React.CSSProperties => ({
    background: bg, color: fg, border: 'none', borderRadius: 12,
    padding: '10px 14px', fontWeight: 900, fontSize: '0.82rem',
    cursor: 'pointer', flex: '1 1 auto', minWidth: 130,
});

const DeliveryTrackerCard: React.FC<Props> = ({ barcode, fulfillment, bookingStatus, isRTL, onAlert }) => {
    const [track, setTrack] = useState<TrackState | null>(null);
    const [loadErr, setLoadErr] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [broadcasting, setBroadcasting] = useState(false);
    const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

    // مراجع لا حالات: المتتبّع والمؤقّت يجب أن يُقتلا من داخل ردود نداءٍ لا
    // ترى آخر حالة React (خطأ الموقع مثلاً يقع بعد إعادة الرسم بلحظات).
    const watchIdRef = useRef<number | null>(null);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const lastFixRef = useRef<Fix | null>(null);
    const lastSentAtRef = useRef(0);
    const inFlightRef = useRef(false);
    const mountedRef = useRef(true);

    const isDelivery = fulfillment === 'delivery';
    const closed = bookingStatus === 'completed' || bookingStatus === 'cancelled';

    /**
     * المخرج الوحيد للمتتبّع — كل مسارات الإيقاف تمرّ من هنا:
     *   ١) تفكيك المكوّن (cleanup في useEffect)      ٤) رفض إذن الموقع
     *   ٢) «✅ تم التسليم»                            ٥) خطأ قاطع من القاعدة
     *   ٣) «⏹ إيقاف البثّ»                            ٦) حالة عادت من الخادم ليست بثّاً
     * آمن للاستدعاء المتكرّر.
     */
    const stopWatcher = useCallback(() => {
        if (watchIdRef.current != null) {
            try { navigator.geolocation.clearWatch(watchIdRef.current); } catch { /* المتصفّح أغلقه قبلنا */ }
            watchIdRef.current = null;
        }
        if (timerRef.current != null) { clearInterval(timerRef.current); timerRef.current = null; }
        lastFixRef.current = null;
        lastSentAtRef.current = 0;
        if (mountedRef.current) setBroadcasting(false);
    }, []);

    /** قراءة الحالة من الخادم. `silent` لتحديث خلفي لا يمسح رسالة نجاح ظاهرة. */
    const refresh = useCallback(async (silent = false) => {
        try {
            const { data, error } = await supabase.rpc('delivery_track_get', { p_barcode: barcode });
            if (error) throw error;
            const d = (data || {}) as Record<string, unknown>;
            if (!mountedRef.current) return null;
            if (!d.ok) {
                const reason = String(d.reason || '');
                // «لا صفّ بعد» ليست خطأً: الطلب لم يبدأ توصيله قط — نعرضه «قيد التجهيز».
                if (reason === 'not_found') {
                    setTrack({ status: 'preparing', live: false, remainingKm: null, etaMin: null, ageSec: null, startedAt: null });
                    setLoadErr(null);
                    return 'preparing' as TrackStatus;
                }
                setLoadErr(reason === 'forbidden'
                    ? (isRTL ? ERRORS.FORBIDDEN.ar : ERRORS.FORBIDDEN.en)
                    : reason === 'not_delivery'
                        ? (isRTL ? ERRORS.NOT_DELIVERY.ar : ERRORS.NOT_DELIVERY.en)
                        : (isRTL ? ERRORS.AUTH_REQUIRED.ar : ERRORS.AUTH_REQUIRED.en));
                return null;
            }
            const status: TrackStatus = isTrackStatus(d.status) ? d.status : 'preparing';
            setTrack({
                status,
                live: d.live === true,
                remainingKm: num(d.remaining_km),
                etaMin: num(d.eta_min),
                ageSec: num(d.age_sec),
                startedAt: typeof d.started_at === 'string' ? d.started_at : null,
            });
            setLoadErr(null);
            if (!silent) setNote(null);
            return status;
        } catch (e) {
            if (mountedRef.current) setLoadErr(errText(e, isRTL));
            return null;
        }
    }, [barcode, isRTL]);

    /**
     * إعادة الحالة إلى «قيد التجهيز» بلا مرور بـ`applyStatus` — تُستدعى من رد
     * نداء خطأ الموقع، حيث لا يجوز أن نترك الشاشة توهم بأن البثّ يعمل.
     */
    const revertToPreparing = useCallback(async () => {
        stopWatcher();
        try {
            await supabase.rpc('delivery_track_set_status', { p_barcode: barcode, p_status: 'preparing' });
        } catch { /* الحالة على الخادم ستُقرأ في refresh التالي على أي حال */ }
        await refresh(true);
    }, [barcode, refresh, stopWatcher]);

    /** نبضة واحدة بآخر إحداثي معروف، بخنق محلّي عشر ثوانٍ وبلا تداخل. */
    const sendPing = useCallback(async (force = false) => {
        const fix = lastFixRef.current;
        if (!fix || inFlightRef.current) return;
        if (!force && Date.now() - lastSentAtRef.current < PING_EVERY_MS - 500) return;
        inFlightRef.current = true;
        lastSentAtRef.current = Date.now();
        try {
            const { data, error } = await supabase.rpc('delivery_track_ping', {
                p_barcode: barcode,
                p_lat: fix.lat,
                p_lng: fix.lng,
                p_accuracy: fix.accuracy,
                p_heading: fix.heading,
                p_speed_kmh: fix.speedKmh,
            });
            if (error) throw error;
            const d = (data || {}) as Record<string, unknown>;
            // `throttled` سلوك طبيعي لا خطأ: الخادم رفض نبضةً مبكّرة فحسب.
            if (d.throttled === true || !mountedRef.current) return;
            setTrack(prev => ({
                status: isTrackStatus(d.status) ? d.status : (prev?.status || 'on_the_way'),
                live: true,
                remainingKm: num(d.remaining_km),
                etaMin: num(d.eta_min),
                ageSec: 0,
                startedAt: prev?.startedAt ?? null,
            }));
        } catch (e) {
            const key = errKey(e);
            if (FATAL_PING_ERRORS.includes(key)) {
                // لا فائدة من الاستمرار — نطفئ المتتبّع فوراً ونُخبر التاجر بوضوح.
                stopWatcher();
                if (mountedRef.current) {
                    setNote({ ok: false, text: errText(e, isRTL) });
                    onAlert(errText(e, isRTL));
                }
                await refresh(true);
            }
            // ما عدا ذلك (انقطاع شبكة لحظي) نتجاهله: النبضة التالية بعد ١٠ ثوانٍ.
        } finally {
            inFlightRef.current = false;
        }
    }, [barcode, isRTL, onAlert, refresh, stopWatcher]);

    /**
     * بدء البثّ — لا يُستدعى إلا من ضغطة زرّ صريحة من التاجر (قاعدة الخصوصية).
     * يُرجع `true` إن انطلق المتتبّع فعلاً.
     */
    const startWatcher = useCallback((): boolean => {
        if (watchIdRef.current != null) return true;
        if (typeof navigator === 'undefined' || !navigator.geolocation || !navigator.geolocation.watchPosition) {
            const msg = geoErrorMessage(new GeoError('unsupported'), isRTL);
            setNote({ ok: false, text: msg });
            onAlert(msg);
            return false;
        }
        try {
            watchIdRef.current = navigator.geolocation.watchPosition(
                pos => {
                    const lat = num(pos.coords.latitude), lng = num(pos.coords.longitude);
                    if (lat == null || lng == null) return;
                    const spd = num(pos.coords.speed);
                    lastFixRef.current = {
                        lat, lng,
                        accuracy: num(pos.coords.accuracy),
                        heading: num(pos.coords.heading),
                        // م/ث → كم/س. القيم السالبة تعني «غير متاح» على بعض الأجهزة.
                        speedKmh: spd != null && spd >= 0 ? Math.round(spd * 3.6 * 100) / 100 : null,
                    };
                    void sendPing();
                },
                err => {
                    // رفض الإذن قرار صريح: نوقف كل شيء ونعيد الحالة إلى «قيد
                    // التجهيز» فلا يبقى زرٌّ يوهم بأن الموقع يُبثّ. باقي الأكواد
                    // (تعذّر/مهلة) عابرة — نُبقي المتتبّع ونُعلم التاجر فقط.
                    const geoErr = new GeoError(err?.code === 1 ? 'denied' : err?.code === 3 ? 'timeout' : 'unavailable');
                    const msg = geoErrorMessage(geoErr, isRTL);
                    if (mountedRef.current) setNote({ ok: false, text: msg });
                    if (err?.code === 1) {
                        onAlert(msg);
                        void revertToPreparing();
                    }
                },
                { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
            );
        } catch {
            const msg = geoErrorMessage(new GeoError('unavailable'), isRTL);
            setNote({ ok: false, text: msg });
            onAlert(msg);
            return false;
        }
        // نبضة دورية بآخر إحداثي: جهازٌ واقف قد لا يطلق تحديثاً جديداً، وسكوتنا
        // دقيقتين يُطفئ `live` عند المشتري بينما المندوب على إشارة مرور فقط.
        if (timerRef.current == null) timerRef.current = setInterval(() => { void sendPing(); }, PING_EVERY_MS);
        setBroadcasting(true);
        return true;
    }, [isRTL, onAlert, revertToPreparing, sendPing]);

    /** تغيير الحالة على الخادم ثم مواءمة المتتبّع معها. */
    const applyStatus = useCallback(async (next: TrackStatus) => {
        if (busy) return;
        setBusy(true);
        setNote(null);
        // «تم التسليم» و«إيقاف البثّ» يوقفان الموقع **قبل** نداء الشبكة، فلا
        // تبقى ثانيةٌ واحدة يُبثّ فيها موقع المندوب بعد قراره بالتوقّف.
        if (next === 'delivered' || next === 'preparing' || next === 'cancelled') stopWatcher();
        try {
            const { data, error } = await supabase.rpc('delivery_track_set_status', { p_barcode: barcode, p_status: next });
            if (error) throw error;
            const d = (data || {}) as Record<string, unknown>;
            if (d.ok !== true) throw new Error(String(d.error || 'FAILED'));
            await refresh(true);
            if (!mountedRef.current) return;
            if (next === 'on_the_way') {
                const started = startWatcher();
                setNote(started
                    ? { ok: true, text: isRTL ? '📡 بدأ بثّ موقعك لهذا العميل' : '📡 Your location is now shared with this customer' }
                    : { ok: false, text: isRTL ? 'بدأ التوصيل لكن تعذّر بثّ الموقع' : 'Delivery started but location sharing failed' });
            } else if (next === 'arrived') {
                setNote({ ok: true, text: isRTL ? '📍 أُبلغ العميل بوصولك — البثّ ما زال يعمل' : '📍 The customer was told you arrived — sharing is still on' });
            } else if (next === 'delivered') {
                setNote({ ok: true, text: isRTL ? '✅ سُجّل التسليم وتوقّف بثّ موقعك' : '✅ Handover recorded and location sharing stopped' });
            } else if (next === 'preparing') {
                setNote({ ok: true, text: isRTL ? '⏹ توقّف بثّ موقعك' : '⏹ Location sharing stopped' });
            }
        } catch (e) {
            stopWatcher();
            const msg = errText(e, isRTL);
            if (mountedRef.current) setNote({ ok: false, text: msg });
            onAlert(msg);
            await refresh(true);
        } finally {
            if (mountedRef.current) setBusy(false);
        }
    }, [barcode, busy, isRTL, onAlert, refresh, startWatcher, stopWatcher]);

    /** استئناف البثّ بعد تحديث الصفحة — الحالة على الخادم صحيحة، ينقص الموقع فقط. */
    const resumeBroadcast = useCallback(() => {
        setNote(null);
        if (startWatcher()) {
            setNote({ ok: true, text: isRTL ? '📡 عاد بثّ موقعك لهذا العميل' : '📡 Location sharing resumed for this customer' });
        }
    }, [isRTL, startWatcher]);

    // قراءة أولى عند فتح البطاقة. لا تتبّع لطلب استلام ولا لطلب مُغلق.
    useEffect(() => {
        mountedRef.current = true;
        if (isDelivery && !closed) void refresh();
        return () => { mountedRef.current = false; };
    }, [isDelivery, closed, refresh]);

    // **المخرج رقم ١**: تفكيك المكوّن. الاعتماد على الأزرار وحدها لا يكفي —
    // انتقال التاجر لتبويب آخر أو خروج الطلب من القائمة يفكّك البطاقة والمتتبّع
    // سيبقى حياً في المتصفّح إلى الأبد لو لم يُقتل هنا.
    useEffect(() => stopWatcher, [stopWatcher]);

    // **المخرج رقم ٦**: الخادم يقول إن الحالة لم تعد بثّاً (سُلّم/أُلغي من جهاز
    // آخر) — نطفئ المتتبّع فوراً بدل انتظار ضغطة قد لا تأتي.
    useEffect(() => {
        if (!broadcasting) return;
        const s = track?.status;
        if (s && s !== 'on_the_way' && s !== 'arrived') stopWatcher();
    }, [broadcasting, track?.status, stopWatcher]);

    if (!isDelivery) return null;

    const status: TrackStatus = track?.status || 'preparing';
    const ui = STATUS_UI[status];
    const shipping = status === 'on_the_way' || status === 'arrived';
    const finished = status === 'delivered' || status === 'cancelled';
    const km = track?.remainingKm;
    const eta = track?.etaMin;

    return (
        <div style={{
            marginBottom: 12, padding: '13px 15px', borderRadius: 16,
            background: 'var(--card-bg)', border: '1px solid var(--border-color)',
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: '1.15rem', lineHeight: 1 }}>🛰️</span>
                <div style={{ fontWeight: 900, fontSize: '0.9rem', color: 'var(--text-primary)', flex: 1, minWidth: 120 }}>
                    {isRTL ? 'تتبّع التوصيل' : 'Delivery tracking'}
                </div>
                <div style={{
                    background: ui.bg, color: ui.color, padding: '5px 11px', borderRadius: 12,
                    fontWeight: 900, fontSize: '0.78rem', whiteSpace: 'nowrap',
                }}>
                    {ui.icon} {isRTL ? ui.ar : ui.en}
                </div>
            </div>

            {loadErr && (
                <div style={{ marginTop: 9, padding: '9px 12px', borderRadius: 12, background: 'rgba(220,38,38,0.12)', color: '#dc2626', fontWeight: 800, fontSize: '0.79rem', lineHeight: 1.7 }}>
                    ⚠️ {loadErr}
                </div>
            )}

            {/* الشريط الصريح: ما دام الموقع يُبثّ يجب أن يعرف التاجر ذلك بلا لبس. */}
            {broadcasting && (
                <div style={{
                    marginTop: 10, padding: '11px 13px', borderRadius: 14,
                    background: 'rgba(16,185,129,0.16)', border: '1.5px solid rgba(16,185,129,0.6)',
                }}>
                    <div style={{ fontWeight: 900, fontSize: '0.86rem', color: '#059669', lineHeight: 1.7 }}>
                        📡 {isRTL ? 'موقعك يُبثّ الآن لهذا العميل' : 'Your location is being shared with this customer'}
                    </div>
                    <div style={{ fontWeight: 700, fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 3, lineHeight: 1.7 }}>
                        {isRTL
                            ? 'لا يراه أحد غير مشتري هذا الطلب، ويتوقّف فور ضغطك «تم التسليم» أو «إيقاف البثّ».'
                            : 'Only this order’s buyer can see it, and it stops the moment you press “Delivered” or “Stop sharing”.'}
                    </div>
                    {/* حدٌّ تقنيّ في المتصفّحات لا حيلة لنا فيه: قفلُ الشاشة أو مغادرةُ
                        الصفحة يوقف `watchPosition`. قولُه للتاجر صراحةً خيرٌ من أن
                        يكتشفه من شكوى مشترٍ توقّفت خريطته — ومعه البديل الذي يعمل
                        والشاشة مقفلة: «الموقع الحيّ» في بوت تيليجرام (v14.07). */}
                    <div style={{ fontWeight: 700, fontSize: '0.73rem', color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.7, borderTop: '1px dashed var(--border-color)', paddingTop: 6 }}>
                        {isRTL
                            ? '⚠️ أبقِ هذه الصفحة مفتوحة أثناء التوصيل: قفل الشاشة يوقف البثّ من المتصفّح. وللبثّ والشاشة مقفلة استعمل «الموقع الحيّ» من بوت تيليجرام.'
                            : '⚠️ Keep this page open while delivering: locking the screen stops browser sharing. To keep sharing with the screen locked, use Telegram’s live location in the bot.'}
                    </div>
                </div>
            )}

            {/* الحالة على الخادم بثّ، لكن هذا الجهاز لا يبثّ — لا نُشغّله تلقائياً. */}
            {!broadcasting && shipping && (
                <div style={{
                    marginTop: 10, padding: '11px 13px', borderRadius: 14,
                    background: 'rgba(245,158,11,0.14)', border: '1.5px solid rgba(245,158,11,0.55)',
                    fontWeight: 800, fontSize: '0.8rem', color: 'var(--text-primary)', lineHeight: 1.7,
                }}>
                    {isRTL
                        ? '⏸ بثّ الموقع متوقّف على هذا الجهاز. العميل يرى «في الطريق» بلا خريطة حيّة — اضغط «استئناف البثّ» ليتابعك.'
                        : '⏸ Location sharing is off on this device. The customer sees “on the way” without a live map — press “Resume sharing”.'}
                </div>
            )}

            {/* المسافة والوقت من الخادم وحده. `live=false` ⇒ لا ندّعي أنه حيّ. */}
            {(km != null || eta != null) && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                    {km != null && (
                        <div style={{ background: 'var(--gray-100)', padding: '6px 11px', borderRadius: 10, fontWeight: 800, fontSize: '0.79rem', color: 'var(--text-primary)' }}>
                            📏 {isRTL ? `يتبقّى ${km.toFixed(1)} كم` : `${km.toFixed(1)} km left`}
                        </div>
                    )}
                    {eta != null && (
                        <div style={{ background: 'var(--gray-100)', padding: '6px 11px', borderRadius: 10, fontWeight: 800, fontSize: '0.79rem', color: 'var(--text-primary)' }}>
                            ⏱ {isRTL ? `تقريباً ${Math.max(1, Math.round(eta))} دقيقة` : `about ${Math.max(1, Math.round(eta))} min`}
                        </div>
                    )}
                    {track && !track.live && track.ageSec != null && (
                        <div style={{ background: 'var(--gray-100)', padding: '6px 11px', borderRadius: 10, fontWeight: 800, fontSize: '0.79rem', color: 'var(--text-secondary)' }}>
                            🕘 {isRTL ? `آخر تحديث ${agoText(track.ageSec, true)}` : `last update ${agoText(track.ageSec, false)}`}
                        </div>
                    )}
                </div>
            )}

            {note && (
                <div style={{
                    marginTop: 10, padding: '9px 12px', borderRadius: 12, lineHeight: 1.7,
                    background: note.ok ? 'rgba(16,185,129,0.12)' : 'rgba(220,38,38,0.12)',
                    color: note.ok ? '#059669' : '#dc2626', fontWeight: 800, fontSize: '0.79rem',
                }}>
                    {note.text}
                </div>
            )}

            {/* الأزرار: مقفلة تماماً على طلب مُغلق، فالقاعدة سترفضها بـBOOKING_CLOSED. */}
            {closed ? (
                <div style={{ marginTop: 10, fontWeight: 700, fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                    {isRTL ? 'الطلب مُغلق — لا تتبّع بعد الآن.' : 'The order is closed — tracking is over.'}
                </div>
            ) : (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 11 }}>
                    {!shipping && !finished && (
                        <button type="button" disabled={busy} onClick={() => { void applyStatus('on_the_way'); }}
                            style={{ ...btn('#1d4ed8'), opacity: busy ? 0.6 : 1 }}>
                            🚚 {isRTL ? 'بدء التوصيل' : 'Start delivery'}
                        </button>
                    )}
                    {shipping && !broadcasting && (
                        <button type="button" disabled={busy} onClick={resumeBroadcast}
                            style={{ ...btn('#059669'), opacity: busy ? 0.6 : 1 }}>
                            📡 {isRTL ? 'استئناف البثّ' : 'Resume sharing'}
                        </button>
                    )}
                    {broadcasting && (
                        <button type="button" disabled={busy} onClick={() => { void applyStatus('preparing'); }}
                            style={{ ...btn('var(--card-bg)', 'var(--text-primary)'), border: '1.5px solid var(--border-color)', opacity: busy ? 0.6 : 1 }}>
                            ⏹ {isRTL ? 'إيقاف البثّ' : 'Stop sharing'}
                        </button>
                    )}
                    {status === 'on_the_way' && (
                        <button type="button" disabled={busy} onClick={() => { void applyStatus('arrived'); }}
                            style={{ ...btn('#7c3aed'), opacity: busy ? 0.6 : 1 }}>
                            📍 {isRTL ? 'وصلت' : 'Arrived'}
                        </button>
                    )}
                    {shipping && (
                        <button type="button" disabled={busy} onClick={() => { void applyStatus('delivered'); }}
                            style={{ ...btn('#059669'), opacity: busy ? 0.6 : 1 }}>
                            ✅ {isRTL ? 'تم التسليم' : 'Delivered'}
                        </button>
                    )}
                    {finished && (
                        <button type="button" disabled={busy} onClick={() => { void refresh(); }}
                            style={{ ...btn('var(--card-bg)', 'var(--text-primary)'), border: '1.5px solid var(--border-color)', opacity: busy ? 0.6 : 1 }}>
                            🔄 {isRTL ? 'تحديث الحالة' : 'Refresh status'}
                        </button>
                    )}
                </div>
            )}

            {/* تنبيه لا غنى عنه: «تم التسليم» يُنهي التتبّع لا الطلب. */}
            {!closed && (
                <div style={{ marginTop: 9, fontWeight: 700, fontSize: '0.74rem', color: 'var(--text-secondary)', lineHeight: 1.75 }}>
                    ℹ️ {isRTL
                        ? '«تم التسليم» يُنهي التتبّع فقط ولا يُتمّ الطلب — إتمام الطلب يبقى بمسح رمز المشتري كالمعتاد.'
                        : '“Delivered” only ends tracking — completing the order still requires scanning the buyer’s code as usual.'}
                </div>
            )}
        </div>
    );
};

export default DeliveryTrackerCard;
