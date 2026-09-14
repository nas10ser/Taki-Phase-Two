/**
 * StoreNameRequests — طابور موافقة تغيير اسم المتجر (v14.36)
 * ═══════════════════════════════════════════════════════════════════════════
 * قرار ناصر: «التوثيق أولاً» — التاجر يطلب، والإدارة تبتّ.
 *
 * 🪤 ما كان قبله: التاجر يغيّر اسم متجره بحرّية، **ولكل عرضٍ نسخة مجمّدة من
 * الاسم** لا تتحدّث. فيقرأ «✅ تم حفظ الاسم» ثم يرى اسمه القديم على عروضه هو.
 * وأسوأ: حقل «اسم المحل» في نموذج العرض كان نصّاً حرّاً بلا فحص — أي تاجر
 * ينشر عرضاً باسم «ستاربكس» فيظهر في الرئيسية.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { supabase } from '../../services/supabaseClient';

export const StoreNameRequests: React.FC = () => {
    const { customAlert, customConfirm, customPrompt, language } = useApp();
    const isRTL = language === 'ar';
    const [rows, setRows] = useState<any[]>([]);
    const [busy, setBusy] = useState<string | null>(null);

    const load = useCallback(async () => {
        const { data } = await supabase.rpc('admin_list_store_name_requests', { p_status: 'requested' });
        setRows(Array.isArray((data as any)?.rows) ? (data as any).rows : []);
    }, []);
    useEffect(() => { load(); }, [load]);

    const decide = async (r: any, approve: boolean) => {
        if (approve) {
            const ok = await customConfirm(
                `✅ اعتماد «${r.wanted_name}» بدل «${r.current_name || '—'}»؟\n\n` +
                `سيظهر الاسم الجديد فوراً على صفحة المتجر وعلى كل عروضه وفي البوتين.`);
            if (!ok) return;
        }
        let note: string | null = null;
        if (!approve) {
            const v = await customPrompt(`❌ رفض «${r.wanted_name}» — اكتب السبب (يصل التاجر):`);
            if (v == null) return;
            note = String(v).trim() || null;
        }
        setBusy(r.id);
        const { data, error } = await supabase.rpc('admin_resolve_store_name', {
            p_id: r.id, p_approve: approve, p_note: note,
        });
        setBusy(null);
        if (error || !(data as any)?.ok) {
            await customAlert('❌ ' + (error?.message || (data as any)?.error || ''));
            return;
        }
        await customAlert(approve ? '✅ اعتُمد الاسم وانتشر على كل عروضه.' : '❌ رُفض الطلب ووصل التاجر السبب.');
        load();
    };

    // لا شيء معلّق ⇒ لا نشغل مساحة في اللوحة.
    if (!rows.length) return null;

    return (
        <div style={{
            background: 'var(--card-bg)', border: '1.5px solid rgba(245,158,11,0.5)',
            borderRadius: 18, padding: 16, marginBottom: 16,
            direction: isRTL ? 'rtl' : 'ltr', textAlign: isRTL ? 'right' : 'left',
        }}>
            <div style={{ fontWeight: 900, fontSize: '0.92rem', marginBottom: 4 }}>
                🏷 {isRTL ? `طلبات تغيير اسم متجر (${rows.length})` : `Store rename requests (${rows.length})`}
            </div>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.8 }}>
                {isRTL
                    ? 'الاسم يظهر على كل عروض المتجر وفي الفواتير، ولا يغيّره التاجر وحده. تأكّد أنه لا ينتحل علامة قائمة.'
                    : 'The name appears on every deal and on invoices. Check it does not impersonate an existing brand.'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {rows.map(r => (
                    <div key={r.id} style={{
                        padding: 12, borderRadius: 14, background: 'var(--body-bg)',
                        border: '1px solid var(--border-color)',
                    }}>
                        <div style={{ fontWeight: 900, fontSize: '0.86rem' }}>
                            {r.current_name || '—'} <span style={{ opacity: 0.6 }}>←</span> {r.wanted_name}
                        </div>
                        <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', marginTop: 3 }}>
                            {r.owner_name || '—'}{r.owner_phone ? ` · ${r.owner_phone}` : ''}
                            {r.reason ? ` · ${r.reason}` : ''}
                        </div>
                        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                            <button
                                disabled={busy === r.id}
                                onClick={() => decide(r, true)}
                                style={{
                                    flex: 1, padding: '9px 0', borderRadius: 11, border: 'none',
                                    background: busy === r.id ? 'var(--gray-400)' : 'linear-gradient(135deg,#10b981,#059669)',
                                    color: '#fff', fontWeight: 900, fontSize: '0.78rem', cursor: 'pointer',
                                }}
                            >{isRTL ? '✅ اعتماد' : '✅ Approve'}</button>
                            <button
                                disabled={busy === r.id}
                                onClick={() => decide(r, false)}
                                style={{
                                    flex: 1, padding: '9px 0', borderRadius: 11,
                                    border: '1px solid var(--border-color)', background: 'var(--card-bg)',
                                    color: '#f43f5e', fontWeight: 900, fontSize: '0.78rem', cursor: 'pointer',
                                }}
                            >{isRTL ? '❌ رفض' : '❌ Reject'}</button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default StoreNameRequests;
