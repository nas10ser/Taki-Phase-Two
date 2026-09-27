/**
 * RefundWindowCard — نافذة الاسترداد المضمون وزرّ التاجر، بيد ناصر (v14.97)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 ما تضبطه هذه البطاقة **ليس احتجاز مال**، ولا يجوز أن تُقرأ كذلك: تاكي لا
 *    تستلم ريالاً من المشتري أصلاً — الدفع يذهب من بطاقته إلى بوّابة التاجر
 *    مباشرةً (٠٪ عمولة). فلا يوجد مبلغ «عند المنصّة» لتُمسكه ساعتين ثمّ تُفرج
 *    عنه، ولو كُتب ذلك في الشروط لكان وعداً لا يستطيع أيّ كودٍ أن يفي به
 *    (درس v14.82: وثيقةٌ تَعِد بما لا يُنفَّذ أسوأ من وثيقةٍ لا تَعِد).
 *
 *    والذي تضبطه فعلاً **نافذةُ ضمانٍ إجرائيّ**: خلال هذه الساعات من لحظة
 *    الدفع، يصل طلبُ الاسترداد التاجرَ فوراً ويُنفَّذ **بلا أيّ خطوة موافقة**،
 *    وهذا وعدٌ ينفّذه الكود بالفعل. وبعدها يبقى الزرّ عاملاً لدى التاجر، لكن
 *    وفق سياسته المعلنة لا وفق ضمانٍ منّا.
 *
 * 🪤 والرقم يُضبط هنا لأنّ **موضعَ الضبط حيث يُنفَّذ الوعد** (درس v14.92): هذه
 *    شاشة المدفوعات، لا درجٌ عامّ في «الأدوات». وتغييرُه يسري على الشروط
 *    والأحكام وصفحة الاسترداد في اللحظة نفسها بلا نشر — لأنّ تلك الصفحات
 *    تقرأ هذا المفتاح ولا تكتب رقماً نصّاً.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { supabase } from '../../services/supabaseClient';
import { writePlatformSetting } from '../../services/platformSettingWrite';
import { normalizeArabicNumerals } from '../../utils/helpers';
import { holdLabelGen } from '../../utils/bookingHold';
import { AdmSection, AdmButton, AdmStat, AdmStatGrid } from './ui';

const KEY = 'refund_window';

interface Policy { hours: number; merchant_button: boolean }

export const RefundWindowCard: React.FC = () => {
    const { customAlert, customConfirm } = useApp();
    const [p, setP] = useState<Policy | null>(null);
    const [hours, setHours] = useState('');
    const [busy, setBusy] = useState('');
    /** '' = ما زالت تُقرأ · نصٌّ = تعذّرت القراءة ومعها سببها. */
    const [readErr, setReadErr] = useState('');

    const load = useCallback(async () => {
        setReadErr('');
        const { data, error } = await supabase
            .from('platform_settings').select('value').eq('key', KEY).maybeSingle();
        const v: any = data?.value || {};
        // 🪤 لا يُعرض حقلٌ بقيمةٍ افتراضية قبل وصول الحقيقية: الحفظ حينها يدهس
        //    ضبطَ ناصر بضبطي. و«صفر صفوفٍ بلا خطأ» هو بالضبط ما تعيده RLS حين
        //    يغيب المفتاح عن قائمة السماح — فتبدو الشاشة سليمةً وهي كاذبة.
        if (typeof v.hours !== 'number') {
            setReadErr(error
                ? `تعذّرت قراءة الإعداد: ${error.message}`
                : 'لم تصل نافذة الاسترداد من القاعدة — المفتاح غائبٌ أو لا تراه سياسةُ القراءة (هجرة v14.97).');
            return;
        }
        setP({ hours: v.hours, merchant_button: v.merchant_button !== false });
        setHours(String(v.hours));
    }, []);

    useEffect(() => { load(); }, [load]);

    const save = async (patch: Partial<Policy>, label: string): Promise<boolean> => {
        if (!p) return false;
        setBusy(label);
        const next = { ...p, ...patch };
        const err = await writePlatformSetting(KEY, {
            hours: next.hours, merchant_button: next.merchant_button,
        }, 'نافذة الاسترداد المضمون بالساعات + مفتاح زرّ «ردّ المبلغ» في لوحة التاجر');
        setBusy('');
        if (err) { await customAlert('❌ ' + err); return false; }
        setP(next);
        await load();
        return true;
    };

    if (!p) {
        return (
            <AdmSection title="نافذة الاسترداد المضمون" icon="↩️"
                desc="كم ساعةً بعد الدفع يُنفَّذ الاسترداد بلا أيّ موافقة." collapsible defaultOpen={false}>
                {readErr ? (
                    <div style={{ display: 'grid', gap: 9, justifyItems: 'start' }}>
                        <p role="alert" style={{ fontSize: '.78rem', fontWeight: 800, lineHeight: 1.8, color: 'var(--adm-bad-fg)', margin: 0 }}>
                            ⚠️ {readErr}
                        </p>
                        <p style={{ fontSize: '.73rem', color: 'var(--adm-fg-3)', margin: 0, lineHeight: 1.8 }}>
                            ولا يُعرض الحقل بقيمةٍ افتراضية حتى تصل الحقيقية — فحفظُها حينئذٍ يدهس ضبطك.
                        </p>
                        <AdmButton onClick={load}>🔄 أعِد المحاولة</AdmButton>
                    </div>
                ) : (
                    <p style={{ fontSize: '.78rem', color: 'var(--adm-fg-3)', margin: 0 }}>
                        جارٍ قراءة الإعداد الحالي… لا يُعرض الحقل قبله حتى لا يُحفظ رقمٌ افتراضيّ فوق الحقيقي.
                    </p>
                )}
            </AdmSection>
        );
    }

    const saveHours = async () => {
        const n = parseFloat(normalizeArabicNumerals(hours));
        if (!Number.isFinite(n) || n < 0 || n > 720 || !Number.isInteger(n)) {
            await customAlert('⚠️ النافذة عددٌ صحيح بين ٠ و٧٢٠ ساعة (٣٠ يوماً). و٠ تعني «لا نافذة معلنة».');
            return;
        }
        if (n === 0) {
            const ok = await customConfirm(
                '⚠️ ٠ ساعة = لا نافذة ضمانٍ معلنة.\n\n'
                + 'يبقى زرّ «ردّ المبلغ» عاملاً لدى التاجر، لكن تختفي من الشروط وصفحة الاسترداد جملةُ الضمان '
                + '«يُنفَّذ بلا موافقة خلال …».\n\nهل تتابع؟');
            if (!ok) return;
        }
        if (await save({ hours: n }, 'hours')) {
            await customAlert(n === 0
                ? '✅ أُلغيت النافذة المعلنة — الزرّ باقٍ، والضمان الزمنيّ لم يعد مكتوباً.'
                : `✅ صار الوعد «يُنفَّذ الاسترداد بلا موافقة خلال ${holdLabelGen(n, true)} من الدفع».`);
        }
    };

    const box: React.CSSProperties = {
        padding: 12, borderRadius: 'var(--adm-r-sm)',
        border: '1px solid var(--adm-border)', background: 'var(--adm-surface-2)',
    };

    return (
        <AdmSection
            title="نافذة الاسترداد المضمون"
            icon="↩️"
            desc="كم ساعةً بعد الدفع يُنفَّذ الاسترداد بلا أيّ موافقة · وزرّ «ردّ المبلغ» لدى التاجر. كلاهما يسري فوراً بلا نشر."
            collapsible
            defaultOpen={false}
        >
            <p style={{ fontSize: '.75rem', lineHeight: 1.9, color: 'var(--adm-fg-2)', margin: '0 0 12px',
                        padding: 11, borderRadius: 'var(--adm-r-sm)',
                        border: '1px solid var(--adm-border)', background: 'var(--adm-surface-2)' }}>
                <strong style={{ color: 'var(--adm-fg)' }}>هذه ليست مهلة احتجاز مال.</strong> تاكي لا تستلم ريالاً:
                المشتري يدفع إلى بوّابة التاجر مباشرة. فما تضبطه هنا هو <strong style={{ color: 'var(--adm-fg)' }}>وعدٌ إجرائيّ</strong>:
                خلال هذه الساعات يصل الطلبُ التاجرَ فوراً ويُنفَّذ بضغطة بلا خطوة موافقة. وبعدها يبقى الزرّ عاملاً
                وفق سياسة التاجر المعلنة. وأيُّ صياغةٍ توحي بأننا نمسك المال وعدٌ لا يستطيع الكود أن يفي به.
            </p>

            <AdmStatGrid cols={2}>
                <AdmStat
                    label="النافذة المعلنة الآن" icon="⏱"
                    value={p.hours === 0 ? 'بلا نافذة' : holdLabelGen(p.hours, true)}
                    scope="تظهر في الشروط وصفحة الاسترداد للمشترين جميعاً"
                    tone={p.hours === 0 ? 'neutral' : 'ok'} />
                <AdmStat
                    label="زرّ «ردّ المبلغ» لدى التاجر" icon="↩️"
                    value={p.merchant_button ? 'مفتوح' : 'مُطفأ'}
                    scope="كلّ التجّار الذين فعّلوا بوّابة دفع"
                    tone={p.merchant_button ? 'ok' : 'warn'} />
            </AdmStatGrid>

            <div style={{ ...box, marginTop: 12 }}>
                <div style={{ fontSize: '.84rem', fontWeight: 800, color: 'var(--adm-fg)', marginBottom: 4 }}>⏱ ساعات الضمان</div>
                <div style={{ fontSize: '.73rem', lineHeight: 1.85, color: 'var(--adm-fg-3)', marginBottom: 9 }}>
                    خلال هذه المدّة من لحظة الدفع، يُنفَّذ طلبُ الاسترداد <strong style={{ color: 'var(--adm-fg)' }}>بلا أيّ موافقة</strong>.
                    ٠ تعني «لا نافذة معلنة» — يبقى الزرّ عاملاً وتختفي جملةُ الضمان من الوثائق.
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '.8rem', fontWeight: 800, color: 'var(--adm-fg)' }}>يُنفَّذ بلا موافقة خلال</span>
                    <input
                        type="number" min={0} max={720} step={1} inputMode="numeric" dir="ltr"
                        value={hours} onChange={e => setHours(normalizeArabicNumerals(e.target.value))}
                        aria-label="نافذة الاسترداد المضمون بالساعات" className="adm-focusable"
                        style={{
                            width: 88, padding: '9px 10px', textAlign: 'center', fontWeight: 800,
                            borderRadius: 'var(--adm-r-sm)', border: '1px solid var(--adm-border)',
                            background: 'var(--adm-surface)', color: 'var(--adm-fg)', fontSize: '.9rem',
                        }}
                    />
                    <span style={{ fontSize: '.8rem', fontWeight: 800, color: 'var(--adm-fg-2)' }}>ساعة من الدفع</span>
                    <AdmButton variant="primary" disabled={!!busy} onClick={saveHours}>
                        {busy === 'hours' ? 'جاري الحفظ…' : '💾 حفظ'}
                    </AdmButton>
                </div>
            </div>

            <div style={{ ...box, marginTop: 12 }}>
                <div style={{ fontSize: '.84rem', fontWeight: 800, color: 'var(--adm-fg)', marginBottom: 4 }}>↩️ زرّ «ردّ المبلغ» في لوحة التاجر</div>
                <div style={{ fontSize: '.73rem', lineHeight: 1.85, color: 'var(--adm-fg-3)', marginBottom: 9 }}>
                    مفتاحُ إطفاءٍ فوريّ بلا نشر: لو انكشف عيبٌ عند مزوّدٍ ما، أطفئه فيختفي الزرّ من كلّ اللوحات في اللحظة.
                    <strong style={{ color: 'var(--adm-fg)' }}> وإطفاؤه لا يمسّ الأموال المستردّة سابقاً</strong>، ولا يمنع التاجر من الردّ
                    من لوحة مزوّده ثمّ تسجيله هنا.
                </div>
                <AdmButton
                    variant={p.merchant_button ? 'primary' : undefined}
                    disabled={!!busy}
                    onClick={async () => {
                        if (p.merchant_button) {
                            const ok = await customConfirm(
                                '⚠️ إطفاء زرّ «ردّ المبلغ».\n\n'
                                + 'لن يستطيع أيّ تاجر ردّ مبلغٍ بضغطة من لوحته بعد الآن، ويعود المسار اليدويّ '
                                + '(يردّ من لوحة مزوّده ثمّ يسجّله هنا).\n\nهل تُطفئه؟');
                            if (!ok) return;
                        }
                        if (await save({ merchant_button: !p.merchant_button }, 'btn')) {
                            await customAlert(p.merchant_button
                                ? '✅ أُطفئ الزرّ — عاد التجّار إلى التسجيل اليدويّ.'
                                : '✅ فُتح الزرّ — صار الردّ بضغطة واحدة من لوحة التاجر.');
                        }
                    }}
                >
                    {p.merchant_button ? '🚫 أطفئ الزرّ' : '✅ افتح الزرّ'}
                </AdmButton>
            </div>
        </AdmSection>
    );
};

export default RefundWindowCard;
