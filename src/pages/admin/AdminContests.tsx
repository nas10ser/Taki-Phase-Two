import React, { useCallback, useEffect, useRef, useState } from 'react';
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
    reveal_name: true, reveal_phone: 'last4', audience: 'all', starts_at: null, ends_at: null,
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
    const addQuestion = () => setDraft((d) => ({ ...d, questions: [...(d.questions || []), { id: uid(), type: 'choice', prompt: '', options: ['', ''], correctAnswer: '', points: 1, required: true } as ContestQuestion] }));
    const updateQuestion = (id: string, patch: Partial<ContestQuestion>) =>
        setDraft((d) => ({ ...d, questions: (d.questions || []).map((q) => q.id === id ? { ...q, ...patch } : q) }));
    const removeQuestion = (id: string) => setDraft((d) => ({ ...d, questions: (d.questions || []).filter((q) => q.id !== id) }));

    // Switching the question TYPE resets the fields that don't apply, so the
    // editor never carries stale options/answers between types.
    //   نص (text)   = سؤال مفتوح بلا تصحيح  → no correct answer, no options
    //   فراغ (fill)  = إجابة نصية تُصحّح تلقائياً → correct answer, no options
    //   اختيارات     = اختيار من متعدد        → options + the correct one
    const changeQuestionType = (id: string, type: QuestionType) =>
        updateQuestion(id, type === 'choice'
            ? { type, options: ['', ''], correctAnswer: '' }
            : { type, options: undefined, correctAnswer: '' });

    const addOption = (qid: string) =>
        setDraft((d) => ({ ...d, questions: (d.questions || []).map((q) => q.id === qid ? { ...q, options: [...(q.options || []), ''] } : q) }));
    const updateOption = (qid: string, idx: number, val: string) =>
        setDraft((d) => ({ ...d, questions: (d.questions || []).map((q) => {
            if (q.id !== qid) return q;
            const opts = [...(q.options || [])];
            const prev = opts[idx];
            opts[idx] = val;
            // keep the «correct» marker on the same option while its text is edited
            const correctAnswer = q.correctAnswer && q.correctAnswer === prev ? val : q.correctAnswer;
            return { ...q, options: opts, correctAnswer };
        }) }));
    const removeOption = (qid: string, idx: number) =>
        setDraft((d) => ({ ...d, questions: (d.questions || []).map((q) => {
            if (q.id !== qid) return q;
            const removed = (q.options || [])[idx];
            const opts = (q.options || []).filter((_, i) => i !== idx);
            const correctAnswer = q.correctAnswer && q.correctAnswer === removed ? '' : q.correctAnswer;
            return { ...q, options: opts, correctAnswer };
        }) }));
    const setCorrectOption = (qid: string, val: string) => updateQuestion(qid, { correctAnswer: val });
    const addTask = () => setDraft((d) => ({ ...d, social_tasks: [...(d.social_tasks || []), { id: uid(), prompt: '' }] }));
    const updateTask = (id: string, prompt: string) => setDraft((d) => ({ ...d, social_tasks: (d.social_tasks || []).map((t) => t.id === id ? { ...t, prompt } : t) }));
    const removeTask = (id: string) => setDraft((d) => ({ ...d, social_tasks: (d.social_tasks || []).filter((t) => t.id !== id) }));

    const openNew = () => { setDraft(blankContest()); setView('edit'); };
    const openEdit = (c: Contest) => { setDraft({ ...c }); setView('edit'); };

    const save = async () => {
        // Normalize questions: trim, drop blank options, and keep the «correct»
        // marker only if it still matches a real option.
        const cleaned = (draft.questions || []).map((q) => {
            const prompt = (q.prompt || '').trim();
            // Every question is worth 1 point — so a participant's result reads as
            // «صحيح / عدد الأسئلة» with no confusing weight number to manage.
            if (q.type === 'choice') {
                const options = (q.options || []).map((o) => o.trim()).filter(Boolean);
                const correctAnswer = options.includes((q.correctAnswer || '').trim()) ? (q.correctAnswer || '').trim() : '';
                return { ...q, prompt, options, correctAnswer, points: 1 };
            }
            // نص (open) carries no correct answer; فراغ keeps its graded answer.
            return { ...q, prompt, options: undefined, correctAnswer: q.type === 'fill' ? (q.correctAnswer || '').trim() : '', points: 1 };
        });
        // Validate before hitting the DB so the admin gets a clear, Arabic reason.
        for (let i = 0; i < cleaned.length; i++) {
            const q = cleaned[i];
            if (!q.prompt) { await customAlert(`السؤال رقم ${i + 1}: اكتب نص السؤال.`); return; }
            if (q.type === 'choice' && (q.options || []).length < 2) { await customAlert(`السؤال رقم ${i + 1}: أضف اختيارين على الأقل.`); return; }
        }
        setSaving(true);
        const res = await contestRepository.save({ ...draft, questions: cleaned });
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
                <div className="bg-purple-50 border border-purple-200 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="text-2xl shrink-0">🎁</div>
                        <div className="min-w-0">
                            <div className="font-extrabold text-purple-900 text-base">المسابقات والاستبيانات</div>
                            <div className="text-xs text-purple-700 mt-0.5 leading-relaxed">أنشئ أسئلة بجوائز، صحّح تلقائياً، ثم اسحب الفائزين بخصوصية.</div>
                        </div>
                    </div>
                    <button onClick={openNew} className="shrink-0 px-4 py-2.5 rounded-xl text-sm font-extrabold text-white bg-purple-600 hover:bg-purple-700 active:scale-95 whitespace-nowrap">➕ مسابقة جديدة</button>
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
                        <label className={labelCls}>لمن هذه المسابقة؟</label>
                        <select className={inputCls} value={draft.audience || 'all'} onChange={(e) => setField({ audience: e.target.value as any })}>
                            <option value="all">الجميع (مشترون + تجار)</option>
                            <option value="buyers">المشترون فقط</option>
                            <option value="sellers">التجار فقط</option>
                        </select>
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
                    <div className="text-[11px] text-[var(--text-secondary)] leading-relaxed bg-[var(--body-bg)] rounded-xl p-2.5 border border-[var(--border-color)]">
                        <b className="text-[var(--text-primary)]">أنواع الأسئلة:</b>{' '}
                        <b className="text-purple-600">اختيارات</b> = اختيار من متعدد تُحدِّد صحيحه ·{' '}
                        <b className="text-purple-600">فراغ</b> = إجابة نصية تُصحَّح تلقائياً ·{' '}
                        <b className="text-purple-600">نص</b> = سؤال مفتوح بلا تصحيح.
                    </div>
                    {qs.length === 0 && <div className="text-xs text-[var(--text-secondary)]">لا أسئلة بعد. اضغط «➕ سؤال».</div>}
                    {qs.map((q, i) => (
                        <div key={q.id} className="bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl p-3 space-y-2">
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-extrabold text-[var(--text-secondary)]">سؤال {i + 1}</span>
                                <select className="px-2 py-1.5 bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg text-xs text-[var(--text-primary)] outline-none" value={q.type} onChange={(e) => changeQuestionType(q.id, e.target.value as QuestionType)}>
                                    <option value="choice">اختيارات</option>
                                    <option value="fill">فراغ</option>
                                    <option value="text">نص</option>
                                </select>
                                <label className="flex items-center gap-1 text-[11px] text-[var(--text-secondary)] mr-auto"><input type="checkbox" checked={q.required !== false} onChange={(e) => updateQuestion(q.id, { required: e.target.checked })} /> إلزامي</label>
                                <button onClick={() => removeQuestion(q.id)} className="w-7 h-7 rounded-lg bg-red-50 text-red-600 text-sm">🗑</button>
                            </div>
                            <input className={inputCls} placeholder="نص السؤال" value={q.prompt} onChange={(e) => updateQuestion(q.id, { prompt: e.target.value })} />

                            {q.type === 'choice' && (
                                <div className="space-y-1.5">
                                    <div className="text-[11px] text-[var(--text-secondary)]">اضغط الدائرة بجانب الإجابة الصحيحة ✅</div>
                                    {(q.options || []).map((opt, oi) => {
                                        const isCorrect = !!q.correctAnswer && q.correctAnswer === opt && opt.trim() !== '';
                                        return (
                                            <div key={oi} className="flex items-center gap-2">
                                                <button type="button" onClick={() => opt.trim() && setCorrectOption(q.id, opt)} title="حدّد كإجابة صحيحة"
                                                    className={`w-7 h-7 shrink-0 rounded-full border-2 flex items-center justify-center text-xs font-extrabold transition-colors ${isCorrect ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-[var(--border-color)] text-transparent hover:border-emerald-400'}`}>✓</button>
                                                <input className={inputCls} placeholder={`الاختيار ${oi + 1}`} value={opt} onChange={(e) => updateOption(q.id, oi, e.target.value)} />
                                                <button type="button" onClick={() => removeOption(q.id, oi)} disabled={(q.options || []).length <= 2} title="حذف الاختيار" className="w-9 h-9 shrink-0 rounded-lg bg-red-50 text-red-600 text-sm disabled:opacity-30 disabled:cursor-not-allowed">🗑</button>
                                            </div>
                                        );
                                    })}
                                    <button type="button" onClick={() => addOption(q.id)} className="w-full py-2 rounded-lg text-xs font-bold bg-purple-50 text-purple-700 border border-dashed border-purple-300">➕ أضف اختيار</button>
                                    {!q.correctAnswer && <div className="text-[11px] text-amber-600">لم تحدّد الإجابة الصحيحة (بلا تحديد = هذا السؤال بلا تصحيح).</div>}
                                </div>
                            )}

                            {q.type === 'fill' && (
                                <input className={inputCls} placeholder="الإجابة الصحيحة (تُصحَّح تلقائياً بمطابقة النص)" value={q.correctAnswer || ''} onChange={(e) => updateQuestion(q.id, { correctAnswer: e.target.value })} />
                            )}

                            {q.type === 'text' && (
                                <div className="text-[11px] text-[var(--text-secondary)] bg-[var(--card-bg)] border border-dashed border-[var(--border-color)] rounded-lg px-3 py-2">📝 سؤال مفتوح — تُجمع إجابة المشارك بدون تصحيح.</div>
                            )}
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
    const { customAlert } = useApp();
    const [contest, setContest] = useState<Contest | null>(null);
    const [entries, setEntries] = useState<ContestEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [drawCount, setDrawCount] = useState(1);
    const [showDraw, setShowDraw] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        const [c, e] = await Promise.all([contestRepository.get(contestId), contestRepository.entries(contestId)]);
        setContest(c); setEntries(e); setLoading(false);
    }, [contestId]);
    useEffect(() => { load(); }, [load]);

    const qualified = entries.filter((e) => e.qualified);
    const winners = entries.filter((e) => e.is_winner);

    const openDraw = async () => {
        if (qualified.length === 0) { await customAlert('لا يوجد مشاركون مؤهّلون للسحب بعد.'); return; }
        const safe = Math.min(Math.max(1, drawCount), qualified.length);
        if (safe !== drawCount) setDrawCount(safe);
        setShowDraw(true);
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
                    <button onClick={openDraw} className="px-4 py-2 rounded-lg text-sm font-extrabold text-white bg-purple-600 active:scale-95 mr-auto">🎲 اسحب الآن</button>
                </div>
                {winners.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-purple-200">
                        <div className="text-xs font-bold text-purple-900 mb-1">🏆 الفائزون — الجوال كامل لتتواصل معهم (يظهر للعالم: {contest?.reveal_name === false ? 'بلا اسم' : 'بالاسم'} / {contest?.reveal_phone === 'full' ? 'الجوال كامل' : contest?.reveal_phone === 'hidden' ? 'بلا جوال' : 'آخر ٤ أرقام'})</div>
                        {winners.map((w) => (
                            <div key={w.id} className="text-sm font-bold text-[var(--text-primary)]">🎉 {w.name} — <span className="font-mono text-emerald-600" dir="ltr">{w.phone}</span></div>
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
                            </div>
                            <span className="text-[11px] text-[var(--text-secondary)]">{e.score}/{e.max_score}</span>
                            <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full text-white ${e.qualified ? 'bg-emerald-500' : 'bg-[var(--gray-400)]'}`}>{e.qualified ? 'مؤهّل' : 'غير مؤهّل'}</span>
                        </div>
                    ))}
                </div>
            )}

            {showDraw && contest && (
                <DrawReel
                    entries={qualified}
                    count={drawCount}
                    revealName={contest.reveal_name !== false}
                    maskPhone={maskPhone}
                    drawFn={() => contestRepository.draw(contestId, drawCount)}
                    onClose={() => { setShowDraw(false); load(); }}
                />
            )}
        </div>
    );
};

// ---------- animated winner draw (slot-machine reel) ----------
// Fairness note: the REAL winners are decided server-side by the
// `draw_contest_winners` RPC (random + SECURITY DEFINER). The reel is purely
// cosmetic — it shuffles through participants and, when the admin presses «قف»,
// decelerates onto the winner the server already chose. (v11.46)
const CONFETTI = Array.from({ length: 14 }, (_, i) => ({
    e: ['🎉', '🎊', '⭐', '✨', '🏆', '🎈'][i % 6],
    left: `${(i * 7 + 4) % 94}%`,
    size: 14 + (i % 4) * 5,
    dur: 2.4 + (i % 5) * 0.4,
    delay: (i % 7) * 0.18,
}));

const DrawReel: React.FC<{
    entries: ContestEntry[];
    count: number;
    revealName: boolean;
    maskPhone: (p: string) => string;
    drawFn: () => Promise<{ success: boolean; winners?: { name: string; phone: string }[]; error?: string }>;
    onClose: () => void;
}> = ({ entries, count, revealName, maskPhone, drawFn, onClose }) => {
    const [phase, setPhase] = useState<'spinning' | 'revealed' | 'error'>('spinning');
    const [display, setDisplay] = useState<{ id?: string; name: string; phone: string } | null>(entries[0] || null);
    const [winners, setWinners] = useState<{ name: string; phone: string }[] | null>(null);
    const [errMsg, setErrMsg] = useState('');
    const [stopping, setStopping] = useState(false);

    const winnersRef = useRef<{ name: string; phone: string }[] | null>(null);
    const errRef = useRef<string | null>(null);
    const spinRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
    const idxRef = useRef(0);

    useEffect(() => {
        // Visual spin — cycle fast through the qualified pool.
        spinRef.current = setInterval(() => {
            if (entries.length === 0) return;
            idxRef.current = (idxRef.current + 1) % entries.length;
            setDisplay(entries[idxRef.current]);
        }, 70);
        // Real draw (server-side). Result is stashed for the «قف» handler.
        drawFn()
            .then((res) => { if (res.success) winnersRef.current = res.winners || []; else errRef.current = res.error || 'تعذّر السحب'; })
            .catch((e) => { errRef.current = (e && e.message) || 'تعذّر السحب'; });
        return () => {
            if (spinRef.current) clearInterval(spinRef.current);
            timeoutsRef.current.forEach(clearTimeout);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const decelerate = (wnrs: { name: string; phone: string }[]) => {
        const target = wnrs[0];
        const delays = [110, 150, 200, 260, 330, 420, 540, 680];
        let acc = 0;
        delays.forEach((d, i) => {
            acc += d;
            const t = setTimeout(() => {
                if (i < delays.length - 1) {
                    const r = entries[(idxRef.current + i + 1) % Math.max(1, entries.length)];
                    if (r) setDisplay(r);
                } else {
                    if (target) setDisplay({ name: target.name, phone: target.phone });
                    const reveal = setTimeout(() => { setWinners(wnrs); setPhase('revealed'); }, 380);
                    timeoutsRef.current.push(reveal);
                }
            }, acc);
            timeoutsRef.current.push(t);
        });
    };

    const onStopClick = () => {
        if (stopping) return;
        setStopping(true);
        if (spinRef.current) { clearInterval(spinRef.current); spinRef.current = null; }
        // Wait for the server result, then decelerate onto the winner.
        const wait = (tries: number) => {
            if (winnersRef.current) { decelerate(winnersRef.current); return; }
            if (errRef.current) { setErrMsg(errRef.current); setPhase('error'); return; }
            if (tries > 80) { setErrMsg('تأخّر الاتصال — حاول مجدداً'); setPhase('error'); return; }
            const t = setTimeout(() => wait(tries + 1), 100);
            timeoutsRef.current.push(t);
        };
        wait(0);
    };

    return (
        <div dir="rtl" className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.78)', backdropFilter: 'blur(4px)' }}>
            <div className="relative w-full max-w-md bg-[var(--card-bg)] rounded-3xl border border-purple-300 shadow-2xl overflow-hidden">
                <div className="px-5 py-4 bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white text-center">
                    <div className="text-base font-extrabold">🎲 سحب الفائزين</div>
                    <div className="text-[11px] opacity-90 mt-0.5">{count > 1 ? `يُسحب ${count} فائزين` : 'يُسحب فائز واحد'} من {entries.length} مؤهّل</div>
                </div>

                {phase === 'revealed' && (
                    <div className="pointer-events-none absolute inset-0 overflow-hidden">
                        {CONFETTI.map((c, i) => (
                            <span key={i} style={{ position: 'absolute', left: c.left, top: '-8%', fontSize: c.size, animation: `taki-confetti ${c.dur}s linear ${c.delay}s infinite` }}>{c.e}</span>
                        ))}
                    </div>
                )}

                {phase === 'spinning' && (
                    <div className="p-6 text-center">
                        <div className="text-xs font-bold text-purple-600 mb-3 animate-pulse">جارٍ خلط المشاركين… 🎲</div>
                        <div className="relative mx-auto h-28 flex flex-col items-center justify-center rounded-2xl bg-[var(--body-bg)] border border-[var(--border-color)] overflow-hidden">
                            <div key={(display && display.id) || idxRef.current} className="px-4 w-full animate-taki-pop">
                                <div className="text-2xl font-extrabold text-[var(--text-primary)] truncate">{revealName ? (display ? display.name : '—') : 'مشارك'}</div>
                                <div className="text-sm font-mono text-[var(--text-secondary)] mt-1" dir="ltr">{display ? maskPhone(display.phone) : ''}</div>
                            </div>
                            <div className="absolute inset-x-0 top-0 h-7 bg-gradient-to-b from-[var(--body-bg)] to-transparent" />
                            <div className="absolute inset-x-0 bottom-0 h-7 bg-gradient-to-t from-[var(--body-bg)] to-transparent" />
                        </div>
                        <button onClick={onStopClick} disabled={stopping} className="mt-5 w-full py-4 rounded-2xl text-white font-extrabold text-lg bg-gradient-to-r from-red-500 to-rose-600 active:scale-95 disabled:opacity-60 shadow-lg">
                            {stopping ? '⏳ يُحسم الفائز…' : '🛑 قف'}
                        </button>
                        <button onClick={onClose} className="mt-2 w-full py-2 text-xs font-bold text-[var(--text-secondary)]">إلغاء</button>
                    </div>
                )}

                {phase === 'revealed' && (
                    <div className="relative p-6 text-center animate-taki-pop">
                        <div className="text-5xl mb-2">🎉</div>
                        <div className="text-lg font-extrabold text-[var(--text-primary)] mb-3">{(winners && winners.length > 1) ? 'الفائزون' : 'الفائز'}</div>
                        <div className="space-y-2">
                            {(winners || []).map((w, i) => (
                                <div key={i} className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5">
                                    <span className="text-xl">🏆</span>
                                    <span className="font-extrabold text-emerald-900">{revealName ? w.name : `فائز ${i + 1}`}</span>
                                    <span className="font-mono text-emerald-800 text-sm mr-auto" dir="ltr">{maskPhone(w.phone)}</span>
                                </div>
                            ))}
                            {(winners || []).length === 0 && <div className="text-sm text-[var(--text-secondary)]">لا يوجد فائزون.</div>}
                        </div>
                        <button onClick={onClose} className="mt-5 w-full py-3.5 rounded-2xl text-white font-extrabold bg-purple-600 active:scale-95">✅ تم</button>
                    </div>
                )}

                {phase === 'error' && (
                    <div className="p-6 text-center">
                        <div className="text-4xl mb-2">⚠️</div>
                        <div className="text-sm font-bold text-red-600 mb-4">{errMsg}</div>
                        <button onClick={onClose} className="w-full py-3 rounded-2xl text-white font-extrabold bg-[var(--text-secondary)]">إغلاق</button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default AdminContests;
