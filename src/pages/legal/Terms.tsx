/**
 * Terms of Service — شروط استخدام TAKI / Terms of Service for TAKI.
 * Bilingual (v11.9 — full EN translation alongside Arabic).
 *
 * تَدمج هذه الصياغة:
 *  • الإطار النظامي السعودي الكامل (المعاملات المدنية، التجارة الإلكترونية،
 *    حماية البيانات، مكافحة جرائم المعلوماتية، مكافحة غسل الأموال، حقوق
 *    الإنسان، نظام مكافحة الاتجار بالأشخاص، نظام حماية الطفل).
 *  • بنود حماية المنصّة المُكافِئة لما تَعتمده المنصّات السعودية الكبرى.
 *  • Safety Center مَدمج توزيعاً على الأقسام بدون قسم منفصل.
 */

import React from 'react';
import { LegalLayout, Section, Paragraph, Bullets } from './LegalLayout';
import { useApp } from '../../context/AppContext';
import { CLIENT_PAYMENT_TERMS, MERCHANT_GATEWAY_AGREEMENT } from '../../data/legalTexts';

const Terms: React.FC = () => {
    const { language } = useApp();
    const isRTL = language === 'ar';

    return (
        <LegalLayout
            title={isRTL ? 'شروط الاستخدام' : 'Terms of Service'}
            subtitle={isRTL ? 'Terms of Service · TAKI' : 'Terms of Service · TAKI'}
            lastUpdated="2026-07-23"
        >
            <Paragraph>
                {isRTL ? (
                    <>
                        مرحباً بك في <strong>TAKI</strong> — منصّة سعودية لحجز التخفيضات
                        والعروض من التجار. وُضِعت هذه الشروط وسياسة الخصوصية وسياسة الاسترداد
                        وكلّ السياسات المنشورة على المنصّة <strong>لحماية وحفظ حقوق جميع
                        الأطراف</strong>: مالك المنصّة، التجار، المشترين، والزائرين. تَخضع
                        جميع البنود والشروط والنزاعات القانونية للأنظمة والتشريعات المعمول
                        بها في المملكة العربية السعودية.
                    </>
                ) : (
                    <>
                        Welcome to <strong>TAKI</strong> — a Saudi platform for booking
                        discounts and offers from merchants. These Terms, the Privacy
                        Policy, the Refund Policy and every policy published on the
                        platform are designed <strong>to protect and safeguard the
                        rights of all parties</strong>: the platform owner, merchants,
                        buyers and visitors. All clauses, conditions and disputes are
                        subject to the laws and regulations in force in the Kingdom of
                        Saudi Arabia.
                    </>
                )}
            </Paragraph>
            <Paragraph>
                {isRTL ? (
                    <>
                        بمجرد دخولك إلى المنصّة أو تَسجيلك فيها أو استخدامك لخدماتها — سواء
                        كنت مستخدماً مُسجَّلاً أم زائراً — فإنّك تُقرّ بأنّك قرأت هذه الشروط
                        وفهمتها ووافقت على الالتزام بها بأثر فوريّ. ولا يَحقّ لك لاحقاً
                        التذرّع بعدم العلم بها أو عدم قراءتها. وللإدارة حقّ تَعديل هذه
                        الشروط في أيّ وقت، ويَسري التعديل فور نشره على المنصّة.
                    </>
                ) : (
                    <>
                        By accessing the platform, registering on it, or using its
                        services — whether as a registered user or as a visitor — you
                        acknowledge that you have read these Terms, understood them,
                        and agreed to be bound by them with immediate effect. You may
                        not later rely on a lack of knowledge of them or a failure to
                        read them. The administration reserves the right to amend
                        these Terms at any time, and an amendment takes effect as
                        soon as it is published on the platform.
                    </>
                )}
            </Paragraph>

            <Section n={1} title={isRTL ? 'التعريفات' : 'Definitions'}>
                <Bullets items={isRTL ? [
                    <><strong>المنصّة / TAKI / «نحن»</strong>: تطبيق وموقع ويب يَملكه ويُديره صاحب المنصّة، يُتيح حجز عروض وتخفيضات يُقدّمها التجار في المملكة العربية السعودية. يُشار إليه أيضاً بـ«الموقع» أو «الطرف الأوّل».</>,
                    <><strong>المستخدم / «أنت» / «الطرف الثاني»</strong>: كلّ شخص طبيعيّ أو اعتباريّ يَصل إلى المنصّة، سواء سَجّل فيها أم لا، وسواء كان مشترياً أو تاجراً.</>,
                    <><strong>المشتري</strong>: المستخدم الذي يَتصفّح ويَحجز العروض.</>,
                    <><strong>التاجر / موفّر الخدمة</strong>: الشخص الحاصل على ما يَلزم من تَراخيص نظامية، يَستخدم المنصّة لنشر عروضه.</>,
                    <><strong>المتجر الإلكتروني</strong>: حساب التاجر الذي يَعرض من خلاله العروض ويَتلقّى الحجوزات.</>,
                    <><strong>العرض</strong>: التخفيض أو الباقة أو الخدمة التي يُتيحها التاجر للحجز عبر المنصّة، بسعر وشروط يُحدّدها بنفسه.</>,
                    <><strong>الحجز</strong>: التزام أوّليّ بين المشتري والتاجر بإتمام الصفقة خلال مدّة صلاحية العرض، يُسجَّل على المنصّة. ليس دفعاً ولا حجز مبلغ على بطاقة المشتري.</>,
                    <><strong>المحتوى</strong>: كلّ ما يُدخله المستخدم على المنصّة من نصوص، صور، فيديو، تقييمات، رسائل، مواقع جغرافية، أو روابط.</>,
                    <><strong>الإدارة</strong>: مالك المنصّة ومن يَنوب عنه من الموظّفين والمشرفين والمستشارين.</>,
                    <><strong>الوثائق القانونية</strong>: هذه الشروط، وسياسة الخصوصية، وسياسة الاسترداد، وأيّ سياسة لاحقة تُنشَر على المنصّة — تُقرَأ كوثيقة واحدة متكاملة.</>,
                ] : [
                    <><strong>The Platform / TAKI / «we»</strong>: the mobile application and website owned and operated by the platform owner, enabling the booking of offers and discounts provided by merchants in the Kingdom of Saudi Arabia. Also referred to as «the Site» or the «First Party».</>,
                    <><strong>The User / «you» / the «Second Party»</strong>: every natural or juristic person who accesses the platform, whether registered or not, and whether buyer or merchant.</>,
                    <><strong>Buyer</strong>: a user who browses and books offers.</>,
                    <><strong>Merchant / Service Provider</strong>: a person holding the required regulatory licences, who uses the platform to publish their offers.</>,
                    <><strong>Online Store</strong>: the merchant account through which offers are displayed and bookings received.</>,
                    <><strong>Offer</strong>: the discount, package or service the merchant makes available for booking via the platform, at a price and on conditions they set themselves.</>,
                    <><strong>Booking</strong>: a preliminary commitment between buyer and merchant to complete the transaction within the offer window, recorded on the platform. It is not a payment, nor a hold on the buyer's card.</>,
                    <><strong>Content</strong>: anything entered by the user on the platform — text, images, video, ratings, messages, geolocations, or links.</>,
                    <><strong>The Administration</strong>: the platform owner and those acting on their behalf among staff, moderators and advisers.</>,
                    <><strong>The Legal Documents</strong>: these Terms, the Privacy Policy, the Refund Policy, and any subsequent policy published on the platform — read as a single integrated document.</>,
                ]} />
            </Section>

            <Section n={2} title={isRTL ? 'قبول الشروط — توقيع إلكتروني ملزم' : 'Acceptance of Terms — a binding electronic signature'}>
                <Paragraph>
                    {isRTL ? (
                        <>
                            لا يَكتمل تَسجيلك في المنصّة ولا تَبدأ الاستفادة من خدماتها إلا
                            بعد قبولك الصريح للوثائق القانونية بوضع علامة «✓ قرأت ووافقت»
                            أثناء إنشاء الحساب. يُسجَّل هذا القبول مع تاريخه ووقته وعنوان
                            بروتوكول الإنترنت (IP) كَدليل نظاميّ، ويُعدّ توقيعاً إلكترونياً
                            ملزماً وفقاً لنظام التعاملات الإلكترونية السعودي.
                        </>
                    ) : (
                        <>
                            Your registration on the platform is not complete, and your
                            use of its services does not commence, until you have
                            expressly accepted the legal documents by ticking «✓ I have
                            read and agree» during account creation. This acceptance is
                            recorded together with its date, time, and IP address as
                            statutory evidence, and constitutes a binding electronic
                            signature pursuant to the Saudi Electronic Transactions Law.
                        </>
                    )}
                </Paragraph>
                <Paragraph>
                    {isRTL ? (
                        <>
                            واستمرارك في استخدام الخدمات بعد أيّ تَعديل عليها يُعدّ قبولاً
                            ضمنياً للنسخة المُعدَّلة، وتَعتبر تَعاميم وقرارات الإدارة وتَوجيهاتها
                            مُلزِمة لك بمجرد إيصالها عبر أيّ من قنوات المنصّة (إشعارات داخل
                            التطبيق، بريد إلكتروني، رسائل نصّية، أو غير ذلك).
                        </>
                    ) : (
                        <>
                            Your continued use of the services after any amendment
                            constitutes implied acceptance of the amended version. The
                            administration's circulars, decisions and directions are
                            binding on you as soon as they are communicated via any of
                            the platform's channels (in-app notifications, email, SMS,
                            or otherwise).
                        </>
                    )}
                </Paragraph>
            </Section>

            <Section n={3} title={isRTL ? 'الأهلية وشروط التسجيل' : 'Eligibility and registration conditions'}>
                <Paragraph><strong>{isRTL ? 'أ‌. شروط عامّة لكلّ مستخدم:' : 'A. General conditions for every user:'}</strong></Paragraph>
                <Bullets items={isRTL ? [
                    'بلوغ سنّ الرشد النظاميّ (18 سنة فأكثر) وكامل الأهلية لإبرام عقود ملزمة. التسجيل دون هذا السنّ ممنوع ويُحذف الحساب فور اكتشافه.',
                    'تَقديم بيانات صحيحة، دقيقة، محدَّثة، تَعود إليك شخصياً. أيّ تَزوير أو انتحال جريمة بموجب نظام مكافحة جرائم المعلوماتية تُحال للجهات المختصّة.',
                    'الحفاظ على سرّية كلمة المرور وعدم مشاركة بيانات الحساب مع أيّ طرف، وتَحمّل كامل المسؤولية عن كلّ نشاط يَصدر من الحساب.',
                    'إبلاغ الإدارة فوراً عند أيّ استخدام غير مصرَّح به للحساب أو أيّ اشتباه باختراق.',
                    'التعاون مع الإدارة في أيّ طلب للتحقّق من الهوية أو الأهلية.',
                ] : [
                    'Attainment of the legal age of majority (18 years or above) and full capacity to enter into binding contracts. Registration below this age is prohibited and the account is deleted as soon as it is discovered.',
                    'Submission of accurate, current and up-to-date information belonging to you personally. Any falsification or impersonation is an offence under the Anti-Cyber Crime Law and is referred to the competent authorities.',
                    'Maintaining the confidentiality of your password and not sharing account credentials with any party, and taking full responsibility for every activity carried out from the account.',
                    'Notifying the administration immediately of any unauthorised use of the account or any suspicion of compromise.',
                    'Cooperating with the administration with any request to verify identity or eligibility.',
                ]} />
                <Paragraph><strong>{isRTL ? 'ب‌. شروط إضافية للمتجر/التاجر:' : 'B. Additional conditions for the store/merchant:'}</strong></Paragraph>
                <Bullets items={isRTL ? [
                    'اختيار اسم متجر لائق ومناسب ولا يُخالف الذوق العامّ ولا الأنظمة.',
                    'يُمنع إنشاء أكثر من حساب لنفس الشخص أو الجهة على المنصّة دون إذن خطّيّ مسبق من الإدارة.',
                    'إذا كان اسم المتجر يَتضمّن اسماً تجارياً أو علامة تجارية، فيَلزم أن تكون مالكها أو مُفوَّضاً باستخدامها.',
                    'يُمنع بيع المتجر أو التنازل عنه أو تَأجيره أو السماح لأيّ طرف باستخدامه. وفي حالة المخالفة يُعتبر صاحب الحساب الأوّل هو المسؤول قانونياً عن كلّ ما يَصدر منه، ويُعدّ الطرفان (المتنازِل والمتنازَل له) مُخالفَين لشروط الاستخدام.',
                    'تَحديث رقم الجوّال المرتبط بالمتجر فور تَغييره أو فقدانه.',
                    <><strong>التاجر وحده مسؤول</strong> عن حِيازة جميع الوثائق والتَراخيص النظامية اللازمة لمزاولة نشاطه (سجلّ تجاريّ، وثيقة عمل حرّ، تَرخيص بلديّ، اشتراطات صحّية، تَرخيص هيئة الغذاء والدواء، أو أيّ تَرخيص نظاميّ آخر يَقتضيه نشاطه) — والمنصّة <strong>لا تَلتزم بالتحقّق المسبق</strong> من هذه الوثائق قبل تَفعيل الحساب أو نَشر العروض.</>,
                    <>للإدارة الحقّ في طَلب أيّ من هذه الوثائق متى رأت ذلك ضرورياً (وثائق هوية، سجلّ تجاريّ، رخصة نشاط، بيانات بنكية عند تَفعيل اشتراك مدفوع)، وتَعليق الحساب فوراً إن تَخلّف التاجر عن تَقديمها. وأيّ مخالفة لمتطلّبات التَرخيص أو نَشر نشاط دون التَراخيص اللازمة تَقع مسؤوليّتها الكاملة — جنائياً ومدنياً — على التاجر وحده، دون أيّ مسؤولية على المنصّة.</>,
                ] : [
                    'Choosing a decent and suitable store name that does not breach public taste or the laws.',
                    'It is prohibited to create more than one account for the same person or entity on the platform without prior written permission from the administration.',
                    'If the store name contains a trade name or trademark, you must be its owner or duly authorised to use it.',
                    'Selling, assigning, leasing or allowing any party to use the store account is prohibited. In the event of breach, the original account holder is legally responsible for everything done through it, and both parties (transferor and transferee) are deemed to have breached the Terms.',
                    'Updating the mobile number associated with the store as soon as it is changed or lost.',
                    <><strong>The merchant alone is responsible</strong> for holding all documents and regulatory licences required to carry on their activity (commercial register, freelance permit, municipal licence, health requirements, Saudi Food &amp; Drug Authority licence, or any other regulatory licence required by the activity) — and the platform <strong>does not undertake to verify these documents in advance</strong> before activating the account or publishing offers.</>,
                    <>The administration has the right to request any of these documents whenever it deems necessary (identity documents, commercial register, activity licence, bank details when a paid subscription is enabled) and to suspend the account immediately if the merchant fails to produce them. Any breach of licensing requirements, or publishing of activity without the required licences, falls entirely on the merchant alone — criminally and civilly — and not on the platform.</>,
                ]} />
                <Paragraph>
                    {isRTL ? (
                        <>
                            للإدارة الحقّ المُطلق في رفض أيّ تَسجيل دون إبداء الأسباب، أو
                            تَعليقه، أو إلغائه عند الإخلال بأيّ من الشروط أعلاه. كما يَحقّ
                            للإدارة إجراء أيّ عمليّات تَحقّق تَراها لازمة من هويّتك ومن
                            استيفائك لشروط الأهلية في أيّ وقت.
                        </>
                    ) : (
                        <>
                            The administration has the absolute right to reject any
                            registration without giving reasons, to suspend it, or to
                            cancel it for breach of any of the above conditions. The
                            administration also has the right to carry out any
                            verifications it deems necessary regarding your identity and
                            your satisfaction of the eligibility conditions at any time.
                        </>
                    )}
                </Paragraph>
            </Section>

            <Section n={4} title={isRTL ? '🔗 الطبيعة القانونية للمنصّة — TAKI وسيط رقميّ فقط' : '🔗 The legal nature of the platform — TAKI is a digital intermediary only'}>
                <div className="bg-emerald-50 border-2 border-emerald-200 rounded-2xl p-4 my-3">
                    <Paragraph>
                        <strong>{isRTL ? 'إقرار جوهريّ يُعدّ الأساس الذي تُبنى عليه هذه الشروط:' : 'A core acknowledgement on which these Terms are built:'}</strong>
                    </Paragraph>
                    <Paragraph>
                        {isRTL ? (
                            <>
                                TAKI <strong>منصّة تقنية وسيطة</strong> تَربط التاجر بالمشتري،
                                ولا تَبيع أيّ منتج أو خدمة بنفسها، ولا تَشتري نيابةً عن أيّ
                                طرف، ولا تَخزّن البضائع، ولا تَشحنها، ولا تُسلّمها، ولا
                                تَضمنها، ولا تَتدخّل في تَنفيذ المعاملة بين التاجر والمشتري،
                                ولا في طريقة الشراء أو الدفع أو الاستلام.
                            </>
                        ) : (
                            <>
                                TAKI is a <strong>technical intermediary platform</strong>{' '}
                                that connects merchants with buyers. It does not itself
                                sell any product or service, does not purchase on behalf
                                of any party, does not store goods, ship them, deliver
                                them, or guarantee them, and does not intervene in the
                                performance of the transaction between merchant and
                                buyer, nor in the method of purchase, payment or receipt.
                            </>
                        )}
                    </Paragraph>
                </div>
                <Paragraph>
                    {isRTL ? 'وعليه، يُقرّ كلّ مستخدم — مشترٍ أو تاجر — بما يلي:' : 'Accordingly, every user — buyer or merchant — acknowledges the following:'}
                </Paragraph>
                <Bullets items={isRTL ? [
                    <><strong>TAKI ليست طرفاً</strong> في أيّ عقد بَين المشتري والتاجر، سواء عند الحجز أو الاستلام أو الدفع.</>,
                    <><strong>الحجز التزام مبدئيّ</strong> — لا دفع ولا حجز مبلغ على بطاقة المشتري.</>,
                    <><strong>الدفع يَتمّ مباشرة</strong> بين المشتري والتاجر في موقع التاجر، عند الاستلام، بالطريقة التي يَتّفقان عليها (نقد / بطاقة / تَحويل بنكيّ).</>,
                    <><strong>سياسة الاسترجاع والاستبدال محصورة بين التاجر والمشتري</strong>، وتَختلف من تاجر إلى آخر بحسب طبيعة عرضه. TAKI ليست طرفاً فيها، ولا تَضمنها، ولا تُنفِّذها، ولا تَتحمّل تَبعاتها. لكلّ متجر سياسته الخاصّة، ومسؤولية المشتري أن يَطّلع عليها قبل الحجز.</>,
                    <><strong>كلّ ادّعاء يَتعلّق بالعرض</strong> — جودة، سعر، توفّر، صلاحية، مُطابقة وصف، التزام التاجر بتسليمه — مسؤوليّة التاجر وحده.</>,
                    <><strong>كلّ ادّعاء يَتعلّق بالمشتري</strong> — حضوره، سلوكه، احترامه لشروط العرض، استخدامه السليم له — مسؤوليّة المشتري وحده.</>,
                    <><strong>التواصل بين الطرفين</strong> عبر شات الحجز هو تَيسير تقنيّ فقط. وللإدارة الحقّ في مُراقبة الرسائل عند الحاجة لضمان عدم مخالفة شروط الاستخدام، ولها الحقّ في حذف المحتوى المخالف والتصرّف بالصور المرفقة عند اللزوم.</>,
                    <><strong>لا توجد بين TAKI وأيّ تاجر أيّ علاقة شراكة، أو وكالة، أو استخدام، أو مشروع مشترك</strong>؛ وكلّ طرف مستقلّ تماماً عن الآخر.</>,
                ] : [
                    <><strong>TAKI is not a party</strong> to any contract between buyer and merchant — whether at booking, receipt or payment.</>,
                    <><strong>A booking is a preliminary commitment</strong> — there is no payment and no hold on the buyer's card.</>,
                    <><strong>Payment is made directly</strong> between buyer and merchant at the merchant's location, on receipt, by whatever means they agree (cash / card / bank transfer).</>,
                    <><strong>Returns and exchange policy is confined between merchant and buyer</strong>, and varies from one merchant to another depending on the nature of the offer. TAKI is not a party to it, does not guarantee it, does not implement it, and does not bear its consequences. Each store has its own policy, and it is the buyer's responsibility to review it before booking.</>,
                    <><strong>Every claim relating to the offer</strong> — quality, price, availability, validity, fitness for description, the merchant's obligation to deliver it — is the sole responsibility of the merchant.</>,
                    <><strong>Every claim relating to the buyer</strong> — attendance, conduct, compliance with offer conditions, proper use — is the sole responsibility of the buyer.</>,
                    <><strong>Communications between the two parties</strong> via the booking chat are a technical facilitation only. The administration has the right to monitor messages where necessary to ensure compliance with the Terms, and the right to remove non-compliant content and dispose of attached images as required.</>,
                    <><strong>There is no relationship of partnership, agency, employment or joint venture between TAKI and any merchant</strong>; each party is wholly independent of the other.</>,
                ]} />
            </Section>

            <Section n={5} title={isRTL ? 'آلية الحجز والدفع والاستلام' : 'Booking, payment and delivery mechanism'}>
                <Bullets items={isRTL ? [
                    'يَتصفّح المشتري العروض، يَختار ما يُناسبه، ويَضغط «احجز». يُسجَّل الحجز فوراً، يَصِل التاجر إشعار، ويَصِل المشتري تأكيد.',
                    'قد يَتضمّن العرض نسخاً بأسعار مختلفة واختيارات بإضافات سعرية يُحدّدها التاجر؛ يَظهر الإجمالي كاملاً للمشتري قبل تأكيد الحجز، ويَبقى الدفع مباشرةً للتاجر عند الاستلام.',
                    'مدّة صلاحية الحجز ساعتان من تأكيده (ما لم تُعلن المنصّة خلاف ذلك) — عند انتهائها دون استلام يُلغى الحجز تلقائياً وتُعاد الكمّية للعرض، دون أيّ التزام مالي على المشتري.',
                    'يَخضع الحجز لساعات عمل المحلّ المُعلَنة، ولحدود الحجز التي يَضبطها التاجر (حدّ أقصى للحجز الواحد، حدّ لكلّ مشترٍ، مدّة انتظار بين الحجوزات) — وتُطبَّق هذه الحدود آلياً.',
                    'يَستلم التاجر الحجز عبر لوحته ويَختار قبوله أو رفضه بحسب توفّر الكمّية وساعات العمل.',
                    'يَحضر المشتري إلى موقع التاجر خلال مدّة صلاحية العرض ليَستلم البضاعة أو يَحصل على الخدمة، ويَدفع الثمن للتاجر مباشرةً.',
                    'إن لم يَحضر المشتري خلال المدّة المُحدَّدة، يَحقّ للتاجر إلغاء الحجز.',
                    'تكرار عدم الحضور بدون عذر أو الحجز بدون نيّة الاستلام قد يُؤدّي إلى تَقييد حساب المشتري وفقاً لتقدير الإدارة.',
                    'يَلتزم الطرفان بأن تكون التعاملات في أماكن عامّة وآمنة، وبالتحقّق من هويّة الطرف الآخر قبل أيّ إجراء، وبفحص البضاعة قبل استلامها، وباستخدام وسائل الدفع المعتمَدة المُوضَّحة في إرشادات المنصّة.',
                    'يُمنع منعاً قاطعاً استخدام بيانات الاتصال المتاحة عبر المنصّة (الجوّال، الموقع، الشات) لأيّ غرض خارج تَنفيذ هذا الحجز تَحديداً، أو لمحاولة نقل التعامل خارج المنصّة، أو تَحويل العميل إلى قنوات أخرى — أيّ مخالفة تُعدّ إخلالاً جسيماً.',
                ] : [
                    'The buyer browses the offers, picks one that suits them, and taps «Book». The booking is recorded immediately; the merchant receives a notification and the buyer a confirmation.',
                    'An offer may include versions at different prices and options with priced add-ons set by the merchant; the full total is shown to the buyer before confirming the booking, and payment remains made directly to the merchant on receipt.',
                    'A booking is valid for two hours from confirmation (unless the platform announces otherwise) — if the window passes without pickup, the booking is cancelled automatically and the quantity returns to the offer, at no financial obligation on the buyer.',
                    'Booking is subject to the store\'s published working hours and to the limits set by the merchant (a cap per single booking, a cap per buyer, a waiting period between bookings) — these limits are enforced automatically.',
                    'The merchant receives the booking through their dashboard and chooses to accept or reject it based on quantity availability and operating hours.',
                    'The buyer visits the merchant\'s location within the offer window to collect the goods or receive the service, and pays the merchant directly.',
                    'If the buyer does not attend within the specified window, the merchant may cancel the booking.',
                    'Repeated unjustified no-shows, or booking without intent to attend, may lead to restrictions on the buyer\'s account at the administration\'s discretion.',
                    'Both parties undertake that dealings will take place in safe public locations, that they will verify the other party\'s identity before any action, that they will inspect goods before receipt, and that they will use the approved payment methods described in the platform\'s guidance.',
                    'It is strictly prohibited to use contact details obtained through the platform (mobile number, location, chat) for any purpose outside performing this specific booking, or to attempt to take the dealing off-platform, or to channel the customer elsewhere — any breach is a material default.',
                ]} />
            </Section>

            <Section n={6} title={isRTL ? 'الأسعار، المدفوعات، والفواتير' : 'Prices, payments and invoices'}>
                <Bullets items={isRTL ? [
                    'الأسعار المعروضة بالريال السعودي وتُعرَض كما يُحدّدها التاجر. التاجر مسؤول وحده عن دقّة السعر؛ وأيّ خطأ تَسعيريّ يَقع على عاتقه.',
                    'إصدار الفواتير الضريبية يَقع على التاجر (إن انطبق عليه) وفقاً لأنظمة هيئة الزكاة والضريبة والجمارك.',
                    'يُمنع التلاعب بالأسعار بأيّ شكل، أو رفعها صورياً لخصمها لاحقاً، أو الإعلان عن سعر ثمّ المطالبة بسعر أعلى عند الاستلام («طُعم وتَبديل»).',
                    'عند تَفعيل اشتراك مدفوع للتجار، تُعلَن الأسعار مسبقاً، ويتجدّد الاشتراك تلقائياً ما لم يوقف التاجر التجديد من إعدادات حسابه، وفق سياسة الاسترداد المنشورة على /refund.',
                ] : [
                    'Prices are displayed in Saudi Riyal as set by the merchant. The merchant is solely responsible for the accuracy of the price; any pricing error is borne by the merchant.',
                    'Issuing tax invoices is the merchant\'s responsibility (where applicable) in accordance with the rules of the Zakat, Tax and Customs Authority.',
                    'Manipulating prices in any form, inflating them artificially to discount them later, or advertising a price and then demanding a higher one at receipt («bait-and-switch»), is prohibited.',
                    'Where a paid merchant subscription is enabled, prices are disclosed in advance, and the subscription auto-renews unless the merchant turns off renewal from their account settings, under the Refund Policy published at /refund.',
                ]} />

                {/* v12.81 — بندا «الدفع المباشر لحساب التاجر» المعتمدان (الدرع
                    القانوني): نص العميل + اتفاقية التاجر — من data/legalTexts.ts
                    (مصدر واحد يظهر هنا وفي بطاقة بوابة التاجر). */}
                <Paragraph>
                    {isRTL ? (
                        <>
                            <strong>الدفع الإلكتروني المباشر لحساب التاجر:</strong>{' '}
                            {CLIENT_PAYMENT_TERMS}
                        </>
                    ) : (
                        <>
                            <strong>Direct online payment to the merchant's account:</strong>{' '}
                            The platform is a technical intermediary for listing and connection only, and is not a party
                            to any financial or service contract between buyer and merchant. Online payments — where
                            available — are made directly through independent payment gateways licensed by the Saudi
                            Central Bank and belonging to the merchant themselves; the amount moves from the buyer to the
                            merchant's own account without passing through the platform. The platform does not collect
                            funds, does not store card or payment data, and bears no responsibility for refund or
                            cancellation policies or product quality or conformity — every financial dispute is resolved
                            directly between the buyer, the merchant and the payment gateway. The tax invoice is issued
                            by the merchant in their capacity as the seller.
                        </>
                    )}
                </Paragraph>
                <Paragraph>
                    {isRTL ? (
                        <>
                            <strong>اتفاقية استخدام التاجر لبوابة الدفع</strong> (يوافق عليها التاجر
                            إلكترونياً وبشكل إلزامي قبل تفعيل بوابته):{' '}
                            {MERCHANT_GATEWAY_AGREEMENT}
                        </>
                    ) : (
                        <>
                            <strong>Merchant payment-gateway agreement</strong> (accepted electronically and mandatorily
                            before the merchant activates their gateway): the merchant acknowledges being first and last
                            responsible for: (1) their payment-gateway account and the accuracy and confidentiality of
                            the connection keys they enter, (2) collecting their funds directly into their own account,
                            (3) issuing ZATCA-compliant electronic invoices to customers, (4) handling refund requests,
                            disputes and chargebacks with the gateway and customers, (5) all gateway fees. The merchant
                            releases the platform from any claim or liability arising from payments and undertakes to
                            indemnify it for any damage caused by their breach of this agreement. The platform may
                            suspend the payment feature for any merchant at any time without prior notice.
                        </>
                    )}
                </Paragraph>
            </Section>

            <Section n={7} title={isRTL ? '🚫 المحتوى والعروض المحظورة قطعياً' : '🚫 Strictly prohibited content and offers'}>
                <Paragraph>
                    {isRTL ? (
                        <>
                            يُمنع منعاً قاطعاً نشر أو حَجز أو تَسويق أيّ من الأصناف التالية.
                            مخالفة هذا البند تُؤدّي إلى حذف العرض فوراً، تَعليق الحساب،
                            وإحالة المخالف للجهات الأمنية مع كامل بياناته:
                        </>
                    ) : (
                        <>
                            It is strictly prohibited to publish, book, or promote any of
                            the following. Breach of this clause results in immediate
                            removal of the offer, suspension of the account, and referral
                            of the offender to the security authorities together with their
                            full details:
                        </>
                    )}
                </Paragraph>
                <Bullets items={isRTL ? [
                    <><strong>كلّ ما تَحظره أنظمة المملكة العربية السعودية</strong> — حتى لو لم يُذكر صراحةً أدناه.</>,
                    <><strong>محتوى يُخالف الشريعة الإسلامية أو الذوق العامّ أو الآداب السعودية</strong>: إساءة دينية، إباحية، تَلميحات جنسيّة، إغراء بالفسق.</>,
                    <><strong>محتوى يُهدِّد الأمن الوطنيّ أو يُسيء للسياسة العامّة للدولة أو الشخصيّات المعتبَرة</strong>، أو يَدعم جماعات إرهابية، أو يُحرّض على العنف.</>,
                    <><strong>المقامرة بكلّ صُورها</strong>، اليانصيب، والمسابقات المخالفة لنظام التَراخيص.</>,
                    <><strong>الأوراق المالية</strong>: أسهم، سندات، صكوك، إدارة مَحافظ، عملات، تَسويق عملات رَقمية، وما يَدخل تَحت رقابة هيئة السوق المالية.</>,
                    <><strong>التَقسيط والمنتجات البنكية</strong> بكلّ أشكالها — حتى لو كانت متوافقة شرعياً.</>,
                    <><strong>التَسويق الشبكيّ (التَسويق الهرميّ)</strong> بأيّ شكل أو طريقة، حتى إن قَدَّم نفسه على غير ذلك.</>,
                    <><strong>الأسلحة والذخائر والمتفجّرات</strong>، بما فيها الصواعق والمسدّسات والمدى البيضاء وأسلحة الحماية الشخصية ومستلزماتها — حتى لو كانت مُرخَّصة.</>,
                    <><strong>الخمر، التَبغ، المُعسّل، المخدّرات، المؤثّرات العقلية، المسكّنات والمنوّمات بأنواعها</strong>، وكلّ ما يَحظره نظام مكافحة المخدّرات.</>,
                    <><strong>الأدوية والمنتجات الطبّية والصحية الموصوفة بوصفة طبيب</strong> أو الخاضعة لرقابة هيئة الغذاء والدواء.</>,
                    <><strong>المنتجات الجنسيّة</strong> بكلّ أشكالها وأنواعها.</>,
                    <><strong>أجهزة التَجسّس والتَنصّت والتَشويش والتَشفير وتَقوية إشارات الجوّال</strong>، وأجهزة الليزر، والأجهزة ذات المخاطر الأمنية.</>,
                    <><strong>السلع المُقلَّدة أو المسروقة</strong>، والمنتجات التي تَنتهك حقوق الملكية الفكرية (برامج منسوخة، أفلام منسوخة، علامات تجارية لا يَملكها المُعلِن).</>,
                    <><strong>الأطعمة الفاسدة أو منتهية الصلاحية</strong>، والمنتجات التي يَعلم بائعها بعيوبها ولم يُفصِح عنها.</>,
                    <><strong>الكائنات الحيّة أو النافقة وأجزاؤها</strong> (ما عدا الأطعمة المُعدّة بشكل مشروع في مَطاعم ومحلّات مُرخَّصة).</>,
                    <><strong>المواد الكيميائية الخطرة والغازات والسوائل الملتهبة</strong>.</>,
                    <><strong>القسائم غير القابلة للتحويل المُسوَّقة على أنّها قابلة للتحويل</strong>.</>,
                    <><strong>المنتجات والخدمات التي تَتطلّب تَرخيصاً نظامياً دون أن يَحوزه التاجر</strong> (مثل خدمات الاستقدام دون تَرخيص وزارة الموارد البشرية، والخدمات السياحية دون تَرخيص وزارة السياحة، والخدمات الهندسية دون تَرخيص الهيئة السعودية للمهندسين، وغير ذلك).</>,
                    <><strong>الخدمات والأنشطة المتعلّقة بالحياة الفطرية والمياه</strong> دون التَراخيص الصادرة عن الجهات المختصّة (المركز الوطني لحماية الحياة الفطرية، المركز الوطني لكفاءة وترشيد المياه).</>,
                    <><strong>أيّ محتوى يَنتهك أنظمة حقوق الإنسان والاتجار بالأشخاص</strong>: التَلميح لبيع/شراء عمالة، إساءة لكرامة العمّال، نشر بياناتهم الشخصية، تَحميلهم تكاليف نقل الخدمة. تَلتزم المنصّة بالتعاون الكامل مع هيئة حقوق الإنسان السعودية في رصد وإيقاف أيّ محتوى من هذا النوع.</>,
                    <><strong>أيّ محتوى يَستهدف القاصرين بشكل ضارّ</strong>: تَحرّش، استغلال، تَنمّر، أو محتوى يُخاطب غرائزهم أو يُروّج لسلوك مُخالف للشريعة. تُحال أيّ مخالفة من هذا النوع فوراً للجهات المختصّة (وزارة الموارد البشرية والتنمية الاجتماعية، هيئة حقوق الإنسان).</>,
                    <><strong>التَسوّل ومساعدة المتسوّلين</strong>، وإعلانات التبرّع وطلب المساعدات خارج النطاق القانوني المُحدَّد للأعمال الخيرية في المملكة.</>,
                    <><strong>غسل الأموال</strong> أو تَمويل الإرهاب — تُبلَّغ فوراً وحدة التحرّيات المالية بموجب أنظمة مكافحة غسل الأموال.</>,
                    <><strong>السبام والإعلانات المتطفّلة</strong>: تَكرار الرسائل، نَشر روابط خارجية، استغلال نظام الإشعارات أو التَنبيهات.</>,
                    <><strong>محاولات التحايل التقنيّ</strong>: الوصول غير المشروع، استخراج البيانات (scraping)، هجمات الحرمان من الخدمة، استغلال الثغرات، تشغيل bots دون إذن.</>,
                    <><strong>جَمع بيانات المستخدمين الآخرين دون موافقتهم</strong> أو الإفصاح عنها لأيّ طرف بمقابل أو دونه — بما يُخالف نظام حماية البيانات الشخصية.</>,
                    <><strong>الاتجار بالبشر واستغلالهم</strong>: تَحظر المنصّة كلّ أشكال الاتجار بالأشخاص والأعضاء، استناداً إلى المعايير المحلّية والدولية بما فيها بروتوكول باليرمو. ويُحال المحتوى المخالف إلى هيئة حقوق الإنسان السعودية (<a href="https://www.hrc.gov.sa" target="_blank" rel="noopener noreferrer" className="text-emerald-600 font-bold underline">hrc.gov.sa</a>) فوراً مع إيقاف حساب المُخالف.</>,
                    <><strong>أيّ محتوى يَتضمّن تَحرّشاً بالقاصرين أو استغلالاً لهم أو تَنمّراً عليهم</strong>، أو ألفاظاً مُهينة لكرامتهم، أو محتوى مُوجَّه للأطفال يُخالف الشريعة الإسلامية أو النظام العامّ أو الآداب. ويُبلَّغ عن المخالفات لوزارة الموارد البشرية والتنمية الاجتماعية وهيئة حقوق الإنسان.</>,
                    <><strong>التَحرّش بالنساء والفتيات أو ابتزازهنّ أو التَنمّر عليهنّ</strong>: تَلتزم المنصّة بتَوفير بيئة آمنة وتُتاح أدوات الحظر الفوريّ والإبلاغ، وعلى المُتضرّرة الإبلاغ عبر «📣 الشكاوى» ورفع شكوى لدى الجهات الأمنية لحماية حقوقها.</>,
                    <><strong>التَمييز أو التَهديد أو الإساءة أو التَنمّر بسبب الدين أو العرق أو الجنس أو الجنسية</strong> — سواء في المحتوى المنشور أو عبر الشات — تُحال المخالفات لذوي الاختصاص ويُعلَّق الحساب فوراً.</>,
                ] : [
                    <><strong>Anything prohibited by the laws of the Kingdom of Saudi Arabia</strong> — even if not expressly listed below.</>,
                    <><strong>Content contrary to Islamic Sharia, public taste or Saudi mores</strong>: religious insults, pornography, sexual innuendo, or incitement to vice.</>,
                    <><strong>Content threatening national security, defaming the State's public policy or recognised figures</strong>, supporting terrorist groups, or inciting violence.</>,
                    <><strong>Gambling in all its forms</strong>, lotteries, and competitions in breach of the licensing regime.</>,
                    <><strong>Securities</strong>: shares, bonds, sukuk, portfolio management, currencies, and the marketing of digital currencies and anything falling under the Capital Market Authority's supervision.</>,
                    <><strong>Instalment plans and banking products</strong> in all their forms — even if Sharia-compliant.</>,
                    <><strong>Network (pyramid) marketing</strong> in any shape or form, even if presented under a different name.</>,
                    <><strong>Weapons, ammunition and explosives</strong>, including detonators, firearms, bladed weapons, personal-protection weapons and their accessories — even if licensed.</>,
                    <><strong>Alcohol, tobacco, hookah products, drugs, psychotropic substances, sedatives and hypnotics</strong>, and anything prohibited by the Anti-Narcotics Law.</>,
                    <><strong>Medicines and medical/health products requiring a doctor's prescription</strong>, or subject to the supervision of the Saudi Food &amp; Drug Authority.</>,
                    <><strong>Sexual products</strong> in all their forms and types.</>,
                    <><strong>Surveillance, eavesdropping, jamming, cryptographic and mobile signal-boosting devices</strong>, laser devices, and devices posing security risks.</>,
                    <><strong>Counterfeit or stolen goods</strong>, and products infringing intellectual property rights (copied software, copied films, trademarks the advertiser does not own).</>,
                    <><strong>Spoiled or expired foodstuffs</strong>, and products whose seller is aware of defects but has not disclosed them.</>,
                    <><strong>Live or dead organisms and their parts</strong> (other than food lawfully prepared in licensed restaurants and shops).</>,
                    <><strong>Hazardous chemicals, gases and flammable liquids</strong>.</>,
                    <><strong>Non-transferable vouchers marketed as transferable</strong>.</>,
                    <><strong>Products and services requiring a regulatory licence which the merchant does not hold</strong> (such as recruitment services without a Ministry of Human Resources licence, tourism services without a Ministry of Tourism licence, engineering services without a Saudi Council of Engineers licence, and so on).</>,
                    <><strong>Services and activities relating to wildlife and water</strong> without the licences issued by the competent authorities (National Centre for Wildlife, National Water Efficiency Centre).</>,
                    <><strong>Any content infringing human rights and anti-trafficking laws</strong>: hints at buying/selling labour, contempt for workers' dignity, publishing their personal data, or charging them the cost of transferring service. The platform commits to full cooperation with the Saudi Human Rights Commission to monitor and remove any such content.</>,
                    <><strong>Any content targeting minors harmfully</strong>: harassment, exploitation, bullying, or content addressing their instincts or promoting Sharia-contrary behaviour. Such breaches are referred immediately to the competent authorities (Ministry of Human Resources &amp; Social Development, Human Rights Commission).</>,
                    <><strong>Begging and helping beggars</strong>, donation appeals and requests for assistance outside the legal framework set for charitable work in the Kingdom.</>,
                    <><strong>Money laundering</strong> or financing of terrorism — reported immediately to the Financial Investigations Unit under the Anti-Money Laundering laws.</>,
                    <><strong>Spam and intrusive advertising</strong>: repeated messaging, posting external links, or abuse of the notifications or alerts system.</>,
                    <><strong>Technical circumvention attempts</strong>: unauthorised access, data scraping, denial-of-service attacks, exploitation of vulnerabilities, running bots without permission.</>,
                    <><strong>Collecting data on other users without their consent</strong>, or disclosing it to any party for or without consideration — in breach of the Personal Data Protection Law.</>,
                    <><strong>Human trafficking and exploitation</strong>: the platform prohibits all forms of trafficking in persons and organs, based on domestic and international standards including the Palermo Protocol. Non-compliant content is referred to the Saudi Human Rights Commission (<a href="https://www.hrc.gov.sa" target="_blank" rel="noopener noreferrer" className="text-emerald-600 font-bold underline">hrc.gov.sa</a>) immediately and the offender's account is suspended.</>,
                    <><strong>Any content involving harassment, exploitation or bullying of minors</strong>, language insulting to their dignity, or content directed at children that breaches Islamic Sharia, public order or morality. Breaches are reported to the Ministry of Human Resources &amp; Social Development and the Human Rights Commission.</>,
                    <><strong>Harassment, extortion or bullying of women and girls</strong>: the platform is committed to providing a safe environment with immediate blocking and reporting tools. Affected parties should report via «📣 Complaints» and file a complaint with the security authorities to protect their rights.</>,
                    <><strong>Discrimination, threats, abuse or bullying on grounds of religion, race, gender or nationality</strong> — whether in published content or via chat — are referred to the competent authorities and the account is suspended immediately.</>,
                ]} />
                <Paragraph>
                    {isRTL ? (
                        <>
                            <strong>القائمة أعلاه ليست حصرية</strong>؛ وأيّ محتوى يُخالف
                            الأنظمة السعودية أو الذوق العامّ يُعتبر محظوراً ولو لم يُذكر
                            صراحةً، وتَحتفظ الإدارة بسلطة تَقديرية مُطلقة في تَحديد ذلك.
                        </>
                    ) : (
                        <>
                            <strong>The list above is not exhaustive</strong>; any content
                            contravening Saudi laws or public taste is deemed prohibited
                            even if not expressly listed, and the administration retains
                            absolute discretionary authority to determine the same.
                        </>
                    )}
                </Paragraph>
            </Section>

            <Section n={8} title={isRTL ? '🚧 السلوكيّات المحظورة على المنصّة' : '🚧 Prohibited conduct on the platform'}>
                <Paragraph>{isRTL ? 'عند استخدامك للخدمات، تَتعهّد بألّا تَقوم بـ:' : 'When using the services, you undertake not to:'}</Paragraph>
                <Bullets items={isRTL ? [
                    'خرق أيّ نظام معمول به في المملكة أو محاولة الالتفاف عليه.',
                    'استخدام بيانات الاتصال المتاحة عبر المنصّة للترويج لأنشطة خارجها، أو تَحويل العميل إلى قنوات بديلة.',
                    'التلاعب بالأسعار أو في طريقة عرض العروض في نتائج البحث، أو إنشاء حجوزات صورية لرفع التقييم.',
                    'التدخّل في عروض أو حسابات المستخدمين الآخرين بأيّ صورة.',
                    'القيام بأيّ فعل يُقلِّل من تَقييم المنصّة أو يُسيء لسمعتها أو لنظام التَصنيف فيها — في المنصّة أو على وسائل التواصل الاجتماعي. وتَحتفظ المنصّة بحقّ الرجوع عليك بكلّ الأضرار المُترتّبة على ذلك.',
                    'انتحال شخصية المنصّة أو ممثّليها أو موظّفيها أو أيّ صفة تُوحي بتَبعيتك لها دون إذن خطّيّ.',
                    'نشر محتوى تَشهيريّ أو افترائيّ أو مُسيء لأيّ شخص أو جهة.',
                    'نَقل أو بَيع أو تَأجير حسابك إلى طرف آخر دون موافقة خطّية مُسبقة من الإدارة.',
                    'إرسال رسائل عشوائية، أو إعلانات داخل الردود والرسائل الخاصّة، أو روابط احتيالية.',
                    'نَشر فيروسات أو برمجيات خبيثة، أو أيّ تقنية تَضرّ بالمنصّة أو مستخدميها.',
                    'انتهاك حقوق الملكية الفكرية الخاصّة بالمنصّة أو بأيّ مستخدم آخر أو طرف ثالث، بما فيها حقوق الطبع والنشر والعلامات التجارية وبراءات الاختراع وقواعد البيانات.',
                    'نَسخ محتوى أو عروض من المنصّة وإعادة نَشرها على مواقع أخرى. ويَحقّ للمنصّة عند رصد ذلك التوجّه للجهات المختصّة لرفع دعوى بموجب أنظمة مكافحة جرائم المعلوماتية وأنظمة حماية الملكية الفكرية.',
                    'الالتفاف على أيّ إجراء تقنيّ وقائيّ تَطبّقه المنصّة لحماية خدماتها.',
                    'استخدام المنصّة عبر أيّ وسيلة آلية (bot) دون إذن صريح من الإدارة، باستثناء عناكب المحرّكات المعروفة (Google، Bing، إلخ.) لأغراض الفهرسة المشروعة.',
                    <>(للتاجر) عدم تَنفيذ عرض مَحجوز دون مُبرّر معتمَد في سياسته، أو رفض المشتري الذي حَجز بشكل صحيح.</>,
                    <>(للمشتري) الحَجز المُتكرّر دون نيّة الحضور، أو إساءة استخدام نظام البلاغات بشكل كَيدي، أو إساءة معاملة التاجر.</>,
                ] : [
                    'Breach or attempt to circumvent any law in force in the Kingdom.',
                    'Use the contact details available through the platform to promote off-platform activities, or to channel the customer to alternative platforms.',
                    'Manipulate prices or the way offers are surfaced in search results, or create sham bookings to inflate ratings.',
                    'Interfere with other users\' offers or accounts in any form.',
                    'Take any action that degrades the platform\'s reputation or its ratings system — whether on the platform or on social media. The platform reserves the right to recover from you all damages resulting from this.',
                    'Impersonate the platform, its representatives or staff, or assume any capacity suggesting affiliation with it, without written permission.',
                    'Publish defamatory, slanderous or insulting content against any person or entity.',
                    'Transfer, sell or lease your account to another party without prior written consent from the administration.',
                    'Send spam messages, inject advertising into replies or private messages, or fraudulent links.',
                    'Distribute viruses or malware, or any technology harmful to the platform or its users.',
                    'Infringe the intellectual property rights of the platform or any other user or third party, including copyright, trademarks, patents and databases.',
                    'Copy content or offers from the platform and republish them on other websites. The platform may, on detection, approach the competent authorities to file an action under the Anti-Cyber Crime Law and intellectual property laws.',
                    'Circumvent any technical protective measure applied by the platform to protect its services.',
                    'Use the platform through any automated means (bots) without express permission from the administration, except for well-known search-engine crawlers (Google, Bing, etc.) for legitimate indexing.',
                    <>(Merchant) Failure to fulfil a booked offer without grounds accepted under the merchant\'s policy, or refusal of a buyer who has properly booked.</>,
                    <>(Buyer) Repeated bookings without intent to attend, abuse of the reports system in bad faith, or mistreatment of the merchant.</>,
                ]} />
            </Section>

            <Section n={9} title={isRTL ? '⚖️ تَحمّل المستخدم للمسؤولية الكاملة' : '⚖️ The user\'s full assumption of responsibility'}>
                <Paragraph>{isRTL ? 'كلّ مستخدم — مشترٍ أو تاجر — يُقرّ ويُوافق صراحةً على ما يلي:' : 'Every user — buyer or merchant — expressly acknowledges and agrees to the following:'}</Paragraph>
                <Bullets items={isRTL ? [
                    'هو وَحده المسؤول جنائياً ومدنياً عن أيّ محتوى يَنشره، وأيّ فعل يَرتكبه، وأيّ معاملة يُجريها عبر المنصّة.',
                    'يَتحمّل أيّ تَعويض، غرامة، رسوم محاماة، أو ضرر معنويّ يَنشأ عن أفعاله — تجاه TAKI أو أيّ طرف آخر.',
                    'يُعفي TAKI ومالكها وموظفيها ومستشاريها والشركات التابعة لها وممثّليها من أيّ مطالبة من أيّ طرف ثالث ناتجة عن أفعاله.',
                    'يَتنازل صراحةً عن أيّ حقّ في رَفع دعوى ضدّ TAKI بسبب فعل قام به مُستخدم آخر؛ حقّه يَقع على ذلك المُستخدم وحده.',
                    'إذا تَكبّدت TAKI أيّ تكاليف قانونية أو أتعاب محاماة أو غرامات بسبب فعل من المُستخدم أو مطالبة طرف ثالث ناشئة عنه، يَلتزم المُستخدم بتعويض TAKI عن كامل تلك التكاليف.',
                    'بإستخدامك للمنصّة، فإنّك تُخوِّل TAKI حفظ بياناتك ومعلوماتك على خوادمها، ومراجعتها، والاطّلاع عليها عند اللزوم لحماية المنصّة.',
                ] : [
                    'They alone are criminally and civilly responsible for any content they publish, any act they commit, and any transaction they make through the platform.',
                    'They bear any compensation, fine, lawyers\' fees, or moral damages arising from their acts — to TAKI or any other party.',
                    'They release TAKI, its owner, staff, advisers, affiliates and representatives from any third-party claim arising from their acts.',
                    'They expressly waive any right to bring an action against TAKI on account of an act of another user; their recourse lies against that user alone.',
                    'If TAKI incurs any legal costs, lawyers\' fees or fines because of a user\'s act or a third-party claim arising from it, the user undertakes to indemnify TAKI for the full amount of those costs.',
                    'By using the platform, you authorise TAKI to retain your data and information on its servers, to review them, and to access them where necessary to protect the platform.',
                ]} />
            </Section>

            <Section n={10} title={isRTL ? '🛡️ الحماية من الاحتيال — مسؤولية مُشتركة' : '🛡️ Fraud protection — a shared responsibility'}>
                <Paragraph>
                    {isRTL ? (
                        <>
                            تَسعى TAKI لتوفير بيئة آمنة قَدر الإمكان، وتُوفّر للمستخدم أدوات
                            للحدّ من الاحتيال (الحظر، الإبلاغ، تَقييم الأعضاء، حذف الروابط
                            الخارجية المشبوهة)، لكن <strong>مسؤولية تجنّب الاحتيال تَقع على
                            المستخدم نفسه</strong>. ولتَجنّب التَعرّض للاحتيال:
                        </>
                    ) : (
                        <>
                            TAKI seeks to provide as safe an environment as possible and
                            gives users tools to limit fraud (blocking, reporting, user
                            rating, removal of suspicious external links), but{' '}
                            <strong>the responsibility for avoiding fraud rests on the
                            user themselves</strong>. To avoid being defrauded:
                        </>
                    )}
                </Paragraph>
                <Bullets items={isRTL ? [
                    'تَأكّد من هوية الطرف الآخر قبل أيّ تَعامل.',
                    'اجعل التعامل وَجهاً لوَجه قَدر الإمكان، في مكان عامّ وآمن.',
                    'إذا تَعذّر اللقاء، استخدم وسائل دفع آمنة معتمَدة (مثل خدمات الضمان البنكية المُرخَّصة).',
                    'افحص البضاعة قبل الدفع، وتَأكّد من خلوّها من العيوب.',
                    'لا تُشارك بياناتك الشخصية أو رموز التحقّق أو كلمات المرور مع أحد، مهما كان السبب أو الإغراء.',
                    'لا تَفتح روابط مشبوهة تَصلك من خارج المنصّة، حتى لو أكّد الطرف الآخر أنّها آمنة.',
                    'لا تَدفع لشخص لا تَعرفه بناءً على وعد بوظيفة أو عمولة أو استثمار.',
                    'لا تَنقل التعامل خارج المنصّة بطلب من الطرف الآخر — هذا غالباً مؤشّر احتيال.',
                ] : [
                    'Verify the identity of the other party before any dealing.',
                    'Where possible, conduct the dealing face-to-face in a safe public place.',
                    'If a meeting is impossible, use approved secure payment methods (such as licensed escrow services).',
                    'Inspect the goods before paying and ensure they are free of defects.',
                    'Do not share your personal data, verification codes or passwords with anyone, whatever the reason or inducement.',
                    'Do not open suspicious links from outside the platform, even if the other party claims they are safe.',
                    'Do not pay a person you do not know on the promise of a job, commission or investment.',
                    'Do not take the dealing off-platform at the other party\'s request — that is often a fraud signal.',
                ]} />
                <Paragraph><strong>{isRTL ? 'عند الاشتباه بالتعرّض للاحتيال:' : 'If you suspect you have been defrauded:'}</strong></Paragraph>
                <Bullets items={isRTL ? [
                    'بلّغ فوراً عبر «📣 الشكاوى / تواصل الإدارة» داخل التطبيق وارفع بلاغاً على المُستخدم المخالف عبر «🚩 إبلاغ».',
                    'تَوجّه إلى أقرب مَركز شرطة وارفع شكوى رسمية ضدّ الطرف المُحتال.',
                    'TAKI ليست طرفاً في النزاع، ولا تَتحمّل تَبعاته، لكنّها تَتعاون مع الجهات الأمنية وتُقدّم البيانات المُتاحة لديها عند ورود طلب رَسميّ. كما تَلتزم بإيقاف الحسابات المُتورّطة وإدراجها في قائمة الحسابات المحظورة لحماية المستخدمين الآخرين.',
                    'تَتعهّد بعدم نَشر تَفاصيل الواقعة على وسائل التواصل الاجتماعي قبل صدور قرار رسميّ من الجهة المختصّة — احتراماً لقَرينة البَراءة وحَقّ الردّ.',
                ] : [
                    'Report immediately via «📣 Complaints / Contact the Admin» inside the app and raise a report against the offending user via «🚩 Report».',
                    'Visit the nearest police station and lodge a formal complaint against the fraudster.',
                    'TAKI is not a party to the dispute and bears no consequences for it, but it cooperates with the security authorities and provides the available data on receipt of an official request. It also undertakes to suspend the accounts involved and place them on the list of banned accounts to protect other users.',
                    'You undertake not to publish details of the incident on social media before an official decision is issued by the competent authority — out of respect for the presumption of innocence and the right of reply.',
                ]} />
            </Section>

            <Section n={11} title={isRTL ? '📝 نظام التقييمات والتعليقات' : '📝 Ratings and reviews system'}>
                <Bullets items={isRTL ? [
                    'يُوافق المُستخدم على ظهور التقييمات والتعليقات للعموم — سواء كانت إيجابية أو سَلبية — على أنّها تَعبير عن آراء مُرسليها.',
                    'TAKI لا تَتحمّل مسؤولية محتوى التقييمات، ولا تَلتزم بحذف أو تَعديل أيّ تَقييم بناءً على طلب مَن وَجَّه إليه.',
                    'المسؤولية الكاملة عن محتوى التَقييم تَقع على ناشره — مدنياً وجنائياً.',
                    'يَحقّ للإدارة، وَفق سلطتها التَقديرية، إيقاف أيّ مُستخدم يَثبت تَلاعبه بنظام التقييمات (تَقييمات وَهمية، تَواطؤ مع آخرين، إدخال معلومات كاذبة)، ومنعه من استخدام المنصّة.',
                    'يُمنع المُستخدمون من تَعليقات الإعلان في الردود، أو السبّ والشتم، أو البخس بدون مُبرّر، أو إضافة محتوى لا يَتعلّق بالعرض. وتُحذف هذه التعليقات وقد يُعلَّق حساب المُخالف.',
                    'لكلّ مشترٍ تَقييم واحد لكلّ متجر، ويَحقّ له تَعديله أو حذفه في أيّ وقت، وللتاجر حقّ الردّ عليه علناً.',
                    'تصويت «أصالة المنتج» متاح فقط لمن أتمّ حجزاً فعلياً، ويُعبّر عن رأي صاحبه وحده، ويُعرض مجموعه للعموم — وتَسري عليه نفس أحكام التقييمات أعلاه.',
                ] : [
                    'The user agrees that ratings and reviews are public — whether positive or negative — as expressions of the views of their authors.',
                    'TAKI bears no responsibility for the content of ratings, and is not bound to delete or amend any rating at the request of its subject.',
                    'Full responsibility for the content of a rating lies with its publisher — civilly and criminally.',
                    'The administration may, at its discretion, suspend any user proven to be manipulating the ratings system (fake ratings, collusion with others, false information) and bar them from the platform.',
                    'Users are prohibited from advertising in replies, from abuse and insults, from baseless disparagement, or from adding content unrelated to the offer. Such comments are removed and the offender\'s account may be suspended.',
                    'Each buyer has one rating per store, which they may edit or delete at any time, and the merchant has the right to reply to it publicly.',
                    'The «product authenticity» vote is available only to buyers who have completed a real booking; it expresses the voter\'s own opinion alone, its tally is displayed publicly, and the same rating provisions above apply to it.',
                ]} />
            </Section>

            <Section n={12} title={isRTL ? '🛡️ إخلاء المسؤولية الشامل' : '🛡️ Comprehensive disclaimer of liability'}>
                <Paragraph>
                    {isRTL ? (
                        <>
                            تُقدَّم خدمات TAKI <strong>«كما هي»</strong> و«كما تَتاح» دون أيّ
                            ضمانات صريحة أو ضمنية. ولا تَتحمّل TAKI تَحت أيّ ظرف ولأيّ سبب
                            أيّ مسؤولية عن:
                        </>
                    ) : (
                        <>
                            TAKI's services are provided <strong>«as is»</strong> and «as
                            available», without any express or implied warranties. TAKI
                            bears no responsibility under any circumstance or for any
                            reason for:
                        </>
                    )}
                </Paragraph>
                <Bullets items={isRTL ? [
                    'المعاملات بين المشتري والتاجر: جودة، توفّر، تَسليم، سعر، صلاحية، أو أيّ خلاف حول العرض.',
                    'المحتوى المنشور من المستخدمين: TAKI ناقل وسيط، ولا تُراجع المحتوى قبل النشر.',
                    'الأخطاء التقنية، انقطاع الخدمة، فقد البيانات، تأخّر الإشعارات، أو أيّ عَطل في البنية التحتية.',
                    'الأضرار غير المباشرة: ربح فائت، فرصة ضائعة، أضرار سُمعة، تكاليف اعتمدتَ فيها على معلومات في المنصّة.',
                    'الأفعال الجنائية أو المُخالفة التي يَرتكبها مُستخدمون آخرون.',
                    'البلاغات المُقدَّمة: تُراجَع وَفق سلطة الإدارة التَقديرية، ولا تَلتزم TAKI بصحّتها ولا بنتائجها.',
                    'الاختراق والسرقة الإلكترونية: نطبّق معايير حماية مَعقولة تجارياً، لكن لا يُمكن ضمان حماية مطلقة.',
                    'محتوى الأطراف الثالثة: الروابط، خرائط OpenStreetMap، خدمات الدفع، خدمات تَسجيل الدخول.',
                    'تَلف أجهزة المُستخدم أو فقد بياناته الشخصية على جهازه بسبب استخدام المنصّة.',
                    'الفترة التي تَظهر فيها قوائم التاجر، أو ترتيبها في نتائج البحث، أو تَغيير الخوارزميّات.',
                ] : [
                    'Transactions between buyer and merchant: quality, availability, delivery, price, validity, or any dispute concerning the offer.',
                    'Content published by users: TAKI is a transmissive intermediary and does not review content before publication.',
                    'Technical errors, service interruption, loss of data, delayed notifications, or any infrastructure outage.',
                    'Indirect damages: lost profit, lost opportunity, reputational damage, or expenses incurred in reliance on information on the platform.',
                    'Criminal or unlawful acts committed by other users.',
                    'Reports made: reviewed at the administration\'s discretion; TAKI is not bound by their accuracy nor by their outcomes.',
                    'Hacking and cyber-theft: we apply commercially reasonable protection standards, but absolute security cannot be guaranteed.',
                    'Third-party content: links, OpenStreetMap maps, payment services, sign-in services.',
                    'Damage to the user\'s devices or loss of the user\'s personal data on their device caused by use of the platform.',
                    'The period for which a merchant\'s listings appear, their ranking in search results, or changes in the algorithms.',
                ]} />
                <Paragraph>
                    {isRTL ? (
                        <>
                            <strong>الحدّ الأقصى لمسؤولية TAKI</strong> — إن ثَبتت قَضائياً
                            — هو أقلّ قيمة من بين:
                        </>
                    ) : (
                        <>
                            <strong>TAKI's maximum liability</strong> — if judicially
                            established — is the lower of:
                        </>
                    )}
                </Paragraph>
                <Bullets items={isRTL ? [
                    'إجمالي ما دَفعه المُستخدم لـ TAKI خلال الـ 12 شهراً السابقة على واقعة المسؤولية.',
                    'مبلغ مَقطوع مقداره ثلاثمائة (300) ريال سعوديّ.',
                ] : [
                    'The total of what the user has paid TAKI in the 12 months preceding the event giving rise to the liability.',
                    'A capped amount of three hundred (SAR 300) Saudi Riyals.',
                ]} />
                <Paragraph>
                    {isRTL ? (
                        <>
                            وللمستخدمين الذين يَستخدمون المنصّة مجاناً، يكون الحدّ الأقصى{' '}
                            <strong>صفر ريال</strong>. ولا يَحُدّ هذا البند من المسؤوليات
                            التي لا يَجوز نظاماً الإعفاء منها (الاحتيال المُتعمَّد، الإصابة
                            الجسدية الناتجة عن إهمال جسيم).
                        </>
                    ) : (
                        <>
                            For users using the platform free of charge, the cap is{' '}
                            <strong>zero Riyals</strong>. This clause does not limit
                            liabilities that may not be excluded by law (intentional
                            fraud, physical injury caused by gross negligence).
                        </>
                    )}
                </Paragraph>
            </Section>

            <Section n={13} title={isRTL ? '🤝 تَعويض TAKI (Indemnity)' : '🤝 Indemnity to TAKI'}>
                <Paragraph>
                    {isRTL ? (
                        <>
                            يَلتزم كلّ مُستخدم بتعويض TAKI ومالكها وموظفيها ومستشاريها
                            والشركات التابعة لها وممثّليها، وحمايتهم من أيّ مطالبة، دعوى،
                            خسارة، ضرر، تكاليف، أو نفقات (بما فيها أتعاب المحاماة المعقولة)
                            تَنشأ عن:
                        </>
                    ) : (
                        <>
                            Every user undertakes to indemnify TAKI, its owner, staff,
                            advisers, affiliates and representatives, and to hold them
                            harmless from any claim, action, loss, damage, costs or
                            expenses (including reasonable lawyers' fees) arising from:
                        </>
                    )}
                </Paragraph>
                <Bullets items={isRTL ? [
                    'أيّ ادّعاء يُقدّمه طرف ثالث بسبب استخدامك للمنصّة.',
                    'مخالفتك لأيّ بند من بنود هذه الوثيقة أو الوثائق القانونية الأخرى.',
                    'مخالفتك لأيّ نظام سعوديّ معمول به.',
                    'المحتوى الذي تَنشره أو العروض التي تُدرجها أو الأفعال التي تَرتكبها — إن انتهكت حقوق الغير أو احتوت على افتراء أو قذف.',
                    'أيّ غرامة أو عقوبة تُفرَض على TAKI بسبب نشاطك.',
                ] : [
                    'Any claim brought by a third party because of your use of the platform.',
                    'Your breach of any clause of this document or of the other Legal Documents.',
                    'Your breach of any Saudi law in force.',
                    'Content you publish, offers you list, or acts you commit — where they infringe the rights of others or contain slander or defamation.',
                    'Any fine or penalty imposed on TAKI because of your activity.',
                ]} />
            </Section>

            <Section n={14} title={isRTL ? 'حقوق الملكية الفكرية' : 'Intellectual property rights'}>
                <Bullets items={isRTL ? [
                    'الاسم التجاري «TAKI» وشعارها وتَصميم الواجهات والكود البرمجيّ وقاعدة البيانات والمحتوى التحريريّ — كلّها ملك حصريّ للمنصّة.',
                    'يُمنع نَسخ أو تَفكيك (reverse engineering) أو استخراج أو إعادة استخدام أيّ جزء من المنصّة دون إذن خطّيّ مُسبق.',
                    'يُمنع استخدام علامة «TAKI» أو شعارها دون موافقة خطّية.',
                    'المحتوى الذي يَنشره المُستخدمون يَبقى ملكاً لناشره، لكنّه — بنشره — يَمنح TAKI تَرخيصاً عالمياً غير حصريّ، قابلاً للنقل، مجانياً، لاستخدامه في تَشغيل الخدمات وعرضها.',
                    'كلّ حقّ لم يُمنَح صراحةً للمُستخدم في هذه الشروط يَبقى محفوظاً للمنصّة.',
                ] : [
                    'The trade name «TAKI», its logo, interface design, source code, database and editorial content — are all the exclusive property of the platform.',
                    'Copying, reverse engineering, extracting or reusing any part of the platform without prior written permission is prohibited.',
                    'Use of the «TAKI» mark or its logo without written consent is prohibited.',
                    'Content published by users remains the property of its publisher, but — by publishing it — they grant TAKI a worldwide, non-exclusive, transferable, royalty-free licence to use it for operating and displaying the services.',
                    'Every right not expressly granted to the user in these Terms is reserved to the platform.',
                ]} />
            </Section>

            <Section n={15} title={isRTL ? '🛠️ صلاحيّات الإدارة' : '🛠️ Administration powers'}>
                <Paragraph>{isRTL ? 'للإدارة الحقّ المُطلق — دون إشعار مُسبق ودون أيّ تَعويض — في:' : 'The administration has the absolute right — without prior notice and without any compensation — to:'}</Paragraph>
                <Bullets items={isRTL ? [
                    'حذف أو إخفاء أيّ محتوى تَراه مُخالفاً أو مَشكوكاً فيه، أو ضعيف الجودة، أو ناقص التفاصيل، أو في القسم الخطأ.',
                    'تَعليق أو إنهاء أيّ حساب يُخالف الشروط أو يُشتبه فيه، أو وَرَد ضدّه بَلاغ أو شكوى، أو يُشكّل خَطراً على المنصّة أو مستخدميها.',
                    'إدراج رقم جوّال المُستخدم المُخالف في قائمة الأرقام المحظورة، دون أدنى مسؤولية ودون حاجة لإخطار مُسبق.',
                    'تجميد رصيد اشتراك التاجر تَحت التحقيق دون استرداد، ريثما تَتّضح الواقعة.',
                    'مراقبة الرسائل الخاصة بين المستخدمين عند الحاجة لضمان عدم مخالفة شروط الاستخدام.',
                    'تَقديم بيانات المستخدم كاملةً لأيّ جهة أمنية أو قضائية سعودية تَطلبها رسمياً.',
                    'التعاون الكامل مع الجهات الأمنية في أيّ تحقيق جنائيّ.',
                    'تَقييد الوصول من مَناطق جغرافية أو شبكات معيّنة لحماية المنصّة.',
                    'تَشغيل أنظمة فرز آليّ للنصوص والصور تَحجب أو تَحذف المحتوى المخالف فور نشره، مع إصدار إنذارات موثَّقة على الحساب المخالف قد يُؤدّي تراكمها إلى التعليق أو الحظر.',
                    'تنظيم مسابقات وسحوبات وحملات موسمية اختيارية وفق شروط تُعلَن وقت كلّ فعالية — وللإدارة تَعديلها أو إيقافها أو استبعاد أيّ مشاركة مخالفة دون تعويض.',
                ] : [
                    'Delete or hide any content it considers non-compliant or suspicious, of poor quality, lacking detail, or in the wrong section.',
                    'Suspend or terminate any account that breaches the Terms or is under suspicion, or against which a report or complaint has been received, or that poses a risk to the platform or its users.',
                    'List the offending user\'s mobile number on the banned-numbers list, without any responsibility and without need of prior notice.',
                    'Freeze a merchant\'s subscription balance under investigation without refund pending resolution of the matter.',
                    'Monitor private messages between users where necessary to ensure compliance with the Terms.',
                    'Provide the user\'s full data to any Saudi security or judicial authority making a formal request.',
                    'Cooperate fully with the security authorities in any criminal investigation.',
                    'Restrict access from certain geographies or networks to protect the platform.',
                    'Operate automated screening systems for text and images that hide or remove non-compliant content as soon as it is published, and issue documented warnings on the offending account, the accumulation of which may lead to suspension or ban.',
                    'Organise optional contests, draws and seasonal campaigns under rules announced at the time of each event — the administration may amend or stop them, or exclude any non-compliant entry, without compensation.',
                ]} />
                <Paragraph>
                    {isRTL ? (
                        <>
                            إنهاء الحساب لا يُلغي أيّ التزام نَشأ على المُستخدم قَبل
                            الإنهاء. والمستخدم الموقوف يَتعهّد بعدم العودة لاستخدام المنصّة
                            إلا بعد موافقة الإدارة، وبعدم نَشر تَفاصيل الإيقاف على وسائل
                            التواصل.
                        </>
                    ) : (
                        <>
                            Termination of an account does not discharge any obligation
                            arising on the user before termination. A suspended user
                            undertakes not to return to use the platform without the
                            administration's approval and not to publish details of the
                            suspension on social media.
                        </>
                    )}
                </Paragraph>
            </Section>

            <Section n={16} title={isRTL ? 'نظام البلاغات وآلية المُراجعة' : 'Reports system and review mechanism'}>
                <Bullets items={isRTL ? [
                    'يحقّ لأيّ مُستخدم تَقديم بلاغ ضدّ عرض أو حساب أو مستخدم عبر زرّ «🚩 إبلاغ».',
                    'تُراجَع البلاغات يدوياً من الإدارة وَفق أولويّاتها وسلطتها التَقديرية، دون التزام بمدّة زمنية مُحدَّدة.',
                    'للإدارة وَحدها — وبسلطتها التَقديرية المُطلقة — صلاحية اتّخاذ أيّ إجراء تَراه مُناسباً (تَحذير، تَعليق، حذف، تَجميد، وضع تحت المُراجعة، أو أيّ تَدبير آخر) دون إشعار مُسبق ودون شرح أسباب.',
                    <><strong>سرّية الإجراءات الداخلية</strong>: آليّات الكشف، عَتبات اتّخاذ القرار، خوارزميّات الرصد — كلّها <strong>أسرار تَشغيلية</strong> لا يَحقّ لأيّ مُستخدم الاطّلاع عليها أو طَلب كشفها أو الاعتراض على عدم الإفصاح عنها.</>,
                    'البلاغ الكيديّ قد يُؤدّي إلى تَعليق حساب المُبلِّغ أو حذفه دون تَنبيه.',
                    'قرار الإدارة في كلّ بَلاغ نهائيّ ضمن المنصّة. للطرف غير الراضي حقّ اللجوء للقضاء السعوديّ المختصّ.',
                ] : [
                    'Any user may submit a report against an offer, account or user via the «🚩 Report» button.',
                    'Reports are reviewed manually by the administration in accordance with its priorities and discretionary authority, without commitment to any specific timeframe.',
                    'The administration alone — at its absolute discretion — has the authority to take whatever action it deems appropriate (warning, suspension, deletion, freezing, placement under review, or any other measure) without prior notice and without explanation of reasons.',
                    <><strong>Confidentiality of internal procedures</strong>: detection mechanisms, decision thresholds, and monitoring algorithms — are all <strong>operational secrets</strong> that no user has the right to inspect, request disclosure of, or object to non-disclosure of.</>,
                    'A malicious report may lead to suspension or deletion of the reporter\'s account without notice.',
                    'The administration\'s decision on every report is final on the platform. The dissatisfied party has the right to approach the competent Saudi judiciary.',
                ]} />
            </Section>

            <Section n={17} title={isRTL ? 'القوّة القاهرة' : 'Force majeure'}>
                <Paragraph>
                    {isRTL ? (
                        <>
                            لا تَتحمّل TAKI أيّ مسؤولية عن أيّ تأخّر أو إخفاق في تَنفيذ
                            الخدمات إذا كان السبب خارجاً عن إرادتها المعقولة، بما في ذلك
                            على سبيل المثال لا الحصر: القَضاء والقَدر، الأوبئة، الحرائق،
                            الفيضانات، الزلازل، الحرب، الإرهاب، الاضطرابات المدنية،
                            الإضرابات، انقطاع الكهرباء، انقطاع الإنترنت، أعطال مزوّدي البنية
                            التحتية، القرارات الحكومية والقضائية، أو أيّ ظرف قاهر آخر يُحدّده
                            النظام السعوديّ.
                        </>
                    ) : (
                        <>
                            TAKI bears no responsibility for any delay or failure in
                            providing the services where the cause is beyond its
                            reasonable control — including, by way of example only:
                            acts of God, epidemics, fires, floods, earthquakes, war,
                            terrorism, civil unrest, strikes, power outages, internet
                            outages, failures by infrastructure providers, governmental
                            and judicial decisions, or any other force-majeure event as
                            defined by Saudi law.
                        </>
                    )}
                </Paragraph>
            </Section>

            <Section n={18} title={isRTL ? 'علاقة الأطراف' : 'Relationship of the parties'}>
                <Paragraph>
                    {isRTL ? (
                        <>
                            لا يُوجد في هذه الشروط ما يُمكن تَأويله — لا من قِبَل الأطراف ولا
                            من قِبَل الغير — على أنّه يُنشئ بين TAKI والتجار أو المشترين أيّ
                            علاقة <strong>شراكة، أو وكالة، أو استخدام (employment)، أو مشروع
                            مشترك</strong>؛ وكلّ طرف يَتعاقد بصفته الشخصية ولحسابه المستقلّ،
                            ولا يَحقّ لأيّ طرف إلزام الطرف الآخر تجاه الغير دون موافقة
                            خطّية صريحة.
                        </>
                    ) : (
                        <>
                            Nothing in these Terms is to be construed — by the parties or
                            by third parties — as creating between TAKI and any merchant
                            or buyer any relationship of <strong>partnership, agency,
                            employment, or joint venture</strong>; each party contracts
                            in its own name and for its own independent account, and no
                            party may bind the other to a third party without express
                            written consent.
                        </>
                    )}
                </Paragraph>
            </Section>

            <Section n={19} title={isRTL ? 'مُجمل الاتفاق وعدم التنازل' : 'Entire agreement and no waiver'}>
                <Bullets items={isRTL ? [
                    'تُمثّل هذه الشروط — مع سياسة الخصوصية وسياسة الاسترداد وأيّ سياسة لاحقة — مُجمل الاتفاق بين الأطراف، وتَسمو على وتُلغي أيّ اتفاقات شفوية أو خطّية سابقة.',
                    'لا يُعتبر تنازل TAKI عن حقّ من حقوقها — أو تأخّرها في ممارسته — تنازلاً عن ذلك الحقّ مستقبلاً ولا عن أيّ حقّ آخر، ما لم يكن التنازل خطّياً وصريحاً من مُمثّل مفوَّض.',
                    'لا يَحقّ لأيّ مُستخدم نَقل حقوقه أو التزاماته الناشئة عن هذه الشروط إلى طرف آخر دون موافقة خطّية مُسبقة من TAKI؛ ولـ TAKI الحقّ في نقل حقوقها والتزاماتها إلى أيّ خَلَف نظاميّ أو شركة تابعة دون حاجة لموافقة المُستخدم.',
                    'إذا قَضت محكمة سعودية مختصّة ببطلان أيّ بند من هذه الوثيقة، يَبقى باقي البنود نافذاً وملزماً، ويُستبدل البند الباطل بأقرب بند مَشروع يُحقّق النيّة الأصلية.',
                    'الأحكام التي تَسري بطبيعتها بعد إنهاء الاتفاق (المسؤولية، التَعويض، الملكية الفكرية، حلّ النزاعات، السرّية) تَبقى نافذةً حتى بعد إنهاء أو تَعليق الحساب.',
                ] : [
                    'These Terms — together with the Privacy Policy, the Refund Policy and any subsequent policy — constitute the entire agreement between the parties and supersede and cancel any prior oral or written agreements.',
                    'TAKI\'s waiver of any of its rights — or delay in exercising them — is not a waiver of that right for the future nor of any other right, unless the waiver is in writing and express, from an authorised representative.',
                    'No user may transfer their rights or obligations under these Terms to another party without prior written consent from TAKI; TAKI has the right to transfer its rights and obligations to any legal successor or affiliate without need of the user\'s consent.',
                    'If a competent Saudi court rules that any clause of this document is invalid, the remaining clauses remain in force and binding, and the invalid clause is replaced by the nearest lawful clause that achieves the original intent.',
                    'Provisions that survive termination by their nature (liability, indemnity, intellectual property, dispute resolution, confidentiality) remain in force after termination or suspension of the account.',
                ]} />
            </Section>

            <Section n={20} title={isRTL ? 'تَعديل الشروط' : 'Amendment of the Terms'}>
                <Paragraph>
                    {isRTL ? (
                        <>
                            للإدارة الحقّ في تَعديل هذه الشروط في أيّ وقت، ويَسري التعديل
                            فور نَشره على المنصّة (أو في تاريخ السريان المُحدَّد فيه إن
                            وُجد). يُعرَض تاريخ آخر تَحديث في الأعلى. <strong>الاستخدام
                            المستمرّ بعد التعديل قبول ضمنيّ للنسخة الجديدة</strong>، وللتعديلات
                            الجوهرية قد تَطلب TAKI إعادة الموافقة الصريحة قَبل المتابعة.
                        </>
                    ) : (
                        <>
                            The administration has the right to amend these Terms at any
                            time, and the amendment takes effect as soon as it is
                            published on the platform (or on the specified effective
                            date, if any). The last-updated date is displayed at the top.
                            <strong> Continued use after an amendment is implied
                            acceptance of the new version</strong>, and for material
                            amendments TAKI may require renewed express acceptance
                            before continuing.
                        </>
                    )}
                </Paragraph>
            </Section>

            <Section n={21} title={isRTL ? 'القانون الحاكم والاختصاص القَضائيّ' : 'Governing law and jurisdiction'}>
                <Paragraph>
                    {isRTL ? (
                        <>
                            تَخضع هذه الشروط — وأيّ نزاع يَنشأ عنها أو يَرتبط بها — <strong>حصرياً
                            لأنظمة المملكة العربية السعودية</strong>، وتُفسَّر وَفقاً لها بما في
                            ذلك أحكام الشريعة الإسلامية الواردة فيها.
                        </>
                    ) : (
                        <>
                            These Terms — and any dispute arising out of or relating to
                            them — are <strong>governed exclusively by the laws of the
                            Kingdom of Saudi Arabia</strong>, and are construed
                            accordingly, including the provisions of Islamic Sharia
                            contained therein.
                        </>
                    )}
                </Paragraph>
                <Paragraph>
                    {isRTL ? (
                        <>
                            <strong>الاختصاص حصرياً للمحاكم السعودية المختصّة داخل المملكة العربية السعودية</strong>،
                            ما لم يَقتضِ النظام خلاف ذلك (كقضايا حماية المستهلك التي تَنظرها
                            محاكم محلّ المستهلك). ويَتنازل المستخدم صراحةً عن أيّ حقّ في
                            رَفع دعوى ضدّ TAKI أمام محاكم أجنبية.
                        </>
                    ) : (
                        <>
                            <strong>Jurisdiction lies exclusively with the competent
                            courts within the Kingdom of Saudi Arabia</strong>, unless
                            the law requires otherwise (for example, consumer-protection
                            cases heard by the courts of the consumer's domicile). The
                            user expressly waives any right to bring an action against
                            TAKI before foreign courts.
                        </>
                    )}
                </Paragraph>
                <Paragraph>
                    {isRTL ? (
                        <>
                            ويُحفظ للمستخدم حقّ اللجوء — كبديل أو خطوة سابقة — للجهات
                            الرقابية: وزارة التجارة، منصّة معروف، البنك المركزي السعوديّ
                            للمدفوعات، هيئة البيانات والذكاء الاصطناعي للخصوصية، هيئة حقوق
                            الإنسان لقضاياها.
                        </>
                    ) : (
                        <>
                            The user retains the right to approach — as an alternative
                            or as a preliminary step — the regulatory authorities: the
                            Ministry of Commerce, the Maroof Platform, the Saudi Central
                            Bank for payments, the Saudi Data &amp; AI Authority for
                            privacy, and the Human Rights Commission for its matters.
                        </>
                    )}
                </Paragraph>
            </Section>

            <Section n={22} title={isRTL ? 'التواصل' : 'Contact'}>
                <Paragraph>
                    {isRTL ? (
                        <>
                            لأيّ استفسار، شكوى، أو طلب قانونيّ، استخدم زرّ «📣 الشكاوى /
                            تواصل الإدارة» داخل التطبيق، أو زُر صفحة{' '}
                            <a href="/contact" className="text-emerald-600 font-bold underline">اتصل بنا</a>،
                            أو تَصفّح <a href="/faq" className="text-emerald-600 font-bold underline">الأسئلة الشائعة</a>{' '}
                            لأكثر الاستفسارات شيوعاً.
                        </>
                    ) : (
                        <>
                            For any enquiry, complaint or legal request, use the
                            «📣 Complaints / Contact the Admin» button inside the app,
                            visit the <a href="/contact" className="text-emerald-600 font-bold underline">Contact Us</a>{' '}
                            page, or browse the{' '}
                            <a href="/faq" className="text-emerald-600 font-bold underline">Frequently Asked Questions</a>{' '}
                            for the most common queries.
                        </>
                    )}
                </Paragraph>
            </Section>

            <div className="mt-8 p-4 bg-emerald-50 border-2 border-emerald-200 rounded-2xl text-center">
                <div className="text-3xl mb-2">✍️</div>
                <p className="text-sm font-extrabold text-emerald-900">
                    {isRTL
                        ? 'تَسجيلك في TAKI يُعدّ توقيعاً إلكترونياً ملزماً على هذه الشروط'
                        : 'Your registration on TAKI constitutes a binding electronic signature on these Terms'}
                </p>
                <p className="text-xs text-emerald-700 mt-1 font-bold">
                    {isRTL
                        ? 'وَفقاً لنظام التعاملات الإلكترونية السعوديّ.'
                        : 'Pursuant to the Saudi Electronic Transactions Law.'}
                </p>
            </div>
        </LegalLayout>
    );
};

export default Terms;
