/**
 * BuyerAddressCard — دفتر عناوين المشتري (v14.08 — طلبا ناصر ٤ و٥)
 *
 * «اجعله يضيف أكثر من عنوان، ولكن عنوان التوصيل لا بدّ أن يكون ضمن الحدود»
 * ← صار العنوان صفّاً في `public.user_addresses` (حتى ١٠ عناوين) بدل حقل مفرد،
 * وواحدٌ منها **افتراضي** هو الذي يُقاس عليه نطاق التوصيل عند الحجز.
 *
 * ── لماذا الإحداثيات إلزامية والعنوان المكتوب اختياري؟ ─────────────────────
 * لأن قرار «هل يصلك هذا المتجر؟» يُقاس هندسياً على نطاق التاجر (دائرة/مستطيل/
 * مضلّع) — ونصٌّ مكتوب لا يُقاس. لذلك القاعدة نفسها ترفض عنواناً بلا lat/lng
 * أو خارج حدود المملكة (`TAKI_ADDR_BAD:point`)، والتفاصيل والجوال للتاجر ليصل
 * إلى الباب.
 *
 * ── من يكتب `users.delivery_address`؟ ─────────────────────────────────────
 * **المشغّل `tr_single_default_address` وحده** — يزامن المرآة مع العنوان
 * الافتراضي، والبوتان وكل ما كُتب قبل هذه النسخة يقرآنها. الاستثناء الوحيد
 * هنا هو حذف **آخر** عنوان: لا صفّ يُرقّى فلا مشغّل يعمل، فنمسح المرآة صراحةً
 * وإلا بقي خيار «التوصيل» ظاهراً بعنوانٍ لا وجود له.
 *
 * ── ثلاثة فخاخ يجب تجنّبها (دروس مدفوعة الثمن في هذا المستودع) ────────────
 *  • `map.flyTo` يرمي «Invalid LatLng object: (NaN, NaN)» **خارج شجرة React**
 *    حين لا يكون للحاوية مقاس، فيلتقطه ErrorBoundary وتسقط الصفحة كلها.
 *    نستعمل `setView` داخل try/catch بعد `invalidateSize`.
 *  • `getCurrentPosition` الخام يعلّق بلا نهاية على iOS Safari — نستعمل
 *    `getCurrentPositionSafe` (دقّة عالية أولاً + مهلة + احتياطي).
 *  • حذفٌ ترفضه RLS يعود بـ`error = null` وصفر صفوف — لذلك كل حذف/تعديل هنا
 *    ينتهي بـ`.select()` ويُفحص **عدد** الصفوف لا غياب الخطأ وحده.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Circle, useMap } from 'react-leaflet';
import L from 'leaflet';
import { useApp } from '../context/AppContext';
import { supabase } from '../services/supabaseClient';
import { getCurrentPositionSafe, geoErrorMessage, normalizeArabicNumerals } from '../utils/helpers';

/** حدود المملكة تقريباً — نفس أرقام حارس القاعدة، ليُرفض الخطأ قبل الشبكة. */
const KSA = { latMin: 16, latMax: 33, lngMin: 34, lngMax: 56 };
const inKsa = (lat: number, lng: number) =>
    Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= KSA.latMin && lat <= KSA.latMax && lng >= KSA.lngMin && lng <= KSA.lngMax;

/**
 * إحداثيّ حقيقي أو `null`. ⚠️ `Number(null) === 0` و`Number('') === 0` — فتمريرُ
 * قيمةٍ فارغة كإحداثي يرسم دبّوساً عند خطّ الاستواء (٠،٠) بدل أن يُقال للمستخدم
 * «لا موقع»، وأسوأ منه: يجعل عنواناً بلا نقطة يبدو داخل نطاق تاجرٍ لا يخصّه.
 * لذلك نرفض null/''/undefined صراحةً لا نمرّرها صفراً.
 */
const finiteCoord = (v: unknown): number | null =>
    (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) ? null : Number(v);

/** مركز افتراضي حين لا عنوان ولا موقع: الرياض. */
const DEFAULT_CENTER: [number, number] = [24.7136, 46.6753];

/** سقف القاعدة (`TAKI_ADDR_CAP:10`) — مكرّر هنا ليُمنع الضغط قبل الشبكة. */
const MAX_ADDRESSES = 10;

/**
 * بلاغ ناصر (٥): «لا يحدد موقعي بدقة إلا إذا كبّرت الخريطة».
 * السبب أن التركيز كان يقف عند تكبير ١٥ — وعلى هذا المستوى يغطّي الدبّوس حيّاً
 * كاملاً فيبدو «غير دقيق». نقفز إلى ١٧ بعد كل تثبيت GPS، ونعرض دائرة الدقّة.
 */
const GPS_ZOOM = 17;
/** أسوأ من هذا (بالأمتار) يعني تثبيتاً تقريبياً — ننبّه المستخدم ليضبط الدبّوس. */
const ACCURACY_WARN_M = 50;

const pinIcon = L.divIcon({
    className: '',
    html: `<div style="
        width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50% 50% 50% 0;
        transform:rotate(-45deg);
        background:linear-gradient(135deg,#0d9488,#0f766e);
        border:2.5px solid #fff;box-shadow:0 3px 10px rgba(0,0,0,0.45);
    "></div>`,
    iconSize: [34, 34],
    iconAnchor: [0, 0],
});

/**
 * قائد الخريطة: يحرّك الدبّوس بالنقر ويُركّز الإطار على نقطة عند الطلب.
 * مفصول عن الحاوية لأن `useMap` لا يعمل إلا داخل `MapContainer`.
 * `focusSeq` عدّاد لا قيمة منطقية: «موقعي الحالي» مرتين متتاليتين يجب أن
 * تُركّز في المرتين، ولو كان شرطاً منطقياً لما تغيّر في الثانية.
 */
const PinController: React.FC<{
    point: { lat: number; lng: number } | null;
    focusSeq: number;
    focusZoom: number;
    onPick: (lat: number, lng: number) => void;
}> = ({ point, focusSeq, focusZoom, onPick }) => {
    const map = useMap();

    useEffect(() => {
        const onClick = (e: any) => {
            const { lat, lng } = e?.latlng || {};
            if (Number.isFinite(lat) && Number.isFinite(lng)) onPick(lat, lng);
        };
        map.on('click', onClick);
        const t = setTimeout(() => { try { map.invalidateSize(); } catch { /* لا شيء */ } }, 0);
        return () => { map.off('click', onClick); clearTimeout(t); };
    }, [map, onPick]);

    useEffect(() => {
        if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return;
        // لا نُصغّر أبداً: من كبّر يدوياً لضبط الدبّوس لا يُعاد إلى تكبير أوسع.
        const z = Math.max(map.getZoom() || focusZoom, focusZoom);
        try {
            map.invalidateSize();
            map.setView([point.lat, point.lng], z, { animate: true, duration: 0.6 });
        } catch {
            try { map.setView([point.lat, point.lng], z, { animate: false }); } catch { /* حركة خريطة لا تُسقط صفحة */ }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [map, focusSeq]);

    return null;
};

const LABELS: Array<{ id: string; ar: string; en: string; emoji: string }> = [
    { id: 'home', ar: 'المنزل', en: 'Home', emoji: '🏠' },
    { id: 'work', ar: 'العمل', en: 'Work', emoji: '🏢' },
    { id: 'other', ar: 'آخر', en: 'Other', emoji: '📍' },
];

/** صفّ `public.user_addresses` كما تقرؤه الواجهة. */
interface Addr {
    id: string;
    label: string | null;
    details: string | null;
    city: string | null;
    phone: string | null;
    /**
     * `null` مستحيل من قاعدةٍ سليمة (العمودان `NOT NULL` وحارسها يرفض ما هو
     * خارج المملكة) — لكنّه هنا نوعٌ صريح حتى لا يتسلّل `Number(null) === 0`
     * إلى الخريطة صفراً يبدو إحداثيّاً صحيحاً.
     */
    lat: number | null;
    lng: number | null;
    is_default: boolean;
    created_at: string | null;
}

const ADDR_COLUMNS = 'id,label,details,city,phone,lat,lng,is_default,created_at';

/** الأحدث أولاً — يُستعمل لترقية بديلٍ حين يُحذف الافتراضي. */
const newestFirst = (a: Addr, b: Addr) =>
    Date.parse(b.created_at || '') - Date.parse(a.created_at || '') || (a.id < b.id ? 1 : -1);

interface Props {
    /**
     * عدّاد يرسله `Profile` حين يصل المستخدم من زر «تغيير العنوان» في شاشة
     * الحجز: أي قيمة > 0 تُمرّر الصفحة إلى هذه البطاقة وتُبرزها لحظةً.
     * عدّاد لا قيمة منطقية — ليعمل في المرة الثانية أيضاً.
     */
    focusSignal?: number;
}

const BuyerAddressCard: React.FC<Props> = ({ focusSignal = 0 }) => {
    const { user, language, updateProfile, customAlert, customConfirm, liveLocation } = useApp();
    const isRTL = language === 'ar';
    const t = (ar: string, en: string) => (isRTL ? ar : en);

    const rootRef = useRef<HTMLDivElement | null>(null);
    const [highlight, setHighlight] = useState(false);

    const [list, setList] = useState<Addr[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);

    /** `null` = لا محرّر · `''` = إضافة عنوان جديد · معرّف = تعديل ذلك العنوان. */
    const [editing, setEditing] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [busyId, setBusyId] = useState<string | null>(null);

    const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null);
    const [accuracy, setAccuracy] = useState<number | null>(null);
    const [focusSeq, setFocusSeq] = useState(0);
    const [focusZoom, setFocusZoom] = useState(16);
    const [locating, setLocating] = useState(false);
    const [label, setLabel] = useState('');
    const [details, setDetails] = useState('');
    const [city, setCity] = useState('');
    const [phone, setPhone] = useState('');

    const userId = user?.id as string | undefined;

    /** ترجمة أخطاء حارس القاعدة إلى جملة يفهمها المشتري. */
    const addrErrorText = useCallback((e: any): string => {
        const m = String(e?.message || e?.error_description || e || '');
        if (m.includes('TAKI_ADDR_CAP')) {
            return t(`❌ الحد الأقصى ${MAX_ADDRESSES} عناوين — احذف عنواناً قبل إضافة آخر.`,
                     `❌ Maximum of ${MAX_ADDRESSES} addresses — delete one before adding another.`);
        }
        if (m.includes('TAKI_ADDR_BAD:point')) {
            return t('❌ حدّد موقعاً داخل المملكة — التاجر يقيس نطاق توصيله على هذه النقطة.',
                     '❌ Pick a spot inside Saudi Arabia — merchants measure their delivery area from this point.');
        }
        return t(`❌ تعذّر إتمام العملية: ${m || 'حاول مرة أخرى'}`,
                 `❌ Could not complete: ${m || 'please retry'}`);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isRTL]);

    const load = useCallback(async () => {
        if (!userId) { setList([]); setLoading(false); return; }
        setLoadError(false);
        const { data, error } = await supabase
            .from('user_addresses')
            .select(ADDR_COLUMNS)
            .eq('user_id', userId)
            .order('is_default', { ascending: false })
            .order('created_at', { ascending: false });
        if (error) {
            // لا زرّ صامت: نُظهر حالة فشل صريحة مع إعادة محاولة، لا قائمة فارغة كاذبة.
            setLoadError(true);
            setList([]);
        } else {
            // كل إحداثيّ يمرّ بالحارس عند القراءة — نقطة واحدة تالفة لا يجوز أن
            // تصل إلى Leaflet، فـ«Invalid LatLng» يُرمى خارج شجرة React ويُسقط
            // الصفحة كلها عبر ErrorBoundary.
            setList(((data as any[]) || []).map(r => ({
                ...(r as Addr),
                lat: finiteCoord(r.lat),
                lng: finiteCoord(r.lng),
            })));
        }
        setLoading(false);
    }, [userId]);

    useEffect(() => { void load(); }, [load]);

    // وصولٌ فوري من شاشة الحجز: مرّر الصفحة إلى البطاقة وأبرِزها لحظةً.
    // التأخير القصير يترك المتصفح يُنهي تخطيط التبويب قبل قياس الموضع.
    useEffect(() => {
        if (!focusSignal) return;
        const t1 = setTimeout(() => {
            try { rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch { /* تمريرٌ لا يُسقط صفحة */ }
            setHighlight(true);
        }, 80);
        const t2 = setTimeout(() => setHighlight(false), 2600);
        return () => { clearTimeout(t1); clearTimeout(t2); };
    }, [focusSignal]);

    const defaultAddr = useMemo(() => list.find(a => a.is_default) || null, [list]);

    /**
     * الموقع الحيّ يُقرأ من `localStorage` عند الإقلاع، فقد يعود تالفاً — نمرّره
     * بالحارس قبل أن نبني منه نقطة خريطة.
     */
    const liveFix = useMemo(() => {
        const la = finiteCoord(liveLocation?.lat);
        const ln = finiteCoord(liveLocation?.lng);
        return la !== null && ln !== null ? { lat: la, lng: ln } : null;
    }, [liveLocation]);

    const openEditor = (addr: Addr | null) => {
        if (addr) {
            setEditing(addr.id);
            // عنوانٌ بلا إحداثيّ سليم يُفتح **بلا دبّوس**: نطلب من صاحبه تحديد
            // النقطة بدل أن نضع له دبّوساً كاذباً عند (٠،٠).
            setPoint(addr.lat !== null && addr.lng !== null ? { lat: addr.lat, lng: addr.lng } : null);
            setLabel(addr.label || '');
            setDetails(addr.details || '');
            setCity(addr.city || '');
            setPhone(addr.phone || user?.phone || '');
            setFocusZoom(16);
        } else {
            setEditing('');
            setPoint(liveFix);
            setLabel(list.length === 0 ? t('المنزل', 'Home') : '');
            setDetails('');
            setCity('');
            setPhone(user?.phone || '');
            setFocusZoom(liveFix ? GPS_ZOOM : 14);
        }
        setAccuracy(null);
        setFocusSeq(s => s + 1);
    };

    const closeEditor = () => { setEditing(null); setAccuracy(null); };

    const center = useMemo<[number, number]>(() => {
        if (point && Number.isFinite(point.lat) && Number.isFinite(point.lng)) return [point.lat, point.lng];
        if (liveFix) return [liveFix.lat, liveFix.lng];
        return DEFAULT_CENTER;
    }, [point, liveFix]);

    // نقرة يدوية على الخريطة = نيّة صريحة، فلا معنى لدائرة دقّة الجهاز بعدها.
    const pick = useCallback((lat: number, lng: number) => {
        setPoint({ lat, lng });
        setAccuracy(null);
    }, []);

    const useMyLocation = async () => {
        if (locating) return;
        setLocating(true);
        try {
            // `getCurrentPositionSafe` يبدأ بمحاولة عالية الدقّة (GPS) ثم يتراجع.
            const pos = await getCurrentPositionSafe();
            setPoint({ lat: pos.lat, lng: pos.lng });
            setAccuracy(Number.isFinite(pos.accuracy) ? pos.accuracy : null);
            setFocusZoom(GPS_ZOOM);
            setFocusSeq(s => s + 1);
        } catch (e) {
            customAlert(geoErrorMessage(e, isRTL));
        } finally {
            setLocating(false);
        }
    };

    const save = async () => {
        if (saving || !userId) return;
        if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
            customAlert(t('📍 حدّد موقعك على الخريطة أولاً — اضغط على الخريطة أو استعمل «موقعي الحالي».',
                          '📍 Pick your spot on the map first — tap the map or use “My current location”.'));
            return;
        }
        if (!inKsa(point.lat, point.lng)) {
            customAlert(t('⛔ الدبّوس خارج حدود المملكة — حرّكه إلى عنوانك الفعلي لأن التاجر يقيس نطاق توصيله على هذه النقطة.',
                          '⛔ The pin is outside Saudi Arabia — move it to your real address; merchants measure their delivery area from this point.'));
            return;
        }
        if (editing === '' && list.length >= MAX_ADDRESSES) {
            customAlert(t(`❌ الحد الأقصى ${MAX_ADDRESSES} عناوين — احذف عنواناً قبل إضافة آخر.`,
                          `❌ Maximum of ${MAX_ADDRESSES} addresses — delete one before adding another.`));
            return;
        }

        const cleanPhone = normalizeArabicNumerals(phone).replace(/[^\d+]/g, '').slice(0, 20);
        const row = {
            label: label.trim().slice(0, 60) || null,
            details: details.trim().slice(0, 300) || null,
            city: city.trim().slice(0, 60) || null,
            phone: cleanPhone || null,
            // خمس منازل عشرية ≈ متر واحد — دقّة تكفي التوصيل ولا تضخّم الصفّ.
            lat: Math.round(point.lat * 1e5) / 1e5,
            lng: Math.round(point.lng * 1e5) / 1e5,
        };

        setSaving(true);
        try {
            if (editing) {
                const { data, error } = await supabase
                    .from('user_addresses').update(row).eq('id', editing).select('id');
                if (error) throw error;
                // RLS ترفض بصمت: صفر صفوف مع `error === null`. ونُغلق المحرّر
                // ونُحدّث القائمة لأن الصفّ الذي نُعدّله لم يعد موجوداً أصلاً.
                if (!data || data.length === 0) {
                    await load();
                    closeEditor();
                    customAlert(t('⚠️ لم يُحدَّث أي عنوان — يبدو أنه حُذف من جهاز آخر. حدّثنا القائمة.',
                                  '⚠️ No address was updated — it seems it was deleted on another device. The list has been refreshed.'));
                    return;
                }
            } else {
                // `is_default` لا يُرسَل: حارس القاعدة يجعل **أول** عنوان افتراضياً وحده.
                const { data, error } = await supabase
                    .from('user_addresses').insert({ ...row, user_id: userId }).select('id');
                if (error) throw error;
                if (!data || data.length === 0) {
                    throw new Error(t('لم يُحفظ العنوان.', 'The address was not saved.'));
                }
            }
            await load();
            closeEditor();
            customAlert(editing
                ? t('✅ تم تحديث العنوان.', '✅ Address updated.')
                : t('✅ تم حفظ العنوان — سيظهر لك خيار «التوصيل» في المتاجر التي تغطّي عنوانك الافتراضي.',
                    '✅ Address saved — “Delivery” appears at stores that cover your default address.'));
        } catch (e: any) {
            customAlert(addrErrorText(e));
        } finally {
            setSaving(false);
        }
    };

    const makeDefault = async (a: Addr) => {
        if (busyId || a.is_default) return;
        setBusyId(a.id);
        try {
            const { data, error } = await supabase
                .from('user_addresses').update({ is_default: true }).eq('id', a.id).select('id');
            if (error) throw error;
            // صفر صفوف = رفضٌ صامت من RLS أو صفٌّ اختفى: نُحدّث القائمة لا نكتفي برسالة.
            if (!data || data.length === 0) {
                await load();
                customAlert(t('⚠️ لم يتغيّر شيء — قد يكون العنوان حُذف من جهاز آخر. حدّثنا القائمة.',
                              '⚠️ Nothing changed — the address may have been deleted on another device. The list has been refreshed.'));
                return;
            }
            await load();
            customAlert(t('⭐ صار هذا عنوانك الافتراضي — عليه يُقاس التوصيل في حجوزاتك القادمة.',
                          '⭐ This is now your default address — delivery is measured from it.'));
        } catch (e: any) {
            customAlert(addrErrorText(e));
        } finally {
            setBusyId(null);
        }
    };

    const remove = async (a: Addr) => {
        if (busyId) return;
        const ok = await customConfirm(a.is_default
            ? t('حذف عنوانك الافتراضي؟ سيُرقّى أحدث عنوان بعده تلقائياً — وإن لم يبقَ عنوان لن تستطيع اختيار «التوصيل».',
                'Delete your default address? The newest remaining one is promoted automatically — with none left you cannot choose delivery.')
            : t('حذف هذا العنوان؟', 'Delete this address?'));
        if (!ok) return;

        setBusyId(a.id);
        try {
            const { data, error } = await supabase
                .from('user_addresses').delete().eq('id', a.id).select('id');
            if (error) throw error;
            // حذفٌ ترفضه RLS يعود `error = null` وصفر صفوف — نفحص العدد لا الخطأ.
            // وصفر صفوف يعني أن قائمتنا متأخّرة عن القاعدة، فنُحدّثها قبل الرسالة
            // وإلا بقي الصفّ الشبح معروضاً ويعيد المشتري المحاولة بلا نتيجة.
            if (!data || data.length === 0) {
                await load();
                customAlert(t('⚠️ لم يُحذف أي عنوان — يبدو أنه حُذف من جهاز آخر. حدّثنا القائمة.',
                              '⚠️ Nothing was deleted — it seems it is already gone. The list has been refreshed.'));
                return;
            }

            // ما بعد الحذف خطوةٌ ثانية قد تفشل وحدها — والحذف نفسه قد **نجح**.
            // لذلك نجمع تحذيرها ولا نرميها: رميُها كان يتخطّى `load()` فتبقى
            // البطاقة المحذوفة معروضة، ويظنّ المشتري أن الحذف لم يقع.
            let warn = '';
            if (a.is_default) {
                const rest = list.filter(x => x.id !== a.id).slice().sort(newestFirst);
                if (rest.length > 0) {
                    // لا مشغّل يعمل عند الحذف، فبلا ترقية صريحة يبقى المشتري بعناوين
                    // بلا افتراضي — والمرآة التي يقرؤها البوتان تتبع الافتراضي.
                    const { data: promoted, error: e2 } = await supabase
                        .from('user_addresses').update({ is_default: true }).eq('id', rest[0].id).select('id');
                    // ترقيةٌ ترفضها RLS تعود `error = null` بصفر صفوف — نفحص العدد.
                    if (e2 || !promoted || promoted.length === 0) {
                        warn = t('⚠️ حُذف العنوان، لكن تعذّر ترقية بديلٍ افتراضياً — اختر واحداً بزرّ «اجعله الافتراضي».',
                                 '⚠️ Address deleted, but promoting a replacement default failed — pick one with “Make default”.');
                    }
                } else {
                    // آخر عنوان: لا صفّ يُرقّى ⇒ لا مشغّل يمسح `users.delivery_address`.
                    // نمسحها صراحةً هنا وحدها، وإلا بقي «التوصيل» ظاهراً بعنوانٍ محذوف.
                    try {
                        await updateProfile({ deliveryAddress: null });
                    } catch {
                        warn = t('⚠️ حُذف العنوان، لكن تعذّر تحديث ملفك — أعد تحميل الصفحة قبل الحجز بالتوصيل.',
                                 '⚠️ Address deleted, but your profile could not be updated — reload before booking delivery.');
                    }
                }
            }
            await load();
            customAlert(warn || t('🗑️ تم حذف العنوان.', '🗑️ Address deleted.'));
        } catch (e: any) {
            customAlert(addrErrorText(e));
        } finally {
            setBusyId(null);
        }
    };

    const inputStyle: React.CSSProperties = {
        width: '100%', padding: '12px 14px', borderRadius: 12,
        border: '1.5px solid var(--border-color)', background: 'var(--body-bg)',
        color: 'var(--text-primary)', fontSize: '0.9rem', fontWeight: 700,
        outline: 'none', fontFamily: 'inherit',
    };
    const btn = (bg: string, fg: string): React.CSSProperties => ({
        padding: '12px 18px', borderRadius: 14, border: 'none', background: bg, color: fg,
        fontWeight: 900, fontSize: '0.9rem', cursor: 'pointer',
    });
    const smallBtn: React.CSSProperties = {
        padding: '7px 12px', borderRadius: 10, fontSize: '0.78rem', fontWeight: 800,
        border: '1.5px solid var(--border-color)', background: 'var(--card-bg)',
        color: 'var(--text-primary)', cursor: 'pointer',
    };

    const atCap = list.length >= MAX_ADDRESSES;
    const showEditor = editing !== null;
    const accuracyPoor = accuracy !== null && accuracy > ACCURACY_WARN_M;

    return (
        <div
            ref={rootRef}
            id="delivery-address"
            style={{
                background: 'var(--card-bg)',
                border: highlight ? '2px solid var(--primary)' : '1px solid var(--border-color)',
                padding: 20, borderRadius: 20,
                boxShadow: highlight ? '0 0 0 4px var(--primary-glow)' : 'none',
                transition: 'box-shadow .3s ease, border-color .3s ease',
                // مساحة تحت الشريط العلوي حين نُمرّر الصفحة إلى البطاقة.
                scrollMarginTop: 90,
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 900, margin: 0, color: 'var(--text-primary)' }}>
                    🚚 {t('عناوين التوصيل', 'Delivery addresses')}
                    {list.length > 0 && (
                        <span style={{ fontSize: '0.78rem', fontWeight: 800, color: 'var(--text-secondary)', marginInlineStart: 8 }}>
                            {list.length}/{MAX_ADDRESSES}
                        </span>
                    )}
                </h3>
                {!showEditor && (
                    <button
                        type="button"
                        onClick={() => {
                            if (atCap) {
                                customAlert(t(`❌ الحد الأقصى ${MAX_ADDRESSES} عناوين — احذف عنواناً قبل إضافة آخر.`,
                                              `❌ Maximum of ${MAX_ADDRESSES} addresses — delete one before adding another.`));
                                return;
                            }
                            openEditor(null);
                        }}
                        style={{ ...btn('var(--primary)', '#fff'), padding: '8px 14px', fontSize: '0.82rem', opacity: atCap ? 0.55 : 1 }}
                    >
                        ➕ {t('إضافة عنوان', 'Add address')}
                    </button>
                )}
            </div>
            <p style={{ fontSize: '0.82rem', opacity: 0.7, margin: '0 0 14px', lineHeight: 1.6, color: 'var(--text-secondary)' }}>
                {t('احفظ عناوينك (المنزل، العمل…) واختر الافتراضي — عليه يُقاس نطاق التاجر، ويُشارَك مع تاجر الطلب وحده عند الحجز.',
                   'Save your addresses (home, work…) and pick a default — it decides which stores reach you, and is shared only with that order’s merchant.')}
            </p>

            {/* القائمة */}
            {!showEditor && (
                loading ? (
                    <div style={{ background: 'var(--body-bg)', border: '1px solid var(--border-color)', borderRadius: 14, padding: 16, color: 'var(--text-secondary)', fontWeight: 700, fontSize: '0.85rem', textAlign: 'center' }}>
                        {t('⏳ جاري تحميل عناوينك…', '⏳ Loading your addresses…')}
                    </div>
                ) : loadError ? (
                    <div style={{ background: 'var(--body-bg)', border: '1px solid var(--danger)', borderRadius: 14, padding: 14, textAlign: 'center' }}>
                        <div style={{ color: 'var(--danger)', fontWeight: 800, fontSize: '0.85rem', marginBottom: 8 }}>
                            {t('تعذّر تحميل العناوين.', 'Could not load your addresses.')}
                        </div>
                        <button type="button" onClick={() => { setLoading(true); void load(); }} style={smallBtn}>
                            🔄 {t('إعادة المحاولة', 'Retry')}
                        </button>
                    </div>
                ) : list.length === 0 ? (
                    <div style={{ background: 'var(--body-bg)', border: '1px dashed var(--border-color)', borderRadius: 14, padding: '14px', textAlign: 'center', color: 'var(--text-secondary)', fontWeight: 700, fontSize: '0.85rem' }}>
                        {t('لا يوجد عنوان محفوظ بعد.', 'No saved address yet.')}
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {list.map(a => (
                            <div key={a.id}
                                style={{
                                    background: 'var(--body-bg)',
                                    border: a.is_default ? '1.5px solid var(--primary)' : '1px solid var(--border-color)',
                                    borderRadius: 14, padding: '12px 14px', opacity: busyId === a.id ? 0.6 : 1,
                                }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                    <span style={{ fontWeight: 900, fontSize: '0.92rem', color: 'var(--text-primary)' }}>
                                        📍 {a.label || t('عنواني', 'My address')}
                                    </span>
                                    {a.is_default && (
                                        <span style={{ background: 'var(--primary)', color: '#fff', borderRadius: 999, padding: '3px 10px', fontSize: '0.7rem', fontWeight: 900 }}>
                                            ⭐ {t('الافتراضي', 'Default')}
                                        </span>
                                    )}
                                </div>
                                {(a.details || a.city) && (
                                    <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', fontWeight: 700, marginTop: 4, lineHeight: 1.6 }}>
                                        {a.details || ''}{a.details && a.city ? ' — ' : ''}{a.city || ''}
                                    </div>
                                )}
                                {a.phone && (
                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 700, marginTop: 4, direction: 'ltr', textAlign: isRTL ? 'right' : 'left' }}>
                                        📞 {a.phone}
                                    </div>
                                )}
                                {a.lat !== null && a.lng !== null ? (
                                    <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 700, marginTop: 6, direction: 'ltr', textAlign: isRTL ? 'right' : 'left', opacity: 0.75 }}>
                                        {a.lat.toFixed(5)}, {a.lng.toFixed(5)}
                                    </div>
                                ) : (
                                    // صفٌّ بلا إحداثيّ سليم لا يصلح للتوصيل — نقولها بدل أن نطبع «0.00000».
                                    <div style={{ fontSize: '0.74rem', color: 'var(--danger)', fontWeight: 800, marginTop: 6, lineHeight: 1.6 }}>
                                        {t('⚠️ بلا موقع على الخريطة — عدّله وحدّد النقطة ليصلح للتوصيل.',
                                           '⚠️ No map point — edit it and drop the pin so delivery can use it.')}
                                    </div>
                                )}
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                                    {!a.is_default && (
                                        <button type="button" onClick={() => makeDefault(a)} disabled={!!busyId}
                                            style={{ ...smallBtn, borderColor: 'var(--primary)', color: 'var(--primary)' }}>
                                            ⭐ {t('اجعله الافتراضي', 'Make default')}
                                        </button>
                                    )}
                                    <button type="button" onClick={() => openEditor(a)} disabled={!!busyId} style={smallBtn}>
                                        ✏️ {t('تعديل', 'Edit')}
                                    </button>
                                    <button type="button" onClick={() => remove(a)} disabled={!!busyId}
                                        style={{ ...smallBtn, background: 'rgba(239,68,68,0.12)', color: 'var(--danger)', border: '1px solid rgba(239,68,68,0.3)' }}>
                                        🗑️ {t('حذف', 'Delete')}
                                    </button>
                                </div>
                            </div>
                        ))}
                        {!defaultAddr && (
                            <div style={{ fontSize: '0.78rem', color: 'var(--danger)', fontWeight: 800, lineHeight: 1.6 }}>
                                {t('⚠️ لا يوجد عنوان افتراضي — اختر واحداً ليعمل التوصيل.',
                                   '⚠️ No default address — pick one to enable delivery.')}
                            </div>
                        )}
                    </div>
                )
            )}

            {/* المحرّر (إضافة/تعديل) */}
            {showEditor && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 900, color: 'var(--text-primary)' }}>
                        {editing ? t('تعديل العنوان', 'Edit address') : t('عنوان جديد', 'New address')}
                    </div>
                    <div style={{ height: 260, borderRadius: 14, overflow: 'hidden', border: '1px solid var(--border-color)', position: 'relative' }}>
                        <MapContainer center={center} zoom={point ? 16 : 13} attributionControl={false} style={{ height: '100%', width: '100%' }}>
                            <TileLayer
                                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                                subdomains="abc"
                                detectRetina={true}
                                maxZoom={19}
                                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                            />
                            <PinController point={point} focusSeq={focusSeq} focusZoom={focusZoom} onPick={pick} />
                            {/* دائرة الدقّة: تُظهر للمستخدم كم هامش خطأ جهازه فعلاً،
                                فلا يظنّ الدبّوس خاطئاً وهو داخل هامش الجهاز. */}
                            {point && Number.isFinite(point.lat) && Number.isFinite(point.lng)
                              && accuracy !== null && accuracy > 0 && Number.isFinite(accuracy) && (
                                <Circle
                                    center={[point.lat, point.lng]}
                                    radius={Math.min(accuracy, 2000)}
                                    pathOptions={{ color: '#0d9488', weight: 1, fillColor: '#0d9488', fillOpacity: 0.12 }}
                                />
                            )}
                            {point && Number.isFinite(point.lat) && Number.isFinite(point.lng) && (
                                <Marker position={[point.lat, point.lng]} icon={pinIcon} />
                            )}
                        </MapContainer>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        <button type="button" onClick={useMyLocation} disabled={locating}
                            style={{ ...btn('var(--body-bg)', 'var(--text-primary)'), border: '1.5px solid var(--border-color)', padding: '10px 14px', fontSize: '0.84rem', opacity: locating ? 0.6 : 1 }}>
                            {locating ? t('⏳ جاري تحديد موقعك…', '⏳ Locating…') : `📍 ${t('موقعي الحالي', 'My current location')}`}
                        </button>
                        <span style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', fontWeight: 700 }}>
                            {point
                                ? t('اضغط على الخريطة لتحريك الدبّوس', 'Tap the map to move the pin')
                                : t('اضغط على الخريطة لتحديد موقعك', 'Tap the map to set your location')}
                        </span>
                    </div>
                    {accuracy !== null && (
                        <div style={{
                            fontSize: '0.76rem', fontWeight: 800, lineHeight: 1.6, borderRadius: 12, padding: '10px 12px',
                            border: `1px solid ${accuracyPoor ? 'rgba(245,158,11,0.45)' : 'var(--border-color)'}`,
                            background: accuracyPoor ? 'rgba(245,158,11,0.12)' : 'var(--body-bg)',
                            color: accuracyPoor ? 'var(--text-primary)' : 'var(--text-secondary)',
                        }}>
                            {accuracyPoor
                                ? t(`⚠️ الدقّة تقريبية (±${Math.round(accuracy)} متر) — كبّر الخريطة وحرّك الدبّوس لضبطه على بابك.`,
                                    `⚠️ Approximate accuracy (±${Math.round(accuracy)} m) — zoom in and drag the pin onto your door.`)
                                : t(`✅ دقّة جيدة (±${Math.round(accuracy)} متر) — تأكّد أن الدبّوس على بابك تماماً.`,
                                    `✅ Good accuracy (±${Math.round(accuracy)} m) — make sure the pin sits on your door.`)}
                        </div>
                    )}

                    <div>
                        <div style={{ fontSize: '0.82rem', fontWeight: 800, color: 'var(--text-secondary)', marginBottom: 6 }}>{t('الوسم', 'Label')}</div>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {LABELS.map(l => {
                                const val = isRTL ? l.ar : l.en;
                                const picked = label.trim() === val;
                                return (
                                    <button key={l.id} type="button" onClick={() => setLabel(val)}
                                        style={{
                                            padding: '8px 14px', borderRadius: 999, cursor: 'pointer', fontWeight: 800, fontSize: '0.82rem',
                                            border: picked ? '1.5px solid var(--primary)' : '1.5px solid var(--border-color)',
                                            background: picked ? 'var(--notif-unread-bg)' : 'var(--body-bg)',
                                            color: 'var(--text-primary)',
                                        }}>
                                        {l.emoji} {val}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <input
                        value={label}
                        onChange={e => setLabel(e.target.value.slice(0, 60))}
                        placeholder={t('وسم العنوان (مثال: بيت أمي)', 'Address label (e.g. Mum’s place)')}
                        style={inputStyle}
                    />
                    <textarea
                        value={details}
                        onChange={e => setDetails(e.target.value.slice(0, 300))}
                        placeholder={t('تفاصيل العنوان: الحي، الشارع، رقم المبنى، الدور، علامة مميزة…', 'Address details: district, street, building, floor, landmark…')}
                        style={{ ...inputStyle, minHeight: 78, resize: 'none' }}
                    />
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <input
                            value={city}
                            onChange={e => setCity(e.target.value.slice(0, 60))}
                            placeholder={t('المدينة', 'City')}
                            style={{ ...inputStyle, flex: '1 1 130px' }}
                        />
                        <input
                            value={phone}
                            // تطبيع الأرقام العربية فوراً: من يكتب «٠٥» يجب أن يرى «05».
                            onChange={e => setPhone(normalizeArabicNumerals(e.target.value).replace(/[^\d+]/g, '').slice(0, 20))}
                            inputMode="tel"
                            placeholder={t('جوال للتوصيل', 'Delivery phone')}
                            style={{ ...inputStyle, flex: '1 1 130px', direction: 'ltr', textAlign: isRTL ? 'right' : 'left' }}
                        />
                    </div>
                    <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', fontWeight: 700, lineHeight: 1.6 }}>
                        {t('التفاصيل والجوال اختياريان — لكنهما ما يستعمله التاجر ليصل إليك، فالأفضل كتابتهما.',
                           'Details and phone are optional — but they are what the merchant uses to reach you.')}
                    </div>

                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        <button type="button" onClick={save} disabled={saving} style={{ ...btn('var(--primary)', '#fff'), flex: '1 1 140px', opacity: saving ? 0.65 : 1 }}>
                            {saving ? t('⏳ جاري الحفظ…', '⏳ Saving…') : t('حفظ العنوان ✅', 'Save address ✅')}
                        </button>
                        <button type="button" onClick={closeEditor} disabled={saving}
                            style={{ ...btn('var(--body-bg)', 'var(--text-primary)'), border: '1.5px solid var(--border-color)', flex: '0 1 110px' }}>
                            {t('إلغاء', 'Cancel')}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default BuyerAddressCard;
