/**
 * BuyerAddressCard — عنوان التوصيل الدائم للمشتري (v14.06 — طلب ناصر)
 *
 * «لابد أن يتم للمشتري إضافة موقع دائم له أو تغييرها» — فالعنوان يُحفظ مرة واحدة
 * في `users.delivery_address` ويُستعمل في كل حجز بعدها (والبوتان يقرآنه من القاعدة
 * نفسها، فلا يُطلب من المستخدم عنوانٌ داخل محادثة).
 *
 * ── لماذا الإحداثيات إلزامية والعنوان المكتوب اختياري؟ ─────────────────────
 * لأن قرار «هل يصلك هذا المتجر؟» يُقاس هندسياً على نطاق التاجر (دائرة/مستطيل/
 * مضلّع) — ونصٌّ مكتوب لا يُقاس. لذلك القاعدة نفسها ترفض عنواناً بلا lat/lng،
 * والتفاصيل المكتوبة والجوال للتاجر ليصل إلى الباب.
 *
 * ── فخّان يجب تجنّبهما (دروس مدفوعة الثمن في هذا المستودع) ─────────────────
 *  • `map.flyTo` يرمي «Invalid LatLng object: (NaN, NaN)» **خارج شجرة React**
 *    حين لا يكون للحاوية مقاس أو تقترب المسافة من الصفر، فيلتقطه ErrorBoundary
 *    وتسقط الصفحة كلها. نستعمل `setView` داخل try/catch بعد `invalidateSize`.
 *  • `getCurrentPosition` الخام يعلّق بلا نهاية على iOS Safari — نستعمل
 *    `getCurrentPositionSafe` (مهلة + احتياطي) ورسالة `geoErrorMessage`.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import { useApp } from '../context/AppContext';
import { getCurrentPositionSafe, geoErrorMessage, normalizeArabicNumerals } from '../utils/helpers';

/** حدود المملكة تقريباً — دبّوس خارجها يعني عنواناً لا يمكن التوصيل إليه. */
const KSA = { latMin: 16, latMax: 33, lngMin: 34, lngMax: 56 };
const inKsa = (lat: number, lng: number) =>
    Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= KSA.latMin && lat <= KSA.latMax && lng >= KSA.lngMin && lng <= KSA.lngMax;

/** مركز افتراضي حين لا عنوان ولا موقع: الرياض. */
const DEFAULT_CENTER: [number, number] = [24.7136, 46.6753];

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
    onPick: (lat: number, lng: number) => void;
}> = ({ point, focusSeq, onPick }) => {
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
        try {
            map.invalidateSize();
            map.setView([point.lat, point.lng], Math.max(map.getZoom() || 15, 15), { animate: true, duration: 0.6 });
        } catch {
            try { map.setView([point.lat, point.lng], 15, { animate: false }); } catch { /* حركة خريطة لا تُسقط صفحة */ }
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

const BuyerAddressCard: React.FC = () => {
    const { user, language, updateProfile, customAlert, customConfirm, liveLocation } = useApp();
    const isRTL = language === 'ar';
    const t = (ar: string, en: string) => (isRTL ? ar : en);

    const saved = user?.deliveryAddress || null;

    const [open, setOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [locating, setLocating] = useState(false);
    const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null);
    const [focusSeq, setFocusSeq] = useState(0);
    const [label, setLabel] = useState('');
    const [details, setDetails] = useState('');
    const [city, setCity] = useState('');
    const [phone, setPhone] = useState('');
    const openedRef = useRef(false);

    // تهيئة النموذج عند كل فتح: من العنوان المحفوظ، وإلا من الموقع الحيّ إن وُجد.
    useEffect(() => {
        if (!open) { openedRef.current = false; return; }
        if (openedRef.current) return;
        openedRef.current = true;
        if (saved && Number.isFinite(Number(saved.lat)) && Number.isFinite(Number(saved.lng))) {
            setPoint({ lat: Number(saved.lat), lng: Number(saved.lng) });
            setLabel(saved.label || '');
            setDetails(saved.details || '');
            setCity(saved.city || '');
            setPhone(saved.phone || user?.phone || '');
        } else {
            setPoint(liveLocation ? { lat: liveLocation.lat, lng: liveLocation.lng } : null);
            setLabel(isRTL ? 'المنزل' : 'Home');
            setDetails('');
            setCity('');
            setPhone(user?.phone || '');
        }
        setFocusSeq(s => s + 1);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const center = useMemo<[number, number]>(() => {
        if (point && Number.isFinite(point.lat) && Number.isFinite(point.lng)) return [point.lat, point.lng];
        if (liveLocation) return [liveLocation.lat, liveLocation.lng];
        return DEFAULT_CENTER;
    }, [point, liveLocation]);

    const pick = useCallback((lat: number, lng: number) => setPoint({ lat, lng }), []);

    const useMyLocation = async () => {
        if (locating) return;
        setLocating(true);
        try {
            const { lat, lng } = await getCurrentPositionSafe();
            setPoint({ lat, lng });
            setFocusSeq(s => s + 1);
        } catch (e) {
            customAlert(geoErrorMessage(e, isRTL));
        } finally {
            setLocating(false);
        }
    };

    const save = async () => {
        if (saving) return;
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
        const cleanPhone = normalizeArabicNumerals(phone).replace(/[^\d+]/g, '').slice(0, 20);
        setSaving(true);
        try {
            await updateProfile({
                deliveryAddress: {
                    label: label.trim().slice(0, 60) || undefined,
                    details: details.trim().slice(0, 300) || undefined,
                    city: city.trim().slice(0, 60) || undefined,
                    phone: cleanPhone || undefined,
                    // خمس منازل عشرية ≈ متر واحد — دقّة تكفي التوصيل ولا تضخّم الصفّ.
                    lat: Math.round(point.lat * 1e5) / 1e5,
                    lng: Math.round(point.lng * 1e5) / 1e5,
                },
            });
            setOpen(false);
            customAlert(t('✅ تم حفظ عنوان التوصيل — سيظهر لك خيار «التوصيل» في المتاجر التي تغطّي عنوانك.',
                          '✅ Delivery address saved — “Delivery” will appear at stores that cover your address.'));
        } catch (e: any) {
            customAlert(t(`❌ تعذّر حفظ العنوان: ${e?.message || 'حاول مرة أخرى'}`,
                          `❌ Could not save the address: ${e?.message || 'please retry'}`));
        } finally {
            setSaving(false);
        }
    };

    const remove = async () => {
        const ok = await customConfirm(t('حذف عنوان التوصيل المحفوظ؟ لن تستطيع اختيار «التوصيل» حتى تضيف عنواناً جديداً.',
                                         'Delete your saved delivery address? You will not be able to choose delivery until you add a new one.'));
        if (!ok) return;
        setSaving(true);
        try {
            await updateProfile({ deliveryAddress: null });
            customAlert(t('🗑️ تم حذف العنوان.', '🗑️ Address deleted.'));
        } catch (e: any) {
            customAlert(t(`❌ تعذّر الحذف: ${e?.message || 'حاول مرة أخرى'}`, `❌ Could not delete: ${e?.message || 'please retry'}`));
        } finally {
            setSaving(false);
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

    return (
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', padding: 20, borderRadius: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 900, margin: 0, color: 'var(--text-primary)' }}>
                    🚚 {t('عنوان التوصيل', 'Delivery address')}
                </h3>
                {!open && (
                    <button type="button" onClick={() => setOpen(true)} style={{ ...btn('var(--primary)', '#fff'), padding: '8px 14px', fontSize: '0.82rem' }}>
                        {saved ? t('تغيير', 'Change') : t('إضافة', 'Add')}
                    </button>
                )}
            </div>
            <p style={{ fontSize: '0.82rem', opacity: 0.7, margin: '0 0 14px', lineHeight: 1.6, color: 'var(--text-secondary)' }}>
                {t('أضِفه مرة واحدة ليظهر لك خيار «التوصيل» في المتاجر التي تصل إلى منطقتك — ويُشارَك مع تاجر الطلب وحده عند الحجز.',
                   'Add it once so “Delivery” appears at stores that reach your area — it is shared only with that order’s merchant.')}
            </p>

            {/* الحالة المحفوظة */}
            {!open && (saved ? (
                <div style={{ background: 'var(--body-bg)', border: '1px solid var(--border-color)', borderRadius: 14, padding: '12px 14px' }}>
                    <div style={{ fontWeight: 900, fontSize: '0.92rem', color: 'var(--text-primary)' }}>
                        📍 {saved.label || t('عنواني', 'My address')}
                    </div>
                    {saved.details && (
                        <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', fontWeight: 700, marginTop: 4, lineHeight: 1.6 }}>
                            {saved.details}{saved.city ? ` — ${saved.city}` : ''}
                        </div>
                    )}
                    {saved.phone && (
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 700, marginTop: 4, direction: 'ltr', textAlign: isRTL ? 'right' : 'left' }}>
                            📞 {saved.phone}
                        </div>
                    )}
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 700, marginTop: 6, direction: 'ltr', textAlign: isRTL ? 'right' : 'left', opacity: 0.75 }}>
                        {Number(saved.lat).toFixed(5)}, {Number(saved.lng).toFixed(5)}
                    </div>
                    <button type="button" onClick={remove} disabled={saving}
                        style={{ ...btn('rgba(239,68,68,0.12)', 'var(--danger)'), marginTop: 10, padding: '8px 14px', fontSize: '0.8rem', border: '1px solid rgba(239,68,68,0.3)' }}>
                        🗑️ {t('حذف العنوان', 'Delete address')}
                    </button>
                </div>
            ) : (
                <div style={{ background: 'var(--body-bg)', border: '1px dashed var(--border-color)', borderRadius: 14, padding: '14px', textAlign: 'center', color: 'var(--text-secondary)', fontWeight: 700, fontSize: '0.85rem' }}>
                    {t('لا يوجد عنوان محفوظ بعد.', 'No saved address yet.')}
                </div>
            ))}

            {/* المحرّر */}
            {open && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div style={{ height: 260, borderRadius: 14, overflow: 'hidden', border: '1px solid var(--border-color)', position: 'relative' }}>
                        <MapContainer center={center} zoom={15} attributionControl={false} style={{ height: '100%', width: '100%' }}>
                            <TileLayer
                                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                                subdomains="abc"
                                detectRetina={true}
                                maxZoom={19}
                                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                            />
                            <PinController point={point} focusSeq={focusSeq} onPick={pick} />
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
                            onChange={e => setPhone(e.target.value)}
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
                        <button type="button" onClick={() => setOpen(false)} disabled={saving}
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
