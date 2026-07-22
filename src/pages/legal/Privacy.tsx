/**
 * Privacy Policy — سياسة الخصوصية لـ TAKI / Privacy Policy for TAKI.
 * Bilingual (v11.9 — full EN support, retains the noon-style general tone).
 *
 * مرجعيّاً: نظام حماية البيانات الشخصية السعودي (PDPL) ولوائحه الصادرة عن
 * هيئة البيانات والذكاء الاصطناعي (SDAIA) — يكتفي بالعموميات ولا يلزم
 * بكشف الموردين أو المدد التفصيلية.
 */

import React from 'react';
import { LegalLayout, Section, Paragraph, Bullets } from './LegalLayout';
import { useApp } from '../../context/AppContext';

const Privacy: React.FC = () => {
    const { language } = useApp();
    const isRTL = language === 'ar';

    return (
        <LegalLayout
            title={isRTL ? 'سياسة الخصوصية' : 'Privacy Policy'}
            subtitle={isRTL ? 'Privacy Policy · TAKI' : 'Privacy Policy · TAKI'}
            lastUpdated="2026-07-22"
        >
            <Paragraph>
                {isRTL ? (
                    <>
                        تَحترم <strong>TAKI</strong> خصوصية جميع مستخدميها وتلتزم بحماية
                        البيانات الشخصية التي تَجمعها من خلال الموقع وتطبيق الهاتف الجوّال،
                        وفقاً للأنظمة المعمول بها في المملكة العربية السعودية، وعلى رأسها
                        <strong> نظام حماية البيانات الشخصية</strong> ولوائحه التنفيذية.
                    </>
                ) : (
                    <>
                        <strong>TAKI</strong> respects the privacy of all its users and is
                        committed to protecting the personal data it collects through the
                        website and mobile application, in accordance with the laws in
                        force in the Kingdom of Saudi Arabia — in particular the{' '}
                        <strong>Personal Data Protection Law (PDPL)</strong> and its
                        implementing regulations.
                    </>
                )}
            </Paragraph>

            <Paragraph>
                {isRTL ? (
                    <>
                        تُبيّن هذه السياسة الأساس الذي نَعتمد عليه في جمع بياناتك الشخصية
                        ومعالجتها عند استخدامك للمنصّة. يُرجى قراءتها بعناية، فاستمرارك في
                        استخدام الخدمات يُعدّ موافقةً منك على ممارساتنا الموضّحة فيها.
                    </>
                ) : (
                    <>
                        This policy sets out the basis on which we collect and process
                        your personal data when you use the platform. Please read it
                        carefully — your continued use of the services constitutes your
                        acceptance of the practices described in it.
                    </>
                )}
            </Paragraph>

            <Section n={1} title={isRTL ? 'نطاق السياسة' : 'Scope of the policy'}>
                <Bullets items={isRTL ? [
                    'تنطبق هذه السياسة على كلّ من يصل إلى منصّة TAKI، سواء عبر الموقع أو تطبيق الهاتف الجوّال، وسواء كان مشترياً أو تاجراً أو زائراً غير مُسجَّل.',
                    'تُكمِّل هذه السياسة شروط الاستخدام وسياسة الاسترداد، وتُقرَأ معها كوثيقة واحدة متكاملة.',
                    'قد يَشتمل الموقع على روابط لمواقع أو خدمات الغير. لا نَتحكّم بسياسات الغير ولا نَتحمّل مسؤوليتها — يُرجى مراجعة سياسة الخصوصية الخاصّة بكلّ موقع تَزوره.',
                ] : [
                    'This policy applies to anyone who accesses the TAKI platform — whether through the website or mobile app, and whether buyer, merchant or unregistered visitor.',
                    'It complements the Terms of Service and the Refund Policy and is read together with them as a single integrated document.',
                    'The platform may contain links to third-party sites or services. We do not control third-party policies and bear no responsibility for them — please review the privacy policy of each site you visit.',
                ]} />
            </Section>

            <Section n={2} title={isRTL ? 'البيانات التي نَجمعها' : 'The data we collect'}>
                <Paragraph>
                    {isRTL
                        ? 'قد نَجمع — وفقاً لطبيعة استخدامك — الفئات التالية من البيانات:'
                        : 'Depending on the nature of your use, we may collect the following categories of data:'}
                </Paragraph>
                <Bullets items={isRTL ? [
                    <><strong>بيانات الهوية والاتصال</strong>: الاسم، رقم الجوّال، البريد الإلكتروني، نوع الحساب (مشترٍ أو تاجر).</>,
                    <><strong>بيانات التاجر</strong>: اسم المتجر، فئة النشاط، الموقع، الفروع، الصور، وما يَلزم للتحقّق من النشاط التجاري.</>,
                    <><strong>بيانات المعاملات</strong>: تفاصيل الحجوزات والعروض والتفاعلات على المنصّة.</>,
                    <><strong>بيانات الاستخدام والبيانات الفنّية</strong>: الصفحات التي تَزورها، الأنشطة على المنصّة، نوع الجهاز ونظام التشغيل، إعدادات اللغة، عنوان بروتوكول الإنترنت (IP).</>,
                    <><strong>بيانات الموقع الجغرافي</strong>: عند تفعيلك خدمات الموقع لعرض العروض القريبة («حولي»)؛ وإن أبقيت خدمة الموقع مفعّلة فقد يُحدَّث موقعك أثناء استخدام التطبيق لتحسين النتائج القريبة — ويمكنك إيقافها من إعدادات جهازك في أيّ وقت.</>,
                    <><strong>بيانات الاستخدام التحليلية</strong>: مشاهدات العروض، النقرات، عمليات البحث، وفترات فتح التطبيق — تُعالَج بشكل مجمّع لتحسين الخدمة، وتُعرض إحصاءات الجمهور على مستوى المدن والمناطق فقط دون كشف مواقع فردية.</>,
                    <><strong>بيانات ربط قنوات البوت</strong>: عند ربطك حسابك ببوت تيليجرام الرسمي (أو واتساب مستقبلاً) نحفظ معرّف القناة لتوجيه إشعاراتك — دون مشاركة رقم جوّالك مع تلك القناة.</>,
                    <><strong>مشاركات المسابقات والاستبيانات</strong>: إجاباتك تُحفظ للإدارة فقط ولا تُعرض للعموم، وتُعلَن نتائج السحوبات بهوية مموّهة.</>,
                    <><strong>محتوى التواصل</strong>: محادثاتك مع التجار/المشترين عبر شات الحجز، تقييماتك، شكاويك.</>,
                    <><strong>بيانات الموافقات القانونية</strong>: تاريخ ووقت موافقتك على الشروط والسياسات.</>,
                ] : [
                    <><strong>Identity and contact data</strong>: name, mobile number, email, account type (buyer or merchant).</>,
                    <><strong>Merchant data</strong>: store name, activity category, location, branches, images, and what is needed to verify the commercial activity.</>,
                    <><strong>Transaction data</strong>: details of bookings, offers and interactions on the platform.</>,
                    <><strong>Usage and technical data</strong>: pages you visit, activity on the platform, device type and operating system, language settings, and IP address.</>,
                    <><strong>Geolocation data</strong>: where you enable location services to surface nearby offers («Nearby»); if you keep location services on, your position may be refreshed while using the app to improve nearby results — you can turn this off from your device settings at any time.</>,
                    <><strong>Analytics usage data</strong>: offer views, clicks, searches and app-open sessions — processed in aggregate to improve the service; audience statistics are presented at city and region level only, with no individual locations disclosed.</>,
                    <><strong>Bot-channel linking data</strong>: when you link your account to the official Telegram bot (or WhatsApp in the future), we store the channel identifier to route your notifications — without sharing your phone number with that channel.</>,
                    <><strong>Contest and survey entries</strong>: your answers are kept for the administration only and are never displayed publicly, and draw results are announced with masked identities.</>,
                    <><strong>Communications content</strong>: your conversations with merchants/buyers via the booking chat, your reviews, and your complaints.</>,
                    <><strong>Consent records</strong>: the date and time of your acceptance of the terms and policies.</>,
                ]} />
                <Paragraph>
                    {isRTL ? (
                        <>
                            لا نَجمع بيانات بطاقات الدفع، فهي تُمرَّر مباشرة إلى بوّابات
                            الدفع المرخّصة. كما لا نَجمع بياناتٍ حسّاسة بمفهوم النظام
                            السعودي إلا بموافقتك الصريحة ولغرضٍ مُعلَن.
                        </>
                    ) : (
                        <>
                            We do not collect payment-card data — that information is
                            passed directly to licensed payment gateways. Nor do we collect
                            sensitive data as defined under Saudi law, save with your
                            express consent and for a clearly stated purpose.
                        </>
                    )}
                </Paragraph>
            </Section>

            <Section n={3} title={isRTL ? 'كيف نَجمع البيانات' : 'How we collect data'}>
                <Bullets items={isRTL ? [
                    <><strong>مباشرة منك</strong>: عند التسجيل، الحجز، النشر، التقييم، الشكاوى، أو أيّ تفاعل تَختار القيام به على المنصّة.</>,
                    <><strong>تلقائياً</strong>: عند استخدامك للمنصّة، تَجمع الأنظمة لدينا — كحال أيّ منصّة رقمية — معلومات تقنية أساسية عن جلستك وجهازك لأغراض التشغيل والأمان.</>,
                    <><strong>من الغير</strong>: قد تَردنا بيانات محدّدة من بوّابات الدفع المرخّصة أو من مزوّدي خدمات تسجيل الدخول الموحَّد عند استخدامك لهم.</>,
                ] : [
                    <><strong>Directly from you</strong>: when you register, book, publish, rate, complain, or otherwise interact with the platform.</>,
                    <><strong>Automatically</strong>: when you use the platform, our systems — as on any digital platform — collect basic technical information about your session and device for operational and security purposes.</>,
                    <><strong>From third parties</strong>: we may receive specific data from licensed payment gateways or single-sign-on providers when you choose to use them.</>,
                ]} />
            </Section>

            <Section n={4} title={isRTL ? 'أغراض جمع البيانات' : 'Purposes for collecting data'}>
                <Paragraph>
                    {isRTL
                        ? 'نَستخدم بياناتك للأغراض التالية، أو لأيّ غرض مماثل تَقتضيه طبيعة الخدمة:'
                        : 'We use your data for the following purposes, or any similar purpose required by the nature of the service:'}
                </Paragraph>
                <Bullets items={isRTL ? [
                    'تشغيل المنصّة وتمكينك من تَصفّح العروض والحجز والتواصل مع الطرف الآخر.',
                    'التحقّق من هويّتك ومن استيفاء شروط الأهلية.',
                    'إرسال التنبيهات والإشعارات الضرورية أو ذات الصلة بالخدمات والعروض، عبر القنوات التي تَختارها.',
                    'تخصيص تجربتك بناءً على اهتماماتك وتفاعلاتك.',
                    'تحسين الخدمات وقياس الأداء وتطوير الميزات.',
                    'الامتثال للأنظمة المعمول بها، ومعالجة البلاغات والشكاوى.',
                    'الكشف عن الاحتيال وسوء الاستخدام، وحماية المنصّة ومستخدميها.',
                    'أيّ غرض آخر تَقتضيه إدارة الخدمة أو تَسمح به الأنظمة.',
                ] : [
                    'Operating the platform and enabling you to browse offers, book, and communicate with the other party.',
                    'Verifying your identity and that you satisfy the eligibility conditions.',
                    'Sending necessary or service-related notifications and alerts on the channels you have chosen.',
                    'Personalising your experience based on your interests and interactions.',
                    'Improving the services, measuring performance, and developing new features.',
                    'Complying with applicable laws and processing reports and complaints.',
                    'Detecting fraud and misuse, and protecting the platform and its users.',
                    'Any other purpose required by service management or permitted by law.',
                ]} />
            </Section>

            <Section n={5} title={isRTL ? 'مع من نُشارك البيانات' : 'With whom we share data'}>
                <Paragraph>
                    {isRTL ? (
                        <>
                            نَلتزم بحماية بياناتك ولا نَبيعها ولا نُؤجّرها ولا نُفشيها لأيّ
                            طرف لأيّ غرض تسويقيّ. وقد تَجري المشاركة — بحدود ما يَلزم
                            ووفق الأنظمة المعمول بها — في الحالات العامّة التالية:
                        </>
                    ) : (
                        <>
                            We are committed to protecting your data and do not sell,
                            rent or disclose it to any party for any marketing purpose.
                            Sharing may take place — within the limits required and in
                            accordance with applicable laws — in the following general
                            cases:
                        </>
                    )}
                </Paragraph>
                <Bullets items={isRTL ? [
                    <><strong>الطرف الآخر في المعاملة</strong>: التاجر يَطّلع على ما يَلزم للاتصال بك وتسليم العرض، والمشتري يَطّلع على ما يَنشره التاجر من بيانات متجره وعروضه.</>,
                    <><strong>الشركاء التشغيليون والتقنيون والمالِيُّون</strong>: بقَدر ما يَلزم لتقديم الخدمات وتشغيلها (استضافة، معالجة بيانات، اتصالات، مدفوعات، تحليلات، مراقبة الأعطال التقنية، قنوات البوتات، وغيرها)، مع التزام كلّ شريك بأنظمة حماية البيانات المعمول بها.</>,
                    <><strong>الجهات النظامية والأمنية والقضائية</strong>: عند ورود طلب رسميّ بموجب الأنظمة، أو عند الحاجة لحماية المنصّة أو مستخدميها أو الغير من ضرر محتمل.</>,
                    <><strong>الأغراض المشروعة الأخرى</strong>: كالتدقيق، حلّ النزاعات، عمليات إعادة الهيكلة أو التَنازل، أو أيّ غرض آخر تَسمح به الأنظمة.</>,
                ] : [
                    <><strong>The other party to the transaction</strong>: the merchant receives what is needed to contact you and deliver the offer, and the buyer sees what the merchant has published of their store and offer details.</>,
                    <><strong>Operational, technical and financial partners</strong>: to the extent required to provide and operate the services (hosting, data processing, communications, payments, analytics, technical error monitoring, bot channels, and the like), with each partner committed to applicable data-protection laws.</>,
                    <><strong>Regulatory, security and judicial authorities</strong>: upon receipt of an official request under the law, or where necessary to protect the platform, its users or third parties from potential harm.</>,
                    <><strong>Other legitimate purposes</strong>: such as auditing, dispute resolution, restructuring or assignment, or any other purpose permitted by law.</>,
                ]} />
                <Paragraph>
                    {isRTL ? (
                        <>
                            ولا تُستخدَم بياناتك في أيّ حال لأغراض خارجة عن الغرض الذي
                            جُمعت من أجله.
                        </>
                    ) : (
                        <>
                            In all cases, your data is not used for purposes outside the
                            purpose for which it was collected.
                        </>
                    )}
                </Paragraph>
            </Section>

            <Section n={6} title={isRTL ? 'حقوقك بموجب النظام' : 'Your rights under the law'}>
                <Paragraph>
                    {isRTL
                        ? 'يَكفل لك النظام السعودي مجموعة من الحقوق المتعلّقة ببياناتك، تَشمل بوجهٍ عامّ:'
                        : 'Saudi law guarantees you a set of rights relating to your data, including in general:'}
                </Paragraph>
                <Bullets items={isRTL ? [
                    'الاطّلاع على البيانات التي نَجمعها عنك والغرض من جمعها.',
                    'طلب تصحيح أيّ بيانات غير دقيقة.',
                    'طلب إتلاف بياناتك إلى الحدّ الذي تَسمح به الأنظمة، مع احتفاظنا بما تَقتضيه التزاماتنا النظامية والمالية والأمنية.',
                    'سحب موافقتك على المعالجة في الأغراض التي تَستند إليها (كالتسويق المباشر أو الموقع الجغرافي).',
                    'الاعتراض على معالجة معيّنة لا تَستند إلى عقد أو نظام.',
                    'تقديم شكوى إلى الجهة المختصّة بحماية البيانات الشخصية في المملكة العربية السعودية.',
                ] : [
                    'Access to the data we collect about you and the purpose of collecting it.',
                    'Request correction of any inaccurate data.',
                    'Request destruction of your data to the extent permitted by law, while we retain what is required by our regulatory, financial and security obligations.',
                    'Withdraw your consent to processing for the purposes that rely on it (such as direct marketing or geolocation).',
                    'Object to a specific processing activity not based on contract or law.',
                    'File a complaint with the competent personal-data-protection authority in the Kingdom of Saudi Arabia.',
                ]} />
                <Paragraph>
                    {isRTL ? (
                        <>
                            لممارسة أيّ من هذه الحقوق، يُرجى التواصل معنا عبر زرّ
                            «📣 الشكاوى / تواصل الإدارة» داخل التطبيق أو من{' '}
                            <a href="/contact" className="text-emerald-600 font-bold underline">صفحة اتصل بنا</a>،
                            مع تقديم ما يُثبت هويّتك. سنَسعى للاستجابة <strong>ضمن المدد المنصوص عليها نظاماً</strong>،
                            وقد يَتعذّر الاستجابة في حالات يُحدّدها النظام (كالطلبات
                            المُتكرّرة، أو غير المعقولة، أو التي تَتعارض مع التزامات قانونية
                            أخرى)؛ وسنُخطرك حينئذٍ بالسبب.
                        </>
                    ) : (
                        <>
                            To exercise any of these rights, please contact us via the
                            «📣 Complaints / Contact the Admin» button inside the app or
                            through the{' '}
                            <a href="/contact" className="text-emerald-600 font-bold underline">Contact Us</a>{' '}
                            page, providing proof of identity. We will endeavour to respond{' '}
                            <strong>within the periods prescribed by law</strong>. A
                            response may be impossible in cases identified by law (such as
                            repeated, unreasonable, or requests in conflict with other legal
                            obligations) — in which case we will notify you of the reason.
                        </>
                    )}
                </Paragraph>
            </Section>

            <Section n={7} title={isRTL ? 'مدّة الاحتفاظ بالبيانات' : 'Data retention period'}>
                <Paragraph>
                    {isRTL ? (
                        <>
                            نَحتفظ بكلّ نوع من البيانات للحدّ الذي تَقتضيه طبيعة الخدمة أو
                            الأنظمة المعمول بها — أيّهما أطول. ونَأخذ في الاعتبار عند تَحديد
                            المدّة المناسبة:
                        </>
                    ) : (
                        <>
                            We retain each category of data for the period required by the
                            nature of the service or by applicable law — whichever is
                            longer. In setting the appropriate period we take into account:
                        </>
                    )}
                </Paragraph>
                <Bullets items={isRTL ? [
                    'الغرض الذي جُمعت من أجله البيانات وما إذا كان لا يَزال قائماً.',
                    'حساسية البيانات والمخاطر المحتملة من الاحتفاظ بها.',
                    'متطلّبات الأنظمة المحاسبية والضريبية والأمنية المعمول بها.',
                    'الحاجة إلى البيانات في النزاعات أو الادعاءات المحتملة.',
                ] : [
                    'The purpose for which the data was collected and whether it still applies.',
                    'The sensitivity of the data and the potential risks of retaining it.',
                    'The requirements of applicable accounting, tax and security laws.',
                    'The need for the data in potential disputes or claims.',
                ]} />
                <Paragraph>
                    {isRTL ? (
                        <>
                            بعد انتفاء المبرّر للاحتفاظ، تُحذف البيانات أو تُجهَّل بشكل لا
                            يُتيح الرجوع إلى صاحبها.
                        </>
                    ) : (
                        <>
                            Once the retention justification no longer applies, data is
                            deleted or anonymised in a form that does not allow tracing
                            back to its owner.
                        </>
                    )}
                </Paragraph>
            </Section>

            <Section n={8} title={isRTL ? 'نقل البيانات' : 'Data transfer'}>
                <Paragraph>
                    {isRTL ? (
                        <>
                            قد يَستلزم تقديم الخدمات معالجة بعض البيانات لدى شركاء أو مزوّدي
                            خدمات قد تَكون مَواقعهم خارج المملكة. وفي جميع الأحوال، نَلتزم
                            بأن يَتمّ ذلك وفقاً لأحكام نظام حماية البيانات الشخصية ولوائحه،
                            ووفق الضمانات التي تَقتضيها الأنظمة المعمول بها.
                        </>
                    ) : (
                        <>
                            Delivering the services may require some data to be processed
                            by partners or service providers whose locations may be outside
                            the Kingdom. In all cases, we ensure that this takes place in
                            accordance with the Personal Data Protection Law and its
                            implementing regulations, and with the safeguards required by
                            applicable law.
                        </>
                    )}
                </Paragraph>
            </Section>

            <Section n={9} title={isRTL ? 'ملفّات تعريف الارتباط (Cookies) وتقنيات مماثلة' : 'Cookies and similar technologies'}>
                <Paragraph>
                    {isRTL ? (
                        <>
                            نَستخدم ملفّات تعريف الارتباط والتقنيات المماثلة لتشغيل الجلسة،
                            وحفظ تَفضيلاتك، وتحسين تجربتك، وحماية المنصّة. يُمكنك تَعديل
                            إعدادات متصفّحك لرفض هذه الملفّات أو حذفها، علماً بأنّ ذلك قد
                            يُؤثّر على بعض وظائف المنصّة. وفي حال عدم رغبتك في قبولها،
                            يُمكنك التوقّف عن استخدام المنصّة.
                        </>
                    ) : (
                        <>
                            We use cookies and similar technologies to run the session,
                            save your preferences, improve your experience and protect the
                            platform. You can adjust your browser settings to reject or
                            delete these files, but this may affect some platform
                            functionality. If you do not wish to accept them, you may
                            choose to stop using the platform.
                        </>
                    )}
                </Paragraph>
            </Section>

            <Section n={10} title={isRTL ? 'أمن البيانات' : 'Data security'}>
                <Paragraph>
                    {isRTL ? (
                        <>
                            نَحرص على تَصميم أنظمتنا مع وضع أمن المستخدم وخصوصيّته في
                            الاعتبار، ونَتّبع إجراءات وقائية فنّية وإدارية ومادّية معقولة
                            تجارياً لحماية البيانات من الوصول غير المصرَّح به أو التعديل أو
                            الإفصاح أو الإتلاف. ومن ذلك — على سبيل المثال لا الحصر — استخدام
                            تقنيات تَشفير في النقل والتخزين، وضوابط وصول صارمة لا تُتيح
                            البيانات إلا لمن يَلزمهم الاطّلاع عليها لأداء عملهم.
                        </>
                    ) : (
                        <>
                            We design our systems with user security and privacy in mind,
                            and apply commercially reasonable technical, administrative
                            and physical safeguards to protect data from unauthorised
                            access, alteration, disclosure or destruction. These include —
                            by way of example only — the use of encryption in transit and
                            at rest, and strict access controls that limit data to those
                            who require access in order to perform their duties.
                        </>
                    )}
                </Paragraph>
                <Paragraph>
                    {isRTL ? (
                        <>
                            مع ذلك، لا يُمكن لأيّ منصّة ضمان الأمان المطلق لنقل البيانات
                            عبر الإنترنت أو لتخزينها الإلكتروني. لذا تَقع عليك أيضاً
                            مسؤولية الحفاظ على سرّية كلمة المرور وعدم مشاركتها مع أحد،
                            وتسجيل الخروج عند استخدام أجهزة مُشترَكة، وإبلاغنا فوراً عند
                            الاشتباه بأيّ استخدام غير مصرَّح به لحسابك.
                        </>
                    ) : (
                        <>
                            Even so, no platform can guarantee absolute security for the
                            transmission of data over the internet or for its electronic
                            storage. You therefore share responsibility for keeping your
                            password confidential and not sharing it with anyone, logging
                            out from shared devices, and notifying us immediately if you
                            suspect any unauthorised use of your account.
                        </>
                    )}
                </Paragraph>
            </Section>

            <Section n={11} title={isRTL ? 'بيانات الأطفال' : 'Children\'s data'}>
                <Paragraph>
                    {isRTL ? (
                        <>
                            المنصّة ليست موجَّهة لمن لم يَبلغ سنّ الرشد النظامي. ولا نَجمع
                            — عن قصد — بياناتٍ من القاصرين. إذا اكتشفنا أنّ حساباً يَعود
                            لقاصر دون إذن وليّ الأمر، فإننا نَحذفه وننهي وصوله للخدمات. وإن
                            كنت وليّ أمر وتَعتقد أنّ طفلك سَجّل بيانات لدينا، تَواصل معنا
                            لحذفها.
                        </>
                    ) : (
                        <>
                            The platform is not directed at anyone below the legal age of
                            majority. We do not knowingly collect data from minors. If we
                            discover that an account belongs to a minor without parental
                            consent, we delete it and end its access to the services. If
                            you are a parent or guardian and believe that your child has
                            registered data with us, contact us so we can delete it.
                        </>
                    )}
                </Paragraph>
            </Section>

            <Section n={12} title={isRTL ? 'تعديل السياسة' : 'Policy updates'}>
                <Paragraph>
                    {isRTL ? (
                        <>
                            قد نُحدِّث هذه السياسة من حينٍ لآخر لمواكبة تَطوّر الخدمات أو
                            المتطلّبات النظامية. تُنشر النسخة الحالية على هذه الصفحة، ويُعرض
                            تاريخ آخر تحديث في الأعلى. ويَسري التغيير من تاريخ النشر — أو
                            من تاريخ السريان المُحدَّد فيه إن وُجد. ويَقع على عاتقك مراجعة
                            هذه الصفحة بشكل دوري؛ واستمرارك في استخدام المنصّة بعد التعديل
                            يُعدّ موافقة منك على النسخة المُعدَّلة.
                        </>
                    ) : (
                        <>
                            We may update this policy from time to time to keep pace with
                            service developments or regulatory requirements. The current
                            version is published on this page, with the last-updated date
                            shown at the top. Changes take effect from the date of
                            publication — or the specified effective date, if any. It is
                            your responsibility to review this page periodically; continued
                            use of the platform after an update constitutes your acceptance
                            of the revised version.
                        </>
                    )}
                </Paragraph>
            </Section>

            <Section n={13} title={isRTL ? 'التواصل' : 'Contact'}>
                <Paragraph>
                    {isRTL ? (
                        <>
                            لأيّ شأن يَتعلّق بهذه السياسة أو بمعالجة بياناتك الشخصية، يُمكنك
                            التواصل معنا عبر زرّ «📣 الشكاوى / تواصل الإدارة» داخل التطبيق
                            أو عبر <a href="/contact" className="text-emerald-600 font-bold underline">صفحة اتصل بنا</a>.
                            ولأكثر الاستفسارات شيوعاً، يُرجى مراجعة <a href="/faq" className="text-emerald-600 font-bold underline">صفحة الأسئلة الشائعة</a>.
                        </>
                    ) : (
                        <>
                            For any matter relating to this policy or to the processing of
                            your personal data, you can contact us via the «📣 Complaints /
                            Contact the Admin» button inside the app or through the{' '}
                            <a href="/contact" className="text-emerald-600 font-bold underline">Contact Us</a>{' '}
                            page. For the most common questions, please consult the{' '}
                            <a href="/faq" className="text-emerald-600 font-bold underline">Frequently Asked Questions</a>.
                        </>
                    )}
                </Paragraph>
            </Section>
        </LegalLayout>
    );
};

export default Privacy;
