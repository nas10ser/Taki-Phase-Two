/**
 * PasswordField — حقل كلمة مرور واحد لكل المنصّة (v14.01)
 * ---------------------------------------------------------------------------
 * طلب ناصر: «أظهر لي علامة العين وهذه الشروط عند إعادة تعيين كلمة المرور
 * وعند تغييرها من الإعدادات، وتأكّد من ربطها في قاعدة البيانات».
 *
 * كانت الشروط الخمسة مكتوبة داخل صفحة التسجيل وحدها، فشاشة إعادة التعيين
 * تقبل ٨ أحرف صغيرة، وشاشة الإعدادات تقبل ما هو أضعف. أي أن **أضعف باب
 * يحدّد قوة كلمات المرور فعلياً** لا أقواها.
 *
 * المعايير هنا هي **نفسها** المفروضة على خادم جدة
 * (`GOTRUE_PASSWORD_MIN_LENGTH=8` + `GOTRUE_PASSWORD_REQUIRED_CHARACTERS`)،
 * فلا يعد المستخدم بشيء ثم يرفضه الخادم أو العكس.
 */
import React, { useState } from 'react';

/** الشروط الخمسة — مصدر واحد لكل الشاشات. */
export const pwChecks = (pw: string) => ({
    length: pw.length >= 8,
    uppercase: /[A-Z]/.test(pw),
    lowercase: /[a-z]/.test(pw),
    number: /[0-9]/.test(pw),
    // ⚠️ هذه المجموعة **مطابقة حرفياً** لـGOTRUE_PASSWORD_REQUIRED_CHARACTERS
    // على خادم جدة. أي اختلاف = وعدٌ للمستخدم يرفضه الخادم، أو العكس.
    special: /[!@#$%\^&*()_+\-=[\]{};':"|<>?,./`~]/.test(pw),
});

export const pwScore = (pw: string) => Object.values(pwChecks(pw)).filter(Boolean).length;
export const pwIsStrong = (pw: string) => pwScore(pw) === 5;

interface Props {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    isRTL?: boolean;
    /** يخفي لوحة الشروط — لحقل «كلمة السر الحالية» حيث لا معنى لتقييمها. */
    hideChecklist?: boolean;
    autoComplete?: string;
    onEnter?: () => void;
    inputStyle?: React.CSSProperties;
}

const OFF = '#94a3b8';
const OK = '#10b981';

const PasswordField: React.FC<Props> = ({
    value, onChange, placeholder, isRTL = true, hideChecklist = false,
    autoComplete = 'new-password', onEnter, inputStyle,
}) => {
    const [show, setShow] = useState(false);
    const c = pwChecks(value);
    const score = Object.values(c).filter(Boolean).length;

    let barColor = OFF, label = '';
    if (value.length > 0) {
        if (score <= 2) { barColor = '#ef4444'; label = isRTL ? 'ضعيفة' : 'Weak'; }
        else if (score <= 4) { barColor = '#f59e0b'; label = isRTL ? 'متوسطة' : 'Fair'; }
        else { barColor = OK; label = isRTL ? 'قوية' : 'Strong'; }
    }

    const row = (ok: boolean, ar: string, en: string) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', color: ok ? OK : OFF }}>
            <span>{ok ? '✅' : '⚪️'}</span><span>{isRTL ? ar : en}</span>
        </div>
    );

    const baseInput: React.CSSProperties = inputStyle || {
        width: '100%', padding: '15px 18px', borderRadius: 14,
        background: 'rgba(80, 80, 90, 0.2)', border: '1.5px solid rgba(80, 80, 90, 0.2)',
        color: 'white', outline: 'none', fontSize: '0.95rem', fontFamily: 'inherit',
    };

    return (
        <div style={{ width: '100%' }}>
            <div style={{ position: 'relative', width: '100%' }}>
                <input
                    type={show ? 'text' : 'password'}
                    value={value}
                    onChange={e => onChange(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && onEnter) onEnter(); }}
                    placeholder={placeholder}
                    autoComplete={autoComplete}
                    style={{ ...baseInput, paddingInlineEnd: 48 }}
                />
                {/* زرّ العين — نوعه button لا submit حتى لا يُرسل النموذج. */}
                <button
                    type="button"
                    onClick={() => setShow(s => !s)}
                    aria-label={show ? (isRTL ? 'إخفاء كلمة المرور' : 'Hide password')
                                     : (isRTL ? 'إظهار كلمة المرور' : 'Show password')}
                    style={{
                        position: 'absolute', insetInlineEnd: 10, top: '50%', transform: 'translateY(-50%)',
                        background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem',
                        padding: 6, lineHeight: 1, color: OFF,
                    }}
                >
                    {show ? '🙈' : '👁'}
                </button>
            </div>

            {!hideChecklist && (
                <div style={{
                    marginTop: 10, padding: 12, borderRadius: 14,
                    background: 'rgba(80, 80, 90, 0.12)', border: '1px solid rgba(80, 80, 90, 0.18)',
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <span style={{ fontSize: '0.78rem', fontWeight: 700, opacity: 0.75 }}>
                            {isRTL ? 'قوة الكلمة:' : 'Strength:'}
                        </span>
                        <span style={{ fontSize: '0.78rem', fontWeight: 800, color: barColor }}>{label}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 5, marginBottom: 10 }}>
                        {[0, 1, 2, 3, 4].map(i => (
                            <div key={i} style={{
                                flex: 1, height: 4, borderRadius: 3,
                                background: i < score ? barColor : 'rgba(148,163,184,0.25)',
                                transition: 'background 0.25s',
                            }} />
                        ))}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
                        {row(c.length, '8 أحرف فما فوق', '8+ characters')}
                        {row(c.uppercase, 'حرف كبير', 'Uppercase')}
                        {row(c.lowercase, 'حرف صغير', 'Lowercase')}
                        {row(c.number, 'رقم', 'Number')}
                        {row(c.special, 'رمز خاص (!@#$)', 'Symbol (!@#$)')}
                    </div>
                </div>
            )}
        </div>
    );
};

export default PasswordField;
