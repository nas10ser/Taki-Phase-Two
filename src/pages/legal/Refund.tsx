/**
 * Refund Policy — سياسة الاسترداد لـ TAKI / Refund Policy for TAKI.
 * Bilingual (v11.9 — full EN support).
 *
 * النموذج المُعتمَد:
 *   • للمشتري: لا دفع للمنصّة أصلاً — سياسة استرداد ثمن المشتريات على عاتق
 *     التاجر وحده، تختلف من تاجر لآخر، وTAKI ليست طرفاً ولا تتدخّل.
 *   • للتاجر (في حال تفعيل الاشتراك المدفوع): نموذج «اشترك ويتجدد تلقائياً،
 *     أوقف التجديد متى تشاء واستفد حتى نهاية المدّة» (v12.67 — مماثل لـ
 *     Netflix / Spotify / iCloud، مع تذكير قبل كل تجديد).
 */

import React from 'react';
import { LegalLayout, Section, Paragraph, Bullets } from './LegalLayout';
import { useApp } from '../../context/AppContext';

const Refund: React.FC = () => {
    const { language } = useApp();
    const isRTL = language === 'ar';

    return (
        <LegalLayout
            title={isRTL ? 'سياسة الاسترداد' : 'Refund Policy'}
            subtitle={isRTL ? 'Refund Policy · TAKI' : 'Refund Policy · TAKI'}
            lastUpdated="2026-07-22"
        >
            <Paragraph>
                {isRTL ? (
                    <>
                        تُحدِّد هذه السياسة قواعد الإلغاء والاسترداد المتعلّقة باستخدام منصّة
                        <strong> TAKI</strong>، وفق <strong>نظام التجارة الإلكترونية السعودي</strong>،
                        <strong> ونظام حماية المستهلك</strong>، و<strong>نظام المعاملات المدنية</strong>.
                        تُقرَأ هذه السياسة مع شروط الاستخدام وسياسة الخصوصية كوثيقة واحدة
                        متكاملة، وتُعدّ موافقتك عليها شرطاً نظامياً لاستمرار استخدام المنصّة.
                    </>
                ) : (
                    <>
                        This policy sets out the cancellation and refund rules applicable to
                        the use of the <strong>TAKI</strong> platform, pursuant to the
                        <strong> Saudi E-Commerce Law</strong>, the <strong>Consumer
                        Protection Law</strong>, and the <strong>Civil Transactions Law</strong>.
                        It must be read together with the Terms of Service and Privacy
                        Policy as a single integrated document, and your acceptance of it
                        is a regulatory condition of continued use of the platform.
                    </>
                )}
            </Paragraph>

            <div className="bg-emerald-50 border-2 border-emerald-200 rounded-2xl p-4 my-4">
                <div className="text-lg font-extrabold text-emerald-900 mb-2">
                    {isRTL ? '🔗 المبدأ الجوهري' : '🔗 The core principle'}
                </div>
                <p className="text-sm font-bold text-emerald-900 leading-relaxed">
                    {isRTL ? (
                        <>
                            TAKI <strong>منصّة وسيطة فقط</strong>. لا تَبيع منتجات ولا تَستلم ثمنها،
                            ولا تَتدخّل في طريقة الشراء ولا في آلية البيع.
                            <br />
                            <strong>ثمن المشتريات يَتمّ بين المشتري والتاجر مباشرة</strong>،
                            و<strong>سياسة الاسترجاع والاستبدال محصورة بينهما</strong> وفق
                            سياسة المتجر المُعلَنة. TAKI ليست طرفاً فيها ولا تَضمنها.
                            <br />
                            عند ورود شكوى، يَحقّ للموقع اتّخاذ ما يَراه مناسباً من إجراءات
                            دون التزام بمدّة محدَّدة ودون شرح أسباب القرار.
                        </>
                    ) : (
                        <>
                            TAKI is an <strong>intermediary platform only</strong>. It does
                            not sell products, does not collect their price, and does not
                            intervene in the method of purchase or sale.
                            <br />
                            <strong>The price of purchases is settled directly between
                            buyer and merchant</strong>, and the <strong>returns and
                            exchange policy is confined to those two parties</strong>{' '}
                            under the store's published policy. TAKI is neither a party
                            to it nor a guarantor of it.
                            <br />
                            When a complaint is received, the platform reserves the right
                            to take whatever measures it deems appropriate, without being
                            bound by a specific timeframe and without disclosing the
                            reasons for the decision.
                        </>
                    )}
                </p>
            </div>

            <Section n={1} title={isRTL ? 'طبيعة المعاملات على TAKI' : 'Nature of transactions on TAKI'}>
                <Bullets items={isRTL ? [
                    <><strong>للمشتري</strong>: التسجيل والتصفّح والحجز <strong>مجانيّ بالكامل</strong>. لا توجد أيّ مدفوعات أو اشتراكات على المشتري لصالح المنصّة، ولا تستلم TAKI أيّ ثمن نيابةً عن أيّ تاجر.</>,
                    <><strong>الثمن (إن وُجد)</strong> يدفعه المشتري مباشرةً للتاجر عند الاستلام، بالطريقة التي يتّفقان عليها (نقد / بطاقة / تحويل في موقع التاجر).</>,
                    <><strong>للتاجر</strong>: قد يدفع — في حال تفعيل بوابة الدفع للتجار — اشتراكاً شهرياً للمنصّة مقابل خدمات النشر والظهور. هذا الاشتراك هو الجزء الوحيد من سياسة الاسترداد الذي يتعلّق بـ TAKI مباشرة.</>,
                ] : [
                    <><strong>For buyers</strong>: registration, browsing and booking are <strong>entirely free</strong>. There are no payments or subscriptions owed by the buyer to the platform, and TAKI does not collect any price on behalf of any merchant.</>,
                    <><strong>The price (if any)</strong> is paid by the buyer directly to the merchant upon receipt, by whatever means they agree (cash / card / transfer at the merchant's location).</>,
                    <><strong>For merchants</strong>: where the merchant payment gateway is enabled, the merchant may pay a monthly subscription to the platform in return for listing and visibility services. This subscription is the only part of the refund policy that relates directly to TAKI.</>,
                ]} />
            </Section>

            <Section n={2} title={isRTL ? '🛍️ استرداد ثمن المشتريات (للمشتري) — سياسة التاجر هي الحاكمة' : '🛍️ Refunds for purchases (buyers) — the merchant\'s policy governs'}>
                <Paragraph>
                    {isRTL ? (
                        <>
                            <strong>كلّ تاجر يضع سياسة استرداد خاصّة به</strong>، تختلف بحسب نوع
                            نشاطه (مطاعم، تجزئة، خدمات، ترفيه، إلخ.)، وبحسب طبيعة العرض،
                            وبحسب التزاماته النظامية. ولذلك:
                        </>
                    ) : (
                        <>
                            <strong>Each merchant sets its own refund policy</strong>, which
                            varies according to the nature of the business (restaurants,
                            retail, services, entertainment, and so on), the nature of the
                            offer, and the merchant's regulatory obligations. Accordingly:
                        </>
                    )}
                </Paragraph>
                <Bullets items={isRTL ? [
                    <><strong>TAKI ليست طرفاً في استرداد ثمن المشتريات بين المشتري والتاجر</strong> — لأنّ ثمن البضاعة لم يَمُرّ أصلاً عبر TAKI.</>,
                    <><strong>المُسائَل الأوّل والوحيد عن استرداد الثمن هو التاجر</strong> الذي تمّ الشراء منه؛ وكلّ ادعاء بشأن جودة، عيب، مطابقة وصف، أو عيب تصنيع يُرفَع للتاجر مباشرة.</>,
                    <>اطّلع — قبل الحجز — على سياسة الاسترداد المُعلَنة في صفحة المتجر أو العرض (إن أُتيحت)، وأسأل التاجر مباشرة عبر شات الحجز عن أيّ تفاصيل قبل تأكيد الاستلام.</>,
                    <>الفئات التي عادةً ما تكون <strong>غير قابلة للاسترداد</strong> بطبيعتها وفقاً للأنظمة السعودية ولسياسات معظم التجار: المواد الغذائية الطازجة بعد فتح/استهلاك، منتجات العناية الشخصية المفتوحة، الخدمات المُقدَّمة فعلاً (قصّ شعر، تدليك، إلخ.)، الخدمات الفورية المُستهلَكة.</>,
                    <>إذا فشل التواصل مع التاجر، أو رفض التاجر تطبيق سياسته المُعلَنة، أو نشأ خلاف، يمكنك رفع شكوى للإدارة عبر «📣 الشكاوى» داخل التطبيق. تتدخّل TAKI <strong>كميسِّر للتواصل فقط</strong> دون أن تكون ملزَمة بنتيجة معيّنة.</>,
                    <>للنزاعات التي لا تُحلّ ودّياً، يحقّ للمشتري التقدّم للجهات الرقابية السعودية المذكورة في القسم 7.</>,
                ] : [
                    <><strong>TAKI is not a party to refunds between buyer and merchant</strong> — because the price of the goods never passed through TAKI in the first place.</>,
                    <><strong>The first and sole party answerable for a refund is the merchant</strong> from whom the purchase was made; any claim concerning quality, defect, fitness for description, or manufacturing fault must be raised with the merchant directly.</>,
                    <>Before booking, review the refund policy published on the store or offer page (where provided), and ask the merchant directly through the booking chat about any detail before confirming receipt.</>,
                    <>Categories typically <strong>not refundable</strong> by their nature under Saudi laws and most merchants' policies include: fresh food after opening or consumption, opened personal-care products, services already rendered (haircuts, massages, etc.), and immediately consumed services.</>,
                    <>If you cannot reach the merchant, the merchant refuses to honour its published policy, or a dispute arises, you may raise a complaint with the administration via «📣 Complaints» inside the app. TAKI may intervene <strong>only as a facilitator of communication</strong> and is not bound to any specific outcome.</>,
                    <>For disputes that cannot be resolved amicably, the buyer may approach the Saudi regulatory authorities listed in Section 7.</>,
                ]} />
                <div className="bg-amber-50 border-2 border-amber-200 rounded-2xl p-4 my-3">
                    <p className="text-sm font-bold text-amber-900 leading-relaxed">
                        {isRTL ? (
                            <>
                                ⚠️ <strong>تنبيه مهم</strong>: عند الحجز، أنت تُبرم عقداً مباشرةً مع
                                التاجر — لا مع TAKI. أيّ مطالبة باسترداد الثمن المدفوع للتاجر،
                                أو تعويض، أو إصلاح، أو استبدال، تُوجَّه للتاجر مباشرةً وتسري بحسب
                                سياسته المُعلَنة وبحسب الأنظمة السعودية لحماية المستهلك.
                            </>
                        ) : (
                            <>
                                ⚠️ <strong>Important notice</strong>: when you book, you enter
                                into a contract directly with the merchant — not with TAKI.
                                Any claim for refund of the price paid to the merchant, or for
                                compensation, repair or exchange, must be addressed to the
                                merchant directly and is governed by its published policy and
                                by Saudi consumer-protection law.
                            </>
                        )}
                    </p>
                </div>
            </Section>

            <Section n={3} title={isRTL ? '📅 إلغاء الحجز (للمشتري)' : '📅 Cancelling a booking (buyers)'}>
                <Bullets items={isRTL ? [
                    'الحجز التزام مبدئيّ لا دفع — لا يحجز أيّ مبلغ على بطاقتك ولا يلتزم أيّ مال للمنصّة.',
                    'مدّة صلاحية الحجز ساعتان من التأكيد: إن لم تستلم خلالها يُلغى الحجز تلقائياً وتعود الكمّية (بما فيها كمّيات النسخ المحجوزة) للعرض — دون أيّ التزام مالي عليك.',
                    'الإجمالي الظاهر عند الحجز (النسخ + الإضافات المختارة) يُدفع للتاجر مباشرةً عند الاستلام — لا تستلم TAKI أيّ جزء منه.',
                    'يحقّ لك إلغاء الحجز في أيّ وقت قبل انتهاء صلاحيّته من صفحة «حجوزاتي»، بضغطة واحدة، دون أيّ رسوم أو غرامات على المنصّة — وعند الإلغاء تعود الكمّيات المحجوزة للعرض فوراً.',
                    'إذا لم تحضر خلال مدّة العرض، يحقّ للتاجر إلغاء الحجز من جانبه.',
                    'الإلغاء لا يترتّب عليه أيّ مبلغ مالي لأنّه لا دفع تمّ أصلاً عبر TAKI.',
                    'الإكثار من الحجز دون نيّة الحضور قد يُعرّض حسابك لتقييد أو تعليق وفقاً لتقدير الإدارة (لأنّه يُضرّ بثقة التجار في المنصّة).',
                ] : [
                    'A booking is a preliminary commitment, not a payment — no amount is held on your card and no money is owed to the platform.',
                    'A booking is valid for two hours from confirmation: if you do not collect within that window, it is cancelled automatically and the quantity (including reserved version quantities) returns to the offer — at no financial obligation on you.',
                    'The total shown at booking (versions + selected add-ons) is paid directly to the merchant on receipt — TAKI receives no part of it.',
                    'You may cancel your booking at any time before it expires from the «My Bookings» page in a single tap, with no fees or penalties charged by the platform — on cancellation, the reserved quantities return to the offer immediately.',
                    'If you do not attend within the offer window, the merchant may cancel the booking from their side.',
                    'Cancellation does not give rise to any financial amount, because no payment was made through TAKI in the first place.',
                    'Frequent bookings without intention to attend may lead to your account being restricted or suspended at the administration\'s discretion (since this undermines merchants\' trust in the platform).',
                ]} />
            </Section>

            <Section n={4} title={isRTL ? '💳 اشتراك التاجر — نموذج «ادفع شهرياً، ألغِ متى تشاء»' : '💳 Merchant subscription — «Pay monthly, cancel anytime»'}>
                <Paragraph>
                    {isRTL ? (
                        <>
                            هذا القسم يَسري <strong>على التاجر</strong> فقط، عند تفعيل خدمة الاشتراك
                            المدفوع للتجار. لا علاقة له بالمشتري الذي يبقى استخدامه للمنصّة
                            مجاناً.
                        </>
                    ) : (
                        <>
                            This section applies <strong>to merchants only</strong>, where the
                            paid merchant-subscription service is enabled. It does not affect
                            buyers, whose use of the platform remains free.
                        </>
                    )}
                </Paragraph>
                <div className="bg-emerald-50 border-2 border-emerald-200 rounded-2xl p-4 my-3">
                    <div className="text-base font-extrabold text-emerald-900 mb-2">
                        {isRTL ? 'كيف يعمل الاشتراك؟' : 'How does the subscription work?'}
                    </div>
                    <ol className="list-decimal ps-6 space-y-2 text-sm text-emerald-900 font-medium">
                        {isRTL ? (
                            <>
                                <li>التاجر يدفع مبلغ الباقة عبر بوّابة الدفع المُرخَّصة.</li>
                                <li>الاشتراك يُفعَّل فوراً ويبقى نافذاً <strong>للمدّة المحدَّدة في الباقة</strong> من تاريخ الدفع.</li>
                                <li><strong>يتجدَّد الاشتراك تلقائياً</strong> بنفس الباقة والمبلغ عند نهاية كلّ مدّة — حتى لا تنقطع عروض التاجر عن الظهور — ويصل التاجر <strong>تذكير قبل التجديد بعدّة أيام</strong>.</li>
                                <li>في أيّ لحظة، يحقّ للتاجر <strong>إيقاف التجديد التلقائي</strong> من صفحة الاشتراك. وعند الإيقاف: <strong>يبقى الاشتراك نافذاً حتى نهاية المدّة المدفوعة</strong>، ثم يتوقّف <strong>دون أيّ سحب إضافي</strong>.</li>
                                <li>بعد التوقّف يتوقّف ظهور العروض تلقائياً حتى يُجدِّد التاجر بنفسه، ويُعيد تفعيل عروضه بما يوافق سقف المواقع في باقته؛ والانتقال لباقة أدنى يسري بسقفها الجديد فور انتهاء الباقة الأعلى.</li>
                            </>
                        ) : (
                            <>
                                <li>The merchant pays the package fee through the licensed payment gateway.</li>
                                <li>The subscription is activated immediately and remains effective for <strong>the period specified in the plan</strong> from the date of payment.</li>
                                <li><strong>The subscription auto-renews</strong> at the same package and amount at the end of each period — so the merchant's offers never stop appearing — and the merchant receives a <strong>reminder several days before renewal</strong>.</li>
                                <li>At any moment, the merchant may <strong>turn off auto-renewal</strong> from the subscription page. On turning it off: <strong>the subscription remains effective until the end of the paid period</strong>, then stops <strong>with no further charge</strong>.</li>
                                <li>After it stops, the offers stop appearing automatically until the merchant renews themselves, re-activating them within the location cap of their package; a downgrade takes effect at the lower cap as soon as the higher package ends.</li>
                            </>
                        )}
                    </ol>
                </div>
                <Paragraph>
                    {isRTL ? (
                        <>
                            هذا النموذج — «اشترك ويتجدَّد تلقائياً، وأوقف التجديد متى تشاء
                            واستفد حتى نهاية المدّة المدفوعة» — مماثل لنماذج Netflix و Spotify
                            و iCloud المعتمَدة دولياً، مع تذكير مُسبق قبل كلّ تجديد. وهو متوافق
                            مع مبدأ «العقد شريعة المتعاقدين» المنصوص عليه في نظام المعاملات
                            المدنية السعودي.
                        </>
                    ) : (
                        <>
                            This model — «Subscribe and it auto-renews; turn off renewal
                            anytime and benefit until the end of the paid period» — mirrors
                            the internationally accepted models of Netflix, Spotify and
                            iCloud, with an advance reminder before every renewal. It is
                            consistent with the principle that «the contract is the law of
                            the parties» as set out in the Saudi Civil Transactions Law.
                        </>
                    )}
                </Paragraph>
            </Section>

            <Section n={5} title={isRTL ? '❌ متى لا يحقّ استرداد اشتراك التاجر' : '❌ When merchant subscriptions are non-refundable'}>
                <Paragraph>
                    {isRTL
                        ? 'لا يحقّ للتاجر استرداد أيّ مبلغ من اشتراكه في الحالات التالية:'
                        : 'A merchant is not entitled to a refund of any subscription amount in the following cases:'}
                </Paragraph>
                <Bullets items={isRTL ? [
                    'بعد إتمام عملية الدفع — لأنّ الخدمة بدأت فوراً وبدأ ظهور التاجر على المنصّة.',
                    'بعد نشر أيّ عرض على المنصّة (ولو عرضاً واحداً، ولو لدقيقة) — لأنّه استفاد من الخدمة المدفوعة.',
                    'عند إيقاف التاجر للتجديد التلقائي في أيّ يوم خلال المدّة المدفوعة — يبقى الاشتراك نافذاً للنهاية ولا يُسترَدّ جزء منه.',
                    'عند تعليق حساب التاجر بسبب مخالفة شروط الاستخدام أو الأنظمة السعودية — لا يُسترَدّ المبلغ المتبقّي من الفترة المدفوعة.',
                    'بعد مرور 7 أيام على تاريخ المعاملة — حتى لو لم يستخدم التاجر الخدمة، تَسقط الفترة النظامية للمطالبة وفقاً لحقّ العدول المنصوص عليه في نظام التجارة الإلكترونية السعودي.',
                    'إذا كان السبب «غيّرت رأيي»، «وجدت بديلاً أرخص»، «النتائج لم ترقَ لتوقّعاتي»، «اكتسبت زبائن أقلّ من المتوقّع» — هذه ليست أسباباً موجبة للاسترداد بعد إتمام الدفع.',
                    'مبلغ التجديد التلقائي بعد وصول التذكير المُسبق دون إيقاف التجديد — لأنّ التاجر مُكِّن من الإيقاف قبل التجديد بعدّة أيام.',
                ] : [
                    'After payment has been completed — because the service starts immediately and the merchant\'s listing appears on the platform.',
                    'After publishing any offer on the platform (even one offer, even for one minute) — because the merchant has benefited from the paid service.',
                    'Where the merchant turns off auto-renewal on any day of the paid period — the subscription remains effective until the end and no part of it is refunded.',
                    'Where the merchant\'s account is suspended for breach of the Terms of Service or Saudi laws — no portion of the remaining paid period is refunded.',
                    'After 7 days have elapsed since the transaction date — even if the merchant has not used the service, the statutory window for claiming has expired, in line with the right of withdrawal under the Saudi E-Commerce Law.',
                    'Where the reason is «I changed my mind», «I found a cheaper alternative», «results fell short of expectations», or «I gained fewer customers than expected» — these are not valid grounds for refund after payment.',
                    'An auto-renewal charge made after the advance reminder was delivered and renewal was not turned off — because the merchant was enabled to stop it several days before the renewal.',
                ]} />
            </Section>

            <Section n={6} title={isRTL ? '✅ حالات استثنائية قد يُنظَر فيها بالاسترداد' : '✅ Exceptional cases where a refund may be considered'}>
                <Paragraph>
                    {isRTL ? (
                        <>
                            قد تَنظر الإدارة — وفق تَقديرها والأنظمة المعمول بها — في استرداد المبلغ
                            المدفوع للمنصّة (كلّياً أو جزئياً) في حالات استثنائية محدودة، مع تقديم
                            إثبات قاطع، ومن أمثلتها:
                        </>
                    ) : (
                        <>
                            The administration may consider — at its discretion and in
                            accordance with applicable law — refunding the amount paid to the
                            platform (in whole or in part) in limited exceptional cases, on
                            submission of conclusive evidence, such as:
                        </>
                    )}
                </Paragraph>
                <Bullets items={isRTL ? [
                    <><strong>خطأ تقنيّ من المنصّة</strong>: سحب المبلغ مرّتين عن نفس الفترة، أو خصم بدون تفعيل اشتراك.</>,
                    <><strong>سحب بدون موافقة</strong>: استخدام طرف آخر بطاقة التاجر دون إذنه — مع تقديم بلاغ شرطة وتجميد البطاقة وإثبات بنكي.</>,
                    <><strong>انقطاع جوهريّ ومُطوَّل في الخدمة من جانب المنصّة</strong> يَحول دون الانتفاع بها — قد تَنظر الإدارة في تعويض مناسب وفق تقديرها.</>,
                    <><strong>إنهاء حساب التاجر من قِبَل الإدارة بدون مخالفة منه</strong> — قد يُنظَر في ردّ ما تبقّى من الفترة المدفوعة وفق تقدير الإدارة.</>,
                ] : [
                    <><strong>A technical error of the platform</strong>: charging the amount twice for the same period, or charging without activating a subscription.</>,
                    <><strong>Unauthorised charge</strong>: a third party used the merchant's card without authorisation — supported by a police report, card freeze, and bank evidence.</>,
                    <><strong>A substantial and prolonged service outage on the platform's side</strong> that prevents use — the administration may consider appropriate compensation at its discretion.</>,
                    <><strong>Termination of the merchant's account by the administration without any breach on the merchant's part</strong> — the remaining portion of the paid period may be considered for refund at the administration's discretion.</>,
                ]} />
                <Paragraph>
                    {isRTL ? (
                        <>
                            تُقدَّم المطالبة بالاسترداد <strong>خلال مدّة معقولة</strong> من تاريخ الواقعة،
                            عبر زرّ «📣 الشكاوى» داخل التطبيق، مع إرفاق ما يَلزم من إثباتات:
                        </>
                    ) : (
                        <>
                            The refund claim <strong>should be submitted within a reasonable
                            period</strong> of the incident, through the «📣 Complaints»
                            button inside the app, attaching:
                        </>
                    )}
                </Paragraph>
                <Bullets items={isRTL ? [
                    'رقم العملية وتاريخها.',
                    'لقطة شاشة لكشف البنك (مع إخفاء رقم البطاقة).',
                    'وصف مفصَّل للمشكلة.',
                    'أيّ إثبات إضافي (بلاغ شرطة، إيميل تأكيد، إلخ.).',
                ] : [
                    'The transaction number and date.',
                    'A screenshot of the bank statement (with the card number masked).',
                    'A detailed description of the problem.',
                    'Any further evidence (police report, confirmation email, etc.).',
                ]} />
            </Section>

            <Section n={7} title={isRTL ? '⏱️ مدّة معالجة طلبات الاسترداد المقبولة' : '⏱️ Processing time for approved refund requests'}>
                <Bullets items={isRTL ? [
                    'تُراجَع طلبات الاسترداد المقبولة خلال مدّة معقولة من استلامها كاملةً مع كامل المستندات.',
                    'في حال قبول الطلب، يُحوَّل المبلغ خلال مدّة معقولة إلى وسيلة الدفع الأصلية، وفق الأنظمة المعمول بها ولوائح البنك المركزي السعودي.',
                    'قد تَستغرق الإجراءات البنكية أو شبكات البطاقات (مدى / Visa / Mastercard) مدّة إضافية خارجة عن سيطرة المنصّة.',
                    'لا تتحمّل TAKI أيّ تأخير من الجهة البنكية بعد إتمام التحويل من جانبها.',
                ] : [
                    'Approved requests are reviewed within a reasonable period of being received complete with all supporting documents.',
                    'If accepted, the amount is transferred within a reasonable period to the original payment method, in accordance with applicable regulations and the Saudi Central Bank rules.',
                    'Banking procedures or card networks (mada / Visa / Mastercard) may take additional time beyond the platform\'s control.',
                    'TAKI bears no responsibility for any delay caused by the banking side once the transfer has been completed on TAKI\'s end.',
                ]} />
            </Section>

            <Section n={8} title={isRTL ? '🚫 لا تنازل عن الحقوق النظامية' : '🚫 No waiver of statutory rights'}>
                <Paragraph>
                    {isRTL
                        ? 'لا تُلغي هذه السياسة الحقوق النظامية المكفولة للمستهلك في:'
                        : 'This policy does not waive any of the consumer\'s statutory rights under:'}
                </Paragraph>
                <Bullets items={isRTL ? [
                    'نظام التجارة الإلكترونية السعودي ولائحته التنفيذية.',
                    'نظام حماية المستهلك.',
                    'لوائح البنك المركزي السعودي للمدفوعات الإلكترونية.',
                    'نظام حماية البيانات الشخصية لأيّ شأن متعلّق بمعالجة بيانات الدفع.',
                ] : [
                    'The Saudi E-Commerce Law and its implementing regulations.',
                    'The Consumer Protection Law.',
                    'The Saudi Central Bank\'s regulations for electronic payments.',
                    'The Personal Data Protection Law in any matter relating to the processing of payment data.',
                ]} />
                <Paragraph>
                    {isRTL
                        ? 'إذا اعتقد المستخدم أنّ حقّاً من حقوقه النظامية انتُهك، يحقّ له التقدّم للجهات التالية حسب طبيعة الشكوى:'
                        : 'If a user believes that any of their statutory rights has been infringed, they may approach the following authorities depending on the nature of the complaint:'}
                </Paragraph>
                <Bullets items={isRTL ? [
                    <><strong>وزارة التجارة</strong> — <a href="https://mc.gov.sa" target="_blank" rel="noopener noreferrer" className="text-emerald-600 font-bold underline">mc.gov.sa</a> — لقضايا التجارة الإلكترونية وحماية المستهلك.</>,
                    <><strong>منصّة معروف</strong> — <a href="https://maroof.sa" target="_blank" rel="noopener noreferrer" className="text-emerald-600 font-bold underline">maroof.sa</a> — لتوثيق المتاجر الإلكترونية والشكاوى عليها.</>,
                    <><strong>البنك المركزي السعودي (SAMA)</strong> — <a href="https://sama.gov.sa" target="_blank" rel="noopener noreferrer" className="text-emerald-600 font-bold underline">sama.gov.sa</a> — للنزاعات المتعلّقة بالمدفوعات الإلكترونية.</>,
                    <><strong>هيئة البيانات والذكاء الاصطناعي (SDAIA)</strong> — <a href="https://sdaia.gov.sa" target="_blank" rel="noopener noreferrer" className="text-emerald-600 font-bold underline">sdaia.gov.sa</a> — للشكاوى المتعلّقة بالخصوصية.</>,
                    'المحاكم التجارية السعودية المختصّة داخل المملكة العربية السعودية.',
                ] : [
                    <><strong>Ministry of Commerce</strong> — <a href="https://mc.gov.sa" target="_blank" rel="noopener noreferrer" className="text-emerald-600 font-bold underline">mc.gov.sa</a> — for e-commerce and consumer-protection matters.</>,
                    <><strong>Maroof Platform</strong> — <a href="https://maroof.sa" target="_blank" rel="noopener noreferrer" className="text-emerald-600 font-bold underline">maroof.sa</a> — for the accreditation of online stores and complaints against them.</>,
                    <><strong>Saudi Central Bank (SAMA)</strong> — <a href="https://sama.gov.sa" target="_blank" rel="noopener noreferrer" className="text-emerald-600 font-bold underline">sama.gov.sa</a> — for disputes relating to electronic payments.</>,
                    <><strong>Saudi Data &amp; AI Authority (SDAIA)</strong> — <a href="https://sdaia.gov.sa" target="_blank" rel="noopener noreferrer" className="text-emerald-600 font-bold underline">sdaia.gov.sa</a> — for complaints relating to privacy.</>,
                    'The competent Saudi commercial courts within the Kingdom of Saudi Arabia.',
                ]} />
            </Section>

            <Section n={9} title={isRTL ? 'إقرار وقبول' : 'Acknowledgement and acceptance'}>
                <Paragraph>
                    {isRTL ? (
                        <>
                            إتمام أيّ عملية دفع على TAKI، أو الاستمرار في استخدام المنصّة بعد
                            نشر هذه السياسة، يُعدّ إقراراً صريحاً بأنّك قرأتها، فهمتها، ووافقت
                            عليها قانونياً. ولا يحقّ لاحقاً التذرّع بعدم العلم أو عدم الفهم.
                        </>
                    ) : (
                        <>
                            Completing any payment on TAKI, or continuing to use the platform
                            after this policy has been published, constitutes an express
                            acknowledgement that you have read, understood and legally
                            accepted it. You may not later rely on a lack of knowledge or
                            understanding.
                        </>
                    )}
                </Paragraph>
                <Paragraph>
                    {isRTL ? (
                        <>
                            للاستفسارات الشائعة عن آلية الحجز والاستخدام، راجع{' '}
                            <a href="/faq" className="text-emerald-600 font-bold underline">الأسئلة الشائعة</a>{' '}
                            أو راسلنا عبر <a href="/contact" className="text-emerald-600 font-bold underline">صفحة اتصل بنا</a>.
                        </>
                    ) : (
                        <>
                            For common questions about how booking and use of the platform
                            work, see the{' '}
                            <a href="/faq" className="text-emerald-600 font-bold underline">Frequently Asked Questions</a>{' '}
                            or contact us through the <a href="/contact" className="text-emerald-600 font-bold underline">Contact Us</a> page.
                        </>
                    )}
                </Paragraph>
            </Section>
        </LegalLayout>
    );
};

export default Refund;
