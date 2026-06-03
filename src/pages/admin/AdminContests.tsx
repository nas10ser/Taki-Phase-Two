import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
    contestRepository, Contest, ContestQuestion, SocialTask, ContestEntry,
    ContestStatus, QuestionType,
} from '../../repositories/contestRepository';

/**
 * AdminContests (v11.44) — create surveys/quizzes with prizes, auto-grade
 * entries, then run a privacy-aware draw. Light/dark safe (var(--*) + solid
 * tints, no light gradients). Gated by the `tab_contests` permission.
 */

const uid = () => Math.random().toString(36).slice(2, 9);

const STATUS_META: Record<ContestStatus, { label: string; bg: string }> = {
    draft:  { label: 'مسودة',  bg: '#64748b' },
    active: { label: 'مُفعّلة', bg: '#10b981' },
    closed: { label: 'مغلقة',  bg: '#f59e0b' },
    drawn:  { label: 'تم السحب', bg: '#8b5cf6' },
};

const inputCls = 'w-full px-3 py-2.5 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl text-sm text-[var(--text-primary)] outline-none focus:border-emerald-500';
const labelCls = 'block text-xs font-bold text-[var(--text-secondary)] mb-1.5';

const blankContest = (): Partial<Contest> => ({
    title: '', description: '', prize: '', status: 'draft',
    questions: [], social_tasks: [], pass_mode: 'all_correct',
    reveal_name: true, reveal_phone: 'last4', starts_at: null, ends_at: null,
});

const AdminContests: React.FC = () => {
    const { customAlert, customConfirm } = useApp();
    const [view, setView] = useState<'list' | 'edit' | 'manage'>('list');
    const [contests, setContests] = useState<Contest[]>([]);
    const [loading, setLoading] = useState(true);
    const [counts, setCounts] = useState<Record<string, { total: number; qualified: number }>>({});
    const [draft, setDraft] = useState<Partial<Contest>>(blankContest());
    const [saving, setSaving] = useState(false);
    const [manageId, setManageId] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        const list = await contestRepository.list();
        setContests(list);
        setLoading(false);
        // counts (best-effort)
        const c: Record<string, { total: number; qualified: number }> = {};
        await Promise.all(list.map(async (ct) => { c[ct.id] = await contestRepository.counts(ct.id); }));
        setCounts(c);
    }, []);
    useEffect(() => { load(); }, [load]);

    // ---------- editor helpers ----------
    const setField = (patch: Partial<Contest>) => setDraft((d) => ({ ...d, ...patch }));
    const addQuestion = () => setDraft((d) => ({ ...d, questions: [...(d.questions || []), { id: uid(), type: 'text', prompt: '', correctAnswer: '', points: 1, required: true } as ContestQuestion] }));
    const updateQuestion = (id: string, patch: Partial<ContestQuestion>) =>
        setDraft((d) => ({ ...d, questions: (d.questions || []).map((q) => q.id === id ? { ...q, ...patch } : q) }));
    const removeQuestion = (id: string) => setDraft((d) => ({ ...d, questions: (d.questions || []).filter((q) => q.id !== id) }));
    const addTask = () => setDraft((d) => ({ ...d, social_tasks: [...(d.social_tasks || []), { id: uid(), prompt: '' }] }));
    const updateTask = (id: string, prompt: string) => setDraft((d) => ({ ...d, social_tasks: (d.social_tasks || []).map((t) => t.id === id ? { ...t, prompt } : t) }));
    const removeTask = (id: string) => setDraft((d) => ({ ...d, social_tasks: (d.social_tasks || []).filter((t) => t.id !== id) }));

    const openNew = () => { setDraft(blankContest()); setView('edit'); };
    const openEdit = (c: Contest) => { setDraft({ ...c }); setView('edit'); };

    const save = async () => {
        setSaving(true);
        const res = await contestRepository.save(draft);
        setSaving(false);
        if (!res.success) { await customAlert('❌ ' + (res.error || 'تعذّر الحفظ')); return; }
        await customAlert('✅ تم حفظ المسابقة.');
        setView('list');
        load();
    };

    const changeStatus = async (c: Contest, status: ContestStatus) => {
        await contestRepository.setStatus(c.id, status);
        load();
    };

    const removeContest = async (c: Contest) => {
        if (!(await customConfirm(`حذف «${c.title}» وكل مشاركاتها؟`))) return;
        await contestRepository.remove(c.id);
        load();
    };

    // ================= LIST =================
    if (view === 'list') {
        return (
            <div dir="rtl" className="space-y-3">
                <div className="bg-purple-50 border border-purple-200 rounded-2xl p-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <div className="text-2xl">🎁</div>
                        <div>
                            <div className="font-extrabold text-purple-900 text-base">المسابقات والاستبيانات</div>
                            <div className="text-xs text-purple-700 mt-0.5">أنشئ أسئلة بجوائز، صحّح تلقائياً، ثم اسحب الفائزين بخصوصية.</div>
                        </div>
                    </div>
                    <button onClick={openNew} className="px-4 py-2.5 rounded-xl text-sm font-extrabold text-white bg-purple-600 hover:bg-purple-700 active:scale-95 whitespace-nowrap">➕ مسابقة جديدة</button>
                </div>

                {loading ? (
                    <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-28 bg-[var(--gray-100)] rounded-2xl animate-pulse" />)}</div>
                ) : contests.length === 0 ? (
                    <div className="text-center text-[var(--text-secondary)] py-16">لا توجد مسابقات بعد. اضغط «مسابقة جديدة».</div>
                ) : contests.map((c) => {
                    const sm = STATUS_META[c.status];
                    const ct = counts[c.id];
                    return (
                        <div key={c.id} className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl p-4 shadow-sm">
                            <div className="flex items-start justify-between gap-2 mb-2">
                                <div className="min-w-0">
                                    <div className="font-extrabold text-[var(--text-primary)] text-base truncate">{c.title || '(بدون عنوان)'}</div>
                                    {c.prize && <div className="text-xs text-amber-600 font-bold mt-0.5">🏆 {c.prize}</div>}
                                </div>
                                <span className="text-[11px] font-extrabold text-white px-2.5 py-1 rounded-full whitespace-nowrap" style={{ background: sm.bg }}>{sm.label}</span>
                            </div>
                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--text-secondary)] mb-3">
                                <span>📝 {c.questions.length} سؤال</span>
                                <span>👥 {ct ? ct.total : '…'} مشارك</span>
                                <span>✅ {ct ? ct.qualified : '…'} مؤهّل</span>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <button onClick={() => openEdit(c)} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-[var(--body-bg)] border border-[var(--border-color)] text-[var(--text-primary)]">✏️ تعديل</button>
                                {c.status !== 'active' && <button onClick={() => changeStatus(c, 'active')} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-500 text-white">▶️ تفعيل</button>}
                                {c.status === 'active' && <button onClick={() => changeStatus(c, 'closed')} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-amber-500 text-white">⏸️ إغلاق</button>}
                                <button onClick={() => { setManageId(c.id); setView('manage'); }} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-purple-600 text-white">👥 المشاركات والسحب</button>
                                <button onClick={() => removeContest(c)} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-red-50 text-red-600 border border-red-200">🗑 حذف</button>
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    }

    // ================= EDITOR =================
    if (view === 'edit') {
        const qs = draft.questions || [];
        const tasks = draft.social_tasks || [];
        return (
            <div dir="rtl" className="space-y-4 max-w-2xl">
                <div className="flex items-center justify-between">
                    <h2 className="font-extrabold text-lg text-[var(--text-primary)]">{draft.id ? 'تعديل المسابقة' : 'مسابقة جديدة'}</h2>
                    <button onClick={() => setView('list')} className="text-sm font-bold text-[var(--text-secondary)]">رجوع →</button>
                </div>

                <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl p-4 space-y-3">
                    <div><label className={labelCls}>عنوان المسابقة *</label><input className={inputCls} value={draft.title || ''} onChange={(e) => setField({ title: e.target.value })} placeholder="مثال: مسابقة رمضان" /></div>
                    <div><label className={labelCls}>وصف مختصر</label><textarea className={inputCls} rows={2} value={draft.description || ''} onChange={(e) => setField({ description: e.target.value })} /></div>
                    <div><label className={labelCls}>الجائزة</label><input className={inputCls} value={draft.prize || ''} onChange={(e) => setField({ prize: e.target.value })} placeholder="مثال: بطاقة هدية 500 ر.س" /></div>
                    <div className="grid grid-cols-2 gap-3">
                        <div><label className={labelCls}>يبدأ في</label><input type="datetime-local" className={inputCls} value={draft.starts_at ? draft.starts_at.slice(0, 16) : ''} onChange={(e) => setField({ starts_at: e.target.value ? new Date(e.target.value).toISOString() : null })} /></div>
                        <div><label className={labelCls}>ينتهي في</label><input type="datetime-local" className={inputCls} value={draft.ends_at ? draft.ends_at.slice(0, 16) : ''} onChange={(e) => setField({ ends_at: e.target.value ? new Date(e.target.value).toISOString() : null })} /></div>
                    </div>
                    <div>
                        <label className={labelCls}>شرط التأهّل للسحب</label>
                        <select className={inputCls} value={draft.pass_mode} onChange={(e) => setField({ pass_mode: e.target.value as any })}>
                            <option value="all_correct">يجب الإجابة على كل الأسئلة المُصحّحة بشكل صحيح</option>
                            <option value="any">إجابة صحيحة واحدة على الأقل تكفي</option>
                            <option value="collect">بدون تصحيح — كل من يشارك يدخل السحب</option>
                        </select>
                    </div>
                </div>

                {/* Questions builder */}
                <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                        <div className="font-bold text-[var(--text-primary)] text-sm">📝 الأسئلة</div>
                        <button onClick={addQuestion} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200">➕ سؤال</button>
                    </div>
                    {qs.length === 0 && <div className="text-xs text-[var(--text-secondary)]">لا أسئلة بعد. أضف سؤالاً واترك «الإجابة الصحيحة» فارغة إن كان سؤالاً مفتوحاً بلا تصحيح.</div>}
                    {qs.map((q, i) => (
                        <div key={q.id} className="bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl p-3 space-y-2">
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-extrabold text-[var(--text-secondary)]">#{i + 1}</span>
                                <select className="px-2 py-1.5 bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg text-xs text-[var(--text-primary)] outline-none" value={q.type} onChange={(e) => updateQuestion(q.id, { type: e.target.value as QuestionType })}>
                                    <option value="text">نص</option>
                                    <option value="fill">فراغ</option>
                                    <option value="choice">اختيارات</option>
                                </select>
                                <label className="flex items-center gap-1 text-[11px] text-[var(--text-secondary)] mr-auto"><input type="checkbox" checked={q.required !== false} onChange={(e) => updateQuestion(q.id, { required: e.target.checked })} /> إلزامي</label>
                                <button onClick={() => removeQuestion(q.id)} className="w-7 h-7 rounded-lg bg-red-50 text-red-600 text-sm">🗑</button>
                            </div>
                            <input className={inputCls} placeholder="نص السؤال" value={q.prompt} onChange={(e) => updateQuestion(q.id, { prompt: e.target.value })} />
                            {q.type === 'choice' && (
                                <input className={inputCls} placeholder="الاختيارات مفصولة بفاصلة: أحمر, أخضر, أزرق" value={(q.options || []).join(', ')} onChange={(e) => updateQuestion(q.id, { options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
                            )}
                            <div className="grid grid-cols-3 gap-2">
                                <input className={`${inputCls} col-span-2`} placeholder="الإجابة الصحيحة (اتركها فارغة = بلا تصحيح)" value={q.correctAnswer || ''} onChange={(e) => updateQuestion(q.id, { correctAnswer: e.target.value })} />
                                <input type="number" min={1} className={inputCls} placeholder="نقاط" value={q.points ?? 1} onChange={(e) => updateQuestion(q.id, { points: Math.max(1, Number(e.target.value) || 1) })} />
                            </div>
                        </div>
                    ))}
                </div>

                {/* Social tasks */}
                <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                        <div className="font-bold text-[var(--text-primary)] text-sm">📣 مهام التفاعل (يكتبها المشارك)</div>
                        <button onClick={addTask} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-sky-50 text-sky-700 border border-sky-200">➕ مهمة</button>
                    </div>
                    {tasks.length === 0 && <div className="text-xs text-[var(--text-secondary)]">مثال: «في أي منصة تابعتنا؟» أو «أين عملت منشن؟» — يكتب المشارك إجابته نصاً.</div>}
                    {tasks.map((t) => (
                        <div key={t.id} className="flex items-center gap-2">
                            <input className={inputCls} placeholder="نص المهمة" value={t.prompt} onChange={(e) => updateTask(t.id, e.target.value)} />
                            <button onClick={() => removeTask(t.id)} className="w-9 h-9 shrink-0 rounded-lg bg-red-50 text-red-600 text-sm">🗑</button>
                        </div>
                    ))}
                </div>

                {/* Privacy for the draw */}
                <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl p-4 space-y-3">
                    <div className="font-bold text-[var(--text-primary)] text-sm">🔒 خصوصية السحب (ما يظهر للعالم)</div>
                    <label className="flex items-center justify-between text-sm text-[var(--text-primary)]">
                        إظهار اسم الفائز
                        <input type="checkbox" className="w-5 h-5 accent-purple-600" checked={draft.reveal_name !== false} onChange={(e) => setField({ reveal_name: e.target.checked })} />
                    </label>
                    <div>
                        <label className={labelCls}>إظهار رقم الجوال</label>
                        <select className={inputCls} value={draft.reveal_phone} onChange={(e) => setField({ reveal_phone: e.target.value as any })}>
                            <option value="last4">آخر 4 أرقام فقط (مثال: *** 4567)</option>
                            <option value="hidden">مخفي تماماً</option>
                            <option value="full">كامل (غير مُنصح به)</option>
                        </select>
                    </div>
                </div>

                <div className="flex gap-2">
                    <button onClick={() => setView('list')} className="flex-1 py-3 rounded-xl text-sm font-bold border border-[var(--border-color)] text-[var(--text-secondary)]">إلغاء</button>
                    <button onClick={save} disabled={saving} className="flex-[2] py-3 rounded-xl text-sm font-extrabold text-white bg-purple-600 disabled:opacity-50">{saving ? 'جاري الحفظ...' : '💾 حفظ المسابقة'}</button>
                </div>
            </div>
        );
    }

    // ================= MANAGE (entries + draw) =================
    return <ManageContest contestId={manageId!} onBack={() => { setView('list'); load(); }} />;
};

// ---------- entries + draw sub-view ----------
const ManageContest: React.FC<{ contestId: string; onBack: () => void }> = ({ contestId, onBack }) => {
    const { customAlert, customConfirm } = useApp();
    const [contest, setContest] = useState<Contest | null>(null);
    const [entries, setEntries] = useState<ContestEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [drawCount, setDrawCount] = useState(1);
    const [drawing, setDrawing] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        const [c, e] = await Promise.all([contestRepository.get(contestId), contestRepository.entries(contestId)]);
        setContest(c); setEntries(e); setLoading(false);
    }, [contestId]);
    useEffect(() => { load(); }, [load]);

    const qualified = entries.filter((e) => e.qualified);
    const winners = entries.filter((e) => e.is_winner);

    const runDraw = async () => {
        if (qualified.length === 0) { await customAlert('لا يوجد مشاركون مؤهّلون للسحب بعد.'); return; }
        if (!(await customConfirm(`سحب ${drawCount} فائز(ين) عشوائياً من ${qualified.length} مؤهّل؟`))) return;
        setDrawing(true);
        const res = await contestRepository.draw(contestId, drawCount);
        setDrawing(false);
        if (!res.success) { await customAlert('❌ ' + (res.error || 'تعذّر السحب')); return; }
        await customAlert('🎉 تم السحب! الفائزون: ' + (res.winners || []).map((w) => w.name).join('، '));
        load();
    };

    const maskPhone = (p: string) => {
        if (!contest) return p;
        if (contest.reveal_phone === 'hidden') return '••••••';
        if (contest.reveal_phone === 'full') return p;
        return '*** ' + (p.replace(/\D/g, '').slice(-4));
    };

    return (
        <div dir="rtl" className="space-y-3 max-w-3xl">
            <div className="flex items-center justify-between">
                <h2 className="font-extrabold text-lg text-[var(--text-primary)] truncate">{contest?.title || 'المشاركات'}</h2>
                <button onClick={onBack} className="text-sm font-bold text-[var(--text-secondary)]">رجوع →</button>
            </div>

            {/* Draw box */}
            <div className="bg-purple-50 border border-purple-200 rounded-2xl p-4">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                    <div className="font-extrabold text-purple-900 text-sm">🎲 سحب الفائزين</div>
                    <span className="text-[11px] text-purple-700">({qualified.length} مؤهّل من {entries.length} مشارك)</span>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-xs text-purple-800 font-bold">عدد الفائزين</span>
                    <input type="number" min={1} max={Math.max(1, qualified.length)} value={drawCount} onChange={(e) => setDrawCount(Math.max(1, Number(e.target.value) || 1))} className="w-20 px-2 py-2 bg-[var(--card-bg)] border border-purple-200 rounded-lg text-center font-bold text-[var(--text-primary)] outline-none" />
                    <button onClick={runDraw} disabled={drawing} className="px-4 py-2 rounded-lg text-sm font-extrabold text-white bg-purple-600 disabled:opacity-50 mr-auto">{drawing ? 'جاري السحب...' : '🎲 اسحب الآن'}</button>
                </div>
                {winners.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-purple-200">
                        <div className="text-xs font-bold text-purple-900 mb-1">🏆 الفائزون (كما سيظهرون للعالم: {contest?.reveal_name === false ? 'بلا اسم' : 'بالاسم'} / {contest?.reveal_phone === 'full' ? 'الجوال كامل' : contest?.reveal_phone === 'hidden' ? 'بلا جوال' : 'آخر ٤ أرقام'})</div>
                        {winners.map((w) => (
                            <div key={w.id} className="text-sm font-bold text-[var(--text-primary)]">🎉 {contest?.reveal_name === false ? 'فائز' : w.name} — <span className="font-mono">{maskPhone(w.phone)}</span></div>
                        ))}
                    </div>
                )}
            </div>

            {/* Entries table */}
            {loading ? (
                <div className="h-40 bg-[var(--gray-100)] rounded-2xl animate-pulse" />
            ) : entries.length === 0 ? (
                <div className="text-center text-[var(--text-secondary)] py-12">لا مشاركات بعد.</div>
            ) : (
                <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl overflow-hidden">
                    {entries.map((e) => (
                        <div key={e.id} className="flex items-center gap-3 p-3 border-b border-[var(--border-color)] last:border-0">
                            <div className="flex-1 min-w-0">
                                <div className="font-bold text-sm text-[var(--text-primary)] truncate flex items-center gap-2">
                                    {e.is_winner && <span title="فائز">🏆</span>}{e.name}
                                </div>
                                <div className="text-[11px] text-[var(--text-secondary)] font-mono" dir="ltr">{e.phone}</div>
                            </div>
                            <span className="text-[11px] text-[var(--text-secondary)]">{e.score}/{e.max_score}</span>
                            <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full text-white ${e.qualified ? 'bg-emerald-500' : 'bg-[var(--gray-400)]'}`}>{e.qualified ? 'مؤهّل' : 'غير مؤهّل'}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default AdminContests;
