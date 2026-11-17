import React, { useState } from 'react';
import { normalizeArabicNumerals, sanitizeDecimalInput } from '../../utils/helpers';
import { splitInclusive, fmtSAR } from '../../utils/vat';

/**
 * حقولُ سعر العرض — الأصليُّ وبعدَ الخصم **ونسبةُ الخصم** (v16.33).
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 طلبُ ناصر (١٧ نوفمبر): «لا يوجد خيار يحدد السعر على نسبة الخصم اللي انا
 *    احدده». وكانت النسبةُ مخرَجاً في اتجاهٍ واحد: تُحسب من السعرين وتُعرض
 *    شارةً للقراءة (`خصم ٢٥٪ 🔥`) ولا يستطيع التاجرُ الكتابةَ فيها. فمن يفكّر
 *    بالنسبة — وهو ما يفعله أهلُ التخفيضات — كان عليه أن يضرب ويقسم بنفسه.
 *
 * ولماذا ملفٌّ مستقلّ لا إضافةٌ في `SellerDashboard.tsx`: ذاك الملفُّ **على
 * سقفه بالضبط** في `scripts/file-size-ledger.json`، والسقّافةُ تصميمٌ لا عقبة
 * (قاعدةُ المشروع: «قلّص، لا ترفع السقف»). فخرجت الكتلةُ كاملةً إلى هنا.
 *
 * 🪤 والاتجاهان لا يتصارعان: النسبةُ **تُرى مشتقّةً** من السعرين دائماً، ولا
 *    تصير حالةً مستقلّة إلّا أثناء الكتابة فيها (`draft`)، ثمّ تعود إلى
 *    الاشتقاق عند الخروج منها. فلا حلقةُ تحديثٍ بين حقلين يكتب كلٌّ منهما الآخر.
 * 🪤 ولا حالةَ جديدةً في الأب: لا `resetForm` تُنظَّف ولا `handleEdit` تُبذَر،
 *    فلا يقع فخُّ v14.72 (حقلٌ يُهيَّأ بافتراضيٍّ فيدهس بيانات المستخدم).
 * 🪤 والتعطيلُ يتبع السعرين حرفاً (`disabled={variantsDriving}`): حقلٌ يعمل
 *    بينما جاراه معطّلان يكتب رقماً يدهسه مؤقّتُ «أرخص نسخة» فوراً — وهو عينُ
 *    «الحقل الميّت» الذي قِيس في v16.30.
 * 🪤 والتقريبُ `Math.round(x*100)/100` لا قصّ: `sanitizeDecimalInput` تقصّ
 *    الخانة الثالثة، والقصُّ يُنتج نسبةً راجعةً مختلفةً عمّا كُتب.
 */

interface Props {
    isRTL: boolean;
    originalPrice: string;
    discountedPrice: string;
    setOriginalPrice: (v: string) => void;
    setDiscountedPrice: (v: string) => void;
    /** النسبةُ المشتقّة من السعرين — يحسبها الأب ويعرضها شارةً أيضاً. */
    discount: number;
    /** توجد نسخٌ للمنتج ⇒ السعران يُداران من مصفوفة النسخ لا من هنا. */
    variantsDriving: boolean;
    priceInvalid: boolean;
    vatRegistered: boolean;
    vatRate: number;
    inputGroupStyle: React.CSSProperties;
    labelStyle: React.CSSProperties;
    fieldInputStyle: React.CSSProperties;
}

/** أقلُّ نسبةٍ وأكثرُها. ١٠٠٪ تعني سعراً صفراً — عرضٌ مجّانيّ بلا قصد. */
export const PCT_MIN = 1;
export const PCT_MAX = 99;

/**
 * السعرُ بعد الخصم من الأصليّ ونسبةٍ مئوية — أو `null` إن كان المدخلُ لا يصلح.
 *
 * 🪤 التقريبُ إلى خانتين **تقريبٌ لا قصّ**: `sanitizeDecimalInput` في
 *    `helpers.ts` تقصّ الثالثة، والقصُّ يجعل النسبةَ الراجعة (المحسوبة من
 *    السعرين) تختلف عمّا كتبه التاجر — فيرى ٢٤٪ بعد أن كتب ٢٥٪.
 * 🪤 و`null` ليست صفراً: صفرٌ سعرٌ صالحٌ في الحساب، وإرجاعُه عند مدخلٍ فاسد
 *    يُنتج عرضاً مجّانياً بصمت.
 */
export const priceFromPct = (original: number, pct: number): number | null => {
    if (!Number.isFinite(original) || original <= 0) return null;
    if (!Number.isFinite(pct) || pct < PCT_MIN || pct > PCT_MAX) return null;
    return Math.round(original * (1 - pct / 100) * 100) / 100;
};

export const DealPriceFields: React.FC<Props> = ({
    isRTL, originalPrice, discountedPrice, setOriginalPrice, setDiscountedPrice,
    discount, variantsDriving, priceInvalid, vatRegistered, vatRate,
    inputGroupStyle, labelStyle, fieldInputStyle,
}) => {
    /** `null` = اعرض النسبةَ المشتقّة · نصٌّ = التاجرُ يكتب فيها الآن. */
    const [draft, setDraft] = useState<string | null>(null);

    const normalizedDiscountedPrice = normalizeArabicNumerals(discountedPrice);
    const orig = Number(normalizeArabicNumerals(originalPrice)) || 0;

    const shownPct = draft !== null ? draft : (discount > 0 ? String(discount) : '');

    /** يكتب التاجرُ نسبةً ⇒ يُحسب السعرُ بعد الخصم من الأصليّ. */
    const onPct = (raw: string) => {
        const txt = normalizeArabicNumerals(raw).replace(/[^\d]/g, '').slice(0, 2);
        setDraft(txt);
        const next = txt ? priceFromPct(orig, Number(txt)) : null;
        if (next !== null) setDiscountedPrice(String(next));
    };

    const pctHelp = isRTL
        ? 'اكتب النسبة ويُحسب السعر بعد الخصم تلقائياً — أو اكتب السعرين وتظهر النسبة وحدها.'
        : 'Type the percentage and the final price is computed — or type both prices and the percentage follows.';

    return (
        <>
            <div style={inputGroupStyle}>
                <div style={{ flex: 1 }}>
                    <label style={labelStyle}>{isRTL ? 'السعر الأصلي (شامل الضريبة)' : 'Original Price (VAT incl.)'}</label>
                    <input
                        type="text"
                        inputMode="decimal"
                        disabled={variantsDriving}
                        style={{
                            ...fieldInputStyle,
                            opacity: variantsDriving ? 0.55 : 1,
                            borderColor: priceInvalid ? 'var(--danger)' : (fieldInputStyle as any).borderColor,
                            boxShadow: priceInvalid ? '0 0 0 1px var(--danger) inset' : (fieldInputStyle as any).boxShadow,
                        }}
                        placeholder={isRTL ? 'مثال: 16.50' : 'e.g. 16.50'}
                        value={originalPrice}
                        onChange={e => setOriginalPrice(sanitizeDecimalInput(normalizeArabicNumerals(e.target.value)))}
                    />
                </div>
                <div style={{ flex: 1 }}>
                    <label style={labelStyle}>{isRTL ? 'السعر بعد الخصم (شامل الضريبة)' : 'Final Price (VAT incl.)'}</label>
                    <input
                        type="text"
                        inputMode="decimal"
                        disabled={variantsDriving}
                        style={{
                            ...fieldInputStyle,
                            opacity: variantsDriving ? 0.55 : 1,
                            borderColor: priceInvalid ? 'var(--danger)' : (fieldInputStyle as any).borderColor,
                            boxShadow: priceInvalid ? '0 0 0 1px var(--danger) inset' : (fieldInputStyle as any).boxShadow,
                        }}
                        placeholder={isRTL ? 'مثال: 12.34' : 'e.g. 12.34'}
                        value={discountedPrice}
                        onChange={e => setDiscountedPrice(sanitizeDecimalInput(normalizeArabicNumerals(e.target.value)))}
                    />
                </div>
            </div>

            {/* ── نسبةُ الخصم: تُكتب فتُحسب، أو تُشتقّ فتُعرض ───────────────── */}
            <div style={{ margin: '-8px 0 16px' }}>
                <label style={labelStyle} htmlFor="deal-pct">
                    {isRTL ? '🔥 نسبة الخصم (اختياري)' : '🔥 Discount percentage (optional)'}
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <input
                        id="deal-pct"
                        type="text"
                        inputMode="numeric"
                        disabled={variantsDriving}
                        aria-label={isRTL ? 'نسبة الخصم بالمئة' : 'Discount percentage'}
                        style={{
                            ...fieldInputStyle,
                            width: 96, flex: 'none', textAlign: 'center',
                            opacity: variantsDriving ? 0.55 : 1,
                        }}
                        placeholder={isRTL ? 'مثال: 25' : 'e.g. 25'}
                        value={shownPct}
                        onChange={e => onPct(e.target.value)}
                        onBlur={() => setDraft(null)}
                    />
                    <span style={{ fontSize: '1rem', fontWeight: 900, color: 'var(--text-primary)' }}>٪</span>
                    <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                        {variantsDriving
                            ? (isRTL ? 'تُدار من «أنواع المنتج» بالأسفل.' : 'Managed by the product versions below.')
                            : pctHelp}
                    </span>
                </div>
                {!variantsDriving && !(orig > 0) && draft && (
                    <div style={{ marginTop: 6, fontSize: '0.72rem', fontWeight: 800, color: 'var(--danger)' }}>
                        {isRTL ? '⚠️ اكتب السعر الأصلي أولاً حتى نحسب لك السعر بعد الخصم.' : '⚠️ Enter the original price first.'}
                    </div>
                )}
            </div>

            {/* v13.30 — حاسبة ضريبة القيمة المضافة (طلب ناصر): السعر يُدخل
                شاملاً (نظام العرض السعودي)، والحاسبة تستخرج الضريبة المضمّنة
                لحظياً، ونفس القيمة تظهر على فاتورة الطلب تلقائياً. */}
            {(() => {
                const sell = Number(normalizedDiscountedPrice) || 0;
                if (!(sell > 0)) return null;
                // v14.17 — النسبة من مصدرها الوحيد لا من ثابتٍ في الكود،
                // والحاسبة تظهر فقط للتاجر المسجَّل ضريبياً: غير المسجَّل
                // لا يجوز له تحصيل ضريبة، وكانت البطاقة تَعِده بأنها
                // «تُطبع تلقائياً على فاتورة كل طلب» وهي لا تُطبع له.
                if (!vatRegistered) return null;
                const s = splitInclusive(sell, vatRate);
                return (
                    <div style={{
                        margin: '-12px 0 16px', padding: '10px 14px', borderRadius: 12,
                        background: 'rgba(13, 148, 136, 0.08)', border: '1px solid rgba(13, 148, 136, 0.35)',
                        color: 'var(--text-primary)', fontSize: '0.76rem', fontWeight: 800, lineHeight: 1.8,
                    }}>
                        🧾 {isRTL
                            ? <>حاسبة الضريبة ({vatRate}٪): سعر البيع <b>{fmtSAR(s.total)}</b> ر.س شامل الضريبة = الأساس <b>{fmtSAR(s.base)}</b> ر.س + ضريبة <b style={{ color: '#0d9488' }}>{fmtSAR(s.vat)}</b> ر.س — تُطبع تلقائياً على فاتورة كل طلب.</>
                            : <>VAT calculator ({vatRate}%): selling price <b>{fmtSAR(s.total)}</b> SAR incl. VAT = base <b>{fmtSAR(s.base)}</b> + VAT <b style={{ color: '#0d9488' }}>{fmtSAR(s.vat)}</b> — shown automatically on every order invoice.</>}
                    </div>
                );
            })()}

            {/* v12.62 — عندما توجد نسخ: السعران العامان يُضبطان تلقائياً
                على أرخص نسخة حتى لا يلتبس التاجر بين سعرين. */}
            {variantsDriving && (
                <div style={{
                    margin: '-12px 0 16px', padding: '10px 14px', borderRadius: 12,
                    background: 'var(--notif-unread-bg)', border: '1px solid var(--primary-light)',
                    color: 'var(--text-primary)', fontSize: '0.76rem', fontWeight: 700, lineHeight: 1.6,
                }}>
                    🧬 {isRTL
                        ? 'الأسعار تُدار الآن من «أنواع المنتج» بالأسفل — هذان الحقلان يُضبطان تلقائياً على أرخص نوع، والبطاقة ستعرض «يبدأ من».'
                        : 'Prices are now managed by the product versions below — these two fields auto-follow the cheapest version, and the card will show “From …”.'}
                </div>
            )}
        </>
    );
};

export default DealPriceFields;
