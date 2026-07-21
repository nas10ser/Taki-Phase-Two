/**
 * AdminModeration v12.31 — تبويب «🛡 الإنذارات» (طلب ناصر ١٣).
 *
 * قسم مستقل تماماً عن البلاغات والشكاوى: هذه إنذارات آلية يرصدها النظام
 * بنفسه (فلترة لحالها) — لا تعتمد على بلاغ من أحد:
 *   💬 كلمة تحرش/إساءة في محادثة حجز   ⭐ في تعليق تقييم   🏷 في اسم/وصف عرض
 *   🖼 محاولة رفع صورة غير لائقة (حجبها فلتر NSFWJS قبل وصولها للتخزين)
 *
 * الرصد النصي يتم بتريغرات في قاعدة البيانات (يغطي الموقع + بوتي تيليجرام
 * وواتساب تلقائياً) عبر قاموس moderation_terms القابل للإدارة من هنا.
 * البيانات عبر admin_moderation_overview / admin_moderation_flags (is_admin).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../services/supabaseClient';
import { useApp } from '../../context/AppContext';

interface StoreRow {
    store_id: string; shop: string | null;
    flags: number; open: number;
    chat: number; rating: number; deal: number; upload: number;
    last_at: string;
}
interface FlagRow {
    id: string; kind: 'text' | 'image'; source: 'chat' | 'rating' | 'deal' | 'upload';
    store_id: string | null; offender_id: string | null; offender_name: string | null;
    content: string | null; matched: string[] | null;
    status: 'open' | 'reviewed'; created_at: string;
}
interface TermRow { id: number; term: string; match_mode: 'word' | 'substr'; }

const SOURCE_META: Record<string, { icon: string; label: string }> = {
    chat:   { icon: '💬', label: 'محادثة حجز' },
    rating: { icon: '⭐', label: 'تعليق تقييم' },
    deal:   { icon: '🏷', label: 'اسم/وصف عرض' },
    upload: { icon: '🖼', label: 'صورة مرفوضة' },
};

const fmtWhen = (iso: string) => {
    try {
        const d = new Date(iso);
        return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' }) + ' ' +
               d.toLocaleTimeString('en-GB', { timeZone: 'Asia/Riyadh', hour12: false, hour: '2-digit', minute: '2-digit' });
    } catch { return iso; }
};

const AdminModeration: React.FC = () => {
    const { customAlert, customConfirm } = useApp();
    const [overview, setOverview] = useState<{ total_open: number; stores: StoreRow[] } | null>(null);
    const [flags, setFlags] = useState<FlagRow[]>([]);
    const [storeFilter, setStoreFilter] = useState<string | null>(null);
    const [statusFilter, setStatusFilter] = useState<'open' | 'reviewed' | ''>('');
    const [loading, setLoading] = useState(true);
    const [terms, setTerms] = useState<TermRow[]>([]);
    const [newTerm, setNewTerm] = useState('');
    const [newMode, setNewMode] = useState<'word' | 'substr'>('word');
    const [savingTerm, setSavingTerm] = useState(false);
    // v12.53 — تأخير وصول الإنذار للمخالف بالدقائق (٠ = فوري): يوحي بمراجعة بشرية
    const [warnDelay, setWarnDelay] = useState<number>(0);
    const [savingDelay, setSavingDelay] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        const [ovRes, flRes, tRes, msRes] = await Promise.all([
            supabase.rpc('admin_moderation_overview', { p_limit: 200 }),
            supabase.rpc('admin_moderation_flags', {
                p_store: storeFilter,
                p_status: statusFilter || null,
                p_limit: 300,
            }),
            supabase.from('moderation_terms').select('*').order('term'),
            supabase.from('platform_settings').select('value').eq('key', 'moderation_settings').maybeSingle(),
        ]);
        if (!ovRes.error && ovRes.data) setOverview(ovRes.data as any);
        if (!flRes.error && Array.isArray(flRes.data)) setFlags(flRes.data as FlagRow[]);
        if (!tRes.error && tRes.data) setTerms(tRes.data as TermRow[]);
        setWarnDelay(Number((msRes.data?.value as any)?.warn_delay_minutes) || 0);
        setLoading(false);
    }, [storeFilter, statusFilter]);
    useEffect(() => { load(); }, [load]);

    const saveWarnDelay = async () => {
        setSavingDelay(true);
        const { error } = await supabase.from('platform_settings').upsert({
            key: 'moderation_settings',
            value: { warn_delay_minutes: Math.max(0, Math.min(1440, Math.round(warnDelay) || 0)) },
            description: 'Moderation: minutes to delay warning delivery so it feels human-reviewed (v12.53)',
            updated_at: new Date().toISOString(),
        });
        setSavingDelay(false);
        if (error) { await customAlert('❌ ' + error.message); return; }
        await customAlert(warnDelay > 0
            ? `✅ من الآن: أي إنذار ترسله يُسجّل فوراً عندك، ويصل للمخالف بعد ${warnDelay} دقيقة — يوحي بأن فريقاً بشرياً راجع المخالفة.`
            : '✅ الإنذارات ستصل فوراً (بدون تأخير).');
    };

    const setFlagStatus = async (f: FlagRow, status: 'open' | 'reviewed') => {
        setFlags(prev => prev.map(x => x.id === f.id ? { ...x, status } : x));
        const { error } = await supabase.rpc('admin_set_flag_status', { p_id: f.id, p_status: status });
        if (error) {
            setFlags(prev => prev.map(x => x.id === f.id ? { ...x, status: f.status } : x));
            await customAlert('❌ ' + error.message);
        }
    };

    // v12.65 (طلب ناصر) — حذف الإنذار نهائياً: يختفي من السجل وعدّادات المتجر،
    // وترقية الإنذار الآلي تعدّ صفوف moderation_flags — فحذفه يعيد عدّ
    // مخالفات الحساب من الصفر فعلياً.
    const deleteFlag = async (f: FlagRow) => {
        const ok = await customConfirm('🗑 حذف هذا الإنذار نهائياً؟ لن يُحسب على الحساب وسيبدأ عدّه من جديد.');
        if (!ok) return;
        const prev = flags;
        setFlags(p => p.filter(x => x.id !== f.id));
        const { error } = await supabase.rpc('admin_delete_flag', { p_id: f.id });
        if (error) {
            setFlags(prev);
            await customAlert('❌ ' + error.message);
        }
    };

    const addTerm = async () => {
        const t = newTerm.trim();
        if (!t || savingTerm) return;
        setSavingTerm(true);
        const { error } = await supabase.from('moderation_terms').insert({ term: t, match_mode: newMode });
        setSavingTerm(false);
        if (error) {
            await customAlert(error.code === '23505' ? '⚠️ هذه الكلمة موجودة أصلاً في القاموس.' : '❌ ' + error.message);
            return;
        }
        setNewTerm('');
        load();
    };

    const removeTerm = async (t: TermRow) => {
        if (!(await customConfirm(`حذف «${t.term}» من قاموس الفلترة؟`))) return;
        const { error } = await supabase.from('moderation_terms').delete().eq('id', t.id);
        if (error) { await customAlert('❌ ' + error.message); return; }
        setTerms(prev => prev.filter(x => x.id !== t.id));
    };

    return (
        <div dir="rtl" className="space-y-4">
            <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 flex items-start gap-3">
                <div className="text-2xl shrink-0">🛡</div>
                <div className="min-w-0">
                    <div className="font-extrabold text-rose-900 text-base">الإنذارات الآلية — فلترة المحتوى</div>
                    <div className="text-xs text-rose-700 mt-1 leading-relaxed">
                        النظام يرصد بنفسه (بدون بلاغ من أحد): كلمات التحرش والإساءة في محادثات الحجز والتقييمات وأسماء/أوصاف العروض
                        — في الموقع والبوتين معاً — ومحاولات رفع الصور غير اللائقة التي يحجبها فلتر الصور قبل وصولها للمنصة.
                        {overview && <b className="mr-1">حالياً {overview.total_open.toLocaleString('ar-SA')} إنذار مفتوح.</b>}
                    </div>
                </div>
            </div>

            {/* v12.53 — «المراقبة البشرية»: تأخير وصول الإنذار للمخالف بالدقائق.
                الإنذار يُسجّل عندك فوراً ويبقى حتى تحذفه يدوياً — فقط وصول
                الإشعار للمخالف يتأخر فلا يبدو رداً آلياً لحظياً. */}
            <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl p-4">
                <div className="font-extrabold text-sm text-[var(--text-primary)] mb-1">⏱ توقيت وصول الإنذار للمخالف</div>
                <p className="text-[11px] font-bold text-[var(--text-secondary)] leading-relaxed mb-2.5">
                    الإنذار يُسجّل في سجلك <b>فوراً</b> ويبقى حتى تحذفه يدوياً. حدد كم دقيقة ينتظر النظام قبل إيصال
                    الإشعار للمخالف — التأخير يوحي بأن <b>فريقاً بشرياً</b> راجع المخالفة (٠ = يصل فوراً).
                    وإذا حذفت الإنذار قبل انقضاء المدة، يُلغى إرساله نهائياً.
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                    {[0, 10, 30, 60, 180].map(m => (
                        <button key={m} onClick={() => setWarnDelay(m)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-extrabold border ${warnDelay === m ? 'bg-rose-600 text-white border-rose-600' : 'bg-[var(--body-bg)] text-[var(--text-primary)] border-[var(--border-color)]'}`}>
                            {m === 0 ? 'فوري' : m < 60 ? `${m} دقيقة` : `${m / 60} ساعة`}
                        </button>
                    ))}
                    <input
                        type="number" min={0} max={1440} value={warnDelay}
                        onChange={e => setWarnDelay(Math.max(0, Math.min(1440, Number(e.target.value) || 0)))}
                        className="w-20 px-2 py-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--body-bg)] text-xs font-bold text-center text-[var(--text-primary)]"
                    />
                    <span className="text-[10px] font-bold text-[var(--text-secondary)]">دقيقة</span>
                    <button onClick={saveWarnDelay} disabled={savingDelay}
                        className="px-4 py-1.5 rounded-lg bg-emerald-500 text-white text-xs font-extrabold shadow hover:shadow-md active:scale-95 transition-all disabled:opacity-60">
                        {savingDelay ? '⏳' : '💾 حفظ'}
                    </button>
                </div>
            </div>

            {loading && !overview ? (
                <div className="h-40 bg-[var(--gray-100)] rounded-2xl animate-pulse" />
            ) : (
                <>
                    {/* عدد الإنذارات لكل متجر + أسبابها */}
                    <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl p-4 space-y-2">
                        <h3 className="font-extrabold text-sm text-[var(--text-primary)]">🏬 الإنذارات لكل متجر (اضغط متجراً لعرض تفاصيله)</h3>
                        {!overview || overview.stores.length === 0 ? (
                            <div className="text-xs text-[var(--gray-400)] text-center py-5">لا إنذارات على أي متجر — المنصة نظيفة ✅</div>
                        ) : (
                            <div className="space-y-1.5">
                                {overview.stores.map(s => (
                                    <button key={s.store_id}
                                        onClick={() => setStoreFilter(storeFilter === s.store_id ? null : s.store_id)}
                                        className={`w-full flex items-center gap-2 text-xs font-bold border rounded-xl px-3 py-2.5 text-right transition-colors ${storeFilter === s.store_id ? 'border-rose-400 bg-rose-50' : 'border-[var(--border-color)] bg-[var(--body-bg)]'}`}>
                                        <span className="flex-1 min-w-0 truncate text-[var(--text-primary)]">{s.shop || s.store_id}</span>
                                        {s.chat > 0 && <span title="محادثات">💬 {s.chat}</span>}
                                        {s.rating > 0 && <span title="تقييمات">⭐ {s.rating}</span>}
                                        {s.deal > 0 && <span title="عروض">🏷 {s.deal}</span>}
                                        {s.upload > 0 && <span title="صور مرفوضة">🖼 {s.upload}</span>}
                                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold text-white ${s.open > 0 ? 'bg-rose-500' : 'bg-emerald-500'}`}>
                                            {s.open > 0 ? `${s.open} مفتوح` : 'كلها روجعت'}
                                        </span>
                                        <span className="text-[10px] text-[var(--text-secondary)] shrink-0">{s.flags} إجمالاً</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* قائمة الإنذارات التفصيلية */}
                    <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl p-4 space-y-2">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                            <h3 className="font-extrabold text-sm text-[var(--text-primary)]">
                                📋 سجل الإنذارات {storeFilter && overview ? `— ${overview.stores.find(s => s.store_id === storeFilter)?.shop || ''}` : ''}
                            </h3>
                            <div className="flex gap-1.5">
                                {storeFilter && (
                                    <button onClick={() => setStoreFilter(null)} className="px-2.5 py-1.5 rounded-lg text-[11px] font-extrabold bg-[var(--gray-100)] text-[var(--text-secondary)]">✕ كل المتاجر</button>
                                )}
                                {([['', 'الكل'], ['open', 'المفتوحة'], ['reviewed', 'المُراجَعة']] as const).map(([v, lbl]) => (
                                    <button key={v} onClick={() => setStatusFilter(v)}
                                        className={`px-2.5 py-1.5 rounded-lg text-[11px] font-extrabold ${statusFilter === v ? 'bg-rose-500 text-white' : 'bg-[var(--gray-100)] text-[var(--text-secondary)]'}`}>
                                        {lbl}
                                    </button>
                                ))}
                            </div>
                        </div>
                        {flags.length === 0 ? (
                            <div className="text-xs text-[var(--gray-400)] text-center py-5">لا إنذارات مطابقة.</div>
                        ) : flags.map(f => {
                            const meta = SOURCE_META[f.source] || { icon: '❔', label: f.source };
                            return (
                                <div key={f.id} className={`border rounded-xl p-3 space-y-1.5 ${f.status === 'open' ? 'border-rose-200 bg-rose-50/40' : 'border-[var(--border-color)]'}`}>
                                    <div className="flex items-center gap-2 flex-wrap text-[11px] font-bold text-[var(--text-secondary)]">
                                        <span className="text-[var(--text-primary)] font-extrabold">{meta.icon} {meta.label}</span>
                                        {f.offender_name && <span>👤 {f.offender_name}</span>}
                                        <span dir="ltr" className="font-mono">{fmtWhen(f.created_at)}</span>
                                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold text-white ${f.status === 'open' ? 'bg-rose-500' : 'bg-emerald-500'}`}>
                                            {f.status === 'open' ? 'مفتوح' : 'روجع'}
                                        </span>
                                        <span className="mr-auto" />
                                        <button onClick={() => setFlagStatus(f, f.status === 'open' ? 'reviewed' : 'open')}
                                            className="px-2.5 py-1 rounded-lg text-[10px] font-extrabold bg-[var(--gray-100)] text-[var(--text-primary)]">
                                            {f.status === 'open' ? '✓ اعتبره مُراجَعاً' : '↩︎ أعده مفتوحاً'}
                                        </button>
                                        {/* v12.65 — حذف نهائي: يصفّر عدّ مخالفات الحساب */}
                                        <button onClick={() => deleteFlag(f)}
                                            className="px-2.5 py-1 rounded-lg text-[10px] font-extrabold bg-rose-100 text-rose-700 border border-rose-200">
                                            🗑 حذف
                                        </button>
                                    </div>
                                    {f.content && (
                                        <div className="text-xs text-[var(--text-primary)] bg-[var(--body-bg)] border border-[var(--border-color)] rounded-lg px-2.5 py-2 leading-relaxed break-words">
                                            {f.content}
                                        </div>
                                    )}
                                    {f.matched && f.matched.length > 0 && (
                                        <div className="flex items-center gap-1.5 flex-wrap text-[10px] font-extrabold">
                                            <span className="text-[var(--text-secondary)]">السبب — كلمات مرصودة:</span>
                                            {f.matched.map((m, i) => (
                                                <span key={i} className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 border border-rose-200">{m}</span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {/* قاموس الفلترة */}
                    <details className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl p-4">
                        <summary className="cursor-pointer font-extrabold text-sm text-[var(--text-primary)]">
                            📖 قاموس كلمات الفلترة ({terms.length}) — أضف أو احذف بنفسك
                        </summary>
                        <div className="mt-3 space-y-3">
                            <div className="text-[11px] text-[var(--text-secondary)] leading-relaxed bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl p-2.5">
                                <b className="text-[var(--text-primary)]">وضع المطابقة:</b>{' '}
                                <b>كلمة مستقلة</b> = تُرصد فقط ككلمة كاملة (آمن للكلمات القصيرة حتى لا تُرصد «مكسرات» خطأً) ·{' '}
                                <b>في أي مكان</b> = تُرصد حتى داخل كلمة أخرى (للألفاظ الصريحة التي لا ترد في كلام طبيعي).
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                                <input value={newTerm} onChange={e => setNewTerm(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') addTerm(); }}
                                    placeholder="كلمة أو عبارة جديدة…"
                                    className="flex-1 min-w-[160px] px-3 py-2 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl text-sm text-[var(--text-primary)] outline-none" />
                                <select value={newMode} onChange={e => setNewMode(e.target.value as any)}
                                    className="px-3 py-2 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl text-sm font-bold text-[var(--text-primary)]">
                                    <option value="word">كلمة مستقلة</option>
                                    <option value="substr">في أي مكان</option>
                                </select>
                                <button onClick={addTerm} disabled={savingTerm || !newTerm.trim()}
                                    className="px-4 py-2 rounded-xl text-sm font-extrabold text-white bg-rose-500 disabled:opacity-50">
                                    ➕ إضافة
                                </button>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                                {terms.map(t => (
                                    <span key={t.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--body-bg)] border border-[var(--border-color)] text-[11px] font-bold text-[var(--text-primary)]">
                                        {t.term}
                                        <span className="text-[9px] text-[var(--text-secondary)]">{t.match_mode === 'word' ? 'كلمة' : 'أي مكان'}</span>
                                        <button onClick={() => removeTerm(t)} className="text-rose-500 font-extrabold" title="حذف">✕</button>
                                    </span>
                                ))}
                            </div>
                        </div>
                    </details>
                </>
            )}
        </div>
    );
};

export default AdminModeration;
