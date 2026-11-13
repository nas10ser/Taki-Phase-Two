/**
 * useListSearch — بحثٌ في قائمةٍ محمَّلةٍ كاملةً، بقاعدةٍ واحدة (v16.30)
 * ═══════════════════════════════════════════════════════════════════════════
 * أمرُ ناصر: «كمّل جميعها» — بحثٌ في كلّ شاشةٍ تعرض سجلّات. وهذا الخطّاف هو
 * نصفُ الجواب: الشاشاتُ التي تحمل قائمتَها **كاملةً** في الذاكرة. والنصفُ
 * الآخر (القوائمُ المُرقَّمة من الخادم) يمرّ بـ`browse_*` على القاعدة.
 *
 * 🔴 ومتى يصحّ هذا الخطّاف ومتى يكذب: يُرشّح **ما حُمِّل فقط**. فإن كانت
 *    القائمةُ صفحةً من خادمٍ مُرقَّم، قال «لا نتائج» عن سجلٍّ موجود — وهو
 *    أسوأ من غياب البحث. استُعمل هنا بعد قياسٍ لكلّ شاشة:
 *      • المفضّلة      → `getByIds(favorites)` — كلُّ المحفوظ.
 *      • عروضُ التاجر   → `getByStore(uid)` بلا سقف — كلُّ عروضه.
 *      • عروضُ المتجر   → `getByStore(id)` كذلك.
 *      • الشكاوى       → `complaintRepository.mine(50)` — سقفٌ ٥٠، وهو
 *        **كلُّ ما تعرضه الشاشة أصلاً**، فالترشيحُ لا يُخفي ما كان ظاهراً.
 *      • شاشاتُ الإدارة → قوائمُها تصل كاملةً من دوالّها.
 *
 * 🪤 والتطبيعُ من `normalizeText` نفسِها التي يستعملها بحثُ العروض منذ زمن —
 *    وهي توأمُ `taki_norm` على القاعدة (أرقامٌ عربية ⇐ لاتينية · أ إ آ ⇐ ا ·
 *    ة ⇐ ه · حذفُ التشكيل · وكلُّ ما ليس حرفاً ولا رقماً يصير مسافة). فلا
 *    قاعدتان للمطابقة: واحدةٌ في المتصفّح وواحدةٌ في القاعدة، وهما متطابقتان.
 */
import { useMemo, useState } from 'react';
import { normalizeText } from '../services/dealService';

export interface ListSearch<T> {
    /** النصُّ كما كتبه المستخدم (للحقل). */
    q: string;
    set: (next: string) => void;
    /** هل هناك بحثٌ قائم؟ (`q` بعد التشذيب غيرُ فارغ) */
    active: boolean;
    /** الصفوفُ بعد الترشيح — نفسُ المصفوفة حرفياً حين لا بحث. */
    rows: T[];
}

/**
 * يُطابق حين تظهر **كلُّ** كلمةٍ من الاستعلام في أيٍّ من حقول الصفّ مجتمعةً.
 * فـ«قهوة وسط» تجد «قهوة اليوم — حرارة وسط» ولا تشترط ترتيباً.
 */
export const listSearchMatch = (fields: Array<string | number | null | undefined>, q: string): boolean => {
    const needle = normalizeText(q);
    if (!needle) return true;
    const hay = normalizeText(fields.filter(v => v !== null && v !== undefined && v !== '').join(' '));
    if (!hay) return false;
    return needle.split(' ').every(term => hay.includes(term));
};

export function useListSearch<T>(
    rows: T[],
    getFields: (row: T) => Array<string | number | null | undefined>,
): ListSearch<T> {
    const [q, set] = useState('');
    const trimmed = q.trim();
    const filtered = useMemo(
        // 🪤 وتُعاد المصفوفةُ **نفسُها** حين لا بحث: مصفوفةٌ جديدة كلَّ تصييرٍ
        //    تُبطل `memo` عند كلّ مستهلكٍ أسفلها بلا سببٍ واحد.
        () => (trimmed ? rows.filter(r => listSearchMatch(getFields(r), trimmed)) : rows),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [rows, trimmed],
    );
    return { q, set, active: trimmed.length > 0, rows: filtered };
}

export default useListSearch;
