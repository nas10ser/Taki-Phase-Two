/**
 * DeliveryCard — «🚚 خدمة التوصيل» في لوحة التاجر (v14.06 — طلب ناصر)
 *
 * طلب ناصر حرفياً: «إضافة خدمة توصيل للمتاجر التي تريد التوصيل … وتحديد بالكيلو
 * أو باليد في الخريطة باستخدام مربع أو دائرة أو مستطيل يدوياً بحيث يحدد بشكل
 * يدوي خدمة التوصيل بالضبط … وطريقة الاستلام بالدفع عند الاستلام أو بطاقة فقط».
 *
 * ── القرار المعماري: النطاق هندسة لا نصّ ──────────────────────────────────
 * «هل يصل هذا المتجر إلى عنوان المشتري؟» سؤالٌ يُقاس بالإحداثيات لا بأسماء
 * الأحياء (اسم الحيّ يختلف كتابةً ويتقاطع بين المدن). لذلك التاجر يرسم نطاقه
 * بنفسه — دائرة بنصف قطر بالكيلومتر، أو مستطيل بركنين، أو مضلّعاً بنقاط —
 * والقاعدة تحسم الأمر بدالة `delivery_quote` واحدة يستعملها الموقع والبوتان
 * وحارس الحجز. فلا يمكن لمشترٍ خارج النطاق أن يختار التوصيل من أي واجهة.
 *
 * ── لماذا الرسوم والحدّ الأدنى على الخادم؟ ────────────────────────────────
 * لأنها مال: حارس القاعدة (`tr_ac_booking_delivery`) يُهمل أي رسوم يرسلها
 * العميل ويكتب رسوم النطاق الحقيقية، ويرفض الحجز خارج النطاق أو تحت الحدّ
 * الأدنى أو بطريقة دفع لا يقبلها التاجر. هذه البطاقة تُدير الإعداد فقط.
 *
 * ⚠️ Leaflet: `map.flyTo` يرمي «Invalid LatLng (NaN, NaN)» خارج شجرة React حين
 * لا مقاس للحاوية، فيسقط التطبيق كله عبر ErrorBoundary — نستعمل `setView`
 * داخل try/catch، وكل إحداثي يُفحص بـ`Number.isFinite` قبل تمريره للخريطة.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Circle, Rectangle, Polygon, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import { supabase } from '../../services/supabaseClient';
import NumericField from '../NumericField';
import { getCurrentPositionSafe, geoErrorMessage } from '../../utils/helpers';

type ZoneKind = 'circle' | 'rect' | 'polygon';

interface Zone {
    id: string;
    name: string | null;
    kind: ZoneKind;
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

interface Props {
    userId: string;
    isRTL: boolean;
    onAlert: (msg: string) => void;
}

/** رسائل أخطاء القاعدة بالعربية — التاجر لا يقرأ رموزاً. */
const ERR_AR: Record<string, string> = {
    AUTH_REQUIRED: 'انتهت جلستك — أعد تسجيل الدخول',
    SELLER_ONLY: 'خدمة التوصيل لحسابات المتاجر فقط',
    BAD_MODE: 'طريقة دفع غير معروفة',
    BAD_FEE: 'رسوم التوصيل يجب أن تكون بين ٠ و١٠٠٠ ريال',
    BAD_MIN: 'الحد الأدنى للطلب غير منطقي',
    BAD_ETA: 'مدة التوصيل يجب أن تكون بين ٠ و١٤٤٠ دقيقة',
    GATEWAY_REQUIRED: 'اختيار «بطاقة» يتطلّب تفعيل بوابة الدفع أولاً من بطاقة «💳 بوابة الدفع» أعلاه — وإلا لن يستطيع المشتري الدفع',
    'TAKI_ZONE_CAP:10': 'وصلت الحد الأقصى: ١٠ نطاقات فعّالة. عطّل نطاقاً أو احذفه قبل إضافة غيره',
    'TAKI_ZONE_BAD:not_store': 'هذه الخاصية لحسابات المتاجر فقط',
    'TAKI_ZONE_BAD:circle': 'مركز الدائرة أو نصف قطرها غير صالح (نصف القطر بين ٠.٢ و٢٠٠ كم)',
    'TAKI_ZONE_BAD:points_count': 'المستطيل يحتاج ركنين بالضبط، والمضلّع من ٣ إلى ٨٠ نقطة',
    'TAKI_ZONE_BAD:points': 'شكل النطاق غير صالح — أعد الرسم',
    'TAKI_ZONE_BAD:point': 'إحدى النقاط خارج الحدود الجغرافية الصالحة',
    'TAKI_ZONE_BAD:fee': 'رسوم النطاق يجب أن تكون بين ٠ و١٠٠٠ ريال',
};
const errMsg = (e: unknown): string => {
    const raw = String((e as { message?: string })?.message || e || '');
    for (const k of Object.keys(ERR_AR)) if (raw.includes(k)) return ERR_AR[k];
    return raw || 'خطأ غير معروف';
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

const DEFAULT_CENTER: [number, number] = [24.7136, 46.6753];
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

const dot = (n: number, active: boolean) => L.divIcon({
    className: '',
    html: `<div style="width:${active ? 22 : 18}px;height:${active ? 22 : 18}px;border-radius:50%;
        background:${active ? 'linear-gradient(135deg,#f59e0b,#d97706)' : 'linear-gradient(135deg,#0d9488,#0f766e)'};
        color:#fff;font-weight:900;font-size:${active ? 11 : 10}px;display:flex;align-items:center;justify-content:center;
        border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.4)">${n}</div>`,
    iconSize: [active ? 22 : 18, active ? 22 : 18],
    iconAnchor: [active ? 11 : 9, active ? 11 : 9],
});

/** قائد الخريطة: النقر يضيف نقطة، والتركيز يُعاد عند الطلب (عدّاد لا شرط منطقي). */
const DrawController: React.FC<{
    onTap: (lat: number, lng: number) => void;
    focus: { lat: number; lng: number; seq: number } | null;
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
            map.invalidateSize();
            map.setView([focus.lat, focus.lng], Math.max(map.getZoom() || 12, 12), { animate: true, duration: 0.6 });
        } catch {
            try { map.setView([focus.lat, focus.lng], 12, { animate: false }); } catch { /* لا تُسقط الصفحة */ }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [map, focus?.seq]);
    return null;
};

const DeliveryCard: React.FC<Props> = ({ userId, isRTL, onAlert }) => {
    const t = (ar: string, en: string) => (isRTL ? ar : en);

    const [open, setOpen] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const [saving, setSaving] = useState(false);
    const [zonesBusy, setZonesBusy] = useState(false);

    const [enabled, setEnabled] = useState(false);
    const [payment, setPayment] = useState<'cod' | 'card' | 'both'>('cod');
    const [fee, setFee] = useState<number | undefined>(0);
    const [minOrder, setMinOrder] = useState<number | undefined>(0);
    const [eta, setEta] = useState<number | undefined>(undefined);
    const [note, setNote] = useState('');

    const [zones, setZones] = useState<Zone[]>([]);
    const [kind, setKind] = useState<ZoneKind>('circle');
    const [pts, setPts] = useState<Array<[number, number]>>([]);
    const [radiusKm, setRadiusKm] = useState<number | undefined>(3);
    const [zoneName, setZoneName] = useState('');
    const [zoneFee, setZoneFee] = useState<number | undefined>(undefined);
    const [focus, setFocus] = useState<{ lat: number; lng: number; seq: number } | null>(null);
    const [locating, setLocating] = useState(false);
    const seqRef = useRef(0);

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
            .select('id,name,kind,center_lat,center_lng,radius_km,points,fee,is_active')
            .eq('store_id', userId)
            .order('created_at', { ascending: true });
        if (error) { onAlert(`❌ ${t('تعذّر تحميل النطاقات', 'Could not load zones')}: ${error.message}`); return; }
        setZones((data || []) as Zone[]);
    }, [userId, onAlert, t]);

    const load = useCallback(async () => {
        const { data, error } = await supabase
            .from('store_profiles')
            .select('delivery_enabled,delivery_payment,delivery_fee,delivery_min_order,delivery_eta_min,delivery_note')
            .eq('store_id', userId)
            .maybeSingle();
        if (!error) hydrate((data as Settings) || null);
        await loadZones();
        setLoaded(true);
    }, [userId, hydrate, loadZones]);

    useEffect(() => { if (open && !loaded) load(); }, [open, loaded, load]);

    const save = async () => {
        if (saving) return;
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
                ? t('✅ تم حفظ إعدادات التوصيل. التوصيل يظهر للمشتري **فقط** إذا كان عنوانه داخل نطاق رسمته.',
                    '✅ Delivery settings saved. Delivery appears to a buyer ONLY if their address falls inside a zone you drew.')
                : t('⏸ خدمة التوصيل موقوفة — كل الطلبات استلام من المتجر.',
                    '⏸ Delivery is off — all orders are store pickup.'));
        } catch (e) {
            onAlert(`❌ ${errMsg(e)}`);
        } finally {
            setSaving(false);
        }
    };

    // ── الرسم ─────────────────────────────────────────────────────────────
    const onTap = useCallback((lat: number, lng: number) => {
        setPts(prev => {
            if (kind === 'circle') return [[lat, lng]];
            if (kind === 'rect') return prev.length >= 2 ? [[lat, lng]] : [...prev, [lat, lng]];
            return prev.length >= 80 ? prev : [...prev, [lat, lng]];
        });
    }, [kind]);

    const useMyLocation = async () => {
        if (locating) return;
        setLocating(true);
        try {
            const { lat, lng } = await getCurrentPositionSafe();
            seqRef.current += 1;
            setFocus({ lat, lng, seq: seqRef.current });
            if (kind === 'circle') setPts([[lat, lng]]);
        } catch (e) {
            onAlert(geoErrorMessage(e, isRTL));
        } finally {
            setLocating(false);
        }
    };

    const drawReady = kind === 'circle'
        ? pts.length === 1 && finite(radiusKm as number) && (radiusKm as number) >= 0.2
        : kind === 'rect' ? pts.length === 2 : pts.length >= 3;

    const addZone = async () => {
        if (zonesBusy || !drawReady) return;
        setZonesBusy(true);
        try {
            const row: Record<string, unknown> = {
                store_id: userId,
                name: zoneName.trim().slice(0, 60) || null,
                kind,
                fee: zoneFee == null ? null : Number(zoneFee),
            };
            if (kind === 'circle') {
                row.center_lat = pts[0][0];
                row.center_lng = pts[0][1];
                row.radius_km = Number(radiusKm);
            } else {
                row.points = pts;
            }
            // ⚠️ حذفٌ/إدراجٌ ترفضه RLS يعود بـ error=null وصفر صفوف — نفحص العدد
            // أيضاً، وإلا أعلنّا نجاحاً وهمياً (قاعدة «الأزرار الصامتة»).
            const { data, error } = await supabase.from('store_delivery_zones').insert(row).select('id');
            if (error) throw error;
            if (!data || data.length === 0) throw new Error(t('لم يُضَف النطاق (لا صلاحية)', 'Zone was not added (not allowed)'));
            setPts([]); setZoneName(''); setZoneFee(undefined);
            await loadZones();
            onAlert(t('✅ أُضيف النطاق. المشترون داخله وحدهم سيرون خيار التوصيل.',
                      '✅ Zone added. Only buyers inside it will see the delivery option.'));
        } catch (e) {
            onAlert(`❌ ${errMsg(e)}`);
        } finally {
            setZonesBusy(false);
        }
    };

    const toggleZone = async (z: Zone) => {
        setZonesBusy(true);
        try {
            const { data, error } = await supabase.from('store_delivery_zones')
                .update({ is_active: !z.is_active }).eq('id', z.id).select('id');
            if (error) throw error;
            if (!data || data.length === 0) throw new Error(t('لم يُحدَّث النطاق (لا صلاحية)', 'Zone was not updated'));
            await loadZones();
        } catch (e) {
            onAlert(`❌ ${errMsg(e)}`);
        } finally {
            setZonesBusy(false);
        }
    };

    const deleteZone = async (z: Zone) => {
        setZonesBusy(true);
        try {
            const { data, error } = await supabase.from('store_delivery_zones').delete().eq('id', z.id).select('id');
            if (error) throw error;
            if (!data || data.length === 0) throw new Error(t('لم يُحذف النطاق (لا صلاحية)', 'Zone was not deleted'));
            await loadZones();
            onAlert(t('🗑️ حُذف النطاق.', '🗑️ Zone deleted.'));
        } catch (e) {
            onAlert(`❌ ${errMsg(e)}`);
        } finally {
            setZonesBusy(false);
        }
    };

    const focusZone = (z: Zone) => {
        const p = z.kind === 'circle'
            ? (finite(z.center_lat) && finite(z.center_lng) ? { lat: z.center_lat as number, lng: z.center_lng as number } : null)
            : (Array.isArray(z.points) && z.points.length && finite(Number(z.points[0][0])) && finite(Number(z.points[0][1]))
                ? { lat: Number(z.points[0][0]), lng: Number(z.points[0][1]) } : null);
        if (!p) return;
        seqRef.current += 1;
        setFocus({ ...p, seq: seqRef.current });
    };

    // نقاط صالحة فقط تُمرَّر لـLeaflet — إحداثي NaN واحد يُسقط الصفحة كلها.
    const safePts = useMemo(
        () => pts.filter(p => finite(p[0]) && finite(p[1])) as Array<[number, number]>,
        [pts]);

    const mapCenter = useMemo<[number, number]>(() => {
        if (safePts.length) return safePts[0];
        const z = zones.find(x => x.kind === 'circle' && finite(x.center_lat) && finite(x.center_lng));
        if (z) return [z.center_lat as number, z.center_lng as number];
        const q = zones.find(x => Array.isArray(x.points) && x.points.length);
        if (q) return [Number(q.points![0][0]), Number(q.points![0][1])];
        return DEFAULT_CENTER;
    }, [safePts, zones]);

    const activeZones = zones.filter(z => z.is_active).length;
    const zonePts = (z: Zone): Array<[number, number]> =>
        (Array.isArray(z.points) ? z.points : [])
            .map(p => [Number(p[0]), Number(p[1])] as [number, number])
            .filter(p => finite(p[0]) && finite(p[1]));

    const inputStyle: React.CSSProperties = {
        width: '100%', padding: '11px 13px', borderRadius: 12,
        border: '1.5px solid var(--border-color)', background: 'var(--body-bg)',
        color: 'var(--text-primary)', fontSize: '0.88rem', fontWeight: 700, outline: 'none', fontFamily: 'inherit',
    };
    const btn = (bg: string, fg: string): React.CSSProperties => ({
        padding: '11px 16px', borderRadius: 13, border: 'none', background: bg, color: fg,
        fontWeight: 900, fontSize: '0.86rem', cursor: 'pointer',
    });
    const sectionTitle: React.CSSProperties = { fontSize: '0.85rem', fontWeight: 900, color: 'var(--text-primary)', margin: '4px 0 8px' };

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
                                ? t(`مفعّلة · ${activeZones} نطاق` , `On · ${activeZones} zone(s)`)
                                : t('موقوفة — كل الطلبات استلام من المتجر', 'Off — all orders are pickup'))
                            : t('وصّل طلباتك إلى عنوان المشتري داخل نطاق ترسمه بنفسك', 'Deliver to buyers inside an area you draw yourself')}
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

                    {enabled && activeZones === 0 && (
                        <div style={{ background: 'rgba(245,158,11,0.14)', border: '1.5px solid rgba(245,158,11,0.6)', borderRadius: 14, padding: '11px 13px', fontSize: '0.82rem', fontWeight: 800, color: '#b45309', lineHeight: 1.7 }}>
                            ⚠️ {t('الخدمة مفعّلة لكن لا نطاق مرسوم — لن يرى أي مشترٍ خيار التوصيل حتى ترسم نطاقاً واحداً على الأقل بالأسفل.',
                                  'Delivery is on but no zone is drawn — no buyer will see the delivery option until you draw at least one zone below.')}
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

                    <button type="button" onClick={save} disabled={saving} style={{ ...btn('var(--primary)', '#fff'), opacity: saving ? 0.65 : 1 }}>
                        {saving ? t('⏳ جاري الحفظ…', '⏳ Saving…') : t('حفظ إعدادات التوصيل ✅', 'Save delivery settings ✅')}
                    </button>

                    {/* ── النطاقات ── */}
                    <div style={{ borderTop: '1px dashed var(--border-color)', paddingTop: 14 }}>
                        <div style={sectionTitle}>🗺️ {t('نطاقات التوصيل — ارسمها بيدك', 'Delivery zones — draw them yourself')}</div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 700, lineHeight: 1.7, marginBottom: 10 }}>
                            {t('اختر الشكل ثم اضغط على الخريطة. المشتري الذي يقع عنوانه داخل أي نطاق فعّال يرى «التوصيل»، ومن يقع خارجها لا يستطيع اختياره.',
                               'Pick a shape then tap the map. A buyer inside any active zone sees “Delivery”; anyone outside cannot choose it.')}
                        </div>

                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                            {KINDS.map(k => {
                                const picked = kind === k.id;
                                return (
                                    <button key={k.id} type="button" onClick={() => { setKind(k.id); setPts([]); }}
                                        style={{
                                            padding: '9px 14px', borderRadius: 999, cursor: 'pointer', fontWeight: 900, fontSize: '0.82rem',
                                            border: picked ? '1.5px solid var(--primary)' : '1.5px solid var(--border-color)',
                                            background: picked ? 'var(--notif-unread-bg)' : 'var(--body-bg)', color: 'var(--text-primary)',
                                        }}>
                                        {k.icon} {isRTL ? k.ar : k.en}
                                    </button>
                                );
                            })}
                        </div>

                        <div style={{ background: 'var(--body-bg)', border: '1px solid var(--border-color)', borderRadius: 12, padding: '9px 12px', fontSize: '0.8rem', fontWeight: 800, color: 'var(--primary)', marginBottom: 10, lineHeight: 1.6 }}>
                            {kind === 'circle'
                                ? (pts.length === 0
                                    ? t('اضغط على الخريطة لتحديد مركز الدائرة.', 'Tap the map to set the circle centre.')
                                    : t('المركز محدّد — اضبط نصف القطر بالكيلومتر أدناه.', 'Centre set — adjust the radius in km below.'))
                                : kind === 'rect'
                                    ? t(`اضغط ركنين على الخريطة (المحدّد: ${pts.length}/2).`, `Tap two corners (selected: ${pts.length}/2).`)
                                    : t(`اضغط نقاط المضلّع بالترتيب — ٣ نقاط على الأقل (المحدّد: ${pts.length}).`, `Tap polygon points in order — at least 3 (selected: ${pts.length}).`)}
                        </div>

                        <div style={{ height: 300, borderRadius: 14, overflow: 'hidden', border: '1px solid var(--border-color)' }}>
                            <MapContainer center={mapCenter} zoom={12} attributionControl={false} style={{ height: '100%', width: '100%' }}>
                                <TileLayer
                                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                                    subdomains="abc"
                                    detectRetina={true}
                                    maxZoom={19}
                                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                                />
                                <DrawController onTap={onTap} focus={focus} />

                                {/* النطاقات المحفوظة (تركواز للفعّال، رمادي للموقوف) */}
                                {zones.map(z => {
                                    const color = z.is_active ? '#0d9488' : '#94a3b8';
                                    const opts = { color, weight: 2, fillColor: color, fillOpacity: z.is_active ? 0.13 : 0.06 };
                                    if (z.kind === 'circle' && finite(z.center_lat) && finite(z.center_lng) && finite(z.radius_km)) {
                                        return <Circle key={z.id} center={[z.center_lat as number, z.center_lng as number]} radius={(z.radius_km as number) * 1000} pathOptions={opts} />;
                                    }
                                    const p = zonePts(z);
                                    if (z.kind === 'rect' && p.length === 2) {
                                        return <Rectangle key={z.id} bounds={[p[0], p[1]]} pathOptions={opts} />;
                                    }
                                    if (z.kind === 'polygon' && p.length >= 3) {
                                        return <Polygon key={z.id} positions={p} pathOptions={opts} />;
                                    }
                                    return null;
                                })}

                                {/* الشكل الجاري رسمه (كهرماني ليتميّز) */}
                                {kind === 'circle' && safePts.length === 1 && finite(radiusKm as number) && (
                                    <Circle center={safePts[0]} radius={(radiusKm as number) * 1000}
                                        pathOptions={{ color: '#f59e0b', weight: 2.5, fillColor: '#f59e0b', fillOpacity: 0.16 }} />
                                )}
                                {kind === 'rect' && safePts.length === 2 && (
                                    <Rectangle bounds={[safePts[0], safePts[1]]}
                                        pathOptions={{ color: '#f59e0b', weight: 2.5, fillColor: '#f59e0b', fillOpacity: 0.16 }} />
                                )}
                                {kind === 'polygon' && safePts.length >= 3 && (
                                    <Polygon positions={safePts}
                                        pathOptions={{ color: '#f59e0b', weight: 2.5, fillColor: '#f59e0b', fillOpacity: 0.16 }} />
                                )}
                                {safePts.map((p, i) => <Marker key={`${p[0]}-${p[1]}-${i}`} position={p} icon={dot(i + 1, true)} />)}
                            </MapContainer>
                        </div>

                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                            <button type="button" onClick={useMyLocation} disabled={locating}
                                style={{ ...btn('var(--body-bg)', 'var(--text-primary)'), border: '1.5px solid var(--border-color)', opacity: locating ? 0.6 : 1 }}>
                                {locating ? t('⏳ …', '⏳ …') : `📍 ${t('موقعي الحالي', 'My location')}`}
                            </button>
                            {pts.length > 0 && (
                                <button type="button" onClick={() => setPts(prev => prev.slice(0, -1))} style={{ ...btn('var(--body-bg)', 'var(--text-primary)'), border: '1.5px solid var(--border-color)' }}>
                                    ↩︎ {t('تراجع عن نقطة', 'Undo point')}
                                </button>
                            )}
                            {pts.length > 0 && (
                                <button type="button" onClick={() => setPts([])} style={{ ...btn('var(--body-bg)', 'var(--text-secondary)'), border: '1.5px solid var(--border-color)' }}>
                                    ✕ {t('مسح الرسم', 'Clear')}
                                </button>
                            )}
                        </div>

                        {kind === 'circle' && (
                            <div style={{ marginTop: 10 }}>
                                <div style={{ fontSize: '0.76rem', fontWeight: 800, color: 'var(--text-secondary)', marginBottom: 5 }}>
                                    {t('نصف القطر بالكيلومتر (٠.٢ – ٢٠٠)', 'Radius in km (0.2 – 200)')}
                                </div>
                                <NumericField value={radiusKm} onChange={setRadiusKm} placeholder="3" style={inputStyle} aria-label={t('نصف القطر', 'Radius')} />
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

                        <button type="button" onClick={addZone} disabled={zonesBusy || !drawReady}
                            style={{ ...btn(drawReady ? 'var(--primary)' : 'var(--gray-200)', drawReady ? '#fff' : 'var(--text-secondary)'), width: '100%', marginTop: 10, cursor: drawReady ? 'pointer' : 'not-allowed' }}>
                            {zonesBusy ? t('⏳ …', '⏳ …') : t('➕ إضافة هذا النطاق', '➕ Add this zone')}
                        </button>

                        {/* قائمة النطاقات */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                            {zones.length === 0 && (
                                <div style={{ textAlign: 'center', padding: 14, color: 'var(--text-secondary)', fontWeight: 700, fontSize: '0.82rem', border: '1px dashed var(--border-color)', borderRadius: 12 }}>
                                    {t('لا نطاقات بعد.', 'No zones yet.')}
                                </div>
                            )}
                            {zones.map((z, i) => {
                                const kindLabel = z.kind === 'circle'
                                    ? t(`دائرة ${z.radius_km} كم`, `Circle ${z.radius_km} km`)
                                    : z.kind === 'rect' ? t('مستطيل', 'Rectangle') : t(`مضلّع (${zonePts(z).length} نقطة)`, `Polygon (${zonePts(z).length} pts)`);
                                return (
                                    <div key={z.id} style={{
                                        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12,
                                        background: 'var(--body-bg)', border: `1px solid ${z.is_active ? 'rgba(13,148,136,0.45)' : 'var(--border-color)'}`,
                                        opacity: z.is_active ? 1 : 0.65,
                                    }}>
                                        <button type="button" onClick={() => focusZone(z)} title={t('اعرضه على الخريطة', 'Show on map')}
                                            style={{ flexShrink: 0, width: 26, height: 26, borderRadius: '50%', border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg,#0d9488,#0f766e)', color: '#fff', fontWeight: 900, fontSize: '0.76rem' }}>
                                            {i + 1}
                                        </button>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontWeight: 900, fontSize: '0.84rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {z.name || kindLabel}
                                            </div>
                                            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                                                {kindLabel}
                                                {z.fee != null ? ` · ${t('رسوم', 'fee')} ${z.fee} ${t('ر.س', 'SAR')}` : ` · ${t('رسوم المتجر', 'store fee')}`}
                                                {!z.is_active ? ` · ${t('موقوف', 'inactive')}` : ''}
                                            </div>
                                        </div>
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
                </div>
            )}
        </div>
    );
};

export default DeliveryCard;
