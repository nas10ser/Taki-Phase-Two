import React, { useEffect, useState, useCallback } from 'react';
import { useHistory } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { contestRepository, Contest, MaskedWinner } from '../repositories/contestRepository';

/**
 * Public contests/surveys page (v11.44). Anyone can enter with name + phone and
 * answer the questions; the server auto-grades and (per the contest's pass rule)
 * qualifies them for the draw. Drawn contests show winners with the admin-chosen
 * privacy (masked phone / optionally hidden name). Light/dark safe.
 */

const Contests: React.FC = () => {
    const history = useHistory();
    const { user } = useApp();
    const [contests, setContests] = useState<Contest[]>([]);
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState<Contest | null>(null);

    useEffect(() => {
        let alive = true;
        contestRepository.list().then((list) => {
            if (!alive) return;
            // Public sees active first, then drawn (results), then closed.
            const order: Record<string, number> = { active: 0, drawn: 1, closed: 2, draft: 9 };
            setContests([...list].sort((a, b) => (order[a.status] ?? 5) - (order[b.status] ?? 5)));
            setLoading(false);
        });
        return () => { alive = false; };
    }, []);

    if (selected) return <ContestEntry contest={selected} onBack={() => setSelected(null)} prefillName={user?.name} prefillPhone={user?.phone} />;

    return (
        <div className="pb-28 px-4 max-w-2xl mx-auto font-tajawal animate-fade-in" dir="rtl" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 2.5rem)' }}>
            <div className="flex justify-between items-center gap-3 mb-3">
                <h1 className="text-3xl font-extrabold text-[var(--text-primary)]">المسابقات 🎁</h1>
                <button onClick={() => history.goBack()} className="shrink-0 flex items-center gap-1.5 bg-[var(--card-bg)] border border-[var(--border-color)] text-[var(--text-primary)] font-bold text-sm px-4 py-2 rounded-full shadow-sm active:scale-95">
                    <span aria-hidden>→</span> رجوع
                </button>
            </div>
            <p className="text-sm text-[var(--text-secondary)] mb-6 leading-relaxed">شارك، أجب على الأسئلة، وادخل السحب على الجوائز 🏆</p>

            {loading ? (
                <div className="space-y-3">{[0, 1].map((i) => <div key={i} className="h-32 bg-[var(--gray-100)] rounded-2xl animate-pulse" />)}</div>
            ) : contests.length === 0 ? (
                <div className="text-center text-[var(--text-secondary)] py-16">لا توجد مسابقات متاحة حالياً. تابعنا قريباً 👀</div>
            ) : (
                <div className="space-y-3">
                    {contests.map((c) => <ContestCard key={c.id} contest={c} onOpen={() => setSelected(c)} />)}
                </div>
            )}
        </div>
    );
};

const ContestCard: React.FC<{ contest: Contest; onOpen: () => void }> = ({ contest: c, onOpen }) => {
    const [winners, setWinners] = useState<MaskedWinner[] | null>(null);
    useEffect(() => {
        if (c.status === 'drawn') contestRepository.publicResults(c.id).then(setWinners);
    }, [c.id, c.status]);

    return (
        <div className="bg-[var(--card-bg)] border-2 border-purple-200 rounded-2xl p-5 shadow-sm">
            <div className="text-lg font-extrabold text-[var(--text-primary)]">{c.title}</div>
            {c.prize && <div className="text-sm text-amber-600 font-bold mt-1">🏆 الجائزة: {c.prize}</div>}
            {c.description && <div className="text-sm text-[var(--text-secondary)] mt-2 leading-relaxed">{c.description}</div>}

            {c.status === 'active' && (
                <button onClick={onOpen} className="w-full mt-4 py-3 rounded-xl text-sm font-extrabold text-white bg-purple-600 hover:bg-purple-700 active:scale-95">✍️ شارك الآن</button>
            )}
            {c.status === 'closed' && (
                <div className="mt-4 text-center text-sm font-bold text-amber-600 bg-amber-50 rounded-xl py-2.5">⏳ أُغلق التسجيل — بانتظار السحب</div>
            )}
            {c.status === 'drawn' && (
                <div className="mt-4 pt-3 border-t border-purple-200">
                    <div className="text-sm font-extrabold text-purple-700 mb-2">🎉 الفائزون</div>
                    {winners === null ? (
                        <div className="text-xs text-[var(--text-secondary)]">جاري التحميل...</div>
                    ) : winners.length === 0 ? (
                        <div className="text-xs text-[var(--text-secondary)]">لا يوجد فائزون.</div>
                    ) : (
                        <div className="space-y-1.5">
                            {winners.map((w, i) => (
                                <div key={i} className="flex items-center gap-2 bg-emerald-50 rounded-lg px-3 py-2">
                                    <span className="text-lg">🏆</span>
                                    <span className="font-bold text-emerald-900">{w.name}</span>
                                    {w.phone && <span className="font-mono text-emerald-800 text-sm mr-auto" dir="ltr">{w.phone}</span>}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

const ContestEntry: React.FC<{ contest: Contest; onBack: () => void; prefillName?: string; prefillPhone?: string }> = ({ contest: c, onBack, prefillName, prefillPhone }) => {
    const [name, setName] = useState(prefillName || '');
    const [phone, setPhone] = useState(prefillPhone || '');
    const [answers, setAnswers] = useState<Record<string, string>>({});
    const [social, setSocial] = useState<Record<string, string>>({});
    const [submitting, setSubmitting] = useState(false);
    const [result, setResult] = useState<{ qualified: boolean; score?: number; max?: number } | null>(null);
    const [error, setError] = useState('');

    const setAns = (id: string, v: string) => setAnswers((a) => ({ ...a, [id]: v }));
    const setSoc = (id: string, v: string) => setSocial((s) => ({ ...s, [id]: v }));

    const submit = useCallback(async () => {
        setError('');
        if (!name.trim() || !phone.trim()) { setError('الاسم ورقم الجوال مطلوبان'); return; }
        // required questions
        for (const q of c.questions) {
            if (q.required !== false && !((answers[q.id] || '').trim())) { setError('يرجى الإجابة على كل الأسئلة الإلزامية'); return; }
        }
        setSubmitting(true);
        const res = await contestRepository.submit(c.id, name, phone, answers, social);
        setSubmitting(false);
        if (!res.success) { setError(res.error || 'تعذّر الإرسال'); return; }
        setResult({ qualified: !!res.qualified, score: res.score, max: res.max });
    }, [c, name, phone, answers, social]);

    const inputCls = 'w-full px-3 py-2.5 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl text-sm text-[var(--text-primary)] outline-none focus:border-purple-500';

    if (result) {
        return (
            <div className="pb-28 px-4 max-w-2xl mx-auto font-tajawal animate-fade-in" dir="rtl" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 3rem)' }}>
                <div className={`text-center rounded-2xl p-8 ${result.qualified ? 'bg-emerald-50 border-2 border-emerald-200' : 'bg-amber-50 border-2 border-amber-200'}`}>
                    <div className="text-5xl mb-3">{result.qualified ? '🎉' : '🙏'}</div>
                    <div className={`text-xl font-extrabold ${result.qualified ? 'text-emerald-900' : 'text-amber-900'}`}>
                        {result.qualified ? 'تم تسجيلك في السحب!' : 'شكراً لمشاركتك'}
                    </div>
                    <div className={`text-sm mt-2 ${result.qualified ? 'text-emerald-800' : 'text-amber-800'}`}>
                        {c.pass_mode === 'collect'
                            ? 'أنت الآن ضمن السحب — بالتوفيق!'
                            : result.qualified
                                ? `أجبت بشكل صحيح${typeof result.score === 'number' ? ` (${result.score}/${result.max})` : ''} ودخلت السحب — بالتوفيق!`
                                : `بعض الإجابات غير صحيحة${typeof result.score === 'number' ? ` (${result.score}/${result.max})` : ''}. يمكنك المحاولة مجدداً.`}
                    </div>
                    <div className="flex gap-2 mt-5">
                        {!result.qualified && c.pass_mode !== 'collect' && (
                            <button onClick={() => setResult(null)} className="flex-1 py-2.5 rounded-xl text-sm font-bold border border-[var(--border-color)] text-[var(--text-primary)]">حاول مجدداً</button>
                        )}
                        <button onClick={onBack} className="flex-1 py-2.5 rounded-xl text-sm font-extrabold text-white bg-purple-600">العودة للمسابقات</button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="pb-28 px-4 max-w-2xl mx-auto font-tajawal animate-fade-in" dir="rtl" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 2.5rem)' }}>
            <div className="flex justify-between items-center gap-3 mb-3">
                <h1 className="text-2xl font-extrabold text-[var(--text-primary)] truncate">{c.title}</h1>
                <button onClick={onBack} className="shrink-0 flex items-center gap-1.5 bg-[var(--card-bg)] border border-[var(--border-color)] text-[var(--text-primary)] font-bold text-sm px-4 py-2 rounded-full shadow-sm active:scale-95">
                    <span aria-hidden>→</span> رجوع
                </button>
            </div>
            {c.prize && <div className="text-sm text-amber-600 font-bold mb-4">🏆 الجائزة: {c.prize}</div>}

            <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl p-4 space-y-3">
                <div><label className="block text-xs font-bold text-[var(--text-secondary)] mb-1.5">الاسم *</label><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></div>
                <div><label className="block text-xs font-bold text-[var(--text-secondary)] mb-1.5">رقم الجوال *</label><input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" dir="ltr" placeholder="05XXXXXXXX" /></div>
            </div>

            {c.questions.length > 0 && (
                <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl p-4 space-y-4 mt-3">
                    {c.questions.map((q, i) => (
                        <div key={q.id}>
                            <label className="block text-sm font-bold text-[var(--text-primary)] mb-1.5">{i + 1}. {q.prompt}{q.required !== false && <span className="text-red-500"> *</span>}</label>
                            {q.type === 'choice' && (q.options || []).length > 0 ? (
                                <div className="space-y-1.5">
                                    {(q.options || []).map((opt) => (
                                        <label key={opt} className={`flex items-center gap-2 px-3 py-2 rounded-xl border cursor-pointer text-sm ${answers[q.id] === opt ? 'bg-purple-50 border-purple-400 text-purple-800 font-bold' : 'bg-[var(--body-bg)] border-[var(--border-color)] text-[var(--text-primary)]'}`}>
                                            <input type="radio" name={q.id} className="accent-purple-600" checked={answers[q.id] === opt} onChange={() => setAns(q.id, opt)} />
                                            {opt}
                                        </label>
                                    ))}
                                </div>
                            ) : (
                                <input className={inputCls} value={answers[q.id] || ''} onChange={(e) => setAns(q.id, e.target.value)} placeholder="اكتب إجابتك" />
                            )}
                        </div>
                    ))}
                </div>
            )}

            {c.social_tasks.length > 0 && (
                <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl p-4 space-y-3 mt-3">
                    <div className="text-sm font-bold text-[var(--text-primary)]">📣 مهام التفاعل</div>
                    {c.social_tasks.map((t) => (
                        <div key={t.id}>
                            <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1.5">{t.prompt}</label>
                            <input className={inputCls} value={social[t.id] || ''} onChange={(e) => setSoc(t.id, e.target.value)} placeholder="اكتب إجابتك" />
                        </div>
                    ))}
                </div>
            )}

            {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2 mt-3">{error}</div>}

            <button onClick={submit} disabled={submitting} className="w-full mt-5 py-4 rounded-2xl text-white font-extrabold bg-purple-600 hover:bg-purple-700 disabled:opacity-50 active:scale-95">
                {submitting ? 'جاري الإرسال...' : '🎯 إرسال ودخول السحب'}
            </button>
        </div>
    );
};

export default Contests;
