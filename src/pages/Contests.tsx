import React, { useEffect, useState } from 'react';
import { goRegister } from '../utils/returnTo';
import { useHistory } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { createT } from '../utils/helpers';
import { contestRepository, Contest, MaskedWinner, isContestPubliclyVisible, contestMatchesAudience } from '../repositories/contestRepository';

/**
 * Public contests/surveys page (v11.44). Anyone can enter with name + phone and
 * answer the questions; the server auto-grades and (per the contest's pass rule)
 * qualifies them for the draw. Drawn contests show winners with the admin-chosen
 * privacy (masked phone / optionally hidden name). Light/dark safe.
 *
 * v14.63 — الصفحة كانت **عربية بالكامل بلا وعي باللغة** (صفر ذكر لـ`language`):
 * من يتصفّح بالإنجليزية يصطدم بصفحة عربية مربوطة من الشريط الجانبي ومن
 * الرئيسية ومن شريط البانرات. الآن كل نصّ ثابت يمرّ بـ`createT`، والاتجاه
 * يتبع اللغة بدل `dir="rtl"` مثبَّتاً. (محتوى المسابقة نفسه — العنوان والجائزة
 * والأسئلة — يكتبه المدير في القاعدة بلغته، فيُعرض كما هو.)
 */

const Contests: React.FC = () => {
    const history = useHistory();
    const { user, language } = useApp();
    const isRTL = language === 'ar';
    const t = createT(isRTL);
    const [contests, setContests] = useState<Contest[]>([]);
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState<Contest | null>(null);

    useEffect(() => {
        let alive = true;
        contestRepository.list().then((list) => {
            if (!alive) return;
            // Hide contests scheduled to start later — even if «مُفعّلة» — until
            // their start time passes. Then: active first, drawn (results), closed.
            const visible = list.filter(isContestPubliclyVisible);
            const order: Record<string, number> = { active: 0, drawn: 1, closed: 2, draft: 9 };
            setContests([...visible].sort((a, b) => (order[a.status] ?? 5) - (order[b.status] ?? 5)));
            setLoading(false);
        });
        return () => { alive = false; };
    }, []);

    if (selected) return <ContestEntry contest={selected} onBack={() => setSelected(null)} user={user} />;

    // Only show contests that target this user's type (buyers / sellers / all).
    const shown = contests.filter((c) => contestMatchesAudience(c, user?.userType));

    return (
        <div className="pb-28 px-4 max-w-2xl mx-auto font-tajawal animate-fade-in" dir={isRTL ? 'rtl' : 'ltr'} style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 2.5rem)' }}>
            <div className="flex justify-between items-center gap-3 mb-3">
                <h1 className="text-3xl font-extrabold text-[var(--text-primary)]">{t('المسابقات 🎁', 'Contests 🎁')}</h1>
                <button
                    onClick={() => history.goBack()}
                    aria-label={t('رجوع', 'Back')}
                    className="shrink-0 flex items-center gap-1.5 bg-[var(--card-bg)] border border-[var(--border-color)] text-[var(--text-primary)] font-bold text-sm px-4 py-2 rounded-full shadow-sm active:scale-95"
                >
                    <span aria-hidden>{isRTL ? '→' : '←'}</span> {t('رجوع', 'Back')}
                </button>
            </div>
            <p className="text-sm text-[var(--text-secondary)] mb-6 leading-relaxed">
                {t('شارك، أجب على الأسئلة، وادخل السحب على الجوائز 🏆', 'Take part, answer the questions, and enter the prize draw 🏆')}
            </p>

            {loading ? (
                <div className="space-y-3">{[0, 1].map((i) => <div key={i} className="h-32 bg-[var(--gray-100)] rounded-2xl animate-pulse" />)}</div>
            ) : shown.length === 0 ? (
                <div className="text-center text-[var(--text-secondary)] py-16">
                    {t('لا توجد مسابقات متاحة حالياً. تابعنا قريباً 👀', 'No contests available right now. Check back soon 👀')}
                </div>
            ) : (
                <div className="space-y-3">
                    {shown.map((c) => <ContestCard key={c.id} contest={c} isRTL={isRTL} onOpen={() => setSelected(c)} />)}
                </div>
            )}
        </div>
    );
};

/**
 * v12.71 — عدّاد تنازلي حي حتى نهاية المسابقة (طلب ناصر). يظهر فقط عندما
 * يحدد المدير تاريخ نهاية (ends_at) والمسابقة نشطة — يحدّث كل ثانية،
 * وعند انقضاء المدة يعرض «انتهى وقت المشاركة».
 */
const ContestCountdown: React.FC<{ endsAt: string; isRTL: boolean }> = ({ endsAt, isRTL }) => {
    const t = createT(isRTL);
    const target = new Date(endsAt).getTime();
    const [left, setLeft] = useState(() => target - Date.now());
    useEffect(() => {
        const id = setInterval(() => setLeft(target - Date.now()), 1000);
        return () => clearInterval(id);
    }, [target]);

    if (!Number.isFinite(target)) return null;
    if (left <= 0) {
        return (
            <div className="mt-3 text-center text-sm font-extrabold text-red-600 bg-red-50 border border-red-200 rounded-xl py-2.5">
                ⏰ {t('انتهى وقت المشاركة', 'Entry has closed')}
            </div>
        );
    }
    const s = Math.floor(left / 1000);
    const parts = [
        { key: 'd', v: Math.floor(s / 86400), label: t('يوم', 'Days') },
        { key: 'h', v: Math.floor((s % 86400) / 3600), label: t('ساعة', 'Hours') },
        { key: 'm', v: Math.floor((s % 3600) / 60), label: t('دقيقة', 'Min') },
        { key: 's', v: s % 60, label: t('ثانية', 'Sec') },
    ];
    return (
        <div className="mt-3 rounded-xl p-3" style={{ background: 'linear-gradient(135deg, #7c3aed 0%, #a21caf 60%, #db2777 100%)' }}>
            <div className="text-center text-xs font-extrabold text-white/90 mb-2">⏳ {t('الوقت المتبقي للمشاركة', 'Time left to enter')}</div>
            <div className="flex justify-center gap-2" dir={isRTL ? 'rtl' : 'ltr'}>
                {parts.map((p) => (
                    <div key={p.key} className="flex flex-col items-center rounded-lg px-2 py-1.5 min-w-[58px]" style={{ background: 'rgba(255,255,255,0.16)' }}>
                        <span className="text-xl font-extrabold text-white tabular-nums leading-tight">{String(p.v).padStart(2, '0')}</span>
                        <span className="text-xs font-bold text-white/85">{p.label}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};

const ContestCard: React.FC<{ contest: Contest; isRTL: boolean; onOpen: () => void }> = ({ contest: c, isRTL, onOpen }) => {
    const t = createT(isRTL);
    const [winners, setWinners] = useState<MaskedWinner[] | null>(null);
    useEffect(() => {
        if (c.status === 'drawn') contestRepository.publicResults(c.id).then(setWinners);
    }, [c.id, c.status]);

    return (
        <div className="bg-[var(--card-bg)] border-2 border-purple-200 rounded-2xl p-5 shadow-sm">
            {c.banner_image && (
                <div className="w-full rounded-xl overflow-hidden mb-3" style={{ aspectRatio: '2 / 1' }}>
                    <img src={c.banner_image} alt={c.title} draggable={false} className="w-full h-full object-cover" onError={(e) => { const p = e.currentTarget.parentElement as HTMLElement | null; if (p) p.style.display = 'none'; }} />
                </div>
            )}
            <div className="text-lg font-extrabold text-[var(--text-primary)]">{c.title}</div>
            {c.prize && <div className="text-sm text-amber-600 font-bold mt-1">🏆 {t('الجائزة', 'Prize')}: {c.prize}</div>}
            {c.description && <div className="text-sm text-[var(--text-secondary)] mt-2 leading-relaxed">{c.description}</div>}

            {c.status === 'active' && c.ends_at && <ContestCountdown endsAt={c.ends_at} isRTL={isRTL} />}
            {c.status === 'active' && (
                <button onClick={onOpen} className="w-full mt-4 py-3 rounded-xl text-sm font-extrabold text-white bg-purple-600 hover:bg-purple-700 active:scale-95">
                    ✍️ {t('شارك الآن', 'Enter now')}
                </button>
            )}
            {c.status === 'closed' && (
                <div className="mt-4 text-center text-sm font-bold text-amber-600 bg-amber-50 rounded-xl py-2.5">
                    ⏳ {t('أُغلق التسجيل — بانتظار السحب', 'Entries closed — draw pending')}
                </div>
            )}
            {c.status === 'drawn' && (
                <div className="mt-4 pt-3 border-t border-purple-200">
                    <div className="text-sm font-extrabold text-purple-700 mb-2">🎉 {t('الفائزون', 'Winners')}</div>
                    {winners === null ? (
                        <div className="text-xs text-[var(--text-secondary)]">{t('جاري التحميل...', 'Loading…')}</div>
                    ) : winners.length === 0 ? (
                        <div className="text-xs text-[var(--text-secondary)]">{t('لا يوجد فائزون.', 'No winners.')}</div>
                    ) : (
                        <div className="space-y-1.5">
                            {winners.map((w, i) => (
                                <div key={i} className="flex items-center gap-2 bg-emerald-50 rounded-lg px-3 py-2">
                                    <span className="text-lg">🏆</span>
                                    <span className="font-bold text-emerald-900">{w.name}</span>
                                    {w.phone && <span className="font-mono text-emerald-800 text-sm ms-auto" dir="ltr">{w.phone}</span>}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

const ContestEntry: React.FC<{ contest: Contest; onBack: () => void; user: any }> = ({ contest: c, onBack, user }) => {
    const history = useHistory();
    const { language } = useApp();
    const isRTL = language === 'ar';
    const t = createT(isRTL);
    const [answers, setAnswers] = useState<Record<string, string>>({});
    const [social, setSocial] = useState<Record<string, string>>({});
    const [submitting, setSubmitting] = useState(false);
    const [result, setResult] = useState<{ qualified: boolean; score?: number; max?: number } | null>(null);
    const [error, setError] = useState('');
    // Has this user already entered? null = still checking. (one-entry-per-user)
    const [existing, setExisting] = useState<{ entered: boolean; qualified?: boolean; score?: number; max?: number } | null>(null);

    const setAns = (id: string, v: string) => setAnswers((a) => ({ ...a, [id]: v }));
    const setSoc = (id: string, v: string) => setSocial((s) => ({ ...s, [id]: v }));

    const accountPhone = String(user?.phone || '').trim();
    const inputCls = 'w-full px-3 py-2.5 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl text-sm text-[var(--text-primary)] focus:border-purple-500';

    // Check whether the signed-in user already participated (server-side, PII-safe).
    useEffect(() => {
        if (!user || !accountPhone) { setExisting({ entered: false }); return; }
        let alive = true;
        contestRepository.myEntry(c.id).then((e) => { if (alive) setExisting(e); });
        return () => { alive = false; };
    }, [c.id, user, accountPhone]);

    // Plain composition (not a nested component) so text inputs never lose focus.
    const shell = (children: React.ReactNode) => (
        <div className="pb-28 px-4 max-w-2xl mx-auto font-tajawal animate-fade-in" dir={isRTL ? 'rtl' : 'ltr'} style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 2.5rem)' }}>
            <div className="flex justify-between items-center gap-3 mb-3">
                <h1 className="text-2xl font-extrabold text-[var(--text-primary)] truncate">{c.title}</h1>
                <button
                    onClick={onBack}
                    aria-label={t('رجوع', 'Back')}
                    className="shrink-0 flex items-center gap-1.5 bg-[var(--card-bg)] border border-[var(--border-color)] text-[var(--text-primary)] font-bold text-sm px-4 py-2 rounded-full shadow-sm active:scale-95"
                >
                    <span aria-hidden>{isRTL ? '→' : '←'}</span> {t('رجوع', 'Back')}
                </button>
            </div>
            {children}
        </div>
    );

    // Gate: must be signed in — name + phone are taken from the account.
    if (!user) {
        return shell(
            <div className="text-center bg-purple-50 border-2 border-purple-200 rounded-2xl p-8">
                <div className="text-5xl mb-3">🔐</div>
                <div className="text-lg font-extrabold text-purple-900">{t('سجّل دخولك للمشاركة', 'Sign in to take part')}</div>
                <div className="text-sm text-purple-800 mt-2 leading-relaxed">
                    {t(
                        'نأخذ اسمك ورقم جوالك من حسابك مباشرةً — لا حاجة لكتابتهما، وأكثر أماناً للسحب.',
                        'We take your name and mobile number straight from your account — nothing to type, and safer for the draw.',
                    )}
                </div>
                <button onClick={() => goRegister(history)} className="w-full mt-5 py-3 rounded-xl text-sm font-extrabold text-white bg-purple-600">
                    {t('تسجيل الدخول / إنشاء حساب', 'Sign in / Create account')}
                </button>
            </div>
        );
    }
    // Gate: account needs a phone for the draw.
    if (!accountPhone) {
        return shell(
            <div className="text-center bg-amber-50 border-2 border-amber-200 rounded-2xl p-8">
                <div className="text-5xl mb-3">📱</div>
                <div className="text-lg font-extrabold text-amber-900">{t('أكمل رقم جوالك أولاً', 'Add your mobile number first')}</div>
                <div className="text-sm text-amber-800 mt-2 leading-relaxed">
                    {t(
                        'نحتاج رقم جوالك المسجّل في حسابك حتى تدخل السحب على الجوائز.',
                        'We need the mobile number on your account so you can enter the prize draw.',
                    )}
                </div>
                <button onClick={() => history.push('/profile')} className="w-full mt-5 py-3 rounded-xl text-sm font-extrabold text-white bg-amber-500">
                    {t('إكمال بيانات حسابي', 'Complete my account')}
                </button>
            </div>
        );
    }

    // Still checking participation — avoid flashing the form.
    if (existing === null) {
        return shell(<div className="text-center text-[var(--text-secondary)] py-20">{t('جاري التحميل...', 'Loading…')}</div>);
    }
    // Already participated — one entry per user, no re-submission.
    if (existing.entered && !result) {
        const scoreNote = typeof existing.score === 'number' ? ` (${existing.score}/${existing.max})` : '';
        return shell(
            <div className={`text-center rounded-2xl p-8 ${existing.qualified ? 'bg-emerald-50 border-2 border-emerald-200' : 'bg-amber-50 border-2 border-amber-200'}`}>
                <div className="text-5xl mb-3">{existing.qualified ? '🎉' : '🙏'}</div>
                <div className={`text-xl font-extrabold ${existing.qualified ? 'text-emerald-900' : 'text-amber-900'}`}>
                    {t('شاركت مسبقاً في هذه المسابقة', 'You have already entered this contest')}
                </div>
                <div className={`text-sm mt-2 leading-relaxed ${existing.qualified ? 'text-emerald-800' : 'text-amber-800'}`}>
                    {c.pass_mode === 'collect'
                        ? t('أنت ضمن السحب — بالتوفيق! 🍀', 'You are in the draw — good luck! 🍀')
                        : existing.qualified
                            ? t(
                                `أجبت بشكل صحيح${scoreNote} ودخلت السحب — بالتوفيق! 🍀`,
                                `You answered correctly${scoreNote} and entered the draw — good luck! 🍀`,
                            )
                            : t(
                                `لم تتأهّل هذه المرة${scoreNote}. لكل مشارك محاولة واحدة فقط.`,
                                `You did not qualify this time${scoreNote}. One entry per person.`,
                            )}
                </div>
                <button onClick={onBack} className="w-full mt-5 py-3 rounded-xl text-sm font-extrabold text-white bg-purple-600">
                    {t('العودة للمسابقات', 'Back to contests')}
                </button>
            </div>
        );
    }

    const submit = async () => {
        setError('');
        for (const q of c.questions) {
            if (q.required !== false && !((answers[q.id] || '').trim())) {
                setError(t('يرجى الإجابة على كل الأسئلة الإلزامية', 'Please answer every required question'));
                return;
            }
        }
        setSubmitting(true);
        // v12.76 — try/finally: أي استثناء شبكة كان يترك زر الإرسال يدور للأبد
        try {
            // name + phone are stamped from the account server-side; sent only for the API shape.
            const res = await contestRepository.submit(c.id, user.name || '', accountPhone, answers, social);
            if (!res.success) { setError(res.error || t('تعذّر الإرسال', 'Could not submit')); return; }
            setResult({ qualified: !!res.qualified, score: res.score, max: res.max });
        } catch (e: any) {
            setError(e?.message || t('تعذّر الإرسال — تحقق من اتصالك وحاول مجدداً', 'Could not submit — check your connection and try again'));
        } finally {
            setSubmitting(false);
        }
    };

    if (result) {
        const scoreNote = typeof result.score === 'number' ? ` (${result.score}/${result.max})` : '';
        return shell(
            <div className={`text-center rounded-2xl p-8 ${result.qualified ? 'bg-emerald-50 border-2 border-emerald-200' : 'bg-amber-50 border-2 border-amber-200'}`}>
                <div className="text-5xl mb-3">{result.qualified ? '🎉' : '🙏'}</div>
                <div className={`text-xl font-extrabold ${result.qualified ? 'text-emerald-900' : 'text-amber-900'}`}>
                    {result.qualified ? t('تم تسجيلك في السحب!', 'You are entered in the draw!') : t('شكراً لمشاركتك', 'Thanks for taking part')}
                </div>
                <div className={`text-sm mt-2 ${result.qualified ? 'text-emerald-800' : 'text-amber-800'}`}>
                    {c.pass_mode === 'collect'
                        ? t('أنت الآن ضمن السحب — بالتوفيق!', 'You are now in the draw — good luck!')
                        : result.qualified
                            ? t(
                                `أجبت بشكل صحيح${scoreNote} ودخلت السحب — بالتوفيق!`,
                                `You answered correctly${scoreNote} and entered the draw — good luck!`,
                            )
                            : t(
                                `بعض الإجابات غير صحيحة${scoreNote}. لكل مشارك محاولة واحدة فقط.`,
                                `Some answers were incorrect${scoreNote}. One entry per person.`,
                            )}
                </div>
                <div className="mt-5">
                    <button onClick={onBack} className="w-full py-2.5 rounded-xl text-sm font-extrabold text-white bg-purple-600">
                        {t('العودة للمسابقات', 'Back to contests')}
                    </button>
                </div>
            </div>
        );
    }

    return shell(<>
        {c.prize && <div className="text-sm text-amber-600 font-bold mb-4">🏆 {t('الجائزة', 'Prize')}: {c.prize}</div>}
        {c.ends_at && <div className="mb-4 -mt-1"><ContestCountdown endsAt={c.ends_at} isRTL={isRTL} /></div>}

        {/* Identity comes from the signed-in account — read only, no typing. */}
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 mb-3">
            <div className="text-xs text-emerald-700 font-bold mb-1">✅ {t('تشارك بحسابك المسجّل', 'Entering with your signed-in account')}</div>
            <div className="text-sm font-extrabold text-emerald-900">
                {user.name || t('حسابي', 'My account')} <span className="font-mono font-normal text-emerald-800" dir="ltr">· {accountPhone}</span>
            </div>
        </div>

        {c.questions.length > 0 && (
                <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl p-4 space-y-4 mt-3">
                    {c.questions.map((q, i) => (
                        <div key={q.id}>
                            <label className="block text-sm font-bold text-[var(--text-primary)] mb-1.5" htmlFor={`q-${q.id}`}>
                                {i + 1}. {q.prompt}{q.required !== false && <span className="text-red-500"> *</span>}
                            </label>
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
                                <input id={`q-${q.id}`} className={inputCls} value={answers[q.id] || ''} onChange={(e) => setAns(q.id, e.target.value)} placeholder={t('اكتب إجابتك', 'Type your answer')} />
                            )}
                        </div>
                    ))}
                </div>
            )}

            {c.social_tasks.length > 0 && (
                <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl p-4 space-y-3 mt-3">
                    <div className="text-sm font-bold text-[var(--text-primary)]">📣 {t('مهام التفاعل', 'Engagement tasks')}</div>
                    {c.social_tasks.map((tk) => (
                        <div key={tk.id}>
                            <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1.5" htmlFor={`s-${tk.id}`}>{tk.prompt}</label>
                            <input id={`s-${tk.id}`} className={inputCls} value={social[tk.id] || ''} onChange={(e) => setSoc(tk.id, e.target.value)} placeholder={t('اكتب إجابتك', 'Type your answer')} />
                        </div>
                    ))}
                </div>
            )}

            {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2 mt-3">{error}</div>}

        <button onClick={submit} disabled={submitting} className="w-full mt-5 py-4 rounded-2xl text-white font-extrabold bg-purple-600 hover:bg-purple-700 disabled:opacity-50 active:scale-95">
            {submitting ? t('جاري الإرسال...', 'Submitting…') : `🎯 ${t('إرسال ودخول السحب', 'Submit and enter the draw')}`}
        </button>
    </>);
};

export default Contests;
