import React, { useState } from 'react';
import { useHistory } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import BottomNav from '../components/BottomNav';
import { pushService } from '../services/pushService';

const SeasonalOffers: React.FC = () => {
    const history = useHistory();
    const { language, customAlert } = useApp();
    const isRTL = language === 'ar';
    const [notifyState, setNotifyState] = useState<'idle' | 'subscribing' | 'done'>('idle');

    const handleNotifyMe = async () => {
        if (notifyState !== 'idle') return;
        setNotifyState('subscribing');
        try {
            await pushService.ensurePermissionAndSubscribe();
            try { localStorage.setItem('TAKI_SEASONAL_NOTIFY', '1'); } catch { /* ignore */ }
            setNotifyState('done');
            await customAlert(isRTL ? '✅ سنخبرك أول من يعلم بانطلاق الموسم!' : '✅ We will notify you the moment the season launches!');
        } catch (err: any) {
            setNotifyState('idle');
            await customAlert(isRTL
                ? '❌ تعذر تفعيل التنبيهات. تأكد من السماح للموقع بإرسال إشعارات في إعدادات المتصفح.'
                : '❌ Could not enable notifications. Please allow notifications in your browser settings.');
        }
    };

    return (
        <div className="page-content" style={{ 
            background: 'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)', 
            minHeight: '100vh', 
            color: 'white',
            direction: isRTL ? 'rtl' : 'ltr'
        }}>
            {/* Premium Header */}
            <div style={{ 
                height: 300, 
                position: 'relative', 
                display: 'flex', 
                flexDirection: 'column', 
                alignItems: 'center', 
                justifyContent: 'center',
                textAlign: 'center',
                padding: '0 20px'
            }}>
                <div style={{
                    position: 'absolute',
                    top: 0, left: 0, right: 0, bottom: 0,
                    backgroundImage: 'url(https://images.unsplash.com/photo-1543332164-6e82f355badc?w=1200)',
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    opacity: 0.3,
                    zIndex: 0
                }} />
                
                <div style={{ zIndex: 1 }}>
                    <div style={{ 
                        background: 'rgba(80, 80, 90, 0.3)', 
                        backdropFilter: 'blur(10px)',
                        padding: '12px 24px', 
                        borderRadius: 30,
                        border: '1px solid rgba(80, 80, 95, 0.2)',
                        marginBottom: 20,
                        display: 'inline-block',
                        fontSize: '0.9rem',
                        fontWeight: 700,
                        color: '#fbbf24'
                    }}>
                        ✨ {isRTL ? 'قريباً: عروض رمضان والعيد' : 'Coming Soon: Ramadan & Eid Special'}
                    </div>
                    <h1 style={{ fontSize: '2.4rem', fontWeight: 900, marginBottom: 12, lineHeight: 1.2 }}>
                        {isRTL ? 'مهرجان التخفيضات الكبرى' : 'Grand Seasonal Festival'}
                    </h1>
                    <p style={{ fontSize: '1rem', opacity: 0.8, maxWidth: 400, margin: '0 auto', fontWeight: 600 }}>
                        {isRTL 
                            ? 'عروض حصرية وحصص محدودة جداً تصل إلى 90% خلال أيام الشهر الفضيل والعيد.' 
                            : 'Exclusive limited offers up to 90% off during the holy month and Eid festivities.'}
                    </p>
                </div>

                <button 
                    onClick={() => history.push('/')}
                    style={{
                        position: 'absolute', top: 20, left: isRTL ? 'auto' : 20, right: isRTL ? 20 : 'auto',
                        background: 'rgba(80, 80, 95, 0.2)',
                        border: '1px solid rgba(80, 80, 95, 0.3)',
                        borderRadius: 12,
                        padding: '8px 16px',
                        color: 'white',
                        fontWeight: 800,
                        zIndex: 2
                    }}
                >
                    {isRTL ? '← العودة' : '← Back'}
                </button>
            </div>

            {/* Placeholder Content */}
            <div style={{ padding: '20px 16px 120px', zIndex: 1, position: 'relative' }}>
                <div style={{
                    background: 'rgba(80, 80, 90, 0.2)',
                    border: '1px dashed rgba(80, 80, 95, 0.2)',
                    borderRadius: 24,
                    padding: '60px 20px',
                    textAlign: 'center'
                }}>
                    <div style={{ fontSize: '4rem', marginBottom: 20 }}>🌙</div>
                    <h2 style={{ fontSize: '1.4rem', fontWeight: 800, marginBottom: 12 }}>
                        {isRTL ? 'استعد لموسم العطاء' : 'Get Ready for Giving Season'}
                    </h2>
                    <p style={{ fontSize: '0.9rem', opacity: 0.6, lineHeight: 1.6, marginBottom: 30 }}>
                        {isRTL 
                            ? 'نحن نعمل حالياً مع أكبر الماركات التجارية والمحلات لتوفير أفضل العروض الحصرية لك. فعل التنبيهات لتكون أول من يعلم!' 
                            : "We're currently partnering with premium brands and stores to bring you the best exclusive deals. Enable notifications to be the first to know!"}
                    </p>
                    <button
                        onClick={handleNotifyMe}
                        disabled={notifyState !== 'idle'}
                        aria-live="polite"
                        style={{
                            background: notifyState === 'done' ? '#10b981' : 'var(--secondary)',
                            color: notifyState === 'done' ? 'white' : 'var(--text-primary)',
                            padding: '16px 32px',
                            borderRadius: 16,
                            border: 'none',
                            fontWeight: 900,
                            fontSize: '1rem',
                            boxShadow: '0 8px 24px rgba(251,191,36,0.3)',
                            cursor: notifyState === 'idle' ? 'pointer' : 'default',
                            opacity: notifyState === 'subscribing' ? 0.7 : 1,
                            transition: 'background 0.25s ease, color 0.25s ease',
                        }}>
                        {notifyState === 'subscribing'
                            ? (isRTL ? 'جارٍ التفعيل...' : 'Enabling...')
                            : notifyState === 'done'
                            ? (isRTL ? '✅ تم تفعيل التنبيه' : '✅ Notifications On')
                            : (isRTL ? 'أعلمني عند الانطلاق' : 'Notify Me at Launch')}
                    </button>
                </div>

                {/* Decorative Stats */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 24 }}>
                    <div style={{ background: 'rgba(80, 80, 90, 0.15)', padding: 16, borderRadius: 20, textAlign: 'center' }}>
                        <div style={{ fontSize: '1.5rem', fontWeight: 900, color: '#fbbf24' }}>+500</div>
                        <div style={{ fontSize: '0.7rem', opacity: 0.6 }}>{isRTL ? 'محل مشارك' : 'Participating Stores'}</div>
                    </div>
                    <div style={{ background: 'rgba(80, 80, 90, 0.15)', padding: 16, borderRadius: 20, textAlign: 'center' }}>
                        <div style={{ fontSize: '1.5rem', fontWeight: 900, color: '#fbbf24' }}>90%</div>
                        <div style={{ fontSize: '0.7rem', opacity: 0.6 }}>{isRTL ? 'أقصى خصم' : 'Max Discount'}</div>
                    </div>
                </div>
            </div>

            <BottomNav />
        </div>
    );
};

export default SeasonalOffers;
