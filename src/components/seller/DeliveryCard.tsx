/**
 * DeliveryCard — «🚚 خدمة التوصيل» في لوحة التاجر (v14.08)
 *
 * طلب ناصر حرفياً (v14.06): «إضافة خدمة توصيل للمتاجر التي تريد التوصيل …
 * وتحديد بالكيلو أو باليد في الخريطة … وطريقة الاستلام بالدفع عند الاستلام
 * أو بطاقة فقط».
 *
 * وبلاغاه في v14.08 — وهما ما أعاد تشكيل هذه البطاقة:
 *  (١) «عند وجود للتاجر أكثر من عنوان اجعله يحدد التوصيل لكل عنوان على حده،
 *      على أن يظهر حول موقع المتجر … لا يصح أن يضع عنوانين في مدينتين
 *      ويُحجز من المدينة الأخرى لعنوان المدينة الثانية».
 *  (٢) «نقطة التحديد لا تجعلني أحدد الزوايا، وإنما يرسم مستطيلاً على كيفه —
 *      أريد أنا أتحكّم في طول المستطيل وعرضه، والدائرة كذلك … وأيضاً لا
 *      أستطيع أن ألفّ الخريطة وأوزن المستطيل أو الدائرة أو الأضلاع».
 *
 * ── القرار المعماري: النطاق هندسة لا نصّ ──────────────────────────────────
 * «هل يصل هذا المتجر إلى عنوان المشتري؟» سؤالٌ يُقاس بالإحداثيات لا بأسماء
 * الأحياء (اسم الحيّ يختلف كتابةً ويتقاطع بين المدن). لذلك التاجر يرسم نطاقه
 * بنفسه — دائرة بنصف قطر بالكيلومتر، أو مستطيلاً، أو مضلّعاً — والقاعدة تحسم
 * الأمر بدالة `delivery_quote` واحدة يستعملها الموقع والبوتان وحارس الحجز.
 *
 * ── ولماذا صار لكل نطاق «فرع»؟ ────────────────────────────────────────────
 * لأن النطاق بلا فرع يعني «كل فروعي»، وهذا يجعل متجراً في الرياض والدمام
 * يوصّل من فرع الرياض إلى حيٍّ في الدمام. `delivery_quote` تأخذ الآن معرّف
 * الفرع رابعاً وتقيس نطاقات ذلك الفرع وحده، فمهمّة هذه البطاقة أن تُلزم
 * التاجر باختيار الفرع **قبل** الرسم، وأن تُظهر الخريطة حول ذلك الفرع
 * ليرسم حوله لا في مدينة أخرى.
 *
 * ── ولماذا الأشكال تُعدَّل بعد رسمها؟ ──────────────────────────────────────
 * «نقرتان ⇒ شكل ثابت» تُجبر التاجر على إصابة الركن من أول محاولة، وهو أمر
 * متعذّر بالإصبع على شاشة جوال. فصار الشكل بعد إنشائه **قابلاً للتعديل**:
 * مقابض تُسحب لتغيير الطول والعرض ونصف القطر، ومقبض دوران يلفّ الشكل بأي
 * زاوية، وحقول رقمية لمن يفضّل الرقم على السحب.
 *
 * 🪤 الدوران لا يصحّ بجمع الدرجات مباشرةً: درجة الطول ≈ ١١١ كم عند خط
 * الاستواء و≈ ١٠٢ كم عند ٢٤° شمالاً (السعودية). فلو دوّرنا (lat,lng) كما هي
 * خرج المستطيل مائل الأضلاع مشوّه النسب. لذلك كل دوران يمرّ بمستوٍ محلّي
 * بالأمتار (تصحيح cos(lat)) ثم يعود.
 *
 * 🪤 المستطيل المُدار لم يعد محاذياً للمحاور، فيُحفظ `kind:'polygon'` بأربع
 * نقاط (القاعدة تقبل ٣–٨٠)، ويبقى `kind:'rect'` للمستطيل غير المُدار وحده
 * توافقاً مع النطاقات القديمة.
 *
 * ⚠️ Leaflet: `map.flyTo` يرمي «Invalid LatLng (NaN, NaN)» خارج شجرة React حين
 * لا مقاس للحاوية، فيسقط التطبيق كله عبر ErrorBoundary — نستعمل `setView`
 * داخل try/catch، وكل إحداثي يُفحص بـ`Number.isFinite` قبل تمريره للخريطة.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Circle, Polygon, Polyline, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import { supabase } from '../../services/supabaseClient';
import { useApp } from '../../context/AppContext';
import NumericField from '../NumericField';
import { getCurrentPositionSafe, geoErrorMessage } from '../../utils/helpers';

type ZoneKind = 'circle' | 'rect' | 'polygon';

interface Zone {
    id: string;
    name: string | null;
    kind: ZoneKind;
    /** `null` = كل الفروع (نطاقات ما قبل v14.08). */
    branch_id: string | null;
    center_lat: number | null;
    center_lng: number | null;
    radius_km: number | null;
    points: number[][] | null;
    fee: number | null;
    is_active: boolean;
}

interface Settings {
    delivery_enabled: boolean;
    delivery_payment: 'cod' | 'card' | 'both';
    delivery_fee: number;
    delivery_min_order: number;
    delivery_eta_min: number | null;
    delivery_note: string | null;
}

/** موقع يملكه التاجر: الموقع الأساسي (`primary`) أو فرع من `store_branches`. */
interface BranchOpt {
    id: string;
    nameAr: string;
    nameEn: string | null;
    lat: number | null;
    lng: number | null;
}

interface Props {
    userId: string;
    isRTL: boolean;
    onAlert: (msg: string) => void;
}

/** المعرّف المتّفق عليه مع القاعدة للموقع الأساسي للمتجر. */
const PRIMARY = 'primary';

/**
 * رسائل أخطاء القاعدة — التاجر يقرأ جملة لا رمزاً.
 * وباللغتين: التاجر الذي يستعمل الواجهة الإنجليزية كان يُفاجأ برسالة عربية.
 */
const ERRORS: Array<[string, string, string]> = [
    ['AUTH_REQUIRED', 'انتهت جلستك — أعد تسجيل الدخول', 'Your session expired — sign in again'],
    ['SELLER_ONLY', 'خدمة التوصيل لحسابات المتاجر فقط', 'Delivery is for store accounts only'],
    ['BAD_MODE', 'طريقة دفع غير معروفة', 'Unknown payment mode'],
    ['BAD_FEE', 'رسوم التوصيل يجب أن تكون بين ٠ و١٠٠٠ ريال', 'The delivery fee must be between 0 and 1000 SAR'],
    ['BAD_MIN', 'الحد الأدنى للطلب غير منطقي', 'The minimum order value is not valid'],
    ['BAD_ETA', 'مدة التوصيل يجب أن تكون بين ٠ و١٤٤٠ دقيقة', 'Delivery time must be between 0 and 1440 minutes'],
    ['GATEWAY_REQUIRED',
        'اختيار «بطاقة» يتطلّب تفعيل بوابة الدفع أولاً من بطاقة «💳 بوابة الدفع» أعلاه — وإلا لن يستطيع المشتري الدفع',
        'Choosing “Card” requires an active payment gateway (the “💳 Payment gateway” card above) — otherwise buyers cannot pay'],
    ['TAKI_ZONE_CAP:10',
        'وصلت الحد الأقصى: ١٠ نطاقات فعّالة لمتجرك كله (لا لكل فرع). عطّل نطاقاً أو احذفه قبل إضافة غيره',
        'Limit reached: 10 active zones for the whole store (not per branch). Disable or delete one first'],
    ['TAKI_ZONE_BAD:not_store', 'هذه الخاصية لحسابات المتاجر فقط', 'This feature is for store accounts only'],
    ['TAKI_ZONE_BAD:branch', 'الفرع المختار لا يخصّ متجرك — أعد اختيار الفرع', 'That branch does not belong to your store — pick it again'],
    ['TAKI_ZONE_BAD:circle', 'مركز الدائرة أو نصف قطرها غير صالح (نصف القطر بين ٠.٢ و٢٠٠ كم)', 'Invalid circle centre or radius (radius 0.2–200 km)'],
    // ⚠️ الترتيب مقصود: `points_count` قبل `points` لأن الفحص بـ`includes`
    // فلو سبقت الأعمّ لابتلعت الأخصّ وظهرت رسالة خاطئة.
    ['TAKI_ZONE_BAD:points_count', 'المستطيل يحتاج ركنين بالضبط، والمضلّع من ٣ إلى ٨٠ نقطة', 'A rectangle needs exactly 2 corners, a polygon 3 to 80 points'],
    ['TAKI_ZONE_BAD:points', 'شكل النطاق غير صالح — أعد الرسم', 'The zone shape is invalid — draw it again'],
    ['TAKI_ZONE_BAD:point', 'إحدى النقاط خارج الحدود الجغرافية الصالحة', 'One of the points is outside valid geographic bounds'],
    ['TAKI_ZONE_BAD:fee', 'رسوم النطاق يجب أن تكون بين ٠ و١٠٠٠ ريال', 'The zone fee must be between 0 and 1000 SAR'],
];
const errMsg = (e: unknown, isRTL: boolean): string => {
    const raw = String((e as { message?: string })?.message || e || '');
    for (const [key, ar, en] of ERRORS) if (raw.includes(key)) return isRTL ? ar : en;
    return raw || (isRTL ? 'خطأ غير معروف' : 'Unknown error');
};

const MODES: Array<{ id: 'cod' | 'card' | 'both'; ar: string; en: string; hintAr: string; hintEn: string }> = [
    { id: 'cod', ar: '💵 الدفع عند الاستلام فقط', en: '💵 Cash on delivery only', hintAr: 'يستلم مندوبك المبلغ عند الباب', hintEn: 'Your courier collects at the door' },
    { id: 'card', ar: '💳 بطاقة فقط (مسبقاً)', en: '💳 Card only (prepaid)', hintAr: 'يجب تفعيل بوابة الدفع — المشتري يسدّد قبل الخروج للتوصيل', hintEn: 'Requires an active gateway — the buyer pays before dispatch' },
    { id: 'both', ar: '🔀 الاثنان معاً', en: '🔀 Both', hintAr: 'المشتري يختار في ورقة الحجز', hintEn: 'The buyer chooses at checkout' },
];

const KINDS: Array<{ id: ZoneKind; ar: string; en: string; icon: string }> = [
    { id: 'circle', ar: 'دائرة', en: 'Circle', icon: '⭕' },
    { id: 'rect', ar: 'مستطيل', en: 'Rectangle', icon: '▭' },
    { id: 'polygon', ar: 'مضلّع', en: 'Polygon', icon: '⬡' },
];

/** ألوان دلالية بدرجتين — الوضع الليلي يحتاج درجة أفتح لتبقى مقروءة. */
const TONES = {
    amber: { light: '#b45309', dark: '#fcd34d' },
    teal: { light: '#0d9488', dark: '#5eead4' },
    sky: { light: '#0369a1', dark: '#7dd3fc' },
} as const;

const DEFAULT_CENTER: [number, number] = [24.7136, 46.6753];
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
/** ⚠️ `Number(null) === 0` — فرعٌ بلا إحداثيات يصير دبّوساً في خليج غينيا. */
const numOrNull = (v: unknown): number | null =>
    (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) && Number.isFinite(Number(v)) ? Number(v) : null;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round = (n: number, d: number) => Number(n.toFixed(d));
/** اسم الفرع يدخل HTML الأيقونة — يُهرَّب دائماً مهما كان مصدره. */
const esc = (s: string) => s.replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[ch]);

// ── هندسة محلّية: متر ⇄ درجات ───────────────────────────────────────────────
// كل دوران يمرّ من هنا: نحوّل إلى مستوٍ بالأمتار حول نقطة مرجعية مع تصحيح
// cos(lat) لتقارب خطوط الطول، ندوّر، ثم نعود. بدون التصحيح يخرج الشكل مائلاً
// مشوّهاً كلما ابتعدنا عن خط الاستواء — والسعودية عند ~٢٤° شمالاً.
interface LL { lat: number; lng: number }
const M_PER_DEG_LAT = 111320;
const cosLat = (lat: number) => Math.max(Math.cos((lat * Math.PI) / 180), 1e-6);
const toXY = (p: LL, ref: LL) => ({
    x: (p.lng - ref.lng) * M_PER_DEG_LAT * cosLat(ref.lat),
    y: (p.lat - ref.lat) * M_PER_DEG_LAT,
});
const toLL = (x: number, y: number, ref: LL): LL => ({
    lat: ref.lat + y / M_PER_DEG_LAT,
    lng: ref.lng + x / (M_PER_DEG_LAT * cosLat(ref.lat)),
});
/** موجب = مع عقارب الساعة على الشاشة (المحور y نحو الشمال). */
const rotXY = (x: number, y: number, deg: number) => {
    const a = (deg * Math.PI) / 180;
    const s = Math.sin(a);
    const c = Math.cos(a);
    return { x: x * c + y * s, y: -x * s + y * c };
};
const rotateAbout = (p: LL, pivot: LL, deg: number): LL => {
    const { x, y } = toXY(p, pivot);
    const r = rotXY(x, y, deg);
    return toLL(r.x, r.y, pivot);
};
const centroid = (ps: LL[]): LL => ({
    lat: ps.reduce((s, p) => s + p.lat, 0) / ps.length,
    lng: ps.reduce((s, p) => s + p.lng, 0) / ps.length,
});
const distM = (a: LL, b: LL) => { const { x, y } = toXY(b, a); return Math.hypot(x, y); };
/** الزاوية من الشمال مع عقارب الساعة (٠–٣٥٩) — نفس اصطلاح `rotXY`. */
const bearingDeg = (from: LL, to: LL) => {
    const { x, y } = toXY(to, from);
    return (((Math.atan2(x, y) * 180) / Math.PI) + 360) % 360;
};
const norm360 = (d: number) => ((d % 360) + 360) % 360;

/** مستطيل مُعرَّف بمركزه وأبعاده بالأمتار — لا بركنين، ليصحّ تدويره وتحجيمه. */
interface RectShape { c: LL; w: number; h: number }
const rectCorners = (r: RectShape, deg: number): LL[] =>
    ([[-r.w / 2, -r.h / 2], [r.w / 2, -r.h / 2], [r.w / 2, r.h / 2], [-r.w / 2, r.h / 2]] as Array<[number, number]>)
        .map(([x, y]) => { const q = rotXY(x, y, deg); return toLL(q.x, q.y, r.c); });

const MIN_SIDE_M = 30;   // أصغر ضلع معقول — يمنع مستطيلاً بلا مساحة
const MAX_SIDE_M = 200000;

/**
 * لقطة كاملة لحالة المحرّر.
 *
 * «إلغاء التعديل يعيد الحالة كما كانت» وعدٌ لا يُوفى بمسح الرسم: التاجر قد يكون
 * في منتصف رسم نطاق **جديد** حين يضغط «تعديل» على نطاق قديم، فلو مسحنا مسوّدته
 * ضاع عمله بلا أن يطلب. لذلك ندخل وضع التعديل بلقطة، ونعيدها حرفياً عند الخروج
 * منه — إلغاءً كان أو حفظاً.
 */
interface Draft {
    kind: ZoneKind;
    branchId: string | null;
    zoneName: string;
    zoneFee: number | undefined;
    center: LL | null;
    radiusKm: number | undefined;
    radDeg: number;
    rect: RectShape | null;
    seed: LL | null;
    wKm: number | undefined;
    hKm: number | undefined;
    poly: LL[];
    polyClosed: boolean;
    rot: number;
}

/** ألوان الطبقات على الخريطة — لكل معنى لون واحد لا يتكرّر. */
const C_SAVED_MINE = '#0d9488';   // نطاقات الفرع المختار — بارزة
const C_SAVED_OTHER = '#64748b';  // نطاقات فروع أخرى — للسياق فقط
const C_MUTED = '#94a3b8';        // موقوف · أو «الشكل قبل التعديل»
const C_DRAFT_NEW = '#f59e0b';    // مسوّدة نطاق جديد
const C_DRAFT_EDIT = '#e11d48';   // نطاق قيد التعديل — اللون الثالث الواضح

// ── أيقونات ────────────────────────────────────────────────────────────────
/**
 * 🪤 الفخّ الذي كاد يُفقِد الميزة كلها: أيقونةٌ تُبنى داخل الرسم تعني كائناً
 * **جديداً** في كل تمريرة، و`react-leaflet` يقارن بالمرجع لا بالمحتوى
 * (`props.icon !== prevProps.icon → marker.setIcon`)، و`setIcon` في Leaflet
 * يمرّ بـ`_initIcon → _initInteraction` فيُعطّل `dragging` الحالي ويستبدله
 * بـ`MarkerDrag` جديد. وبما أن كل إطار سحبٍ يُحدِّث الحالة فيُعيد الرسم، فإن
 * السحّابة التي تتابع الإصبع تُقتل بعد أول حركة: النقطة تتزحزح مرة ثم تتجمّد.
 * لذلك كل أيقونة متغيّرة تُخزَّن بمفتاحها فتبقى بنفس المرجع ما لم يتغيّر شكلها.
 * (المقابض الثابتة أدناه معرّفة على مستوى الوحدة أصلاً فلا يمسّها هذا.)
 */
const ICONS = new Map<string, L.DivIcon>();
const cachedIcon = (key: string, make: () => L.DivIcon): L.DivIcon => {
    const hit = ICONS.get(key);
    if (hit) return hit;
    const made = make();
    ICONS.set(key, made);
    return made;
};

const vertexIcon = (n: number) => cachedIcon(`v:${n}`, () => L.divIcon({
    className: '',
    html: `<div style="width:22px;height:22px;border-radius:50%;
        background:linear-gradient(135deg,#f59e0b,#d97706);
        color:#fff;font-weight:900;font-size:11px;display:flex;align-items:center;justify-content:center;
        border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.4)">${n}</div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
}));
const squareIcon = L.divIcon({
    className: '',
    html: `<div style="width:18px;height:18px;border-radius:4px;background:#f59e0b;
        border:2.5px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.45)"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
});
const glyphIcon = (glyph: string, bg: string) => L.divIcon({
    className: '',
    html: `<div style="width:28px;height:28px;border-radius:50%;background:${bg};color:#fff;
        display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:900;
        border:2.5px solid #fff;box-shadow:0 2px 7px rgba(0,0,0,0.45)">${glyph}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
});
const moveIcon = glyphIcon('✥', 'linear-gradient(135deg,#f59e0b,#d97706)');
const rotateIcon = glyphIcon('⟳', 'linear-gradient(135deg,#7c3aed,#5b21b6)');
const radiusIcon = glyphIcon('↔', 'linear-gradient(135deg,#f59e0b,#d97706)');
const storeIcon = (label: string, active: boolean) => cachedIcon(`s:${active ? 1 : 0}:${label}`, () => L.divIcon({
    className: '',
    html: `<div style="display:flex;flex-direction:column;align-items:center">
        <div style="width:${active ? 32 : 22}px;height:${active ? 32 : 22}px;border-radius:50%;
            background:${active ? 'linear-gradient(135deg,#0ea5e9,#0369a1)' : '#94a3b8'};
            display:flex;align-items:center;justify-content:center;font-size:${active ? 16 : 11}px;
            border:2.5px solid #fff;box-shadow:0 3px 9px rgba(0,0,0,0.45)">🏬</div>
        ${active && label ? `<div style="margin-top:3px;background:rgba(3,105,161,0.94);color:#fff;
            font-size:9px;font-weight:900;padding:2px 6px;border-radius:6px;white-space:nowrap;
            max-width:130px;overflow:hidden;text-overflow:ellipsis">${esc(label)}</div>` : ''}
    </div>`,
    iconSize: [active ? 32 : 22, active ? 32 : 22],
    iconAnchor: [active ? 16 : 11, active ? 16 : 11],
}));

/**
 * طلب تركيز: نقطة دائماً، وحدودٌ اختيارية.
 * «أرني التحديد السابق» لا يُشبعه توسيطٌ على نقطة — المضلّع قد يخرج كله عن
 * الشاشة عند تقريب خاطئ. فحين تتوفّر حدود نؤطّرها، والنقطة تبقى خطة بديلة.
 */
interface FocusReq {
    lat: number;
    lng: number;
    seq: number;
    bounds?: Array<[number, number]>;
}

/** قائد الخريطة: النقر يضيف نقطة، والتركيز يُعاد عند الطلب (عدّاد لا شرط منطقي). */
const DrawController: React.FC<{
    onTap: (lat: number, lng: number) => void;
    focus: FocusReq | null;
}> = ({ onTap, focus }) => {
    const map = useMap();
    useEffect(() => {
        const h = (e: any) => {
            const { lat, lng } = e?.latlng || {};
            if (finite(lat) && finite(lng)) onTap(lat, lng);
        };
        map.on('click', h);
        const t = setTimeout(() => { try { map.invalidateSize(); } catch { /* لا شيء */ } }, 0);
        return () => { map.off('click', h); clearTimeout(t); };
    }, [map, onTap]);
    useEffect(() => {
        if (!focus || !finite(focus.lat) || !finite(focus.lng)) return;
        try {
            // ⚠️ `fitBounds` على حاوية بلا مقاس يرمي — نُقاسها أولاً، وكل فشل
            // يسقط إلى `setView` البسيط بدل أن يُسقط الصفحة عبر ErrorBoundary.
            map.invalidateSize();
            const b = focus.bounds;
            if (b && b.length >= 2) {
                // `maxZoom` يمنع تقريباً خانقاً على نطاق صغير جداً (٢٠٠ متر).
                map.fitBounds(L.latLngBounds(b.map(p => L.latLng(p[0], p[1]))), {
                    padding: [26, 26], maxZoom: 16, animate: true, duration: 0.6,
                });
                return;
            }
            map.setView([focus.lat, focus.lng], Math.max(map.getZoom() || 13, 13), { animate: true, duration: 0.6 });
        } catch {
            try { map.setView([focus.lat, focus.lng], 13, { animate: false }); } catch { /* لا تُسقط الصفحة */ }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [map, focus?.seq]);
    return null;
};

/**
 * مقبض يُسحب على الخريطة.
 *
 * ⚠️ بدون تعطيل `map.dragging` أثناء السحب تزحلق الخريطةُ تحت الإصبع على
 * الجوال فيصير كل تعديل معركة: المقبض يتحرك والخلفية تتحرك معه.
 */
const Handle: React.FC<{
    pos: LL;
    icon: L.DivIcon;
    onMove: (p: LL) => void;
    title?: string;
}> = ({ pos, icon, onMove, title }) => {
    const map = useMap();
    // ⚠️ لو اختفى المقبض أثناء السحب (تبديل الشكل · «مسح الرسم» · تراجع) فلن
    // يقع `dragend` أبداً، فتبقى الخريطة مشلولة لا تُسحب حتى تُغلق البطاقة
    // وتُفتح. نتذكّر أننا نحن من عطّلها، ونعيدها عند التفكيك.
    const heldRef = useRef(false);
    useEffect(() => () => {
        if (heldRef.current) { try { map.dragging.enable(); } catch { /* لا شيء */ } }
    }, [map]);
    const grab = (e: any) => {
        const ll = e?.target?.getLatLng?.();
        if (ll && finite(ll.lat) && finite(ll.lng)) onMove({ lat: ll.lat, lng: ll.lng });
    };
    return (
        <Marker
            position={[pos.lat, pos.lng]}
            icon={icon}
            draggable
            title={title}
            eventHandlers={{
                dragstart: () => { heldRef.current = true; try { map.dragging.disable(); } catch { /* لا شيء */ } },
                drag: grab,
                dragend: (e: any) => { heldRef.current = false; try { map.dragging.enable(); } catch { /* لا شيء */ } grab(e); },
            }}
        />
    );
};

const DeliveryCard: React.FC<Props> = ({ userId, isRTL, onAlert }) => {
    const t = useCallback((ar: string, en: string) => (isRTL ? ar : en), [isRTL]);
    const { darkMode } = useApp();
    const tone = useCallback((k: keyof typeof TONES) => (darkMode ? TONES[k].dark : TONES[k].light), [darkMode]);

    const [open, setOpen] = useState(false);
    const [loaded, setLoaded] = useState(false);
    /** فشلت قراءة الإعدادات ⇒ الحقول أمامك افتراضية لا حقيقية، فالحفظ ممنوع. */
    const [loadErr, setLoadErr] = useState(false);
    const [saving, setSaving] = useState(false);
    const [zonesBusy, setZonesBusy] = useState(false);

    const [enabled, setEnabled] = useState(false);
    const [payment, setPayment] = useState<'cod' | 'card' | 'both'>('cod');
    const [fee, setFee] = useState<number | undefined>(0);
    const [minOrder, setMinOrder] = useState<number | undefined>(0);
    const [eta, setEta] = useState<number | undefined>(undefined);
    const [note, setNote] = useState('');

    const [zones, setZones] = useState<Zone[]>([]);
    const [branches, setBranches] = useState<BranchOpt[]>([]);
    const [branchId, setBranchId] = useState<string | null>(null);

    const [kind, setKind] = useState<ZoneKind>('circle');
    const [zoneName, setZoneName] = useState('');
    const [zoneFee, setZoneFee] = useState<number | undefined>(undefined);

    // ── مسوّدة الشكل ──────────────────────────────────────────────────────
    const [center, setCenter] = useState<LL | null>(null);            // مركز الدائرة
    const [radiusKm, setRadiusKm] = useState<number | undefined>(3);
    const [radDeg, setRadDeg] = useState(90);                          // اتجاه مقبض نصف القطر
    const [rect, setRect] = useState<RectShape | null>(null);
    const [seed, setSeed] = useState<LL | null>(null);                 // أول ركن قبل اكتمال المستطيل
    const [wKm, setWKm] = useState<number | undefined>(undefined);     // مخزن الحقل الرقمي للعرض
    const [hKm, setHKm] = useState<number | undefined>(undefined);
    const [poly, setPoly] = useState<LL[]>([]);
    const [polyClosed, setPolyClosed] = useState(false);
    const [rot, setRot] = useState(0);                                 // درجات، مع عقارب الساعة

    /** `null` = وضع الإضافة · وإلا معرّف النطاق الجاري تعديله. */
    const [editingId, setEditingId] = useState<string | null>(null);
    /** الصفّ الأصلي — لنعرف عند الحفظ هل كان للنطاق فرعٌ يجب أن يبقى له. */
    const editOrigRef = useRef<Zone | null>(null);
    /** حالة المحرّر قبل الدخول في التعديل — تُعاد كما هي عند الخروج. */
    const preEditRef = useRef<Draft | null>(null);

    const [focus, setFocus] = useState<FocusReq | null>(null);
    const [locating, setLocating] = useState(false);
    const seqRef = useRef(0);
    /** حاوية الخريطة — «عرض» و«تعديل» يُنادَيان من قائمة تحت الشاشة. */
    const mapBoxRef = useRef<HTMLDivElement | null>(null);

    const goTo = useCallback((p: LL) => {
        if (!finite(p.lat) || !finite(p.lng)) return;
        seqRef.current += 1;
        setFocus({ lat: p.lat, lng: p.lng, seq: seqRef.current });
    }, []);

    /** تأطير الخريطة على مجموعة نقاط (بديل `goTo` حين يكون للشكل امتداد). */
    const fitTo = useCallback((pts: Array<[number, number]>) => {
        const ok = pts.filter(p => finite(p[0]) && finite(p[1]));
        if (!ok.length) return;
        if (ok.length === 1) { goTo({ lat: ok[0][0], lng: ok[0][1] }); return; }
        seqRef.current += 1;
        setFocus({ lat: ok[0][0], lng: ok[0][1], seq: seqRef.current, bounds: ok });
    }, [goTo]);

    /**
     * الخريطة أعلى الصفحة والقائمة أسفلها؛ فزرٌّ «يطيّر الخريطة» وهي خارج
     * الشاشة يبدو للتاجر زرّاً لا يفعل شيئاً. لذلك نُحضر الخريطة إليه.
     */
    const revealMap = useCallback(() => {
        const el = mapBoxRef.current;
        if (!el) return;
        try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
        catch { try { el.scrollIntoView(); } catch { /* لا شيء */ } }
    }, []);

    const clearDraft = useCallback(() => {
        setCenter(null); setRadiusKm(3); setRadDeg(90);
        setRect(null); setSeed(null); setWKm(undefined); setHKm(undefined);
        setPoly([]); setPolyClosed(false); setRot(0);
    }, []);

    const hydrate = useCallback((s: Settings | null) => {
        setEnabled(!!s?.delivery_enabled);
        setPayment((s?.delivery_payment as any) || 'cod');
        setFee(Number(s?.delivery_fee ?? 0));
        setMinOrder(Number(s?.delivery_min_order ?? 0));
        setEta(s?.delivery_eta_min == null ? undefined : Number(s.delivery_eta_min));
        setNote(s?.delivery_note || '');
    }, []);

    const loadZones = useCallback(async () => {
        const { data, error } = await supabase
            .from('store_delivery_zones')
            .select('id,name,kind,branch_id,center_lat,center_lng,radius_km,points,fee,is_active')
            .eq('store_id', userId)
            .order('created_at', { ascending: true });
        if (error) { onAlert(`❌ ${t('تعذّر تحميل النطاقات', 'Could not load zones')}: ${error.message}`); return; }
        setZones((data || []) as Zone[]);
    }, [userId, onAlert, t]);

    /** مواقع المتجر = الموقع الأساسي (من `users`) + فروعه المسجّلة. */
    const loadBranches = useCallback(async (): Promise<BranchOpt[]> => {
        const [me, br] = await Promise.all([
            supabase.from('users').select('lat,lng').eq('id', userId).maybeSingle(),
            supabase.from('store_branches')
                .select('id,name_ar,name_en,map_lat,map_lng')
                .eq('merchant_id', userId)
                .order('created_at', { ascending: true }),
        ]);
        if (br.error) onAlert(`❌ ${t('تعذّر تحميل الفروع', 'Could not load branches')}: ${br.error.message}`);
        // فشل قراءة الموقع الأساسي يعني دبّوساً غائباً ورسماً في غير محلّه —
        // يُقال صراحةً لا يُبتلع.
        if (me.error) onAlert(`❌ ${t('تعذّر تحميل موقع المتجر الأساسي', 'Could not load the main store location')}: ${me.error.message}`);
        const list: BranchOpt[] = [{
            id: PRIMARY,
            nameAr: 'الموقع الأساسي للمتجر',
            nameEn: 'Main store location',
            lat: numOrNull((me.data as any)?.lat),
            lng: numOrNull((me.data as any)?.lng),
        }];
        (br.data || []).forEach((b: any) => list.push({
            id: String(b.id),
            nameAr: String(b.name_ar || 'فرع'),
            nameEn: b.name_en ? String(b.name_en) : null,
            lat: numOrNull(b.map_lat),
            lng: numOrNull(b.map_lng),
        }));
        setBranches(list);
        // موقع واحد ⇒ لا معنى لسؤاله: نربط النطاق به تلقائياً كما طلب ناصر.
        setBranchId(prev => (prev ?? (list.length === 1 ? PRIMARY : null)));
        return list;
    }, [userId, onAlert, t]);

    const load = useCallback(async () => {
        const { data, error } = await supabase
            .from('store_profiles')
            .select('delivery_enabled,delivery_payment,delivery_fee,delivery_min_order,delivery_eta_min,delivery_note')
            .eq('store_id', userId)
            .maybeSingle();
        // ⚠️ قراءةٌ فاشلة تُبقي الحقول على قيمها الافتراضية (موقوفة · نقداً · ٠)،
        // فلو ضغط التاجر «حفظ» بعدها كتب هذه الأصفار فوق إعداداته الحقيقية.
        // لذلك الفشل يُعلَن ولا يُترك صامتاً.
        if (error) {
            setLoadErr(true);
            onAlert(`❌ ${t('تعذّر تحميل إعدادات التوصيل', 'Could not load delivery settings')}: ${error.message}`);
        } else {
            setLoadErr(false);
            hydrate((data as Settings) || null);
        }
        const list = await loadBranches();
        await loadZones();
        setLoaded(true);
        const only = list.length === 1 ? list[0] : null;
        if (only && finite(only.lat) && finite(only.lng)) goTo({ lat: only.lat as number, lng: only.lng as number });
    }, [userId, hydrate, loadBranches, loadZones, goTo, onAlert, t]);

    useEffect(() => { if (open && !loaded) load(); }, [open, loaded, load]);

    /** إعادة محاولة بعد فشل القراءة — بلا إغلاق البطاقة وفتحها. */
    const retryLoad = useCallback(() => { setLoaded(false); }, []);

    const save = async () => {
        if (saving || loadErr) return;
        setSaving(true);
        try {
            const { data, error } = await supabase.rpc('merchant_set_delivery', {
                p_enabled: enabled,
                p_payment: payment,
                p_fee: Number(fee || 0),
                p_min_order: Number(minOrder || 0),
                p_eta_min: eta == null ? null : Number(eta),
                p_note: note.trim() || null,
            });
            if (error) throw error;
            hydrate(data as Settings);
            onAlert(enabled
                ? t('✅ تم حفظ إعدادات التوصيل. التوصيل يظهر للمشتري **فقط** إذا كان عنوانه داخل نطاق رسمته لفرعه.',
                    '✅ Delivery settings saved. Delivery appears to a buyer ONLY if their address falls inside a zone drawn for that branch.')
                : t('⏸ خدمة التوصيل موقوفة — كل الطلبات استلام من المتجر.',
                    '⏸ Delivery is off — all orders are store pickup.'));
        } catch (e) {
            onAlert(`❌ ${errMsg(e, isRTL)}`);
        } finally {
            setSaving(false);
        }
    };

    // ── الفروع ────────────────────────────────────────────────────────────
    const brName = useCallback((b: BranchOpt) => (isRTL ? b.nameAr : (b.nameEn || b.nameAr)), [isRTL]);
    const branchById = useCallback(
        (id: string | null) => (id ? branches.find(b => b.id === id) || null : null),
        [branches]);
    const pickedBranch = branchById(branchId);
    const branchPoint: LL | null = pickedBranch && finite(pickedBranch.lat) && finite(pickedBranch.lng)
        ? { lat: pickedBranch.lat as number, lng: pickedBranch.lng as number }
        : null;

    const pickBranch = (id: string) => {
        const b = branchById(id);
        const go = () => { if (b && finite(b.lat) && finite(b.lng)) goTo({ lat: b.lat as number, lng: b.lng as number }); };
        // إعادة الضغط على الفرع نفسه = «أرني الفرع»، لا «امسح ما رسمت».
        if (id === branchId) { go(); return; }
        setBranchId(id);
        // في وضع التعديل تغييرُ الفرع يعني «انقل هذا النطاق لفرع آخر» — والشكل
        // هو المقصود بالنقل، فمسحه هنا يفقد ما جاء التاجر لتعديله.
        if (!editingId) clearDraft();
        go();
    };

    // ── الرسم ─────────────────────────────────────────────────────────────
    const onTap = useCallback((lat: number, lng: number) => {
        // لا رسم قبل اختيار الفرع — إلا في تعديل نطاق قديم بلا فرع («كل الفروع»)،
        // فذاك نطاق قائم لا يُنشأ من جديد.
        if (!branchId && !editingId) return;
        const p: LL = { lat, lng };
        if (kind === 'circle') { setCenter(p); return; }
        if (kind === 'rect') {
            if (rect) return;                // المستطيل موجود — التعديل بالمقابض لا بالنقر
            if (!seed) { setSeed(p); return; }
            const d = toXY(p, seed);
            const next: RectShape = {
                c: { lat: (seed.lat + p.lat) / 2, lng: (seed.lng + p.lng) / 2 },
                w: clamp(Math.abs(d.x), MIN_SIDE_M, MAX_SIDE_M),
                h: clamp(Math.abs(d.y), MIN_SIDE_M, MAX_SIDE_M),
            };
            setRect(next); setSeed(null); setRot(0);
            setWKm(round(next.w / 1000, 3)); setHKm(round(next.h / 1000, 3));
            return;
        }
        if (polyClosed) return;
        // سقف القاعدة ٨٠ نقطة. تجاهل النقرة صامتاً يجعل التاجر يظن الخريطة
        // معطّلة، فيُقال له السبب مرّة واحدة عند بلوغ السقف.
        setPoly(prev => {
            if (prev.length >= 80) {
                onAlert(`⚠️ ${t('بلغتَ الحد الأقصى: ٨٠ نقطة للمضلّع. احذف نقطة أو أغلق الشكل.',
                                 'Maximum reached: 80 polygon points. Remove one or close the shape.')}`);
                return prev;
            }
            return [...prev, p];
        });
    }, [branchId, editingId, kind, rect, seed, polyClosed, onAlert, t]);

    /** الدوران: غير متلف للمستطيل (يُطبَّق عند الرسم)، ومطبَّق فوراً على المضلّع. */
    const applyRot = useCallback((deg: number) => {
        const nd = norm360(deg);
        if (kind === 'polygon') {
            setPoly(prev => {
                if (prev.length < 3) return prev;
                const pivot = centroid(prev);
                const d = nd - rot;
                return prev.map(p => rotateAbout(p, pivot, d));
            });
        }
        setRot(nd);
    }, [kind, rot]);

    const onRectCorner = useCallback((i: number, p: LL) => {
        if (!rect) return;
        // الركن المقابل يبقى مثبَّتاً تماماً كما في محرّرات التصميم: نُعيد
        // النقطة المسحوبة إلى الإطار غير المُدار حول ذلك الركن، فنقرأ العرض
        // والارتفاع مباشرةً ثم نحسب المركز الجديد. بهذا لا «يقفز» الشكل.
        const cs = rectCorners(rect, rot);
        const anchor = cs[(i + 2) % 4];
        const d = toXY(p, anchor);
        const loc = rotXY(d.x, d.y, -rot);
        const w = clamp(Math.abs(loc.x), MIN_SIDE_M, MAX_SIDE_M);
        const h = clamp(Math.abs(loc.y), MIN_SIDE_M, MAX_SIDE_M);
        const sx = loc.x >= 0 ? 1 : -1;
        const sy = loc.y >= 0 ? 1 : -1;
        const half = rotXY((sx * w) / 2, (sy * h) / 2, rot);
        const next: RectShape = { c: toLL(half.x, half.y, anchor), w, h };
        setRect(next);
        setWKm(round(w / 1000, 3)); setHKm(round(h / 1000, 3));
    }, [rect, rot]);

    const onPolyVertex = useCallback((i: number, p: LL) => {
        setPoly(prev => prev.map((q, j) => (j === i ? p : q)));
    }, []);

    const movePoly = useCallback((p: LL) => {
        setPoly(prev => {
            if (!prev.length) return prev;
            const c = centroid(prev);
            const dLat = p.lat - c.lat;
            const dLng = p.lng - c.lng;
            return prev.map(q => ({ lat: q.lat + dLat, lng: q.lng + dLng }));
        });
    }, []);

    const setRadiusFromHandle = useCallback((p: LL) => {
        if (!center) return;
        setRadiusKm(round(clamp(distM(center, p) / 1000, 0.2, 200), 3));
        setRadDeg(bearingDeg(center, p));   // يبقى المقبض تحت الإصبع بلا قفزة
    }, [center]);

    const undo = () => {
        if (kind === 'circle') { setCenter(null); return; }
        if (kind === 'rect') {
            if (seed) { setSeed(null); return; }
            setRect(null); setRot(0); setWKm(undefined); setHKm(undefined);
            return;
        }
        if (polyClosed) { setPolyClosed(false); return; }
        setPoly(prev => prev.slice(0, -1));
    };

    const useMyLocation = async () => {
        if (locating) return;
        setLocating(true);
        try {
            const { lat, lng } = await getCurrentPositionSafe();
            goTo({ lat, lng });
            if (kind === 'circle' && (branchId || editingId)) setCenter({ lat, lng });
        } catch (e) {
            onAlert(geoErrorMessage(e, isRTL));
        } finally {
            setLocating(false);
        }
    };

    // ── مشتقّات الشكل ─────────────────────────────────────────────────────
    const corners = useMemo(() => (rect ? rectCorners(rect, rot) : []), [rect, rot]);
    const rectRotHandle = useMemo<LL | null>(() => {
        if (!rect) return null;
        const d = rect.h / 2 + Math.max(90, rect.h * 0.18);
        const q = rotXY(0, d, rot);
        return toLL(q.x, q.y, rect.c);
    }, [rect, rot]);
    const polyCentroid = useMemo<LL | null>(() => (poly.length >= 3 ? centroid(poly) : null), [poly]);
    const polyRotHandle = useMemo<LL | null>(() => {
        if (!polyCentroid) return null;
        const r = Math.max(...poly.map(p => distM(polyCentroid, p)), 100);
        const q = rotXY(0, r + Math.max(90, r * 0.2), rot);
        return toLL(q.x, q.y, polyCentroid);
    }, [poly, polyCentroid, rot]);
    const circleHandle = useMemo<LL | null>(() => {
        if (!center || !finite(radiusKm as number)) return null;
        const q = rotXY(0, (radiusKm as number) * 1000, radDeg);
        return toLL(q.x, q.y, center);
    }, [center, radiusKm, radDeg]);

    const radiusOk = finite(radiusKm as number) && (radiusKm as number) >= 0.2 && (radiusKm as number) <= 200;
    const drawReady = kind === 'circle'
        ? !!center && radiusOk
        : kind === 'rect'
            ? !!rect && rect.w >= MIN_SIDE_M && rect.h >= MIN_SIDE_M
            : poly.length >= 3;

    /** مركز الشكل الجاري رسمه — لتنبيه «رسمت بعيداً عن الفرع». */
    const draftCenter: LL | null = kind === 'circle' ? center
        : kind === 'rect' ? (rect ? rect.c : null)
            : polyCentroid;
    const farFromBranch = !!(branchPoint && draftCenter && distM(branchPoint, draftCenter) > 60000);

    /**
     * ⚠️ `Number(null) === 0` و`Number('') === 0` — نقطةٌ ناقصة في صفٍّ قديم كانت
     * تمرّ هكذا إحداثياً صالحاً عند (٠،٠)، فتُرسم في خليج غينيا وتُؤطَّر الخريطة
     * عليها. `numOrNull` يرفض الفارغ صراحةً بدل أن يترجمه صفراً.
     */
    const zonePts = (z: Zone): Array<[number, number]> =>
        (Array.isArray(z.points) ? z.points : [])
            .map(p => [numOrNull(p?.[0]), numOrNull(p?.[1])] as [number | null, number | null])
            .filter((p): p is [number, number] => p[0] != null && p[1] != null);

    /** الركنان المحيطان بالنطاق — للتأطير عليه («أرني التحديد السابق»). */
    const zoneBounds = (z: Zone): Array<[number, number]> => {
        if (z.kind === 'circle') {
            if (!finite(z.center_lat) || !finite(z.center_lng) || !finite(z.radius_km)) return [];
            const c: LL = { lat: z.center_lat as number, lng: z.center_lng as number };
            const r = (z.radius_km as number) * 1000;
            const sw = toLL(-r, -r, c);
            const ne = toLL(r, r, c);
            return [[sw.lat, sw.lng], [ne.lat, ne.lng]];
        }
        return zonePts(z);
    };

    /** الخروج من وضع التعديل بإعادة حالة المحرّر كما كانت قبل الدخول إليه. */
    const leaveEdit = () => {
        const s = preEditRef.current;
        preEditRef.current = null;
        editOrigRef.current = null;
        setEditingId(null);
        if (!s) { clearDraft(); setZoneName(''); setZoneFee(undefined); return; }
        setKind(s.kind); setBranchId(s.branchId); setZoneName(s.zoneName); setZoneFee(s.zoneFee);
        setCenter(s.center); setRadiusKm(s.radiusKm); setRadDeg(s.radDeg);
        setRect(s.rect); setSeed(s.seed); setWKm(s.wKm); setHKm(s.hKm);
        setPoly(s.poly); setPolyClosed(s.polyClosed); setRot(s.rot);
    };

    /**
     * فتح نطاق محفوظ داخل المحرّر نفسه بمقابضه.
     *
     * 🪤 المستطيل المُدار محفوظ `kind:'polygon'` بأربع نقاط (لا سبيل غيره: عمود
     * `points` بركنين لا يحمل زاوية)، فيُفتح مضلّعاً بأربعة رؤوس — والنتيجة على
     * الأرض واحدة، والدوران يعمل عليه كما يعمل على أي مضلّع.
     */
    const startEdit = (z: Zone) => {
        if (zonesBusy) return;
        const pts = zonePts(z);
        // نقطةٌ تالفة في صفٍّ قديم تُسقَط عند القراءة — فلو فتحناه للتعديل صار
        // «الحفظ» كتابةً لشكلٍ أنقص من المحفوظ بلا أن يرى التاجر ما ضاع. نرفض
        // بدل أن نُغيّر شكلاً لم يطلب أحدٌ تغييره.
        const rawPts = Array.isArray(z.points) ? z.points.length : 0;
        if (z.kind !== 'circle' && pts.length !== rawPts) {
            onAlert(`❌ ${t('في هذا النطاق نقطة تالفة — احذفه وارسمه من جديد بدل تعديله.',
                            'This zone has a corrupt point — delete it and draw a new one instead of editing.')}`);
            return;
        }
        const asPoly = (list: Array<[number, number]>) => list.map(p => ({ lat: p[0], lng: p[1] }));

        if (z.kind === 'circle' && finite(z.center_lat) && finite(z.center_lng) && finite(z.radius_km)) {
            setKind('circle');
            setCenter({ lat: z.center_lat as number, lng: z.center_lng as number });
            setRadiusKm(round(clamp(z.radius_km as number, 0.2, 200), 3));
            setRadDeg(90);
            setRect(null); setSeed(null); setWKm(undefined); setHKm(undefined);
            setPoly([]); setPolyClosed(false); setRot(0);
        } else if (z.kind === 'rect' && pts.length === 2) {
            // ركنان محاذيان للمحاور ⇒ نعيد بناء المركز والأبعاد بالأمتار ليصحّ
            // سحبُ الأركان وتدويرها كأنّه رُسم للتوّ.
            const a: LL = { lat: pts[0][0], lng: pts[0][1] };
            const b: LL = { lat: pts[1][0], lng: pts[1][1] };
            const d = toXY(b, a);
            const w = clamp(Math.abs(d.x), MIN_SIDE_M, MAX_SIDE_M);
            const h = clamp(Math.abs(d.y), MIN_SIDE_M, MAX_SIDE_M);
            setKind('rect');
            setRect({ c: { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 }, w, h });
            setWKm(round(w / 1000, 3)); setHKm(round(h / 1000, 3));
            setRot(0); setSeed(null); setCenter(null); setPoly([]); setPolyClosed(false);
        } else if (pts.length >= 3) {
            setKind('polygon');
            setPoly(asPoly(pts));
            setPolyClosed(true);   // شكلٌ مكتمل: يُعدَّل بالمقابض لا بإضافة نقاط
            setRot(0);
            setCenter(null); setRect(null); setSeed(null); setWKm(undefined); setHKm(undefined);
        } else {
            onAlert(`❌ ${t('شكل هذا النطاق غير صالح للعرض — احذفه وارسمه من جديد.',
                            'This zone’s shape is invalid — delete it and draw a new one.')}`);
            return;
        }

        // فرعٌ حُذف يرفضه حارس القاعدة، فلا نُدخله في المحرّر أصلاً: نُفرغ
        // الاختيار (أو نضعه على الموقع الأساسي لمتجرٍ بموقع واحد) ونقولها.
        const known = !!z.branch_id && branches.some(b => b.id === z.branch_id);
        const nextBranch = z.branch_id == null ? null
            : known ? z.branch_id : (branches.length === 1 ? PRIMARY : null);
        setBranchId(nextBranch);
        if (z.branch_id && !known) {
            // الرسالة تصف ما حدث فعلاً: في متجرٍ بموقع واحد اخترنا له الموقع
            // الأساسي، وفي متجرٍ بفروع تُرك الاختيار فارغاً ليقرّر التاجر.
            onAlert(nextBranch
                ? `⚠️ ${t('فرع هذا النطاق لم يعد موجوداً — رُبط بالموقع الأساسي للمتجر، وسيُحفظ عليه.',
                          'This zone’s branch no longer exists — it has been tied to the main store location and will be saved there.')}`
                : `⚠️ ${t('فرع هذا النطاق لم يعد موجوداً — اختر فرعاً قائماً قبل حفظ التعديل.',
                          'This zone’s branch no longer exists — pick an existing branch before saving.')}`);
        }

        setZoneName(z.name || '');
        setZoneFee(z.fee == null ? undefined : Number(z.fee));

        // اللقطة تُؤخذ هنا لا في أول الدالة: كل `set...` أعلاه يجدول تحديثاً ولا
        // يغيّر ثوابت هذه الدورة، فالقيم أدناه ما زالت قيم ما **قبل** التعديل —
        // وبتأخيرها إلى ما بعد كل مخارج الفشل لا نترك لقطةً معلّقة بلا تعديل.
        // وحين ننتقل من نطاق إلى آخر مباشرةً نُبقي أوّل لقطة: هي حالة التاجر
        // الحقيقية قبل أن يدخل التعديل أصلاً.
        if (!editingId) {
            preEditRef.current = {
                kind, branchId, zoneName, zoneFee,
                center, radiusKm, radDeg, rect, seed, wKm, hKm, poly, polyClosed, rot,
            };
        }
        editOrigRef.current = z;
        setEditingId(z.id);
        const b = zoneBounds(z);
        if (b.length) fitTo(b);
        revealMap();
    };

    /**
     * أعمدة الشكل كما تُكتب في القاعدة.
     *
     * ⚠️ كلها صريحة — بما فيها الفارغة. في التعديل قد ينتقل النطاق من دائرة إلى
     * مضلّع، فترك `center_lat/radius_km` كما هي يُبقي في الصفّ بقايا شكلٍ سابق
     * قد تُقرأ لاحقاً. `null` صريحة تُغلق هذا الباب.
     */
    const shapeCols = (): Record<string, unknown> | null => {
        const out: Record<string, unknown> = { kind, center_lat: null, center_lng: null, radius_km: null, points: null };
        if (kind === 'circle') {
            if (!center || !radiusOk) return null;
            out.center_lat = round(center.lat, 6);
            out.center_lng = round(center.lng, 6);
            out.radius_km = Number(radiusKm);
            return out;
        }
        if (kind === 'rect') {
            if (!rect) return null;
            // مستطيل مُدار ⇒ لم يعد محاذياً للمحاور فيُحفظ مضلّعاً بأربع
            // نقاط؛ وغير المُدار يبقى `rect` بركنين توافقاً مع القديم.
            const cs = rectCorners(rect, rot);
            if (norm360(rot) === 0) {
                out.points = [[round(cs[0].lat, 6), round(cs[0].lng, 6)], [round(cs[2].lat, 6), round(cs[2].lng, 6)]];
            } else {
                out.kind = 'polygon';
                out.points = cs.map(p => [round(p.lat, 6), round(p.lng, 6)]);
            }
            return out;
        }
        if (poly.length < 3) return null;
        out.points = poly.map(p => [round(p.lat, 6), round(p.lng, 6)]);
        return out;
    };

    const addZone = async () => {
        if (zonesBusy || !drawReady) return;
        if (!branchId) { onAlert(`❌ ${t('اختر الفرع أولاً', 'Pick a branch first')}`); return; }
        const shape = shapeCols();
        if (!shape) { onAlert(`❌ ${t('الشكل غير مكتمل — أعد الرسم', 'The shape is incomplete — draw it again')}`); return; }
        setZonesBusy(true);
        try {
            const row: Record<string, unknown> = {
                store_id: userId,
                branch_id: branchId,
                name: zoneName.trim().slice(0, 60) || null,
                fee: zoneFee == null ? null : Number(zoneFee),
                ...shape,
            };
            // ⚠️ إدراجٌ ترفضه RLS يعود بـ error=null وصفر صفوف — نفحص العدد
            // أيضاً، وإلا أعلنّا نجاحاً وهمياً (قاعدة «الأزرار الصامتة»).
            const { data, error } = await supabase.from('store_delivery_zones').insert(row).select('id');
            if (error) throw error;
            if (!data || data.length === 0) throw new Error(t('لم يُضَف النطاق (لا صلاحية)', 'Zone was not added (not allowed)'));
            clearDraft(); setZoneName(''); setZoneFee(undefined);
            await loadZones();
            onAlert(t(`✅ أُضيف النطاق لفرع «${pickedBranch ? brName(pickedBranch) : ''}». المشترون داخله وحدهم سيرون خيار التوصيل من هذا الفرع.`,
                      `✅ Zone added for “${pickedBranch ? brName(pickedBranch) : ''}”. Only buyers inside it will see delivery from this branch.`));
        } catch (e) {
            onAlert(`❌ ${errMsg(e, isRTL)}`);
        } finally {
            setZonesBusy(false);
        }
    };

    /**
     * حفظ التعديل: `UPDATE` على الصفّ نفسه — لا `INSERT`.
     *
     * ⚠️ ثلاثة أشياء لا تُلمس هنا عمداً: `id` و`store_id` و`is_active`. إغفال
     * `is_active` من الحمولة هو ما يجعل نطاقاً «موقوفاً» يبقى موقوفاً بعد
     * التعديل بدل أن يعود فعّالاً من تلقاء نفسه ويُفاجئ التاجر بطلبات لم يردها.
     * ولأننا لا نضيف صفّاً فسقف العشرة لا يُستهلك مرّةً ثانية.
     */
    const updateZone = async () => {
        if (zonesBusy || !editingId || !drawReady) return;
        const orig = editOrigRef.current;
        // نطاقٌ كان له فرع يجب أن يبقى له فرع قائم: حارس القاعدة يرفض معرّف فرع
        // محذوف بـ`TAKI_ZONE_BAD:branch`، فنقولها بالعربي قبل أن نُرسل.
        if (orig?.branch_id && !branchId) {
            onAlert(`❌ ${t('اختر فرعاً قائماً لهذا النطاق قبل الحفظ', 'Pick an existing branch for this zone before saving')}`);
            return;
        }
        if (branchId && !branches.some(b => b.id === branchId)) {
            onAlert(`❌ ${t('الفرع المختار لم يعد موجوداً — اختر فرعاً قائماً', 'The chosen branch no longer exists — pick an existing one')}`);
            return;
        }
        const shape = shapeCols();
        if (!shape) { onAlert(`❌ ${t('الشكل غير مكتمل — أعد الرسم', 'The shape is incomplete — draw it again')}`); return; }
        setZonesBusy(true);
        try {
            const patch: Record<string, unknown> = {
                branch_id: branchId,
                name: zoneName.trim().slice(0, 60) || null,
                fee: zoneFee == null ? null : Number(zoneFee),
                ...shape,
            };
            // ⚠️ تحديثٌ ترفضه RLS يعود بـ error=null وصفر صفوف — العدد هو الدليل
            // لا غياب الخطأ (قاعدة «الأزرار الصامتة»).
            const { data, error } = await supabase.from('store_delivery_zones')
                .update(patch).eq('id', editingId).select('id');
            if (error) throw error;
            if (!data || data.length === 0) throw new Error(t('لم يُحفظ التعديل (لا صلاحية)', 'The change was not saved (not allowed)'));
            leaveEdit();
            await loadZones();
            onAlert(t('✅ حُفظ تعديل النطاق. شكله الجديد هو المعتمد الآن لحساب التوصيل.',
                      '✅ Zone updated. Its new shape is what delivery is measured against from now on.'));
        } catch (e) {
            onAlert(`❌ ${errMsg(e, isRTL)}`);
        } finally {
            setZonesBusy(false);
        }
    };

    const toggleZone = async (z: Zone) => {
        if (zonesBusy) return;   // نقرتان سريعتان = طلبان متسابقان
        setZonesBusy(true);
        try {
            const { data, error } = await supabase.from('store_delivery_zones')
                .update({ is_active: !z.is_active }).eq('id', z.id).select('id');
            if (error) throw error;
            if (!data || data.length === 0) throw new Error(t('لم يُحدَّث النطاق (لا صلاحية)', 'Zone was not updated'));
            await loadZones();
        } catch (e) {
            onAlert(`❌ ${errMsg(e, isRTL)}`);
        } finally {
            setZonesBusy(false);
        }
    };

    const deleteZone = async (z: Zone) => {
        if (zonesBusy) return;   // نقرتان سريعتان = طلبان متسابقان
        setZonesBusy(true);
        try {
            const { data, error } = await supabase.from('store_delivery_zones').delete().eq('id', z.id).select('id');
            if (error) throw error;
            if (!data || data.length === 0) throw new Error(t('لم يُحذف النطاق (لا صلاحية)', 'Zone was not deleted'));
            // حذف الصفّ الذي نعدّله يترك المحرّر يشير إلى معرّف لا وجود له،
            // فيصير «حفظ التعديل» تحديثاً لصفر صفوف — نخرج من التعديل هنا.
            if (editingId === z.id) leaveEdit();
            await loadZones();
            onAlert(t('🗑️ حُذف النطاق.', '🗑️ Zone deleted.'));
        } catch (e) {
            onAlert(`❌ ${errMsg(e, isRTL)}`);
        } finally {
            setZonesBusy(false);
        }
    };

    /** تخصيص نطاق قديم (بلا فرع) بفرع بعينه — دعوة تصحيح لا حذف. */
    const assignBranch = async (z: Zone, id: string) => {
        if (zonesBusy) return;   // نقرتان سريعتان = طلبان متسابقان
        setZonesBusy(true);
        try {
            const { data, error } = await supabase.from('store_delivery_zones')
                .update({ branch_id: id }).eq('id', z.id).select('id');
            if (error) throw error;
            if (!data || data.length === 0) throw new Error(t('لم يُحدَّث النطاق (لا صلاحية)', 'Zone was not updated'));
            // النطاق نفسه مفتوح في المحرّر؟ لولا مزامنة الاختيار هنا لكتب «حفظ
            // التعديل» الفرعَ القديم فوق التخصيص الذي اختاره التاجر للتوّ.
            if (editingId === z.id) setBranchId(id);
            await loadZones();
            onAlert(t('✅ صار هذا النطاق خاصاً بالفرع المختار.', '✅ This zone is now tied to the chosen branch.'));
        } catch (e) {
            onAlert(`❌ ${errMsg(e, isRTL)}`);
        } finally {
            setZonesBusy(false);
        }
    };

    /** «أرني التحديد السابق»: تأطير الخريطة على النطاق كاملاً لا توسيطٌ على نقطة. */
    const focusZone = (z: Zone) => {
        const b = zoneBounds(z);
        if (!b.length) {
            onAlert(`⚠️ ${t('لا يمكن عرض هذا النطاق — شكله المحفوظ غير صالح.',
                            'This zone cannot be shown — its stored shape is invalid.')}`);
            return;
        }
        fitTo(b);
        revealMap();
    };

    const mapCenter = useMemo<[number, number]>(() => {
        if (branchPoint) return [branchPoint.lat, branchPoint.lng];
        const withGeo = branches.find(b => finite(b.lat) && finite(b.lng));
        if (withGeo) return [withGeo.lat as number, withGeo.lng as number];
        const z = zones.find(x => x.kind === 'circle' && finite(x.center_lat) && finite(x.center_lng));
        if (z) return [z.center_lat as number, z.center_lng as number];
        const q = zones.find(x => Array.isArray(x.points) && x.points.length);
        if (q) return [Number(q.points![0][0]), Number(q.points![0][1])];
        return DEFAULT_CENTER;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loaded]);   // مركز الإقلاع فقط — الحركة بعدها عبر `focus`

    const activeZones = zones.filter(z => z.is_active).length;

    /** فروع مفعّلة بلا نطاق ⇒ لن يظهر فيها التوصيل أصلاً. */
    const coversAll = zones.some(z => z.is_active && !z.branch_id);
    const uncovered = coversAll ? [] : branches.filter(b => !zones.some(z => z.is_active && z.branch_id === b.id));
    /** نطاقات فعّالة معلّقة بفروع محذوفة — تشغل من سقف العشرة ولا تخدم أحداً. */
    const deadZones = zones.filter(z => z.is_active && !!z.branch_id && !branches.some(b => b.id === z.branch_id)).length;

    /** تجميع النطاقات حسب الفرع — التاجر يقرأ «فرع كذا: نطاقان» لا قائمة مبعثرة. */
    const groups = useMemo(() => {
        const out: Array<{ key: string; label: string; legacy: boolean; orphan: boolean; list: Zone[] }> = [];
        const push = (key: string, label: string, legacy: boolean, orphan: boolean, z: Zone) => {
            const g = out.find(x => x.key === key);
            if (g) g.list.push(z); else out.push({ key, label, legacy, orphan, list: [z] });
        };
        zones.forEach(z => {
            if (!z.branch_id) { push('__all__', t('كل الفروع (نطاق قديم)', 'All branches (legacy zone)'), true, false, z); return; }
            const b = branches.find(x => x.id === z.branch_id);
            // نطاقٌ معلّق بفرعٍ حُذف لن يطابقه `delivery_quote` أبداً — فهو ميت
            // لا «قديم»، ويجب أن يُرى ويُصحَّح لا أن يُعدّ ضمن التغطية.
            push(z.branch_id, b ? brName(b) : t('فرع محذوف — نطاق معطّل عملياً', 'Removed branch — zone is effectively dead'), false, !b, z);
        });
        return out;
    }, [zones, branches, brName, t]);

    const inputStyle: React.CSSProperties = {
        width: '100%', padding: '11px 13px', borderRadius: 12,
        border: '1.5px solid var(--border-color)', background: 'var(--body-bg)',
        color: 'var(--text-primary)', fontSize: '0.88rem', fontWeight: 700, outline: 'none', fontFamily: 'inherit',
    };
    const btn = (bg: string, fg: string): React.CSSProperties => ({
        padding: '11px 16px', borderRadius: 13, border: 'none', background: bg, color: fg,
        fontWeight: 900, fontSize: '0.86rem', cursor: 'pointer',
    });
    const chip = (picked: boolean): React.CSSProperties => ({
        padding: '9px 14px', borderRadius: 999, cursor: 'pointer', fontWeight: 900, fontSize: '0.82rem',
        border: picked ? '1.5px solid var(--primary)' : '1.5px solid var(--border-color)',
        background: picked ? 'var(--notif-unread-bg)' : 'var(--body-bg)', color: 'var(--text-primary)',
        WebkitTapHighlightColor: 'transparent',
    });
    const sectionTitle: React.CSSProperties = { fontSize: '0.85rem', fontWeight: 900, color: 'var(--text-primary)', margin: '4px 0 8px' };
    const noteBox = (t0: keyof typeof TONES): React.CSSProperties => ({
        background: darkMode ? 'rgba(148,163,184,0.10)' : 'var(--body-bg)',
        border: '1px solid var(--border-color)', borderRadius: 12, padding: '9px 12px',
        fontSize: '0.8rem', fontWeight: 800, color: tone(t0), lineHeight: 1.65,
    });
    const stepLabel: React.CSSProperties = { fontSize: '0.78rem', fontWeight: 900, color: 'var(--text-secondary)', marginBottom: 6 };

    // تعديل نطاق قائم لا يحتاج «اختر فرعاً» — النطاق موجود أصلاً، وقد يكون
    // نطاقاً قديماً بلا فرع نريد للتاجر أن يعدّل شكله بلا أن نُجبره على تغيير
    // معناه («كل الفروع») في نفس اللحظة.
    const needBranch = branches.length > 1 && !branchId && !editingId;
    const editingZone = editingId ? zones.find(z => z.id === editingId) || null : null;
    /**
     * نطاقٌ كان مربوطاً بفرع (وحُذف ذلك الفرع) لا يُحفظ بلا فرع قائم — حارس
     * القاعدة يردّه بـ`TAKI_ZONE_BAD:branch`. نُطفئ الزر ونقول السبب بدل أن
     * ندع التاجر يضغط «حفظ» ثم يُصدم برسالة رفض.
     */
    const editBranchMissing = !!editingId && !!editingZone?.branch_id && !branchId;
    /** لون المسوّدة: كهرماني لنطاق جديد، وقرمزي لنطاق قيد التعديل. */
    const draftColor = editingId ? C_DRAFT_EDIT : C_DRAFT_NEW;
    const canSaveEdit = drawReady && !editBranchMissing;
    /**
     * القرمزي داخل البطاقة يحتاج درجتين: الغامق يختفي على خلفية ليلية، والفاتح
     * يذوب على نهارية. (أمّا القرمزي **على الخريطة** فيبقى درجة واحدة — بلاطات
     * الخريطة فاتحة دائماً مهما كان وضع التطبيق.)
     */
    const editFg = darkMode ? '#fda4af' : '#be123c';
    const editLine = darkMode ? '#fb7185' : C_DRAFT_EDIT;
    const editTint = darkMode ? 'rgba(251,113,133,0.18)' : 'rgba(225,29,72,0.10)';
    const editTintSoft = darkMode ? 'rgba(251,113,133,0.12)' : 'rgba(225,29,72,0.07)';

    /**
     * لماذا لا يعمل زر «إضافة النطاق»؟ زرٌّ رمادي بلا تفسير يجعل التاجر يظن
     * الصفحة معطّلة — فيُقال له الناقص بعينه.
     */
    // (اختيار الفرع مستثنى: نصّ الزر نفسه يقولها، فلا تُكرَّر ثلاث مرات.)
    const blockReason: string | null = zonesBusy || needBranch ? null
        : editBranchMissing
            ? t('اختر فرعاً قائماً لهذا النطاق قبل حفظ التعديل.', 'Pick an existing branch for this zone before saving.')
        : kind === 'circle'
                ? (!center ? t('حدّد مركز الدائرة بالضغط على الخريطة.', 'Set the circle centre by tapping the map.')
                    : !radiusOk ? t('نصف القطر يجب أن يكون بين ٠.٢ و٢٠٠ كم.', 'The radius must be between 0.2 and 200 km.') : null)
                : kind === 'rect'
                    ? (!rect ? t('أكمل المستطيل بنقطتين على الخريطة.', 'Finish the rectangle with two taps on the map.') : null)
                    : (poly.length < 3 ? t(`المضلّع يحتاج ٣ نقاط على الأقل (المحدّد: ${poly.length}).`, `A polygon needs at least 3 points (selected: ${poly.length}).`) : null);

    // سطر التعليمات: يتغيّر مع الفرع والنمط والخطوة، فلا يُترك التاجر يخمّن.
    const hint = needBranch
        ? t('١) اختر الفرع الذي ستوصّل منه — النطاق يُقاس بفرع الطلب لا بالمتجر كله.',
            '1) Pick the branch you will deliver from — zones are measured per branch.')
        : kind === 'circle'
            ? (!center
                ? t('اضغط على الخريطة لتحديد مركز الدائرة (الأفضل: موقع الفرع نفسه).',
                    'Tap the map to set the circle centre (ideally the branch itself).')
                : t('اسحب ✥ لتحريك المركز، واسحب ↔ لتكبير الدائرة أو صغّرها — أو اكتب نصف القطر بالأسفل.',
                    'Drag ✥ to move the centre and ↔ to resize — or type the radius below.'))
            : kind === 'rect'
                ? (!rect
                    ? (!seed
                        ? t('اضغط نقطة على الخريطة لبداية المستطيل.', 'Tap a point on the map to start the rectangle.')
                        : t('اضغط نقطة ثانية — ثم تستطيع تعديل الأضلاع والدوران كما تشاء.',
                            'Tap a second point — then you can resize and rotate freely.'))
                    : t('اسحب المربعات الأربعة لتغيير الطول والعرض، و⟳ لتدوير المستطيل، و✥ لتحريكه كله.',
                        'Drag the four squares to resize, ⟳ to rotate, ✥ to move the whole shape.'))
                : (!polyClosed
                    ? t(`اضغط نقاط المضلّع بالترتيب — ٣ نقاط على الأقل (المحدّد: ${poly.length}). ثم «إغلاق الشكل» لتعديله.`,
                        `Tap polygon points in order — at least 3 (selected: ${poly.length}). Then “Close shape” to edit it.`)
                    : t('اسحب أي نقطة لتعديل الشكل، و⟳ لتدويره، و✥ لتحريكه كله.',
                        'Drag any point to reshape, ⟳ to rotate, ✥ to move the whole shape.'));

    return (
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: 20, padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                    <h3 style={{ fontSize: '1rem', fontWeight: 900, margin: 0, color: 'var(--text-primary)' }}>
                        🚚 {t('خدمة التوصيل', 'Delivery service')}
                    </h3>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 700, marginTop: 4 }}>
                        {loaded
                            ? (enabled
                                ? t(`مفعّلة · ${activeZones} نطاق`, `On · ${activeZones} zone(s)`)
                                : t('موقوفة — كل الطلبات استلام من المتجر', 'Off — all orders are pickup'))
                            : t('وصّل طلباتك إلى عنوان المشتري داخل نطاق ترسمه لكل فرع', 'Deliver to buyers inside a zone you draw per branch')}
                    </div>
                </div>
                <button type="button" onClick={() => setOpen(o => !o)} style={{ ...btn('var(--body-bg)', 'var(--text-primary)'), border: '1.5px solid var(--border-color)', flexShrink: 0 }}>
                    {open ? t('إغلاق', 'Close') : t('إدارة', 'Manage')}
                </button>
            </div>

            {open && !loaded && (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)', fontWeight: 800, fontSize: '0.85rem' }}>
                    {t('⏳ جاري التحميل…', '⏳ Loading…')}
                </div>
            )}

            {open && loaded && (
                <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {/* ── التشغيل ── */}
                    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', background: 'var(--body-bg)', border: '1.5px solid var(--border-color)', borderRadius: 14, padding: '12px 14px' }}>
                        <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} style={{ width: 20, height: 20, accentColor: 'var(--primary)' }} />
                        <span style={{ fontWeight: 900, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                            {t('تشغيل خدمة التوصيل لمتجري', 'Enable delivery for my store')}
                        </span>
                    </label>

                    {loadErr && (
                        <div style={{ background: 'rgba(239,68,68,0.12)', border: '1.5px solid rgba(239,68,68,0.45)', borderRadius: 14, padding: '11px 13px', fontSize: '0.82rem', fontWeight: 800, color: 'var(--danger)', lineHeight: 1.7 }}>
                            ⚠️ {t('تعذّرت قراءة إعداداتك الحالية، فما تراه أمامك قيمٌ افتراضية لا إعداداتك. الحفظ موقوف حتى تنجح القراءة حتى لا تُكتب هذه القيم فوق إعداداتك.',
                                  'Your current settings could not be read, so what you see are defaults — not your settings. Saving is blocked until the read succeeds so these values cannot overwrite yours.')}
                            <button type="button" onClick={retryLoad}
                                style={{ ...btn('var(--card-bg)', 'var(--text-primary)'), border: '1px solid var(--border-color)', padding: '7px 12px', fontSize: '0.78rem', marginTop: 8 }}>
                                🔄 {t('إعادة المحاولة', 'Retry')}
                            </button>
                        </div>
                    )}

                    {!enabled && activeZones > 0 && (
                        <div style={{ background: 'rgba(245,158,11,0.14)', border: '1.5px solid rgba(245,158,11,0.6)', borderRadius: 14, padding: '11px 13px', fontSize: '0.82rem', fontWeight: 800, color: tone('amber'), lineHeight: 1.7 }}>
                            ⚠️ {t(`لديك ${activeZones} نطاقاً مرسوماً لكن خدمة التوصيل موقوفة — لن يظهر التوصيل لأحد حتى تُفعّلها بالأعلى وتحفظ.`,
                                  `You have ${activeZones} zone(s) drawn but delivery is off — nobody will see it until you enable it above and save.`)}
                        </div>
                    )}

                    {deadZones > 0 && (
                        <div style={{ background: 'rgba(245,158,11,0.14)', border: '1.5px solid rgba(245,158,11,0.6)', borderRadius: 14, padding: '11px 13px', fontSize: '0.82rem', fontWeight: 800, color: tone('amber'), lineHeight: 1.7 }}>
                            ⚠️ {t(`${deadZones} نطاقاً مرتبطاً بفرع محذوف — لا يخدم أحداً ويشغل من حدّ العشرة. صحّحه في القائمة بالأسفل.`,
                                  `${deadZones} zone(s) are tied to a deleted branch — they serve nobody and still count toward the limit of 10. Fix them in the list below.`)}
                        </div>
                    )}

                    {enabled && activeZones === 0 && (
                        <div style={{ background: 'rgba(245,158,11,0.14)', border: '1.5px solid rgba(245,158,11,0.6)', borderRadius: 14, padding: '11px 13px', fontSize: '0.82rem', fontWeight: 800, color: tone('amber'), lineHeight: 1.7 }}>
                            ⚠️ {t('الخدمة مفعّلة لكن لا نطاق مرسوم — لن يرى أي مشترٍ خيار التوصيل حتى ترسم نطاقاً واحداً على الأقل بالأسفل.',
                                  'Delivery is on but no zone is drawn — no buyer will see the delivery option until you draw at least one zone below.')}
                        </div>
                    )}

                    {enabled && activeZones > 0 && uncovered.length > 0 && (
                        <div style={{ background: 'rgba(245,158,11,0.14)', border: '1.5px solid rgba(245,158,11,0.6)', borderRadius: 14, padding: '11px 13px', fontSize: '0.82rem', fontWeight: 800, color: tone('amber'), lineHeight: 1.7 }}>
                            ⚠️ {t(`لن يظهر خيار التوصيل في: ${uncovered.map(brName).join(' · ')} — لا نطاق مرسوم لها.`,
                                  `Delivery will not appear for: ${uncovered.map(brName).join(' · ')} — no zone drawn for them.`)}
                        </div>
                    )}

                    {/* ── طريقة الدفع للتوصيل ── */}
                    <div>
                        <div style={sectionTitle}>{t('طريقة الدفع لطلبات التوصيل', 'Payment for delivery orders')}</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {MODES.map(mo => {
                                const picked = payment === mo.id;
                                return (
                                    <div key={mo.id} role="radio" aria-checked={picked} tabIndex={0}
                                        onClick={() => setPayment(mo.id)}
                                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPayment(mo.id); } }}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: 11, padding: '11px 13px', borderRadius: 13, cursor: 'pointer',
                                            border: picked ? '1.5px solid var(--primary)' : '1.5px solid var(--border-color)',
                                            background: picked ? 'var(--notif-unread-bg)' : 'var(--body-bg)',
                                            WebkitTapHighlightColor: 'transparent',
                                        }}>
                                        <div style={{ width: 20, height: 20, flexShrink: 0, borderRadius: '50%', border: picked ? '6px solid var(--primary)' : '2px solid var(--gray-300)', background: 'var(--card-bg)' }} />
                                        <div style={{ minWidth: 0 }}>
                                            <div style={{ fontWeight: 900, fontSize: '0.86rem', color: 'var(--text-primary)' }}>{isRTL ? mo.ar : mo.en}</div>
                                            <div style={{ fontWeight: 700, fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: 2 }}>{isRTL ? mo.hintAr : mo.hintEn}</div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* ── الرسوم والحدود ── */}
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        <div style={{ flex: '1 1 130px' }}>
                            <div style={{ fontSize: '0.76rem', fontWeight: 800, color: 'var(--text-secondary)', marginBottom: 5 }}>{t('رسوم التوصيل (ر.س)', 'Delivery fee (SAR)')}</div>
                            <NumericField value={fee} onChange={setFee} placeholder="0" style={inputStyle} aria-label={t('رسوم التوصيل', 'Delivery fee')} />
                        </div>
                        <div style={{ flex: '1 1 130px' }}>
                            <div style={{ fontSize: '0.76rem', fontWeight: 800, color: 'var(--text-secondary)', marginBottom: 5 }}>{t('الحد الأدنى للطلب (ر.س)', 'Minimum order (SAR)')}</div>
                            <NumericField value={minOrder} onChange={setMinOrder} placeholder="0" style={inputStyle} aria-label={t('الحد الأدنى', 'Minimum')} />
                        </div>
                        <div style={{ flex: '1 1 130px' }}>
                            <div style={{ fontSize: '0.76rem', fontWeight: 800, color: 'var(--text-secondary)', marginBottom: 5 }}>{t('مدة التوصيل (دقيقة)', 'Delivery time (min)')}</div>
                            <NumericField value={eta} onChange={setEta} integer placeholder={t('اختياري', 'optional')} style={inputStyle} aria-label={t('مدة التوصيل', 'Delivery time')} />
                        </div>
                    </div>
                    <input value={note} onChange={e => setNote(e.target.value.slice(0, 300))} style={inputStyle}
                        placeholder={t('ملاحظة تظهر للمشتري (مثال: التوصيل حتى ١١ مساءً)', 'Note shown to buyers (e.g. delivery until 11 pm)')} />

                    <button type="button" onClick={save} disabled={saving || loadErr}
                        style={{ ...btn(loadErr ? 'var(--gray-200)' : 'var(--primary)', loadErr ? 'var(--text-secondary)' : '#fff'), opacity: saving ? 0.65 : 1, cursor: saving || loadErr ? 'not-allowed' : 'pointer' }}>
                        {saving ? t('⏳ جاري الحفظ…', '⏳ Saving…')
                            : loadErr ? t('الحفظ موقوف — أعد المحاولة أعلاه', 'Saving blocked — retry above')
                                : t('حفظ إعدادات التوصيل ✅', 'Save delivery settings ✅')}
                    </button>

                    {/* ── النطاقات ── */}
                    <div style={{ borderTop: '1px dashed var(--border-color)', paddingTop: 14 }}>
                        <div style={sectionTitle}>🗺️ {t('نطاقات التوصيل — ارسمها بيدك لكل فرع', 'Delivery zones — draw them per branch')}</div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 700, lineHeight: 1.7, marginBottom: 10 }}>
                            {t('لكل فرع نطاقه. المشتري يرى «التوصيل» فقط إذا وقع عنوانه داخل نطاق فعّال **للفرع الذي يحجز منه** — فلا يُوصَّل طلب فرع الرياض إلى حيٍّ في الدمام.',
                               'Each branch has its own zones. A buyer sees “Delivery” only if their address falls inside an active zone of the branch they order from.')}
                        </div>

                        {/* ١) الفرع */}
                        {branches.length > 1 ? (
                            <div style={{ marginBottom: 12 }}>
                                <div style={stepLabel}>{t('١) الفرع الذي سيوصّل', '1) Delivering branch')}</div>
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                    {branches.map(b => {
                                        const picked = branchId === b.id;
                                        const hasGeo = finite(b.lat) && finite(b.lng);
                                        const count = zones.filter(z => z.branch_id === b.id).length;
                                        return (
                                            <button key={b.id} type="button" onClick={() => pickBranch(b.id)} style={chip(picked)}>
                                                {hasGeo ? '🏬' : '⚠️'} {brName(b)}
                                                <span style={{ fontWeight: 800, opacity: 0.7, fontSize: '0.74rem' }}>
                                                    {` · ${count} ${t('نطاق', 'zone')}`}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                                {pickedBranch && !branchPoint && (
                                    <div style={{ ...noteBox('amber'), marginTop: 8 }}>
                                        ⚠️ {t('هذا الفرع بلا إحداثيات على الخريطة — حدّد موقعه من بطاقة «الفروع» ليظهر دبّوسه هنا وترسم حوله بدقّة.',
                                              'This branch has no map coordinates — set them in the branches card so its pin appears here.')}
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div style={{ ...noteBox('sky'), marginBottom: 10 }}>
                                🏬 {t('لمتجرك موقع واحد، فكل نطاق ترسمه يخصّه تلقائياً.',
                                      'Your store has a single location, so every zone you draw belongs to it.')}
                            </div>
                        )}

                        {/* ٢) الشكل */}
                        <div style={{ opacity: needBranch ? 0.45 : 1, pointerEvents: needBranch ? 'none' : 'auto' }}>
                            <div style={stepLabel}>{branches.length > 1 ? t('٢) شكل النطاق', '2) Zone shape') : t('شكل النطاق', 'Zone shape')}</div>
                            {/* إعادة الضغط على النمط نفسه لا تمسح شيئاً — في وضع التعديل كانت
                                تعني ضياع الشكل الذي جاء التاجر ليعدّله بضغطة عابرة. */}
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                                {KINDS.map(k => (
                                    <button key={k.id} type="button"
                                        onClick={() => { if (k.id === kind) return; setKind(k.id); clearDraft(); }}
                                        style={chip(kind === k.id)}>
                                        {k.icon} {isRTL ? k.ar : k.en}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div style={{ background: 'var(--body-bg)', border: '1px solid var(--border-color)', borderRadius: 12, padding: '9px 12px', fontSize: '0.8rem', fontWeight: 800, color: 'var(--primary)', marginBottom: 10, lineHeight: 1.6 }}>
                            {hint}
                        </div>

                        {editingId && (
                            <div style={{
                                background: editTint,
                                border: `1.5px solid ${editLine}`, borderRadius: 14, padding: '11px 13px',
                                fontSize: '0.82rem', fontWeight: 800, color: editFg,
                                lineHeight: 1.7, marginBottom: 10,
                            }}>
                                ✏️ {t(`أنت تعدّل النطاق «${editingZone?.name || t('بلا اسم', 'unnamed')}». الشكل القرمزي هو التعديل الجاري، والخطّ الرمادي المتقطّع هو شكله قبل التعديل. لن يُحفظ شيء حتى تضغط «حفظ التعديل».`,
                                       `You are editing “${editingZone?.name || 'unnamed'}”. The crimson shape is your live edit; the dashed grey outline is how it was. Nothing is saved until you press “Save changes”.`)}
                            </div>
                        )}

                        <div ref={mapBoxRef} style={{ height: 320, borderRadius: 14, overflow: 'hidden', border: '1px solid var(--border-color)' }}>
                            <MapContainer center={mapCenter} zoom={13} attributionControl={false} style={{ height: '100%', width: '100%' }}>
                                <TileLayer
                                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                                    subdomains="abc"
                                    detectRetina={true}
                                    maxZoom={19}
                                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                                />
                                <DrawController onTap={onTap} focus={focus} />

                                {/* دبابيس المواقع — المختار بارز، والبقية للسياق */}
                                {branches.map(b => (finite(b.lat) && finite(b.lng) ? (
                                    <Marker key={b.id} position={[b.lat as number, b.lng as number]}
                                        icon={storeIcon(brName(b), b.id === branchId)}
                                        zIndexOffset={b.id === branchId ? 500 : 0} />
                                ) : null))}

                                {/* النطاقات المحفوظة: نطاقات الفرع المختار بارزة، وغيرها باهتة */}
                                {zones.map(z => {
                                    const mine = !branchId || !z.branch_id || z.branch_id === branchId;
                                    const ghost = z.id === editingId;
                                    const color = ghost || !z.is_active ? C_MUTED : mine ? C_SAVED_MINE : C_SAVED_OTHER;
                                    // النطاق قيد التعديل يُرسم شبحاً متقطّعاً بلا تعبئة = «شكله قبل
                                    // التعديل»، والمسوّدة الحيّة فوقه بالقرمزي — فيرى التاجر مقدار
                                    // ما غيّره بعينه لا بذاكرته.
                                    const opts: L.PathOptions = ghost
                                        ? { color, weight: 1.5, dashArray: '3 7', fill: false, fillOpacity: 0 }
                                        : {
                                            color, weight: mine ? 3 : 1.5, fillColor: color,
                                            fillOpacity: !z.is_active ? 0.05 : mine ? 0.18 : 0.04,
                                            dashArray: mine ? undefined : '5 5',
                                        };
                                    if (z.kind === 'circle' && finite(z.center_lat) && finite(z.center_lng) && finite(z.radius_km)) {
                                        return <Circle key={z.id} center={[z.center_lat as number, z.center_lng as number]} radius={(z.radius_km as number) * 1000} pathOptions={opts} />;
                                    }
                                    const p = zonePts(z);
                                    // المستطيل المحفوظ بركنين يُرسم مضلّعاً بأربع نقاط — نفس النتيجة
                                    // بمكوّن واحد، فلا نحتاج <Rectangle> ولا حالتين للعرض.
                                    if (z.kind === 'rect' && p.length === 2) {
                                        const box: Array<[number, number]> = [
                                            [p[0][0], p[0][1]], [p[0][0], p[1][1]], [p[1][0], p[1][1]], [p[1][0], p[0][1]],
                                        ];
                                        return <Polygon key={z.id} positions={box} pathOptions={opts} />;
                                    }
                                    if (z.kind === 'polygon' && p.length >= 3) {
                                        return <Polygon key={z.id} positions={p} pathOptions={opts} />;
                                    }
                                    return null;
                                })}

                                {/* ── المسوّدة + مقابضها: كهرمانية لنطاق جديد، قرمزية لنطاق قيد التعديل ── */}
                                {kind === 'circle' && center && finite(radiusKm as number) && (
                                    <>
                                        <Circle center={[center.lat, center.lng]} radius={(radiusKm as number) * 1000}
                                            pathOptions={{ color: draftColor, weight: 2.5, fillColor: draftColor, fillOpacity: 0.16 }} />
                                        <Handle pos={center} icon={moveIcon} onMove={setCenter}
                                            title={t('حرّك مركز الدائرة', 'Move the centre')} />
                                        {circleHandle && (
                                            <Handle pos={circleHandle} icon={radiusIcon} onMove={setRadiusFromHandle}
                                                title={t('اسحب لتغيير نصف القطر', 'Drag to resize')} />
                                        )}
                                    </>
                                )}

                                {kind === 'rect' && seed && !rect && (
                                    <Marker position={[seed.lat, seed.lng]} icon={vertexIcon(1)} />
                                )}
                                {kind === 'rect' && rect && corners.length === 4 && (
                                    <>
                                        <Polygon positions={corners.map(p => [p.lat, p.lng] as [number, number])}
                                            pathOptions={{ color: draftColor, weight: 2.5, fillColor: draftColor, fillOpacity: 0.16 }} />
                                        {rectRotHandle && (
                                            <>
                                                <Polyline positions={[[rect.c.lat, rect.c.lng], [rectRotHandle.lat, rectRotHandle.lng]]}
                                                    pathOptions={{ color: '#7c3aed', weight: 1.5, dashArray: '4 4' }} />
                                                <Handle pos={rectRotHandle} icon={rotateIcon}
                                                    onMove={p => applyRot(bearingDeg(rect.c, p))}
                                                    title={t('لفّ المستطيل', 'Rotate')} />
                                            </>
                                        )}
                                        {corners.map((c, i) => (
                                            <Handle key={`c${i}`} pos={c} icon={squareIcon} onMove={p => onRectCorner(i, p)}
                                                title={t('اسحب لتغيير الطول والعرض', 'Drag to resize')} />
                                        ))}
                                        <Handle pos={rect.c} icon={moveIcon} onMove={p => setRect({ ...rect, c: p })}
                                            title={t('حرّك المستطيل كله', 'Move the whole shape')} />
                                    </>
                                )}

                                {kind === 'polygon' && (
                                    <>
                                        {poly.length >= 3 && (
                                            <Polygon positions={poly.map(p => [p.lat, p.lng] as [number, number])}
                                                pathOptions={{ color: draftColor, weight: 2.5, fillColor: draftColor, fillOpacity: 0.16 }} />
                                        )}
                                        {poly.length === 2 && (
                                            <Polyline positions={poly.map(p => [p.lat, p.lng] as [number, number])}
                                                pathOptions={{ color: draftColor, weight: 2.5, dashArray: '5 5' }} />
                                        )}
                                        {poly.map((p, i) => (
                                            <Handle key={`v${i}`} pos={p} icon={vertexIcon(i + 1)} onMove={q => onPolyVertex(i, q)}
                                                title={t('اسحب النقطة', 'Drag the point')} />
                                        ))}
                                        {polyCentroid && polyRotHandle && (
                                            <>
                                                <Polyline positions={[[polyCentroid.lat, polyCentroid.lng], [polyRotHandle.lat, polyRotHandle.lng]]}
                                                    pathOptions={{ color: '#7c3aed', weight: 1.5, dashArray: '4 4' }} />
                                                <Handle pos={polyRotHandle} icon={rotateIcon}
                                                    onMove={p => applyRot(bearingDeg(polyCentroid, p))}
                                                    title={t('لفّ المضلّع', 'Rotate')} />
                                                <Handle pos={polyCentroid} icon={moveIcon} onMove={movePoly}
                                                    title={t('حرّك المضلّع كله', 'Move the whole shape')} />
                                            </>
                                        )}
                                    </>
                                )}
                            </MapContainer>
                        </div>

                        {/* مفتاح الألوان: ما لم يُفسَّر يُخمَّن — والتخمين هنا يعني نطاقاً في المدينة الخطأ. */}
                        {zones.length > 0 && (
                            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8, fontSize: '0.72rem', fontWeight: 800, color: 'var(--text-secondary)' }}>
                                <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: C_SAVED_MINE, marginInlineEnd: 5 }} />
                                    {branches.length > 1 ? t('نطاقات هذا الفرع', 'This branch’s zones') : t('نطاقاتك المحفوظة', 'Your saved zones')}</span>
                                {branches.length > 1 && (
                                    <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: C_SAVED_OTHER, marginInlineEnd: 5 }} />
                                        {t('فروع أخرى', 'Other branches')}</span>
                                )}
                                <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: draftColor, marginInlineEnd: 5 }} />
                                    {editingId ? t('التعديل الجاري', 'Live edit') : t('الرسم الجديد', 'New drawing')}</span>
                            </div>
                        )}

                        {farFromBranch && (
                            <div style={{ ...noteBox('amber'), marginTop: 10 }}>
                                ⚠️ {t('النطاق الذي رسمته يبعد أكثر من ٦٠ كم عن هذا الفرع — تأكّد أنك ترسم حول الفرع الصحيح.',
                                      'The zone you drew is more than 60 km from this branch — make sure you are drawing around the right one.')}
                            </div>
                        )}

                        {/* أزرار الرسم */}
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                            <button type="button" onClick={useMyLocation} disabled={locating}
                                style={{ ...btn('var(--body-bg)', 'var(--text-primary)'), border: '1.5px solid var(--border-color)', opacity: locating ? 0.6 : 1 }}>
                                {locating ? t('⏳ …', '⏳ …') : `📍 ${t('موقعي الحالي', 'My location')}`}
                            </button>
                            {branchPoint && (
                                <button type="button" onClick={() => goTo(branchPoint)}
                                    style={{ ...btn('var(--body-bg)', 'var(--text-primary)'), border: '1.5px solid var(--border-color)' }}>
                                    🏬 {t('توسيط على الفرع', 'Centre on branch')}
                                </button>
                            )}
                            {kind === 'polygon' && poly.length >= 3 && (
                                <button type="button" onClick={() => setPolyClosed(c => !c)}
                                    style={{ ...btn('var(--body-bg)', 'var(--text-primary)'), border: '1.5px solid var(--border-color)' }}>
                                    {polyClosed ? `➕ ${t('إضافة نقاط', 'Add points')}` : `🔒 ${t('إغلاق الشكل', 'Close shape')}`}
                                </button>
                            )}
                            {(center || rect || seed || poly.length > 0) && (
                                <button type="button" onClick={undo} style={{ ...btn('var(--body-bg)', 'var(--text-primary)'), border: '1.5px solid var(--border-color)' }}>
                                    ↩︎ {t('تراجع', 'Undo')}
                                </button>
                            )}
                            {(center || rect || seed || poly.length > 0) && (
                                <button type="button" onClick={clearDraft} style={{ ...btn('var(--body-bg)', 'var(--text-secondary)'), border: '1.5px solid var(--border-color)' }}>
                                    ✕ {t('مسح الرسم', 'Clear')}
                                </button>
                            )}
                        </div>

                        {/* أبعاد الشكل بالأرقام — لمن يفضّل الرقم على السحب */}
                        {kind === 'circle' && (
                            <div style={{ marginTop: 10 }}>
                                <div style={{ fontSize: '0.76rem', fontWeight: 800, color: 'var(--text-secondary)', marginBottom: 5 }}>
                                    {t('نصف القطر بالكيلومتر (٠.٢ – ٢٠٠)', 'Radius in km (0.2 – 200)')}
                                </div>
                                <NumericField value={radiusKm} onChange={setRadiusKm} placeholder="3" style={inputStyle} aria-label={t('نصف القطر', 'Radius')} />
                            </div>
                        )}

                        {kind === 'rect' && rect && (
                            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
                                <div style={{ flex: '1 1 120px' }}>
                                    <div style={{ fontSize: '0.76rem', fontWeight: 800, color: 'var(--text-secondary)', marginBottom: 5 }}>{t('العرض (كم)', 'Width (km)')}</div>
                                    <NumericField value={wKm} aria-label={t('عرض المستطيل', 'Rectangle width')} style={inputStyle} placeholder="1"
                                        onChange={n => { setWKm(n); if (n != null && n > 0) setRect(r => (r ? { ...r, w: clamp(n * 1000, MIN_SIDE_M, MAX_SIDE_M) } : r)); }} />
                                </div>
                                <div style={{ flex: '1 1 120px' }}>
                                    <div style={{ fontSize: '0.76rem', fontWeight: 800, color: 'var(--text-secondary)', marginBottom: 5 }}>{t('الطول (كم)', 'Height (km)')}</div>
                                    <NumericField value={hKm} aria-label={t('طول المستطيل', 'Rectangle height')} style={inputStyle} placeholder="1"
                                        onChange={n => { setHKm(n); if (n != null && n > 0) setRect(r => (r ? { ...r, h: clamp(n * 1000, MIN_SIDE_M, MAX_SIDE_M) } : r)); }} />
                                </div>
                            </div>
                        )}

                        {((kind === 'rect' && rect) || (kind === 'polygon' && poly.length >= 3)) && (
                            <div style={{ marginTop: 10 }}>
                                <div style={{ fontSize: '0.76rem', fontWeight: 800, color: 'var(--text-secondary)', marginBottom: 5 }}>
                                    {t('زاوية الدوران (٠ – ٣٥٩ درجة)', 'Rotation (0 – 359°)')}
                                </div>
                                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                    <button type="button" onClick={() => applyRot(rot - 15)} aria-label={t('لفّ ١٥ درجة عكس عقارب الساعة', 'Rotate 15° counter-clockwise')}
                                        style={{ ...btn('var(--body-bg)', 'var(--text-primary)'), border: '1.5px solid var(--border-color)', padding: '10px 14px' }}>↺ {t('١٥°', '15°')}</button>
                                    <div style={{ flex: '1 1 90px', minWidth: 90 }}>
                                        <NumericField value={Math.round(rot)} integer style={{ ...inputStyle, textAlign: 'center' }}
                                            aria-label={t('زاوية الدوران', 'Rotation angle')}
                                            onChange={n => { if (n != null) applyRot(n); }} />
                                    </div>
                                    <button type="button" onClick={() => applyRot(rot + 15)} aria-label={t('لفّ ١٥ درجة مع عقارب الساعة', 'Rotate 15° clockwise')}
                                        style={{ ...btn('var(--body-bg)', 'var(--text-primary)'), border: '1.5px solid var(--border-color)', padding: '10px 14px' }}>↻ {t('١٥°', '15°')}</button>
                                </div>
                                {kind === 'rect' && norm360(rot) !== 0 && (
                                    <div style={{ ...noteBox('sky'), marginTop: 8 }}>
                                        ℹ️ {t('المستطيل المُدار يُحفظ بأربع نقاط (مضلّع) — النتيجة على أرض الواقع واحدة.',
                                              'A rotated rectangle is stored as a 4-point polygon — the result on the ground is identical.')}
                                    </div>
                                )}
                            </div>
                        )}

                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                            <input value={zoneName} onChange={e => setZoneName(e.target.value.slice(0, 60))} style={{ ...inputStyle, flex: '1 1 150px' }}
                                placeholder={t('اسم النطاق (اختياري — مثال: شرق المدينة)', 'Zone name (optional)')} />
                            <div style={{ flex: '1 1 130px' }}>
                                <NumericField value={zoneFee} onChange={setZoneFee} style={inputStyle}
                                    placeholder={t('رسوم خاصة (فارغ = رسوم المتجر)', 'Custom fee (empty = store fee)')}
                                    aria-label={t('رسوم النطاق', 'Zone fee')} />
                            </div>
                        </div>

                        {blockReason && (
                            <div style={{ ...noteBox('amber'), marginTop: 10 }}>ℹ️ {blockReason}</div>
                        )}

                        <div style={{ fontSize: '0.74rem', fontWeight: 800, color: 'var(--text-secondary)', marginTop: 10, textAlign: 'center' }}>
                            {editingId
                                // تعديل صفٍّ قائم لا يضيف صفّاً، فلا يُحتسب مرّة ثانية على السقف.
                                ? t(`النطاقات الفعّالة: ${activeZones} من 10 — تعديل نطاق قائم لا يستهلك خانة جديدة`,
                                    `Active zones: ${activeZones} of 10 — editing an existing zone does not use a new slot`)
                                : t(`النطاقات الفعّالة: ${activeZones} من 10 لكل المتجر (لا لكل فرع)`,
                                    `Active zones: ${activeZones} of 10 for the whole store (not per branch)`)}
                        </div>

                        {editingId ? (
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                                <button type="button" onClick={updateZone} disabled={zonesBusy || !drawReady || editBranchMissing}
                                    style={{
                                        ...btn(canSaveEdit ? 'var(--primary)' : 'var(--gray-200)', canSaveEdit ? '#fff' : 'var(--text-secondary)'),
                                        flex: '1 1 180px', cursor: canSaveEdit ? 'pointer' : 'not-allowed',
                                    }}>
                                    {zonesBusy ? t('⏳ …', '⏳ …') : t('💾 حفظ التعديل', '💾 Save changes')}
                                </button>
                                <button type="button" onClick={leaveEdit} disabled={zonesBusy}
                                    style={{ ...btn('var(--body-bg)', 'var(--text-primary)'), border: '1.5px solid var(--border-color)', flex: '0 1 auto' }}>
                                    ✕ {t('إلغاء التعديل', 'Cancel editing')}
                                </button>
                            </div>
                        ) : (
                            <button type="button" onClick={addZone} disabled={zonesBusy || !drawReady || !branchId}
                                style={{
                                    ...btn(drawReady && branchId ? 'var(--primary)' : 'var(--gray-200)', drawReady && branchId ? '#fff' : 'var(--text-secondary)'),
                                    width: '100%', marginTop: 10, cursor: drawReady && branchId ? 'pointer' : 'not-allowed',
                                }}>
                                {zonesBusy
                                    ? t('⏳ …', '⏳ …')
                                    : needBranch
                                        ? t('اختر الفرع أولاً', 'Pick a branch first')
                                        : pickedBranch
                                            ? t(`➕ إضافة النطاق لفرع «${brName(pickedBranch)}»`, `➕ Add zone to “${brName(pickedBranch)}”`)
                                            : t('➕ إضافة هذا النطاق', '➕ Add this zone')}
                            </button>
                        )}

                        {/* قائمة النطاقات مجمّعة حسب الفرع */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 14 }}>
                            {zones.length === 0 && (
                                <div style={{ textAlign: 'center', padding: 14, color: 'var(--text-secondary)', fontWeight: 700, fontSize: '0.82rem', border: '1px dashed var(--border-color)', borderRadius: 12 }}>
                                    {t('لا نطاقات بعد.', 'No zones yet.')}
                                </div>
                            )}
                            {groups.map(g => (
                                <div key={g.key}>
                                    <div style={{ fontSize: '0.78rem', fontWeight: 900, color: 'var(--text-secondary)', marginBottom: 6 }}>
                                        {g.legacy ? '🌐' : '🏬'} {g.label} · {g.list.length}
                                    </div>
                                    {g.legacy && branches.length > 1 && (
                                        <div style={{ ...noteBox('amber'), marginBottom: 8 }}>
                                            ⚠️ {t('هذه النطاقات تُطبَّق على كل فروعك. خصّص كل نطاق بفرعه حتى لا يُوصَّل طلب فرع إلى مدينة فرع آخر.',
                                                  'These zones apply to every branch. Assign each one to its branch so orders are not delivered across cities.')}
                                        </div>
                                    )}
                                    {g.orphan && (
                                        <div style={{ ...noteBox('amber'), marginBottom: 8 }}>
                                            ⚠️ {t('الفرع المرتبط بهذه النطاقات لم يعد موجوداً، فلن يراها أي مشترٍ. خصّصها بفرع قائم أو احذفها — فهي تُحتسب ضمن حدّ العشرة.',
                                                  'The branch these zones belong to no longer exists, so no buyer will ever match them. Reassign or delete them — they still count toward the limit of 10.')}
                                        </div>
                                    )}
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                        {g.list.map((z, i) => {
                                            const kindLabel = z.kind === 'circle'
                                                ? t(`دائرة ${z.radius_km} كم`, `Circle ${z.radius_km} km`)
                                                : z.kind === 'rect' ? t('مستطيل', 'Rectangle') : t(`مضلّع (${zonePts(z).length} نقطة)`, `Polygon (${zonePts(z).length} pts)`);
                                            const isEd = z.id === editingId;
                                            return (
                                                <div key={z.id} style={{
                                                    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, flexWrap: 'wrap',
                                                    background: isEd ? editTintSoft : 'var(--body-bg)',
                                                    border: isEd
                                                        ? `1.5px solid ${editLine}`
                                                        : `1px solid ${z.is_active ? 'rgba(13,148,136,0.45)' : 'var(--border-color)'}`,
                                                    opacity: z.is_active || isEd ? 1 : 0.65,
                                                }}>
                                                    <button type="button" onClick={() => focusZone(z)} title={t('اعرضه على الخريطة', 'Show on map')}
                                                        style={{ flexShrink: 0, width: 26, height: 26, borderRadius: '50%', border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg,#0d9488,#0f766e)', color: '#fff', fontWeight: 900, fontSize: '0.76rem' }}>
                                                        {i + 1}
                                                    </button>
                                                    {/* الصفّ نفسه يفتح النطاق على الخريطة — أكبر هدف للإصبع، وهو ما يجرّبه التاجر أولاً. */}
                                                    <div role="button" tabIndex={0}
                                                        onClick={() => focusZone(z)}
                                                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); focusZone(z); } }}
                                                        title={t('اعرضه على الخريطة', 'Show on map')}
                                                        style={{ flex: '1 1 140px', minWidth: 0, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>
                                                        <div style={{ fontWeight: 900, fontSize: '0.84rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                            {z.name || kindLabel}
                                                        </div>
                                                        <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                                                            {kindLabel}
                                                            {z.fee != null ? ` · ${t('رسوم', 'fee')} ${z.fee} ${t('ر.س', 'SAR')}` : ` · ${t('رسوم المتجر', 'store fee')}`}
                                                            {!z.is_active ? ` · ${t('موقوف', 'inactive')}` : ''}
                                                            {isEd ? ` · ${t('قيد التعديل', 'being edited')}` : ''}
                                                        </div>
                                                    </div>
                                                    {(g.orphan || (g.legacy && branches.length > 1)) && (
                                                        <select
                                                            value=""
                                                            disabled={zonesBusy}
                                                            onChange={e => { const v = e.target.value; if (v) assignBranch(z, v); }}
                                                            aria-label={t('تخصيص النطاق بفرع', 'Assign zone to a branch')}
                                                            style={{ ...inputStyle, width: 'auto', flex: '0 1 160px', padding: '7px 10px', fontSize: '0.76rem' }}>
                                                            <option value="">{t('تخصيصه بفرع…', 'Assign to branch…')}</option>
                                                            {branches.map(b => <option key={b.id} value={b.id}>{brName(b)}</option>)}
                                                        </select>
                                                    )}
                                                    <button type="button" onClick={() => focusZone(z)}
                                                        title={t('اعرض شكله على الخريطة', 'Show its shape on the map')}
                                                        style={{ ...btn('var(--card-bg)', 'var(--text-primary)'), border: '1px solid var(--border-color)', padding: '7px 11px', fontSize: '0.76rem', flexShrink: 0 }}>
                                                        👁 {t('عرض', 'Show')}
                                                    </button>
                                                    {/* «تعديل» يفتح نفس محرّر الرسم بمقابضه على هذا النطاق — لا حذف وإعادة رسم. */}
                                                    <button type="button" onClick={() => (isEd ? leaveEdit() : startEdit(z))} disabled={zonesBusy}
                                                        title={isEd ? t('إلغاء التعديل', 'Cancel editing') : t('عدّل شكل النطاق ورسومه', 'Edit this zone’s shape and fee')}
                                                        style={{
                                                            ...btn(isEd ? editTint : 'var(--card-bg)', isEd ? editFg : 'var(--text-primary)'),
                                                            border: `1px solid ${isEd ? editLine : 'var(--border-color)'}`,
                                                            padding: '7px 11px', fontSize: '0.76rem', flexShrink: 0,
                                                        }}>
                                                        {isEd ? `✕ ${t('إلغاء', 'Cancel')}` : `✏️ ${t('تعديل', 'Edit')}`}
                                                    </button>
                                                    <button type="button" onClick={() => toggleZone(z)} disabled={zonesBusy}
                                                        style={{ ...btn('var(--card-bg)', 'var(--text-primary)'), border: '1px solid var(--border-color)', padding: '7px 11px', fontSize: '0.76rem', flexShrink: 0 }}>
                                                        {z.is_active ? t('إيقاف', 'Disable') : t('تفعيل', 'Enable')}
                                                    </button>
                                                    <button type="button" onClick={() => deleteZone(z)} disabled={zonesBusy}
                                                        style={{ ...btn('rgba(239,68,68,0.12)', 'var(--danger)'), border: '1px solid rgba(239,68,68,0.3)', padding: '7px 11px', fontSize: '0.76rem', flexShrink: 0 }}>
                                                        🗑️
                                                    </button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default DeliveryCard;
