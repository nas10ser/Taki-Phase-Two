/**
 * نظام لوحة الإدارة — مدخلٌ واحد (v14.89)
 * كل شاشةٍ تستورد من هنا، فلا يعود أحدٌ يخترع بطاقةً أو جدولاً أو حالةً فارغة.
 */
export {
    AdmCard, AdmSection, AdmPageHeader,
    AdmStat, AdmStatGrid,
    AdmPill, AdmEmpty, AdmSkeleton, AdmError,
    AdmButton,
    toneFg, toneBg,
    admNum, admMoney,
} from './AdminKit';
export type { Tone } from './AdminKit';

export {
    AdmTable, AdmSearch, AdmSelect, AdmToolbar,
    AdmDateRange, RANGE_PRESETS, rangeFromDays, toDateInput,
} from './AdminData';
export type { AdmColumn, AdmRange } from './AdminData';
