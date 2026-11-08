/**
 * DeleteAccount — صفحةُ حذف الحساب العامّة (v15.56)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 لماذا صفحةٌ مستقلّة ولم يكفِ الزرُّ في «حسابي»:
 *    سياسةُ **قوقل بلاي** لحذف الحساب تُلزم كلَّ تطبيقٍ يُنشئ حسابات بأمرين
 *    لا واحد: مسارٌ داخل التطبيق، **ورابطٌ عامّ على الويب** يُعلَن في «أمان
 *    البيانات» ويستطيع أيُّ أحد فتحُه ليطلب الحذف **بلا تنزيل التطبيق**.
 *    والزرُّ داخل «حسابي» يُغطّي الأوّل وحده، فكان البند ناقصاً — وهو من
 *    البنود التي تُرفض عليها الإصدارات مباشرةً لا تحذيراً.
 *    (وأبل تُلزم بالمسار الداخلي في البند ٥٫١٫١(v) — وهو قائمٌ أصلاً.)
 *
 * 🪤 ولا تَعِد الصفحةُ بشيءٍ لا ينفّذه الكود (درس v14.82): كلُّ سطرٍ فيها
 *    مأخوذٌ من سلوكٍ مقيس — `soft_delete_my_account` تُعطّل فوراً وتجدول
 *    التجهيل، و`purge_expired_accounts` تُنفّذه، والفواتيرُ تبقى بلا هويّة
 *    لأن حرّاس `tr_guard_user_delete` يمنعون محوَ دفاتر التجّار.
 *
 * 🪤 ومدّةُ المهلة لا تُكتب هنا رقماً مستقلّاً: هي نفسُها المذكورة في سياسة
 *    الخصوصية (القسم ٧) — موضعٌ واحدٌ للنصّ القانوني، وهذه الصفحةُ تُحيل إليه.
 */

import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { LEGAL_VERSION } from '../../data/legalVersion';
import { LegalLayout, Section, Paragraph, Bullets } from './LegalLayout';
import { useApp } from '../../context/AppContext';

const DeleteAccount: React.FC = () => {
    const { language, user, deleteAccount } = useApp();
    const isRTL = language === 'ar';
    const [confirming, setConfirming] = useState(false);
    const [busy, setBusy] = useState(false);
    const [done, setDone] = useState(false);

    const run = async () => {
        setBusy(true);
        try { await deleteAccount(); setDone(true); }
        finally { setBusy(false); }
    };

    return (
        <LegalLayout
            title={isRTL ? 'حذف الحساب' : 'Delete your account'}
            subtitle={isRTL ? 'طلبُ حذف الحساب والبيانات · TAKI' : 'Account & data deletion request · TAKI'}
            lastUpdated={LEGAL_VERSION}
        >
            <Paragraph>
                {isRTL
                    ? <>يمكنك حذفُ حسابك في <strong>تاكي</strong> وبياناتك الشخصية في أي وقت، من هذه الصفحة أو من داخل التطبيق — <strong>بلا الحاجة إلى تنزيل التطبيق ولا إلى مراسلة أحد</strong>.</>
                    : <>You can delete your <strong>TAKI</strong> account and personal data at any time, from this page or from inside the app — <strong>no app install and no email request required</strong>.</>}
            </Paragraph>

            <Section n={1} title={isRTL ? 'كيف تحذف حسابك' : 'How to delete your account'}>
                <Bullets items={isRTL ? [
                    <><strong>من هذه الصفحة:</strong> سجّل الدخول ثم اضغط زرّ الحذف أدناه.</>,
                    <><strong>من التطبيق أو الموقع:</strong> «حسابي» ← أسفل الصفحة، أو القائمةُ الجانبية (☰) ← <strong>حذف الحساب</strong>.</>,
                    <><strong>من البوت:</strong> ليس متاحاً — الحذفُ يحتاج تأكيدَ هويّةٍ بتسجيل دخولٍ كامل.</>,
                ] : [
                    <><strong>From this page:</strong> sign in, then press the delete button below.</>,
                    <><strong>From the app or website:</strong> “My account” → bottom of the page, or the side menu (☰) → <strong>Delete account</strong>.</>,
                    <><strong>From the bot:</strong> not available — deletion requires a full signed-in session.</>,
                ]} />
            </Section>

            <Section n={2} title={isRTL ? 'ما يحدث عند الحذف' : 'What happens when you delete'}>
                <Bullets items={isRTL ? [
                    <><strong>فوراً:</strong> يُعطَّل حسابُك وتُخفى عروضُك إن كنت تاجراً، ويُسجَّل خروجُك من كل الأجهزة.</>,
                    <><strong>خلال مهلة التراجع:</strong> إن سجّلت الدخول مرّةً أخرى فستُعرض عليك استعادةُ الحساب. المهلةُ منصوصةٌ في <Link to="/privacy" className="underline font-bold">سياسة الخصوصية</Link> (القسم ٧).</>,
                    <><strong>بعد المهلة:</strong> تُمحى بياناتُك الشخصية محواً لا رجعةَ فيه — الاسمُ والبريدُ والجوّالُ والعناوينُ وإحداثياتُها واسمُك تحت تقييماتك، وصفُّ المصادقة وجلساتُه. ويُحذف <strong>سجلُّ مصادقة الدخول</strong> (وهو سجلُّ أوقاتِ الدخول وطلباتِ استعادة كلمة المرور) في مدّته المنشورة في <Link to="/privacy" className="underline font-bold">سياسة الخصوصية</Link> (القسم ٧).</>,
                ] : [
                    <><strong>Immediately:</strong> your account is deactivated, your deals are hidden if you are a merchant, and you are signed out of every device.</>,
                    <><strong>During the undo window:</strong> signing in again offers to restore the account. The window is stated in the <Link to="/privacy" className="underline font-bold">Privacy Policy</Link> (section 7).</>,
                    <><strong>After the window:</strong> your personal data is irreversibly erased — name, email, phone, saved addresses and their coordinates, your name under your reviews, and your authentication record and sessions. The <strong>sign-in audit log</strong> (the record of sign-in times and password-recovery requests) is deleted within the period published in the <Link to="/privacy" className="underline font-bold">Privacy Policy</Link> (section 7).</>,
                ]} />
            </Section>

            <Section n={3} title={isRTL ? 'ما يبقى — ولماذا' : 'What remains — and why'}>
                <Paragraph>
                    {isRTL
                        ? <>الطلباتُ والفواتيرُ الضريبية التي أصدرها تاجرٌ لا تُمحى: هي <strong>دفاترُه</strong> التي يُلزمه النظام بحفظها، ومحوُها يُحدث فجوةً في تسلسلٍ ضريبيٍّ يُفترض ألّا فجوةَ فيه. وتبقى <strong>بلا هويّتك</strong> — بلا اسمٍ ولا بريدٍ ولا جوّالٍ ولا عنوان. والتفاصيلُ في <Link to="/privacy" className="underline font-bold">سياسة الخصوصية</Link>.</>
                        : <>Orders and tax invoices a merchant has issued are not erased: they are <strong>that merchant’s statutory books</strong>, and erasing them would leave a gap in an invoice sequence that must have none. They remain <strong>stripped of your identity</strong> — no name, email, phone or address. Details are in the <Link to="/privacy" className="underline font-bold">Privacy Policy</Link>.</>}
                </Paragraph>
            </Section>

            <Section n={4} title={isRTL ? 'طلبُ الحذف الآن' : 'Request deletion now'}>
                {done ? (
                    <Paragraph>
                        {isRTL
                            ? <><strong>تمّ تنفيذُ الطلب.</strong> حسابُك مُعطَّلٌ الآن وقد سُجِّل خروجُك. إن سجّلت الدخول خلال مهلة التراجع فستُعرض عليك الاستعادة.</>
                            : <><strong>Your request has been carried out.</strong> Your account is now deactivated and you have been signed out. Signing in during the undo window will offer to restore it.</>}
                    </Paragraph>
                ) : !user ? (
                    <>
                        <Paragraph>
                            {isRTL
                                ? 'الحذفُ يحتاج تأكيدَ أنك صاحبُ الحساب، فسجّل الدخول أوّلاً ثم ارجع إلى هذه الصفحة.'
                                : 'Deletion requires confirming that the account is yours. Sign in first, then return to this page.'}
                        </Paragraph>
                        <Link
                            to="/register"
                            className="inline-block mt-2 px-5 py-2.5 rounded-xl font-bold text-sm bg-[var(--accent)] text-white"
                        >
                            {isRTL ? 'تسجيل الدخول' : 'Sign in'}
                        </Link>
                    </>
                ) : !confirming ? (
                    <button
                        onClick={() => setConfirming(true)}
                        className="mt-1 px-5 py-2.5 rounded-xl font-bold text-sm bg-red-600 text-white"
                    >
                        {isRTL ? 'أريد حذف حسابي' : 'I want to delete my account'}
                    </button>
                ) : (
                    <div className="mt-1 space-y-3">
                        <Paragraph>
                            {isRTL
                                ? <><strong>تأكيدٌ أخير.</strong> سيُعطَّل حسابُك الآن ويُمحى نهائياً بعد مهلة التراجع.</>
                                : <><strong>Final confirmation.</strong> Your account will be deactivated now and permanently erased after the undo window.</>}
                        </Paragraph>
                        <div className="flex gap-2 flex-wrap">
                            <button
                                onClick={run}
                                disabled={busy}
                                className="px-5 py-2.5 rounded-xl font-bold text-sm bg-red-600 text-white disabled:opacity-60"
                            >
                                {busy
                                    ? (isRTL ? 'جارٍ التنفيذ…' : 'Working…')
                                    : (isRTL ? 'نعم، احذف حسابي' : 'Yes, delete my account')}
                            </button>
                            <button
                                onClick={() => setConfirming(false)}
                                disabled={busy}
                                className="px-5 py-2.5 rounded-xl font-bold text-sm border border-[var(--border)] text-[var(--text-primary)]"
                            >
                                {isRTL ? 'تراجَع' : 'Cancel'}
                            </button>
                        </div>
                    </div>
                )}
            </Section>

            <Section n={5} title={isRTL ? 'إن احتجت مساعدة' : 'If you need help'}>
                <Paragraph>
                    {isRTL
                        ? <>إن تعذّر عليك الدخول إلى حسابك، فتواصل معنا من <Link to="/contact" className="underline font-bold">صفحة التواصل</Link> وسنتحقّق من هويّتك ثم ننفّذ الطلب.</>
                        : <>If you cannot sign in, contact us from the <Link to="/contact" className="underline font-bold">contact page</Link>; we will verify your identity and then carry out the request.</>}
                </Paragraph>
            </Section>
        </LegalLayout>
    );
};

export default DeleteAccount;
