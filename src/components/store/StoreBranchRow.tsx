/**
 * StoreBranchRow — صفُّ موقعٍ واحدٍ في بطاقة «مواقع المتجر» (v16.53)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🪤 أُخرج من `StoreDetails` لأن السقّافة رفضت نموَّها — **وهي التصميمُ لا
 *    العقبة**: الصفُّ وحدةٌ قائمةٌ بذاتها (عرضٌ · تحريرٌ · إظهارٌ وإخفاء)،
 *    وبقاؤه مضمَّناً في صفحةٍ من ١٥٠٠ سطرٍ كان يُخفي ذلك.
 *
 * 🔴 ولا منطقَ جديدٌ هنا: نُقل كما هو بحرفه، والتغييرُ الوحيد أن مدخلاته
 *    صارت `props` بدل مُغلَقاتٍ من الصفحة. أيُّ «تحسينٍ» أثناء النقل يخلط
 *    عيبَ النقل بعيب التحسين فلا يُعرف أيُّهما كسر.
 */
import React from 'react';
import { StoreBranch } from '../../repositories/branchRepository';
import BranchContactRow from '../BranchContactRow';

export const StoreBranchRow: React.FC<{
    b: StoreBranch;
    isRTL: boolean;
    isOwner: boolean;
    managingBranches: boolean;
    editingBranchId: string | null;
    branchDraft: { nameAr: string; address: string; phone: string };
    setBranchDraft: React.Dispatch<React.SetStateAction<{ nameAr: string; address: string; phone: string }>>;
    setEditingBranchId: (id: string | null) => void;
    setBranchMsg: (m: string) => void;
    branchBusy: string | null;
    saveBranchCard: (b: StoreBranch) => void;
    toggleBranchDisplay: (b: StoreBranch) => void;
    linkOf: (b: StoreBranch) => string;
    storeContactPhone: string;
}> = ({ b, isRTL, isOwner, managingBranches, editingBranchId, branchDraft, setBranchDraft,
        setEditingBranchId, setBranchMsg, branchBusy, saveBranchCard, toggleBranchDisplay,
        linkOf, storeContactPhone }) => {
    const href = linkOf(b);
    const on = !!b.showOnStorePage;
    const manage = isOwner && managingBranches;
    return (
        <div key={b.id} style={{
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            background: 'var(--body-bg)', borderRadius: 14, padding: '10px 12px',
            opacity: manage && !on ? 0.55 : 1
        }}>
            <div style={{ flex: 1, minWidth: 140 }}>
                {editingBranchId === b.id ? (
                    // v14.74 — تحرير بطاقة الموقع: الاسم والعنوان.
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <input
                            value={branchDraft.nameAr}
                            onChange={e => setBranchDraft(d => ({ ...d, nameAr: e.target.value }))}
                            maxLength={80}
                            aria-label={isRTL ? 'اسم الموقع' : 'Location name'}
                            placeholder={isRTL ? 'اسم الموقع — مثال: فرع الدمام الشمالي' : 'Location name'}
                            style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '8px 10px', borderRadius: 10, fontSize: '0.85rem', fontWeight: 800, fontFamily: 'inherit' }}
                        />
                        <input
                            value={branchDraft.address}
                            onChange={e => setBranchDraft(d => ({ ...d, address: e.target.value }))}
                            maxLength={200}
                            aria-label={isRTL ? 'عنوان الموقع' : 'Location address'}
                            placeholder={isRTL ? 'العنوان — مثال: طريق الملك فهد، حي الشاطئ' : 'Address'}
                            style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '8px 10px', borderRadius: 10, fontSize: '0.8rem', fontWeight: 600, fontFamily: 'inherit' }}
                        />
                        {/* v16.52 (أمرُ ناصر): رقمُ هذا الفرع وحده. فارغاً ⇒ يرى
                            المشتري رقمَ المتجر الموحّد — فتاجرٌ له عشرون فرعاً
                            برقمٍ واحد لا يكتبه عشرين مرّة. */}
                        <input
                            value={branchDraft.phone}
                            onChange={e => setBranchDraft(d => ({ ...d, phone: e.target.value }))}
                            maxLength={24}
                            inputMode="tel"
                            aria-label={isRTL ? 'رقم التواصل لهذا الفرع' : 'Contact number for this location'}
                            placeholder={isRTL ? 'رقم هذا الفرع (اختياري) — 05XXXXXXXX' : 'This location’s number (optional)'}
                            style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '8px 10px', borderRadius: 10, fontSize: '0.8rem', fontWeight: 700, fontFamily: 'inherit', direction: 'ltr', textAlign: isRTL ? 'right' : 'left' }}
                        />
                        <div style={{ fontSize: '0.69rem', color: 'var(--text-secondary)', lineHeight: 1.7, marginTop: -2 }}>
                            {isRTL
                                ? 'اتركه فارغاً إن كان تواصلُ فروعك على رقمٍ واحد — سيظهر رقمُ المتجر الموحّد.'
                                : 'Leave empty if all your locations share one number — the store’s main number will show.'}
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button type="button" onClick={() => saveBranchCard(b)} disabled={branchBusy === b.id}
                                style={{ background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 10, padding: '7px 14px', fontSize: '0.75rem', fontWeight: 900, cursor: 'pointer', fontFamily: 'inherit' }}>
                                {branchBusy === b.id ? '…' : (isRTL ? 'حفظ' : 'Save')}
                            </button>
                            <button type="button" onClick={() => setEditingBranchId(null)}
                                style={{ background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border-color)', borderRadius: 10, padding: '7px 14px', fontSize: '0.75rem', fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>
                                {isRTL ? 'إلغاء' : 'Cancel'}
                            </button>
                        </div>
                    </div>
                ) : (
                    <>
                        <div style={{ fontWeight: 900, fontSize: '0.88rem', color: 'var(--text-primary)' }}>
                            {b.isPrimary ? '⭐ ' : ''}{(isRTL ? b.nameAr : (b.nameEn || b.nameAr)) || (isRTL ? 'فرع' : 'Branch')}
                        </div>
                        {b.address ? (
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 2 }}>{b.address}</div>
                        ) : manage ? (
                            <div style={{ fontSize: '0.72rem', color: '#b45309', marginTop: 2, fontWeight: 700 }}>
                                {isRTL ? 'بلا عنوان — المشتري يرى الاسم وحده' : 'No address — buyers see the name only'}
                            </div>
                        ) : null}
                    </>
                )}
            </div>
            {href && (
                <a href={href} target="_blank" rel="noopener noreferrer"
                   style={{ background: 'var(--primary)', color: '#fff', borderRadius: 10, padding: '7px 12px', fontSize: '0.75rem', fontWeight: 800, textDecoration: 'none', whiteSpace: 'nowrap' }}>
                    🗺️ {isRTL ? 'الاتجاهات' : 'Directions'}
                </a>
            )}
            {/* v16.53 — زرّا الاتصال وواتساب: نفسُ منطقِ الارتداد المستعمَل
                في صفحة العرض وفي الطلب، بمكوّنٍ واحدٍ لا ثلاث نسخ. */}
            {editingBranchId !== b.id && (
                <BranchContactRow
                    variant="inline" branchPhone={b.phone} storePhone={storeContactPhone}
                    branchName={b.nameAr} isRTL={isRTL}
                />
            )}
            {manage && editingBranchId !== b.id && (
                <button type="button"
                    onClick={() => { setBranchDraft({ nameAr: b.nameAr || '', address: b.address || '', phone: b.phone || '' }); setEditingBranchId(b.id); setBranchMsg(''); }}
                    style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)', borderRadius: 10, padding: '7px 12px', fontSize: '0.75rem', fontWeight: 900, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit' }}>
                    ✏️ {isRTL ? 'الاسم والعنوان والرقم' : 'Name, address & number'}
                </button>
            )}
            {manage && editingBranchId !== b.id && (
                <button onClick={() => toggleBranchDisplay(b)} disabled={branchBusy === b.id}
                    style={{
                        background: on ? 'rgba(16,185,129,0.15)' : 'var(--card-bg)',
                        border: `1px solid ${on ? 'rgba(16,185,129,0.6)' : 'var(--border-color)'}`,
                        color: on ? '#059669' : 'var(--text-secondary)',
                        borderRadius: 10, padding: '7px 12px', fontSize: '0.75rem', fontWeight: 900,
                        cursor: branchBusy === b.id ? 'progress' : 'pointer', whiteSpace: 'nowrap'
                    }}>
                    {branchBusy === b.id ? '…' : on ? (isRTL ? '✅ ظاهر' : '✅ Shown') : (isRTL ? '🚫 مخفي' : '🚫 Hidden')}
                </button>
            )}
        </div>
    );
};

export default StoreBranchRow;
