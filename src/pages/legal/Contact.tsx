/**
 * Contact page — قنوات التواصل مع TAKI / Ways to reach TAKI. Bilingual (v11.9).
 *
 * لا نُدرج نموذج تواصل خارجي — زرّ «📣 الشكاوى / تواصل الإدارة» داخل التطبيق
 * يُسلّم الرسالة مباشرةً لإدارة الموقع مع كامل بيانات حساب المرسل، فيُغني عن
 * نموذج موازٍ يفتح صفّ مراجعة منفصلاً.
 */

import React from 'react';
import { LegalLayout, Section, Paragraph } from './LegalLayout';
import { useApp } from '../../context/AppContext';

const Contact: React.FC = () => {
    const { language } = useApp();
    const isRTL = language === 'ar';

    return (
        <LegalLayout
            title={isRTL ? 'اتصل بنا' : 'Contact Us'}
            subtitle={isRTL ? 'Contact TAKI' : 'Contact TAKI'}
            lastUpdated="2026-07-22"
            draftNotice={false}
        >
            <Paragraph>
                {isRTL
                    ? 'نُحبّ سماعك دائماً. اختر القناة الأنسب لطلبك:'
                    : 'We always like to hear from you. Choose the channel that best suits your request:'}
            </Paragraph>

            <Section title={isRTL ? '📣 الشكاوى والاقتراحات والاستفسارات' : '📣 Complaints, suggestions and enquiries'}>
                <Paragraph>
                    {isRTL ? (
                        <>
                            داخل التطبيق، اضغط على زرّ القائمة الجانبية (☰) ثم اختر
                            <strong> «📣 الشكاوى / تواصل الإدارة»</strong>. هذه أسرع وأوثق
                            قناة — تصل مباشرةً لإدارة المنصّة مع كامل تفاصيل حسابك، فلا
                            تحتاج لإعادة شرح هويّتك. نسعى للردّ في أقرب وقت ممكن وفقاً
                            لطبيعة الطلب وأولويّات الإدارة.
                        </>
                    ) : (
                        <>
                            Inside the app, open the side menu (☰) then choose
                            <strong> «📣 Complaints / Contact the Admin»</strong>. This is
                            the fastest and most reliable channel — your message reaches
                            the platform administration directly with your full account
                            details, so you do not need to re-establish your identity. We
                            aim to respond as soon as reasonably possible, depending on
                            the nature of the request and management priorities.
                        </>
                    )}
                </Paragraph>
            </Section>

            <Section title={isRTL ? '🚩 الإبلاغ عن مستخدم أو عرض مُخالف' : '🚩 Reporting a non-compliant user or offer'}>
                <Paragraph>
                    {isRTL ? (
                        <>
                            في كلّ صفحة عرض أو متجر، ستجد زرّ <strong>«🚩 إبلاغ»</strong> يفتح
                            نموذجاً مخصَّصاً. تُراجَع البلاغات يدوياً من فريق الإدارة، ولا
                            تُكشف هويّة المُبلِّغ للمُبلَّغ عنه. تَوقَّع الإجراء بحسب طبيعة المخالفة
                            وسلطة الإدارة التقديرية.
                        </>
                    ) : (
                        <>
                            On every offer or store page you will find a{' '}
                            <strong>«🚩 Report»</strong> button that opens a dedicated form.
                            Reports are reviewed manually by the admin team, and the
                            reporter's identity is not disclosed to the reported party.
                            Expect action to be taken based on the nature of the breach
                            and the discretionary authority of the administration.
                        </>
                    )}
                </Paragraph>
            </Section>

            <Section title={isRTL ? '🛍️ التسجيل كتاجر' : '🛍️ Registering as a merchant'}>
                <Paragraph>
                    {isRTL ? (
                        <>
                            للانضمام كتاجر، سجِّل عبر <a href="/register" className="text-emerald-600 font-bold underline">صفحة التسجيل</a>{' '}
                            واختر «تاجر». سيتولّى فريق الإدارة مراجعة وتفعيل حسابك في أقرب
                            وقت ممكن وفقاً لتسلسل الطلبات. قد تطلب الإدارة وثائق إضافية
                            للتحقّق من النشاط التجاري.
                        </>
                    ) : (
                        <>
                            To join as a merchant, register via the{' '}
                            <a href="/register" className="text-emerald-600 font-bold underline">registration page</a>{' '}
                            and choose «Merchant». The admin team will review and activate
                            your account as soon as practicable in queue order. Additional
                            documents may be requested to verify the commercial activity.
                        </>
                    )}
                </Paragraph>
            </Section>

            <Section title={isRTL ? '⚖️ الاستفسارات القانونية وحماية البيانات (DPO)' : '⚖️ Legal and data-protection enquiries (DPO)'}>
                <Paragraph>
                    {isRTL ? (
                        <>
                            من زرّ «📣 الشكاوى / تواصل الإدارة»، اكتب في عنوان الرسالة كلمة
                            <strong> «خصوصية»</strong> أو <strong>«قانوني»</strong>. تُحوَّل مباشرة
                            إلى مسؤول حماية البيانات (DPO)، ويُرَدّ عليها خلال 30 يوماً
                            كحدّ أقصى بموجب نظام حماية البيانات الشخصية السعودي.
                        </>
                    ) : (
                        <>
                            Through the «📣 Complaints / Contact the Admin» button, include
                            the word <strong>«Privacy»</strong> or <strong>«Legal»</strong>{' '}
                            in the subject line. The message is routed directly to the Data
                            Protection Officer (DPO) and answered within 30 days at most,
                            in line with the Saudi Personal Data Protection Law (PDPL).
                        </>
                    )}
                </Paragraph>
            </Section>

            <Section title={isRTL ? '❓ الأسئلة الشائعة (FAQ)' : '❓ Frequently Asked Questions (FAQ)'}>
                <Paragraph>
                    {isRTL ? (
                        <>
                            قبل التواصل، يُفضَّل تصفّح <a href="/faq" className="text-emerald-600 font-bold underline">صفحة الأسئلة الشائعة</a>{' '}
                            — تجيب عن أكثر الاستفسارات شيوعاً للمشترين والتجار، وتشرح طريقة
                            عمل المنصّة بالتفصيل.
                        </>
                    ) : (
                        <>
                            Before getting in touch, we suggest browsing the{' '}
                            <a href="/faq" className="text-emerald-600 font-bold underline">Frequently Asked Questions</a>{' '}
                            page — it answers the most common queries from buyers and
                            merchants and explains in detail how the platform works.
                        </>
                    )}
                </Paragraph>
            </Section>

            <Section title={isRTL ? '🏛️ الجهات الرقابية السعودية (للنزاعات)' : '🏛️ Saudi regulatory authorities (for disputes)'}>
                <Paragraph>
                    {isRTL
                        ? 'إذا لم تتفق مع قرار الإدارة، يحقّ لك التقدّم للجهات التالية بحسب طبيعة الشكوى:'
                        : 'If you disagree with the administration\'s decision, you may approach the following authorities depending on the nature of your complaint:'}
                </Paragraph>
                <ul className="list-disc ps-6 space-y-1.5 text-sm">
                    {isRTL ? (
                        <>
                            <li><strong>وزارة التجارة</strong> — <a href="https://mc.gov.sa" target="_blank" rel="noopener noreferrer" className="text-emerald-600 font-bold underline">mc.gov.sa</a> — لقضايا التجارة الإلكترونية وحماية المستهلك.</li>
                            <li><strong>منصّة معروف</strong> — <a href="https://maroof.sa" target="_blank" rel="noopener noreferrer" className="text-emerald-600 font-bold underline">maroof.sa</a> — لتوثيق المتاجر والشكاوى عليها.</li>
                            <li><strong>البنك المركزي السعودي (SAMA)</strong> — <a href="https://sama.gov.sa" target="_blank" rel="noopener noreferrer" className="text-emerald-600 font-bold underline">sama.gov.sa</a> — للنزاعات المتعلّقة بالمدفوعات الإلكترونية.</li>
                            <li><strong>هيئة البيانات والذكاء الاصطناعي (SDAIA)</strong> — <a href="https://sdaia.gov.sa" target="_blank" rel="noopener noreferrer" className="text-emerald-600 font-bold underline">sdaia.gov.sa</a> — للشكاوى المتعلّقة بالخصوصية وحماية البيانات.</li>
                        </>
                    ) : (
                        <>
                            <li><strong>Ministry of Commerce</strong> — <a href="https://mc.gov.sa" target="_blank" rel="noopener noreferrer" className="text-emerald-600 font-bold underline">mc.gov.sa</a> — for e-commerce and consumer protection matters.</li>
                            <li><strong>Maroof Platform</strong> — <a href="https://maroof.sa" target="_blank" rel="noopener noreferrer" className="text-emerald-600 font-bold underline">maroof.sa</a> — for store accreditation and complaints against stores.</li>
                            <li><strong>Saudi Central Bank (SAMA)</strong> — <a href="https://sama.gov.sa" target="_blank" rel="noopener noreferrer" className="text-emerald-600 font-bold underline">sama.gov.sa</a> — for disputes relating to electronic payments.</li>
                            <li><strong>Saudi Data &amp; AI Authority (SDAIA)</strong> — <a href="https://sdaia.gov.sa" target="_blank" rel="noopener noreferrer" className="text-emerald-600 font-bold underline">sdaia.gov.sa</a> — for complaints relating to privacy and data protection.</li>
                        </>
                    )}
                </ul>
            </Section>
        </LegalLayout>
    );
};

export default Contact;
