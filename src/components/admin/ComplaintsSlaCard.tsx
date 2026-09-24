/**
 * ComplaintsSlaCard — مهلةُ الردّ على الشكاوى، تُضبط بلا نشر (v14.92)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🪤 القاعدة المدفوعة الثمن (v14.12): **لا يُكتب رقمُ ساعاتٍ نصّاً في أي مكان**
 *    — أوّل ضبطٍ يجعل النصّ كذباً. وحين بُنيت الشكوى كان الرقم ٢٤ ثابتاً في
 *    الصفّ بلا أي شاشةٍ تضبطه، أي أن ناصراً يحتاجني لتغيير وعدٍ يُقال لعملائه.
 *
 * ومكانُه هنا لا في «الأدوات»: المهلة وعدٌ لصاحب الشكوى، فموضعُ ضبطها حيث
 * تُقرأ الشكاوى ويُردّ عليها — لا في درجٍ عامّ من الإعدادات.
 *
 * والرقم يسري لحظياً: `AppContext` يشترك في `platform_settings` فتتبدّل جملةُ
 * المهلة في نافذة الشكوى عند كل عميلٍ مفتوحٍ بلا إعادة نشر.
 */
import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { supabase } from '../../services/supabaseClient';
import { writePlatformSetting } from '../../services/platformSettingWrite';
import { normalizeArabicNumerals } from '../../utils/helpers';
import { holdLabelGen } from '../../utils/bookingHold';
import { AdmSection, AdmButton } from './ui';

const KEY = 'complaints_sla_hours';

export const ComplaintsSlaCard: React.FC = () => {
    const { customAlert } = useApp();
    const [hours, setHours] = useState('');
    const [ready, setReady] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        let alive = true;
        (async () => {
            const { data } = await supabase
                .from('platform_settings').select('value').eq('key', KEY).maybeSingle();
            if (!alive) return;
            const n = Number(data?.value);
            // 🪤 لا يُعرض حقلٌ بقيمةٍ افتراضية قبل وصول الحقيقية: الحفظ حينها
            //    يدهس رقم ناصر برقمي (درس «حقل تحرير يُهيَّأ بنصٍّ افتراضي»).
            if (Number.isFinite(n) && n > 0) { setHours(String(n)); setReady(true); }
        })();
        return () => { alive = false; };
    }, []);

    const save = async () => {
        const n = parseFloat(normalizeArabicNumerals(hours));
        if (!Number.isFinite(n) || n < 1 || n > 720) {
            await customAlert('⚠️ المهلة بين ساعة واحدة و٧٢٠ ساعة (٣٠ يوماً).');
            return;
        }
        setSaving(true);
        const err = await writePlatformSetting(KEY, n,
            'مهلة الردّ المعلنة على شكاوى المستخدمين، بالساعات');
        setSaving(false);
        if (err) { await customAlert('❌ ' + err); return; }
        await customAlert(`✅ صار الوعد «نردّ خلال ${holdLabelGen(n, true)}».\nيظهر فوراً لكل من يفتح نافذة الشكوى.`);
    };

    return (
        <AdmSection
            title="مهلة الردّ المعلنة"
            icon="⏱"
            desc="الوعد الذي يراه المشتري لحظة إرسال الشكوى، وفي «شكاواي». يُقرأ من هنا في كل مكان — فلا يُكتب رقمٌ نصّاً في صفحة."
            collapsible
            defaultOpen={false}
        >
            {!ready ? (
                <p style={{ fontSize: '.78rem', color: 'var(--adm-fg-3)', margin: 0 }}>
                    جارٍ قراءة المهلة الحالية… لا يُعرض الحقل قبلها حتى لا يُحفظ رقمٌ افتراضيّ فوق الحقيقي.
                </p>
            ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '.82rem', fontWeight: 800, color: 'var(--adm-fg)' }}>نردّ خلال</span>
                    <input
                        type="number" min={1} max={720} step={1} inputMode="numeric" dir="ltr"
                        value={hours}
                        onChange={(e) => setHours(normalizeArabicNumerals(e.target.value))}
                        aria-label="مهلة الردّ على الشكاوى بالساعات"
                        className="adm-focusable"
                        style={{
                            width: 92, padding: '9px 10px', textAlign: 'center', fontWeight: 800,
                            borderRadius: 'var(--adm-r-sm)', border: '1px solid var(--adm-border)',
                            background: 'var(--adm-surface)', color: 'var(--adm-fg)', fontSize: '.9rem',
                        }}
                    />
                    <span style={{ fontSize: '.82rem', fontWeight: 800, color: 'var(--adm-fg-2)' }}>ساعة</span>
                    <AdmButton variant="primary" onClick={save} disabled={saving}>
                        {saving ? 'جاري الحفظ…' : '💾 حفظ'}
                    </AdmButton>
                </div>
            )}
        </AdmSection>
    );
};

export default ComplaintsSlaCard;
