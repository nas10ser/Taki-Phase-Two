import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { REGIONS, CITIES, findNearestCity , geoName } from '../data/mock';
import { getCurrentPositionSafe } from '../utils/helpers';

/**
 * First-open location prompt. Asked ONCE (the choice is persisted as
 * `homeCity`), so it never nags. Flow per the owner's spec: ask for GPS;
 * if the customer declines / it fails, ask them to pick their city. The
 * chosen city drives Home's "your city first, then outward" ordering.
 */
const LocationGate: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const { language, setHomeCity, updateProfile } = useApp();
    const isRTL = language === 'ar';
    const [mode, setMode] = useState<'choose' | 'manual'>('choose');
    const [gpsBusy, setGpsBusy] = useState(false);
    const [region, setRegion] = useState('');
    const [city, setCity] = useState('');
    const [err, setErr] = useState('');

    // v11.41 — cross-browser geolocation that never hangs on Safari; on any
    // failure (declined / unavailable / timeout) we fall back to manual pick.
    const useGps = async () => {
        setGpsBusy(true);
        setErr('');
        try {
            const { lat, lng } = await getCurrentPositionSafe();
            // Persist the precise GPS fix onto the account (no-op if signed out)
            // so the platform can push "deals near you" by proximity later.
            updateProfile({ lat, lng }).catch(() => {});
            const near = findNearestCity(lat, lng);
            if (near) {
                setHomeCity({ regionId: near.regionId, cityId: near.id });
                onClose();
            } else {
                setMode('manual');
            }
        } catch {
            setMode('manual');
            setErr(isRTL
                ? 'تعذّر تحديد موقعك تلقائياً — اختر مدينتك من القائمة.'
                : "Couldn't detect your location — pick your city below.");
        } finally {
            setGpsBusy(false);
        }
    };

    const confirmManual = () => {
        if (!city) return;
        const c = CITIES.find(x => x.id === city);
        setHomeCity({ regionId: c?.regionId || region, cityId: city });
        onClose();
    };

    return (
        <div
            dir={isRTL ? 'rtl' : 'ltr'}
            style={{
                position: 'fixed', inset: 0, zIndex: 99996,
                background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18,
            }}
        >
            <div className="animate-fade-in" style={{
                background: 'var(--card-bg)', color: 'var(--text-primary)',
                borderRadius: 24, width: '100%', maxWidth: 420,
                boxShadow: '0 24px 60px rgba(0,0,0,0.4)', overflow: 'hidden',
            }}>
                <div style={{
                    background: 'linear-gradient(135deg, #0f172a, #334155)', color: '#fff',
                    padding: '22px 22px 20px', textAlign: 'center',
                }}>
                    <div style={{ fontSize: '2.4rem', marginBottom: 6 }}>📍</div>
                    <div style={{ fontSize: '1.15rem', fontWeight: 900 }}>
                        {isRTL ? 'وين مدينتك؟' : 'Where are you?'}
                    </div>
                    <div style={{ fontSize: '0.82rem', fontWeight: 600, opacity: 0.85, marginTop: 6, lineHeight: 1.6 }}>
                        {isRTL
                            ? 'نعرض لك عروض مدينتك أولاً ثم الأقرب فالأقرب — حدّد موقعك أو اختر مدينتك.'
                            : 'We show your city\'s deals first, then nearby — detect your location or pick your city.'}
                    </div>
                </div>

                <div style={{ padding: 20 }}>
                    {mode === 'choose' ? (
                        <>
                            <button
                                onClick={useGps}
                                disabled={gpsBusy}
                                style={{
                                    width: '100%', padding: '15px', borderRadius: 16, border: 'none',
                                    background: 'var(--primary)', color: '#fff', fontWeight: 900,
                                    fontSize: '0.98rem', cursor: gpsBusy ? 'default' : 'pointer', marginBottom: 12,
                                }}
                            >
                                {gpsBusy
                                    ? (isRTL ? '⏳ جاري تحديد موقعك...' : '⏳ Locating…')
                                    : (isRTL ? '📍 تحديد موقعي تلقائياً' : '📍 Detect my location')}
                            </button>
                            <button
                                onClick={() => setMode('manual')}
                                style={{
                                    width: '100%', padding: '15px', borderRadius: 16,
                                    border: '1.5px solid var(--border-color)', background: 'var(--card-bg)',
                                    color: 'var(--text-primary)', fontWeight: 800, fontSize: '0.95rem', cursor: 'pointer',
                                }}
                            >
                                {isRTL ? '🏙️ اختر مدينتي يدوياً' : '🏙️ Pick my city manually'}
                            </button>
                        </>
                    ) : (
                        <>
                            {err && (
                                <div style={{
                                    background: 'rgba(245,158,11,0.14)', color: 'var(--text-primary)',
                                    borderRadius: 12, padding: '10px 12px', fontSize: '0.8rem',
                                    fontWeight: 700, marginBottom: 12, lineHeight: 1.5,
                                }}>{err}</div>
                            )}
                            <select
                                value={region}
                                onChange={e => { setRegion(e.target.value); setCity(''); }}
                                style={{
                                    width: '100%', padding: '13px 12px', borderRadius: 14, marginBottom: 10,
                                    border: '1.5px solid var(--border-color)', background: 'var(--body-bg)',
                                    color: 'var(--text-primary)', fontSize: '0.95rem', fontWeight: 700, outline: 'none',
                                }}
                            >
                                <option value="">{isRTL ? 'اختر المنطقة' : 'Select region'}</option>
                                {REGIONS.map(r => <option key={r.id} value={r.id}>{geoName(r, language)}</option>)}
                            </select>
                            <select
                                value={city}
                                onChange={e => setCity(e.target.value)}
                                disabled={!region}
                                style={{
                                    width: '100%', padding: '13px 12px', borderRadius: 14, marginBottom: 16,
                                    border: '1.5px solid var(--border-color)',
                                    background: !region ? 'var(--gray-100)' : 'var(--body-bg)',
                                    color: 'var(--text-primary)', fontSize: '0.95rem', fontWeight: 700,
                                    outline: 'none', opacity: !region ? 0.6 : 1,
                                }}
                            >
                                <option value="">{isRTL ? 'اختر مدينتك' : 'Select your city'}</option>
                                {CITIES.filter(c => !region || c.regionId === region).map(c => (
                                    <option key={c.id} value={c.id}>{geoName(c, language)}</option>
                                ))}
                            </select>
                            <button
                                onClick={confirmManual}
                                disabled={!city}
                                style={{
                                    width: '100%', padding: '15px', borderRadius: 16, border: 'none',
                                    background: city ? 'var(--primary)' : 'var(--gray-300)',
                                    color: '#fff', fontWeight: 900, fontSize: '0.98rem',
                                    cursor: city ? 'pointer' : 'not-allowed',
                                }}
                            >
                                {isRTL ? '✅ تأكيد' : '✅ Confirm'}
                            </button>
                        </>
                    )}

                    <button
                        onClick={onClose}
                        style={{
                            width: '100%', padding: '10px', marginTop: 12, background: 'none',
                            border: 'none', color: 'var(--text-secondary)', fontWeight: 700,
                            fontSize: '0.8rem', cursor: 'pointer', textDecoration: 'underline',
                        }}
                    >
                        {isRTL ? 'لاحقاً' : 'Later'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default LocationGate;
