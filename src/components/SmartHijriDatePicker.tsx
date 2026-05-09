import React, { useState, useEffect, useMemo } from 'react';

interface SmartHijriDatePickerProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (dateStr: string) => void;
    isRTL: boolean;
    currentDate?: string; // Expecting YYYY-MM-DD Hijri
}

const HIJRI_MONTHS = [
    { id: 1, ar: 'محرم', en: 'Muharram' },
    { id: 2, ar: 'صفر', en: 'Safar' },
    { id: 3, ar: 'ربيع الأول', en: 'Rabi\' al-Awwal' },
    { id: 4, ar: 'ربيع الآخر', en: 'Rabi\' al-Thani' },
    { id: 5, ar: 'جمادى الأولى', en: 'Jumada al-Ula' },
    { id: 6, ar: 'جمادى الآخرة', en: 'Jumada al-Akhirah' },
    { id: 7, ar: 'رجب', en: 'Rajab' },
    { id: 8, ar: 'شعبان', en: 'Sha\'ban' },
    { id: 9, ar: 'رمضان', en: 'Ramadan' },
    { id: 10, ar: 'شوال', en: 'Shawwal' },
    { id: 11, ar: 'ذو القعدة', en: 'Dhu al-Qi\'dah' },
    { id: 12, ar: 'ذو الحجة', en: 'Dhu al-Hijjah' },
];

const WEEK_DAYS = [
    { ar: 'ح', en: 'S' },
    { ar: 'ن', en: 'M' },
    { ar: 'ث', en: 'T' },
    { ar: 'ر', en: 'W' },
    { ar: 'خ', en: 'T' },
    { ar: 'ج', en: 'F' },
    { ar: 'س', en: 'S' },
];

const SmartHijriDatePicker: React.FC<SmartHijriDatePickerProps> = ({ 
    isOpen, 
    onClose, 
    onSelect, 
    isRTL, 
    currentDate 
}) => {
    const [viewDate, setViewDate] = useState(() => {
        const now = new Date();
        const formatter = new Intl.DateTimeFormat('en-u-ca-islamic-uma-nu-latn', {
            day: 'numeric',
            month: 'numeric',
            year: 'numeric'
        });
        const parts = formatter.formatToParts(now);
        return {
            month: parseInt(parts.find(p => p.type === 'month')?.value || '1'),
            year: parseInt(parts.find(p => p.type === 'year')?.value || '1445')
        };
    });

    const [selectedDate, setSelectedDate] = useState<string | null>(currentDate || null);

    // Get Hijri parts for any Gregorian date
    const getHijri = (date: Date) => {
        const parts = new Intl.DateTimeFormat('en-u-ca-islamic-uma-nu-latn', {
            day: 'numeric', month: 'numeric', year: 'numeric'
        }).formatToParts(date);
        return {
            d: parseInt(parts.find(p => p.type === 'day')?.value || '1'),
            m: parseInt(parts.find(p => p.type === 'month')?.value || '1'),
            y: parseInt(parts.find(p => p.type === 'year')?.value || '1445')
        };
    };

    // Calculate grid
    const { days, startDay } = useMemo(() => {
        // Find a Gregorian date that is definitely in the start of this Hijri month
        // We can estimate it: Hijri year starts ~622.
        // Or simply iterate Gregorian dates from a safe starting point.
        let greg = new Date(); // Start from today
        let h = getHijri(greg);
        
        // Adjust year first
        greg.setFullYear(greg.getFullYear() + (viewDate.year - h.y));
        h = getHijri(greg);
        
        // Adjust month (rough adjustment)
        greg.setDate(greg.getDate() + (viewDate.month - h.m) * 29);
        h = getHijri(greg);
        
        // Fine tune to find the 1st of the month
        while (h.m !== viewDate.month || h.y !== viewDate.year) {
            if (h.y < viewDate.year || (h.y === viewDate.year && h.m < viewDate.month)) {
                greg.setDate(greg.getDate() + 1);
            } else {
                greg.setDate(greg.getDate() - 1);
            }
            h = getHijri(greg);
        }
        
        // Backtrack to exactly the 1st
        while (h.d > 1) {
            greg.setDate(greg.getDate() - 1);
            h = getHijri(greg);
        }

        const firstGreg = new Date(greg);
        const dayIdx = firstGreg.getDay(); // 0-6 (Sun-Sat)
        
        const monthDays: number[] = [];
        let currentDay = 1;
        let tempGreg = new Date(firstGreg);
        let tempH = getHijri(tempGreg);
        
        while (tempH.m === viewDate.month) {
            monthDays.push(currentDay);
            currentDay++;
            tempGreg.setDate(tempGreg.getDate() + 1);
            tempH = getHijri(tempGreg);
        }

        return { days: monthDays, startDay: dayIdx };
    }, [viewDate.month, viewDate.year]);

    if (!isOpen) return null;

    const handleSelectDay = (day: number) => {
        const dateStr = `${viewDate.year}-${viewDate.month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
        setSelectedDate(dateStr);
        onSelect(dateStr);
        onClose();
    };

    const changeMonth = (delta: number) => {
        setViewDate(prev => {
            let nextM = prev.month + delta;
            let nextY = prev.year;
            if (nextM > 12) { nextM = 1; nextY++; }
            if (nextM < 1) { nextM = 12; nextY--; }
            return { month: nextM, year: nextY };
        });
    };

    const handleToday = () => {
        const now = new Date();
        const h = getHijri(now);
        const dateStr = `${h.y}-${h.m.toString().padStart(2, '0')}-${h.d.toString().padStart(2, '0')}`;
        setSelectedDate(dateStr);
        onSelect(dateStr);
        onClose();
    };

    const handleClear = () => {
        setSelectedDate(null);
        onSelect('');
        onClose();
    };

    return (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'max(env(safe-area-inset-top, 12px), 12px) 12px max(env(safe-area-inset-bottom, 12px), 12px)' }}>
            <div style={{ background: 'var(--body-bg)', width: '100%', maxWidth: 'min(360px, calc(100vw - 24px))', maxHeight: 'calc(100dvh - 24px)', overflowY: 'auto', borderRadius: 24, padding: 20, boxShadow: '0 20px 50px rgba(0,0,0,0.3)', animation: 'scaleIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)', direction: isRTL ? 'rtl' : 'ltr' }}>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ fontWeight: 900, fontSize: '1.2rem' }}>
                            {isRTL ? HIJRI_MONTHS[viewDate.month - 1].ar : HIJRI_MONTHS[viewDate.month - 1].en} {viewDate.year}
                        </div>
                        <span style={{ fontSize: '0.8rem', opacity: 0.5 }}>▼</span>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button aria-label={isRTL ? 'الشهر السابق' : 'Previous month'} onClick={() => changeMonth(-1)} style={{ background: 'var(--gray-100)', border: 'none', minWidth: 44, minHeight: 44, width: 44, height: 44, borderRadius: 12, fontWeight: 900, fontSize: '1rem' }}>{isRTL ? '←' : '←'}</button>
                        <button aria-label={isRTL ? 'الشهر التالي' : 'Next month'} onClick={() => changeMonth(1)} style={{ background: 'var(--gray-100)', border: 'none', minWidth: 44, minHeight: 44, width: 44, height: 44, borderRadius: 12, fontWeight: 900, fontSize: '1rem' }}>{isRTL ? '→' : '→'}</button>
                    </div>
                </div>

                {/* Week Days */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 8 }}>
                    {WEEK_DAYS.map((d, i) => (
                        <div key={i} style={{ textAlign: 'center', fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-secondary)', padding: '5px 0' }}>
                            {isRTL ? d.ar : d.en}
                        </div>
                    ))}
                </div>

                {/* Grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
                    {/* Padding for start day */}
                    {Array.from({ length: startDay }).map((_, i) => (
                        <div key={`empty-${i}`} />
                    ))}
                    
                    {days.map(d => {
                        const dateStr = `${viewDate.year}-${viewDate.month.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
                        const isSelected = selectedDate === dateStr;
                        const isToday = (() => {
                            const nowH = getHijri(new Date());
                            return nowH.y === viewDate.year && nowH.m === viewDate.month && nowH.d === d;
                        })();

                        return (
                            <button 
                                key={d} 
                                onClick={() => handleSelectDay(d)} 
                                style={{ 
                                    aspectRatio: '1', 
                                    display: 'flex', 
                                    alignItems: 'center', 
                                    justifyContent: 'center', 
                                    borderRadius: 12, 
                                    border: 'none', 
                                    background: isSelected ? 'var(--primary)' : 'transparent',
                                    color: isSelected ? 'white' : (isToday ? 'var(--primary)' : 'var(--text-primary)'),
                                    fontWeight: (isSelected || isToday) ? 900 : 700,
                                    fontSize: '0.9rem',
                                    position: 'relative'
                                }}
                            >
                                {d}
                                {isToday && !isSelected && (
                                    <div style={{ position: 'absolute', bottom: 4, width: 4, height: 4, borderRadius: 2, background: 'var(--primary)' }} />
                                )}
                            </button>
                        );
                    })}
                </div>

                {/* Footer Buttons */}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24, borderTop: '1px solid var(--gray-100)', paddingTop: 16 }}>
                    <button onClick={handleClear} style={{ color: 'var(--primary)', fontWeight: 800, border: 'none', background: 'transparent', fontSize: '0.9rem' }}>
                        {isRTL ? 'مسح' : 'Clear'}
                    </button>
                    <button onClick={handleToday} style={{ color: 'var(--primary)', fontWeight: 800, border: 'none', background: 'transparent', fontSize: '0.9rem' }}>
                        {isRTL ? 'اليوم' : 'Today'}
                    </button>
                </div>

                <button onClick={onClose} style={{ width: '100%', marginTop: 16, padding: '12px', borderRadius: 14, background: 'var(--gray-100)', color: 'var(--text-primary)', fontWeight: 800, border: 'none' }}>
                    {isRTL ? 'إغلاق' : 'Close'}
                </button>
            </div>
        </div>
    );
};

export default SmartHijriDatePicker;
