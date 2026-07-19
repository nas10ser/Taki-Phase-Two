import React, { useState, useEffect, useMemo, useCallback } from 'react';

interface DualCalendarPickerProps {
    isOpen: boolean;
    onClose: () => void;
    /** Called with { hijri: 'YYYY-MM-DD', gregorian: 'YYYY-MM-DD' } */
    onSelect: (dates: { hijri: string; gregorian: string }) => void;
    isRTL: boolean;
    /** Pre-selected Hijri date 'YYYY-MM-DD' or Gregorian 'YYYY-MM-DD' */
    currentHijri?: string;
    currentGregorian?: string;
    /** v12.50 — نطاق مسموح (ميلادي YYYY-MM-DD): أيام خارجَه تُعطَّل ولا تُختار.
     *  يُستخدم لحصر عروض الموسم بين تاريخي الحملة اللذين حددهما المالك. */
    minDate?: string;
    maxDate?: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const HIJRI_MONTHS = [
    { id: 1, ar: 'محرم',      en: 'Muharram' },
    { id: 2, ar: 'صفر',       en: 'Safar' },
    { id: 3, ar: 'ربيع الأول', en: "Rabi' al-Awwal" },
    { id: 4, ar: 'ربيع الآخر', en: "Rabi' al-Thani" },
    { id: 5, ar: 'جمادى الأولى', en: 'Jumada al-Ula' },
    { id: 6, ar: 'جمادى الآخرة', en: 'Jumada al-Akhirah' },
    { id: 7, ar: 'رجب',       en: 'Rajab' },
    { id: 8, ar: 'شعبان',     en: "Sha'ban" },
    { id: 9, ar: 'رمضان',     en: 'Ramadan' },
    { id: 10, ar: 'شوال',     en: 'Shawwal' },
    { id: 11, ar: 'ذو القعدة', en: "Dhu al-Qi'dah" },
    { id: 12, ar: 'ذو الحجة', en: 'Dhu al-Hijjah' },
];

const GR_MONTHS_AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
const GR_MONTHS_EN = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const WEEK_DAYS_AR = ['ح','ن','ث','ر','خ','ج','س'];
const WEEK_DAYS_EN = ['Su','Mo','Tu','We','Th','Fr','Sa'];

// ─── Hijri↔Gregorian Engine (Intl-based, Umm al-Qura) ──────────────────────

function gregorianToHijri(date: Date): { y: number; m: number; d: number } {
    const parts = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', {
        year: 'numeric', month: 'numeric', day: 'numeric',
    }).formatToParts(date);
    return {
        y: parseInt((parts.find(p => p.type === 'year') || {value: '1446'}).value),
        m: parseInt((parts.find(p => p.type === 'month') || {value: '1'}).value),
        d: parseInt((parts.find(p => p.type === 'day') || {value: '1'}).value),
    };
}

/** Find Gregorian date whose Hijri is the 1st of the given Hijri month */
function hijriMonthStart(hYear: number, hMonth: number): Date {
    // Estimate: Hijri epoch is ~622 CE, avg year ~354.37 days
    const approxJD = (hYear - 1) * 354.37 + (hMonth - 1) * 29.5;
    let greg = new Date(622, 6, 16); // Hijri epoch
    greg.setDate(greg.getDate() + Math.floor(approxJD));

    // Fine-tune
    let h = gregorianToHijri(greg);
    let safety = 0;
    while ((h.y !== hYear || h.m !== hMonth) && safety++ < 600) {
        if (h.y < hYear || (h.y === hYear && h.m < hMonth)) greg.setDate(greg.getDate() + 1);
        else greg.setDate(greg.getDate() - 1);
        h = gregorianToHijri(greg);
    }
    // Backtrack to exact 1st
    while (h.d > 1) {
        greg.setDate(greg.getDate() - 1);
        h = gregorianToHijri(greg);
    }
    return greg;
}

/** Get all days in a Hijri month: [{hijriDay, gregorianDate}] */
function getHijriMonthDays(hYear: number, hMonth: number): Array<{ hd: number; greg: Date }> {
    const start = hijriMonthStart(hYear, hMonth);
    const result: Array<{ hd: number; greg: Date }> = [];
    let cur = new Date(start);
    let h = gregorianToHijri(cur);
    while (h.m === hMonth && h.y === hYear) {
        result.push({ hd: h.d, greg: new Date(cur) });
        cur.setDate(cur.getDate() + 1);
        h = gregorianToHijri(cur);
    }
    return result;
}

/** Local-timezone YYYY-MM-DD — NOT toISOString(): that converts to UTC and
 *  rolls the date back a day for any timezone east of Greenwich (Riyadh +3),
 *  which made the saved Gregorian date lag one day behind the picked Hijri. */
function toLocalYMD(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Format gregorian date for display */
function formatGregDay(date: Date) {
    return date.getDate();
}
function gregMonthShort(date: Date, ar: boolean) {
    return ar ? GR_MONTHS_AR[date.getMonth()].slice(0,3) : GR_MONTHS_EN[date.getMonth()].slice(0,3);
}

// ─── Component ──────────────────────────────────────────────────────────────

const DualCalendarPicker: React.FC<DualCalendarPickerProps> = ({
    isOpen, onClose, onSelect, isRTL, currentHijri, currentGregorian, minDate, maxDate,
}) => {
    const today = new Date();
    const todayH = gregorianToHijri(today);

    // v12.50 — هل هذا اليوم داخل النطاق المسموح؟ (بدون نطاق = كل الأيام مسموحة)
    const inRange = useCallback((d: Date): boolean => {
        const s = toLocalYMD(d);
        if (minDate && s < minDate) return false;
        if (maxDate && s > maxDate) return false;
        return true;
    }, [minDate, maxDate]);

    // ── View state: which Hijri month are we browsing ──
    const [viewH, setViewH] = useState<{ y: number; m: number }>({ y: todayH.y, m: todayH.m });

    // ── Selected date (stored as Gregorian Date object) ──
    const [selectedGreg, setSelectedGreg] = useState<Date | null>(null);

    // ── Calendar mode toggle ──
    const [mode, setMode] = useState<'hijri' | 'gregorian'>('hijri');

    // ── Gregorian view for Gregorian mode ──
    const [viewGreg, setViewGreg] = useState<{ y: number; m: number }>({ y: today.getFullYear(), m: today.getMonth() });

    // Re-sync from props every time picker opens - so clearing parent state resets calendar
    useEffect(() => {
        if (!isOpen) return;
        if (currentGregorian) {
            const d = new Date(currentGregorian);
            setSelectedGreg(d);
            setViewGreg({ y: d.getFullYear(), m: d.getMonth() });
            const h = gregorianToHijri(d);
            setViewH({ y: h.y, m: h.m });
        } else if (currentHijri) {
            const [y, m, d] = currentHijri.split('-').map(Number);
            if (y && m && d) {
                const start = hijriMonthStart(y, m);
                setSelectedGreg(start);
                setViewH({ y, m });
                setViewGreg({ y: start.getFullYear(), m: start.getMonth() });
            }
        } else {
            // No date selected: start from today
            setSelectedGreg(null);
            setViewH({ y: todayH.y, m: todayH.m });
            setViewGreg({ y: today.getFullYear(), m: today.getMonth() });
            setMode('hijri'); // reset to hijri mode
        }
    }, [isOpen, currentHijri, currentGregorian]);

    // Switch mode and CLEAR selected date to avoid cross-calendar confusion
    const handleModeSwitch = (newMode: 'hijri' | 'gregorian') => {
        if (newMode === mode) return; // no-op if same mode
        // Clear local selection
        setSelectedGreg(null);
        // Notify parent to clear stored dates too
        onSelect({ hijri: '', gregorian: '' });
        // Sync the view to today in the new mode
        const h = gregorianToHijri(today);
        setViewH({ y: h.y, m: h.m });
        setViewGreg({ y: today.getFullYear(), m: today.getMonth() });
        setMode(newMode);
    };

    // ── Hijri month days ──
    const hijriDays = useMemo(() => getHijriMonthDays(viewH.y, viewH.m), [viewH.y, viewH.m]);
    const hijriStartWeekday = (hijriDays[0] && hijriDays[0].greg && hijriDays[0].greg.getDay()) || 0;

    // ── Gregorian month days ──
    const gregorianDays = useMemo(() => {
        const days: Date[] = [];
        const start = new Date(viewGreg.y, viewGreg.m, 1);
        const cur = new Date(start);
        while (cur.getMonth() === viewGreg.m) {
            days.push(new Date(cur));
            cur.setDate(cur.getDate() + 1);
        }
        return days;
    }, [viewGreg.y, viewGreg.m]);
    const gregStartWeekday = (gregorianDays[0] && gregorianDays[0].getDay()) || 0;

    const isSameDay = (a: Date, b: Date) =>
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate();

    const handleSelectDay = useCallback((gregDate: Date) => {
        if (!inRange(gregDate)) return; // خارج نطاق الموسم — اليوم مُعطَّل
        setSelectedGreg(gregDate);
        const h = gregorianToHijri(gregDate);
        const hijri = `${h.y}-${String(h.m).padStart(2,'0')}-${String(h.d).padStart(2,'0')}`;
        const gregorian = toLocalYMD(gregDate);
        onSelect({ hijri, gregorian });
        onClose();
    }, [onSelect, onClose, inRange]);

    const changeHijriMonth = (delta: number) => {
        setViewH(prev => {
            let m = prev.m + delta;
            let y = prev.y;
            if (m > 12) { m = 1; y++; }
            if (m < 1)  { m = 12; y--; }
            return { y, m };
        });
    };

    const changeGregMonth = (delta: number) => {
        setViewGreg(prev => {
            let m = prev.m + delta;
            let y = prev.y;
            if (m > 11) { m = 0; y++; }
            if (m < 0)  { m = 11; y--; }
            return { y, m };
        });
    };

    const handleToday = () => {
        const h = gregorianToHijri(today);
        setViewH({ y: h.y, m: h.m });
        setViewGreg({ y: today.getFullYear(), m: today.getMonth() });
        if (inRange(today)) handleSelectDay(today);
    };

    const handleClear = () => {
        setSelectedGreg(null);
        onSelect({ hijri: '', gregorian: '' });
        onClose();
    };

    // Format selected date label
    const selectedLabel = useMemo(() => {
        if (!selectedGreg) return null;
        const h = gregorianToHijri(selectedGreg);
        const hStr = `${h.d} ${isRTL ? HIJRI_MONTHS[h.m-1].ar : HIJRI_MONTHS[h.m-1].en} ${h.y}هـ`;
        // 'ar-SA' وحدها تعرض التقويم الهجري (أم القرى) — إجبار gregory حتى
        // يظهر السطر الثاني ميلادياً فعلاً بدل هجريين متطابقين.
        const gStr = selectedGreg.toLocaleDateString(isRTL ? 'ar-SA-u-ca-gregory' : 'en-US', { day:'numeric', month:'long', year:'numeric' });
        return { h: hStr, g: gStr };
    }, [selectedGreg, isRTL]);

    // Dual-date label for each cell in Hijri mode
    const getGregLabel = (gregDate: Date) => {
        const day = gregDate.getDate();
        const h = gregorianToHijri(gregDate);
        return { gDay: day, hDay: h.d };
    };

    if (!isOpen) return null;

    const weekDays = isRTL ? WEEK_DAYS_AR : WEEK_DAYS_EN;

    // ─── Styles ──────────────────────────────────────────────────────────────
    const overlay: React.CSSProperties = {
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.65)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        zIndex: 10000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
    };

    const container: React.CSSProperties = {
        background: 'var(--body-bg)',
        width: '100%', maxWidth: 380,
        borderRadius: 28,
        overflow: 'hidden',
        boxShadow: '0 30px 80px rgba(0,0,0,0.4), 0 0 0 1px rgba(80, 80, 90, 0.2)',
        direction: isRTL ? 'rtl' : 'ltr',
        animation: 'dualCalScaleIn 0.35s cubic-bezier(0.16, 1, 0.3, 1)',
    };

    return (
        <>
            <style>{`
                @keyframes dualCalScaleIn {
                    from { opacity: 0; transform: scale(0.88) translateY(20px); }
                    to   { opacity: 1; transform: scale(1) translateY(0); }
                }
                .dcal-day-btn {
                    position: relative;
                    display: flex; flex-direction: column;
                    align-items: center; justify-content: center;
                    border-radius: 12px; border: none;
                    cursor: pointer;
                    transition: all 0.18s cubic-bezier(0.4,0,0.2,1);
                    padding: 3px 0;
                    gap: 1px;
                    aspect-ratio: 1;
                    min-height: 44px;
                    -webkit-tap-highlight-color: transparent;
                }
                .dcal-day-btn:active { transform: scale(0.93); }
                .dcal-day-btn.selected {
                    background: linear-gradient(135deg, var(--primary), var(--primary-dark, #1e293b)) !important;
                    box-shadow: 0 4px 14px rgba(15,23,42,0.35);
                }
                .dcal-day-btn.today-cell {
                    background: rgba(15,23,42,0.08) !important;
                    outline: 1.5px solid var(--primary);
                }
                .dcal-day-btn:not(.selected):not(.today-cell):hover {
                    background: rgba(15,23,42,0.07) !important;
                }
                .dcal-nav-btn {
                    width: 34px; height: 34px; border: none;
                    border-radius: 10px;
                    background: rgba(80, 80, 95, 0.12);
                    color: white;
                    font-size: 1rem; font-weight: 900;
                    cursor: pointer; display: flex;
                    align-items: center; justify-content: center;
                    transition: background 0.15s;
                }
                .dcal-nav-btn:hover { background: rgba(80, 80, 95, 0.22); }
                .dcal-mode-btn {
                    flex: 1; padding: 8px 4px;
                    border: none; border-radius: 10px;
                    font-weight: 800; font-size: 0.82rem;
                    cursor: pointer;
                    transition: all 0.2s;
                }
                .dcal-mode-btn.active {
                    background: white;
                    color: var(--primary);
                    box-shadow: 0 3px 10px rgba(0,0,0,0.2);
                }
                .dcal-mode-btn:not(.active) {
                    background: transparent;
                    color: rgba(150, 150, 165, 0.7);
                }
            `}</style>
            <div style={overlay} onClick={onClose}>
                <div style={container} onClick={e => e.stopPropagation()}>

                    {/* ── HEADER GRADIENT BAR ── */}
                    <div style={{
                        background: 'linear-gradient(135deg, var(--primary, #0f172a), var(--primary-dark, #1e293b))',
                        padding: '18px 20px 16px',
                    }}>
                        {/* Mode Toggle */}
                        <div style={{
                            display: 'flex', gap: 6,
                            background: 'rgba(0,0,0,0.18)',
                            borderRadius: 12, padding: 4,
                            marginBottom: 16,
                        }}>
                            <button
                                className={`dcal-mode-btn ${mode === 'hijri' ? 'active' : ''}`}
                                onClick={() => handleModeSwitch('hijri')}
                            >
                                {isRTL ? '📅 الهجري' : '📅 Hijri'}
                            </button>
                            <button
                                className={`dcal-mode-btn ${mode === 'gregorian' ? 'active' : ''}`}
                                onClick={() => handleModeSwitch('gregorian')}
                            >
                                {isRTL ? '🗓 الميلادي' : '🗓 Gregorian'}
                            </button>
                        </div>

                        {/* v12.50 — نطاق الموسم المسموح (يظهر فقط عندما يُمرَّر حد) */}
                        {(minDate || maxDate) && (
                            <div style={{
                                marginBottom: 10, padding: '6px 10px', borderRadius: 10,
                                background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.25)',
                                color: 'white', fontSize: '0.7rem', fontWeight: 800, textAlign: 'center',
                            }}>
                                {isRTL
                                    ? `🌟 المسموح داخل الموسم: ${minDate ? `من ${minDate}` : ''} ${maxDate ? `إلى ${maxDate}` : ''}`
                                    : `🌟 Season range: ${minDate ? `from ${minDate}` : ''} ${maxDate ? `to ${maxDate}` : ''}`}
                            </div>
                        )}

                        {/* Selected Date Display */}
                        <div style={{ color: 'white' }}>
                            {selectedLabel ? (
                                <>
                                    <div style={{
                                        fontSize: '0.72rem', opacity: 0.75, fontWeight: 700,
                                        marginBottom: 2, letterSpacing: 0.3,
                                        textTransform: 'uppercase',
                                    }}>
                                        {isRTL ? 'التاريخ المختار' : 'Selected Date'}
                                    </div>
                                    <div style={{ fontSize: '1.05rem', fontWeight: 900, lineHeight: 1.3 }}>
                                        {selectedLabel.h}
                                    </div>
                                    <div style={{ fontSize: '0.82rem', opacity: 0.8, fontWeight: 700, marginTop: 2 }}>
                                        {selectedLabel.g}
                                    </div>
                                </>
                            ) : (
                                <div style={{ fontSize: '0.95rem', fontWeight: 800, opacity: 0.8 }}>
                                    {isRTL ? 'اختر تاريخ الانتهاء' : 'Select an expiry date'}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* ── CALENDAR BODY ── */}
                    <div style={{ padding: '16px 14px 12px' }}>

                        {/* Month Navigation */}
                        <div style={{
                            display: 'flex', alignItems: 'center',
                            justifyContent: 'space-between',
                            marginBottom: 14,
                        }}>
                            <button className="dcal-nav-btn" onClick={() => mode === 'hijri' ? changeHijriMonth(-1) : changeGregMonth(-1)}>
                                {isRTL ? '›' : '‹'}
                            </button>

                            <div style={{ textAlign: 'center' }}>
                                {mode === 'hijri' ? (
                                    <>
                                        <div style={{ fontWeight: 900, fontSize: '1rem', color: 'var(--text-primary)' }}>
                                            {isRTL ? HIJRI_MONTHS[viewH.m-1].ar : HIJRI_MONTHS[viewH.m-1].en}
                                            {' '}{viewH.y}
                                            <span style={{ fontSize: '0.75rem', opacity: 0.6, fontWeight: 800 }}> هـ</span>
                                        </div>
                                        {/* Corresponding Gregorian range */}
                                        {hijriDays.length > 0 && (
                                            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 700, marginTop: 2 }}>
                                                {(() => {
                                                    const firstG = hijriDays[0].greg;
                                                    const lastG = hijriDays[hijriDays.length-1].greg;
                                                    const m1 = isRTL ? GR_MONTHS_AR[firstG.getMonth()] : GR_MONTHS_EN[firstG.getMonth()];
                                                    const m2 = isRTL ? GR_MONTHS_AR[lastG.getMonth()] : GR_MONTHS_EN[lastG.getMonth()];
                                                    return m1 === m2
                                                        ? `${m1} ${firstG.getFullYear()}`
                                                        : `${m1} – ${m2} ${lastG.getFullYear()}`;
                                                })()}
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    <>
                                        <div style={{ fontWeight: 900, fontSize: '1rem', color: 'var(--text-primary)' }}>
                                            {isRTL ? GR_MONTHS_AR[viewGreg.m] : GR_MONTHS_EN[viewGreg.m]}
                                            {' '}{viewGreg.y}
                                        </div>
                                        {/* Corresponding Hijri range */}
                                        {gregorianDays.length > 0 && (
                                            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 700, marginTop: 2 }}>
                                                {(() => {
                                                    const h1 = gregorianToHijri(gregorianDays[0]);
                                                    const h2 = gregorianToHijri(gregorianDays[gregorianDays.length-1]);
                                                    const hm1 = isRTL ? HIJRI_MONTHS[h1.m-1].ar : HIJRI_MONTHS[h1.m-1].en;
                                                    const hm2 = isRTL ? HIJRI_MONTHS[h2.m-1].ar : HIJRI_MONTHS[h2.m-1].en;
                                                    return h1.m === h2.m && h1.y === h2.y
                                                        ? `${hm1} ${h1.y}هـ`
                                                        : `${hm1} – ${hm2} ${h2.y}هـ`;
                                                })()}
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>

                            <button className="dcal-nav-btn" onClick={() => mode === 'hijri' ? changeHijriMonth(1) : changeGregMonth(1)}>
                                {isRTL ? '‹' : '›'}
                            </button>
                        </div>

                        {/* Weekday Headers */}
                        <div style={{
                            display: 'grid', gridTemplateColumns: 'repeat(7,1fr)',
                            gap: 2, marginBottom: 6,
                        }}>
                            {weekDays.map((d, i) => (
                                <div key={i} style={{
                                    textAlign: 'center',
                                    fontSize: '0.72rem', fontWeight: 800,
                                    color: 'var(--text-secondary)',
                                    padding: '4px 0',
                                }}>
                                    {d}
                                </div>
                            ))}
                        </div>

                        {/* ── HIJRI MODE GRID ── */}
                        {mode === 'hijri' && (
                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(7,1fr)',
                                gap: 3,
                            }}>
                                {Array.from({ length: hijriStartWeekday }).map((_, i) => <div key={`e${i}`} />)}
                                {hijriDays.map(({ hd, greg }) => {
                                    const isSelected = selectedGreg ? isSameDay(greg, selectedGreg) : false;
                                    const isTodayCell = isSameDay(greg, today);
                                    const isDisabled = !inRange(greg);
                                    const gregDay = greg.getDate();
                                    const h = gregorianToHijri(greg);
                                    const isFirstOfGregMonth = gregDay === 1;

                                    return (
                                        <button
                                            key={hd}
                                            disabled={isDisabled}
                                            className={`dcal-day-btn${isSelected ? ' selected' : ''}${isTodayCell && !isSelected ? ' today-cell' : ''}`}
                                            style={{
                                                background: isSelected ? undefined : 'transparent',
                                                opacity: isDisabled ? 0.22 : 1,
                                                cursor: isDisabled ? 'not-allowed' : 'pointer',
                                            }}
                                            onClick={() => handleSelectDay(greg)}
                                        >
                                            {/* Primary: Hijri day */}
                                            <span style={{
                                                fontSize: '1rem',
                                                fontWeight: 900,
                                                color: isSelected ? 'white' : (isTodayCell ? 'var(--primary)' : 'var(--text-primary)'),
                                                lineHeight: 1,
                                            }}>
                                                {hd}
                                            </span>
                                            {/* Today dot */}
                                            {isTodayCell && !isSelected && (
                                                <span style={{
                                                    position: 'absolute', bottom: 2,
                                                    width: 4, height: 4,
                                                    borderRadius: 2,
                                                    background: 'var(--primary)',
                                                }} />
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        )}

                        {/* ── GREGORIAN MODE GRID ── */}
                        {mode === 'gregorian' && (
                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(7,1fr)',
                                gap: 3,
                            }}>
                                {Array.from({ length: gregStartWeekday }).map((_, i) => <div key={`e${i}`} />)}
                                {gregorianDays.map((greg) => {
                                    const isSelected = selectedGreg ? isSameDay(greg, selectedGreg) : false;
                                    const isTodayCell = isSameDay(greg, today);
                                    const isDisabled = !inRange(greg);
                                    const h = gregorianToHijri(greg);
                                    const isFirstOfHijriMonth = h.d === 1;

                                    return (
                                        <button
                                            key={greg.getDate()}
                                            disabled={isDisabled}
                                            className={`dcal-day-btn${isSelected ? ' selected' : ''}${isTodayCell && !isSelected ? ' today-cell' : ''}`}
                                            style={{
                                                background: isSelected ? undefined : 'transparent',
                                                opacity: isDisabled ? 0.22 : 1,
                                                cursor: isDisabled ? 'not-allowed' : 'pointer',
                                            }}
                                            onClick={() => handleSelectDay(greg)}
                                        >
                                            {/* Primary: Gregorian day */}
                                            <span style={{
                                                fontSize: '1rem', fontWeight: 900,
                                                color: isSelected ? 'white' : (isTodayCell ? 'var(--primary)' : 'var(--text-primary)'),
                                                lineHeight: 1,
                                            }}>
                                                {greg.getDate()}
                                            </span>
                                            {/* Today dot */}
                                            {isTodayCell && !isSelected && (
                                                <span style={{
                                                    position: 'absolute', bottom: 2,
                                                    width: 4, height: 4, borderRadius: 2,
                                                    background: 'var(--primary)',
                                                }} />
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        )}



                        {/* ── FOOTER ACTIONS ── */}
                        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                            <button
                                onClick={handleClear}
                                style={{
                                    flex: 1, padding: '11px',
                                    borderRadius: 14, border: '1.5px solid var(--border-color, #e2e8f0)',
                                    background: 'transparent',
                                    color: 'var(--text-secondary)',
                                    fontWeight: 800, fontSize: '0.85rem',
                                    cursor: 'pointer',
                                }}
                            >
                                {isRTL ? 'مسح' : 'Clear'}
                            </button>
                            <button
                                onClick={handleToday}
                                style={{
                                    flex: 1, padding: '11px',
                                    borderRadius: 14, border: '1.5px solid var(--primary)',
                                    background: 'rgba(15,23,42,0.06)',
                                    color: 'var(--primary)',
                                    fontWeight: 800, fontSize: '0.85rem',
                                    cursor: 'pointer',
                                }}
                            >
                                {isRTL ? 'اليوم' : 'Today'}
                            </button>
                            <button
                                onClick={onClose}
                                style={{
                                    flex: 1, padding: '11px',
                                    borderRadius: 14, border: 'none',
                                    background: 'linear-gradient(135deg, var(--primary, #0f172a), var(--primary-dark, #1e293b))',
                                    color: 'white',
                                    fontWeight: 900, fontSize: '0.85rem',
                                    cursor: 'pointer',
                                    boxShadow: '0 4px 12px rgba(15,23,42,0.3)',
                                }}
                            >
                                {isRTL ? 'إغلاق' : 'Close'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
};

export default DualCalendarPicker;
