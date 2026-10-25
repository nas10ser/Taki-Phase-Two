/**
 * StockLinkSwitch — إظهارُ «اربط مخزونك بنظامك» للتجّار أو إخفاؤه (v15.25)
 * ═══════════════════════════════════════════════════════════════════════════
 * طلبُ ناصر: «زرّ تشغيلٍ وإخفاءٍ لاربط مخزونك بنظامك لحين التأكّد من عمليّته».
 *
 * 🔴 والسببُ وجيهٌ ومقيس: الحلقةُ مبنيّةٌ ومُختبَرة، لكنّ سلّة وزد **لا
 *    يعملان قبل تسجيل تطبيقَي تاكي لديهما** — فبطاقةٌ تَعِد التاجر بربطٍ لا
 *    يتمّ أسوأُ من غيابها (درس v14.82: وثيقةٌ تَعِد بما لا يُنفَّذ).
 *
 * 🪤 والمطفأُ هنا **لا يُخفيها عن ناصر**: لا يستطيع أن «يتأكّد من عمليّتها»
 *    وهي محجوبةٌ عنه. فهي تبقى في لوحته بوسمٍ صريح «مخفيّةٌ عن التجّار».
 *
 * 🪤 وهذا الملفّ مستقلٌّ لا سطرٌ في `AdminTools`: تلك عند سقف السقّافة
 *    بالضبط، والقاعدةُ عندها «قلّص لا ترفع السقف» — فنُقل منها مكوّنان
 *    عرضيّان إلى طقم اللوحة، ويُعاد استعمالهما هنا.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { supabase } from '../../services/supabaseClient';
import { writePlatformSetting } from '../../services/platformSettingWrite';
import { AdmSwitch, AdmSettingRow } from './ui';

const KEY = 'stock_link_enabled';

export const StockLinkSwitch: React.FC = () => {
    const { customAlert } = useApp();
    const [on, setOn] = useState<boolean | null>(null);

    const load = useCallback(async () => {
        const { data } = await supabase.from('platform_settings')
            .select('value').eq('key', KEY).maybeSingle();
        // 🪤 `=== true` لا `!== false`: غيابُ الصفّ **إخفاءٌ** لا إظهار.
        setOn(data?.value === true);
    }, []);
    useEffect(() => { load(); }, [load]);

    const toggle = async () => {
        const next = !on;
        setOn(next);
        const err = await writePlatformSetting(KEY, next,
            'إظهار بطاقة ربط المخزون للتجّار (v15.25)');
        if (err) { setOn(!next); await customAlert('❌ ' + err); return; }
        await customAlert(next
            ? '✅ ظهرت البطاقة لكلّ التجّار في لوحاتهم.\n\nيسري خلال دقيقة (أو عند تحديث الصفحة).'
            : '🙈 أُخفيت البطاقة عن التجّار.\n\nوتبقى ظاهرةً لك أنت في لوحة متجرك لتجرّبها — بوسم «مخفيّة عن التجّار».');
    };

    return (
        <AdmSettingRow
            icon="🔌"
            title="بطاقة «اربط مخزونك بنظامك»"
            desc={on === null ? 'يُقرأ…'
                : on ? 'ظاهرةٌ للتجّار — يستطيع كلُّ تاجرٍ ربطَ نظامه الآن.'
                     : 'مخفيّةٌ عن التجّار — وتبقى ظاهرةً لك وحدك لتجرّبها قبل الفتح.'}
            note={
                <div style={{ fontSize: '.71rem', fontWeight: 700, color: 'var(--adm-fg-3)', marginTop: 5, lineHeight: 1.7 }}>
                    ℹ️ الربطُ المباشر (أيّ نظامٍ يستطيع نداءَ رابط) يعمل اليوم. أمّا <b>سلّة وزد</b> فلا
                    يعملان حتى تُسجَّل تطبيقاتُ تاكي لديهما — والبطاقةُ تقول ذلك للتاجر صراحةً ولا تَعِده بما لا يتمّ.
                </div>
            }
            right={<AdmSwitch on={!!on} onToggle={toggle} disabled={on === null} label="بطاقة ربط المخزون" />}
        />
    );
};

export default StockLinkSwitch;
