import React, { useState, useRef, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { useBooking, Booking } from '../hooks/useBooking';

interface Props {
    isOpen: boolean;
    onClose: () => void;
}

const BarcodeScanner: React.FC<Props> = ({ isOpen, onClose }) => {
    const { language, customAlert } = useApp();
    const { bookings, completeBooking, cancelBooking } = useBooking();
    const [manualCode, setManualCode] = useState('');
    const [scanResult, setScanResult] = useState<Booking | null>(null);
    const [scanError, setScanError] = useState('');
    const [verified, setVerified] = useState(false);
    const [cameraActive, setCameraActive] = useState(false);
    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);

    const isRTL = language === 'ar';

    useEffect(() => {
        if (!isOpen) {
            stopCamera();
            setScanResult(null);
            setScanError('');
            setManualCode('');
            setVerified(false);
        }
    }, [isOpen]);

    const startCamera = async () => {
        try {
            console.log('📷 Attempting to start camera...');

            // On iOS/iPhone, getUserMedia ONLY works over HTTPS.
            if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
                const secureMsg = isRTL 
                    ? '⚠️ الكاميرا تتطلب اتصالاً آمناً (HTTPS) لتعمل على الايفون. يرجى استخدام رابط يبدأ بـ https://' 
                    : '⚠️ Camera access requires a secure connection (HTTPS) on iPhone. Please use a link starting with https://';
                setScanError(secureMsg);
                return;
            }

            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error('MediaDevices API not supported');
            }
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { 
                    facingMode: 'environment',
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                }
            });
            streamRef.current = stream;
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                // Explicitly call play() for iOS Safari stability
                await videoRef.current.play().catch(e => console.error('Video play error:', e));
            }
            setCameraActive(true);
            setScanError('');
        } catch (err: any) {
            console.error('❌ Camera access error:', err);
            const msg = err.name === 'NotAllowedError' 
                ? (isRTL ? 'يرجى السماح بالوصول للكاميرا من إعدادات المتصفح' : 'Please allow camera access in browser settings')
                : (isRTL ? `فشل الوصول للكاميرا: ${err.message || 'خطأ غير معروف'}` : `Camera error: ${err.message || 'Unknown error'}`);
            setScanError(msg);
        }
    };

    const stopCamera = () => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
        setCameraActive(false);
    };

    const lookupBooking = (code: string): Booking | undefined => {
        return bookings.find(b =>
            b.barcode === code.toUpperCase() ||
            b.backupCode === code.toUpperCase() ||
            b.barcode === code ||
            b.backupCode === code
        );
    };

    const handleManualSearch = () => {
        if (!manualCode.trim()) return;
        const booking = lookupBooking(manualCode.trim());
        if (booking) {
            setScanResult(booking);
            setScanError('');
        } else {
            setScanResult(null);
            setScanError(isRTL ? 'لم يتم العثور على حجز بهذا الرمز' : 'No booking found with this code');
        }
    };

    const handleVerify = () => {
        if (!scanResult) return;
        completeBooking(scanResult.barcode);
        setVerified(true);
        setTimeout(() => {
            setVerified(false);
            setScanResult(null);
            setManualCode('');
        }, 3000);
    };

    const handleCancel = () => {
        if (!scanResult) return;
        // cancelBooking centrally handles status sync, quantity restore, and notifying the buyer.
        cancelBooking(scanResult.barcode);
        customAlert(isRTL ? 'تم إلغاء الحجز بنجاح' : 'Booking Cancelled Successfully');
        setScanResult(null);
        setManualCode('');
    };

    if (!isOpen) return null;

    const remaining = scanResult ? Math.max(0, scanResult.expiryTime - Date.now()) : 0;
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 2000,
            background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 16
        }}>
            <div style={{
                background: 'var(--card-bg)', borderRadius: 28,
                width: '100%', maxWidth: 420, maxHeight: '90vh', overflow: 'auto',
                boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
            }}>
                {/* Header */}
                <div style={{
                    background: 'linear-gradient(135deg, #0f172a, #334155)',
                    color: 'white', padding: '20px 24px',
                    borderRadius: '28px 28px 0 0',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                }}>
                    <h2 style={{ fontSize: '1.1rem', fontWeight: 900 }}>
                        {isRTL ? '📷 سكانر الحجز' : '📷 Booking Scanner'}
                    </h2>
                    <button onClick={onClose} style={{
                        background: 'rgba(100, 100, 100, 0.15)', border: 'none', color: 'white',
                        width: 36, height: 36, borderRadius: 12, fontSize: '1rem'
                    }}>✕</button>
                </div>

                <div style={{ padding: 24 }}>
                    {verified ? (
                        /* Success animation */
                        <div style={{ textAlign: 'center', padding: '40px 0' }}>
                            <div style={{ fontSize: '4rem', marginBottom: 16 }}>✅</div>
                            <div style={{ fontSize: '1.3rem', fontWeight: 900, color: 'var(--primary)', marginBottom: 8 }}>
                                {isRTL ? 'تم التحقق بنجاح!' : 'Verified Successfully!'}
                            </div>
                            <div style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>
                                {isRTL ? 'تم تأكيد وصول المشتري' : 'Buyer arrival confirmed'}
                            </div>
                        </div>
                    ) : scanResult ? (
                        /* Booking Details */
                        <div>
                            <div style={{
                                background: 'var(--gray-50)', borderRadius: 16, padding: 16, marginBottom: 20,
                                border: '1.5px solid var(--primary)', textAlign: 'center'
                            }}>
                                <div style={{ fontSize: '0.8rem', color: 'var(--primary)', fontWeight: 800 }}>
                                    {isRTL ? '✅ حجز صالح' : '✅ Valid Booking'}
                                </div>
                            </div>

                            <div style={{ display: 'flex', gap: 15, marginBottom: 20, background: 'var(--gray-100)', borderRadius: 16, padding: 16 }}>
                                <img src={scanResult.deal.images[0]} loading="lazy" alt=""
                                    style={{ width: 70, height: 70, borderRadius: 14, objectFit: 'cover' }} />
                                <div>
                                    <div style={{ fontWeight: 900, color: 'var(--dark)', marginBottom: 4 }}>{scanResult.deal.itemName}</div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 700 }}>{scanResult.deal.shopName}</div>
                                    <div style={{ color: 'var(--primary)', fontWeight: 900, marginTop: 4 }}>{isRTL ? 'الكمية:' : 'Qty:'} {scanResult.bookedQuantity || 1}</div>
                                    <div style={{ color: 'var(--danger)', fontWeight: 900, marginTop: 4 }}>{scanResult.deal.discountedPrice} ر.س</div>
                                </div>
                            </div>

                            <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
                                <div style={{ flex: 1, background: 'var(--gray-100)', borderRadius: 12, padding: 12, textAlign: 'center' }}>
                                    <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 700 }}>{isRTL ? 'الرمز' : 'Code'}</div>
                                    <div style={{ fontWeight: 900, fontFamily: 'monospace' }}>{scanResult.barcode}</div>
                                </div>
                                <div style={{ flex: 1, background: remaining > 0 ? '#fef3c7' : '#fee2e2', borderRadius: 12, padding: 12, textAlign: 'center' }}>
                                    <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 700 }}>{isRTL ? 'الوقت المتبقي' : 'Time Left'}</div>
                                    <div style={{ fontWeight: 900, color: remaining > 0 ? '#92400e' : '#b91c1c' }}>
                                        {remaining > 0 ? `${minutes}:${String(seconds).padStart(2, '0')}` : (isRTL ? 'منتهي' : 'Expired')}
                                    </div>
                                </div>
                            </div>

                            <div style={{ display: 'flex', gap: 10 }}>
                                <button onClick={handleVerify} style={{
                                    flex: 2, padding: 16, borderRadius: 16,
                                    background: 'var(--primary)',
                                    color: 'white', fontWeight: 900, fontSize: '1.05rem', border: 'none'
                                }}>
                                    {isRTL ? '✅ تأكيد الوصول' : '✅ Confirm'}
                                </button>
                                <button onClick={handleCancel} style={{
                                    flex: 1, padding: 16, borderRadius: 16,
                                    background: 'rgba(239, 68, 68, 0.15)', color: 'var(--danger)',
                                    fontWeight: 900, fontSize: '0.9rem', border: 'none'
                                }}>
                                    {isRTL ? '❌ إلغاء' : '❌ Cancel'}
                                </button>
                            </div>
                        </div>
                    ) : (
                        /* Scanner / Manual Input */
                        <div>
                            {/* Camera Section */}
                            <div style={{
                                background: '#0f172a', borderRadius: 16, height: 200,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                marginBottom: 20, overflow: 'hidden', position: 'relative'
                            }}>
                                {cameraActive ? (
                                    <video 
                                        ref={videoRef} 
                                        autoPlay 
                                        playsInline 
                                        muted 
                                        style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                                    />
                                ) : (
                                    <button onClick={startCamera} style={{
                                        background: 'rgba(80, 80, 90, 0.3)', border: '2px dashed rgba(80, 80, 95, 0.2)',
                                        color: 'white', padding: '16px 24px', borderRadius: 16,
                                        fontSize: '0.9rem', fontWeight: 800, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8
                                    }}>
                                        <span style={{ fontSize: '2rem' }}>📷</span>
                                        {isRTL ? 'فتح الكاميرا للمسح' : 'Open Camera to Scan'}
                                    </button>
                                )}
                                {/* Scan overlay frame */}
                                {cameraActive && (
                                    <div style={{
                                        position: 'absolute', inset: 'auto', width: 180, height: 180,
                                        border: '3px solid var(--primary)',
                                        borderRadius: 20
                                    }} />
                                )}
                            </div>

                            {/* Divider */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
                                <div style={{ flex: 1, height: 1, background: 'var(--gray-200)' }} />
                                <span style={{ color: 'var(--gray-400)', fontSize: '0.8rem', fontWeight: 700 }}>{isRTL ? 'أو أدخل الرمز يدوياً' : 'Or enter code manually'}</span>
                                <div style={{ flex: 1, height: 1, background: 'var(--gray-200)' }} />
                            </div>

                            {/* Manual Input */}
                            <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                                <input
                                    value={manualCode}
                                    onChange={e => setManualCode(e.target.value)}
                                    placeholder={isRTL ? 'أدخل رمز الباركود أو الرمز الاحتياطي' : 'Enter barcode or backup code'}
                                    style={{
                                        flex: 1, padding: '14px 16px', borderRadius: 14,
                                        border: '1.5px solid var(--gray-200)',
                                        fontSize: '0.95rem', fontWeight: 700, fontFamily: 'monospace',
                                        textAlign: 'center', letterSpacing: 2, outline: 'none'
                                    }}
                                    onKeyPress={e => e.key === 'Enter' && handleManualSearch()}
                                />
                            </div>
                            <button onClick={handleManualSearch} style={{
                                width: '100%', padding: 14, borderRadius: 14,
                                background: 'var(--dark)', color: 'white',
                                fontWeight: 800, border: 'none', fontSize: '0.95rem'
                            }}>
                                {isRTL ? '🔍 بحث عن الحجز' : '🔍 Search Booking'}
                            </button>

                            {scanError && (
                                <div style={{
                                    marginTop: 12, padding: 12, borderRadius: 12,
                                    background: 'rgba(239, 68, 68, 0.15)', color: 'var(--danger)', fontWeight: 700,
                                    fontSize: '0.85rem', textAlign: 'center'
                                }}>
                                    {scanError}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default BarcodeScanner;
