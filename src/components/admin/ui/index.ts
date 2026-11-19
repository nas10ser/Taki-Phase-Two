/**
 * نظام لوحة الإدارة — مدخلٌ واحد (v14.89)
 * كل شاشةٍ تستورد من هنا، فلا يعود أحدٌ يخترع بطاقةً أو جدولاً أو حالةً فارغة.
 */
export {
    AdmCard, AdmSection, AdmPageHeader,
    AdmStat, AdmStatGrid,
    AdmPill, AdmEmpty, AdmSkeleton, AdmError,
    AdmButton, AdmSwitch, AdmSettingRow,
    toneFg, toneBg,
    admNum, admMoney,
} from './AdminKit';
export type { Tone } from './AdminKit';

export {
    AdmTable, AdmSearch, AdmSelect, AdmToolbar,
    AdmDateRange, RANGE_PRESETS, rangeFromDays, toDateInput,
} from './AdminData';
export type { AdmColumn, AdmRange } from './AdminData';

// v16.36 — حقلٌ رقميٌّ يُمسح ويقبل الأرقام العربية (بلاغُ ناصر).
//    النمطُ القديم `Number(e.target.value) || 1` كان يمنع المسحَ في ١٩ موضعاً.
export { AdmNumber } from './AdmNumber';
// v16.44 — كتلةُ «من/إلى» كانت منسوخةً حرفاً في أربع لوحات.
export { AdmCustomRange } from './AdmCustomRange';

// معدوداتُ اللوحة — مصدرٌ واحد لصيغ الجمع العربي (v15.81)
export * from './adminForms';
