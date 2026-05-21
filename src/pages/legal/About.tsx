/**
 * About page — من نحن / About Us. Fully bilingual (v11.9).
 */

import React from 'react';
import { LegalLayout, Section, Paragraph, Bullets } from './LegalLayout';
import { useApp } from '../../context/AppContext';

const About: React.FC = () => {
    const { language } = useApp();
    const isRTL = language === 'ar';

    return (
        <LegalLayout
            title={isRTL ? 'من نحن' : 'About Us'}
            subtitle={isRTL ? 'About TAKI' : 'About TAKI'}
            lastUpdated="2026-05-21"
            draftNotice={false}
        >
            <Paragraph>
                {isRTL ? (
                    <>
                        <strong>TAKI</strong> منصّة سعودية رقمية لحجز التخفيضات والعروض من
                        التجار، صُمِّمت لتربط بين أصحاب المتاجر الذين يقدّمون عروضاً مميّزة
                        وبين المشترين الباحثين عن أفضل صفقات مدينتهم — بضغطة واحدة، بسرعة،
                        وبشفافية.
                    </>
                ) : (
                    <>
                        <strong>TAKI</strong> is a Saudi digital platform for booking
                        merchant discounts and offers. It is built to connect merchants
                        who run distinctive promotions with shoppers searching for the
                        best deals in their city — in a single tap, fast and transparent.
                    </>
                )}
            </Paragraph>

            <Section title={isRTL ? 'رسالتنا' : 'Our Mission'}>
                <Paragraph>
                    {isRTL ? (
                        <>
                            تُهدَر في السعودية مليارات الريالات سنوياً على منتجات لا تُباع،
                            وأطعمة لا تُستهلَك، وعروض لا يعرف بها أحد.{' '}
                            <strong>TAKI</strong> تربط التاجر الراغب في تصريف مخزون أو
                            زيادة إقبال، بالمشتري الذي يبحث عن قيمة حقيقية — في الوقت
                            المناسب، وبدون وسيط معقّد، وبدون رسوم على المشتري.
                        </>
                    ) : (
                        <>
                            Each year, billions of Saudi riyals are wasted on unsold goods,
                            uneaten food and offers no one knows about. <strong>TAKI</strong>{' '}
                            connects merchants who want to clear stock or drive footfall with
                            shoppers searching for genuine value — at the right time, without
                            complicated intermediaries, and at no cost to the buyer.
                        </>
                    )}
                </Paragraph>
            </Section>

            <Section title={isRTL ? 'ما يميّزنا' : 'What sets us apart'}>
                <Bullets items={isRTL ? [
                    <><strong>لحظية</strong>: العروض حقيقية، لمدّة محدّدة، تُحجَز فوراً.</>,
                    <><strong>محلّية</strong>: مبنية للسعودية أوّلاً — اللغة العربية أساسية، الجغرافيا سعودية بالكامل (مناطق، مدن، أحياء).</>,
                    <><strong>موثوقة</strong>: نظام تقييم وبلاغات شفّاف يحمي الطرفين، مع مركز إدارة يراقب الجودة.</>,
                    <><strong>مجانية للمشتري دائماً</strong>: لا اشتراكات، لا رسوم خفيّة، لا عمولة.</>,
                    <><strong>محايدة</strong>: TAKI وسيط رقميّ فقط، لا تتدخّل في تنفيذ المعاملة بين التاجر والمشتري.</>,
                ] : [
                    <><strong>Real-time</strong>: offers are live, time-limited, and bookable instantly.</>,
                    <><strong>Local</strong>: built for Saudi Arabia first — Arabic is the primary language, and the geography is fully Saudi (regions, cities, districts).</>,
                    <><strong>Trustworthy</strong>: a transparent ratings and reports system protects both parties, with an admin centre that monitors quality.</>,
                    <><strong>Always free for buyers</strong>: no subscriptions, no hidden fees, no commission.</>,
                    <><strong>Neutral</strong>: TAKI is a digital intermediary only and does not intervene in the transaction between merchant and buyer.</>,
                ]} />
            </Section>

            <Section title={isRTL ? 'كيف تعمل المنصّة باختصار' : 'How the platform works — in short'}>
                <Bullets items={isRTL ? [
                    <><strong>للمشتري</strong>: ينشئ حساباً مجانياً، يتصفّح العروض حول موقعه، يحجز ما يناسبه بضغطة، يذهب للمحلّ في المدّة المحدّدة ليستفيد من الخصم.</>,
                    <><strong>للتاجر</strong>: ينشئ حساب متجر، يُحدّد فروعه ونشاطه، يضيف عروضه بأسعار ومدد يختارها، يستقبل الحجوزات ويُؤكّدها، ويتواصل مع المشترين عبر شات الحجز.</>,
                    <>لمزيد من التفاصيل، راجع <a href="/faq" className="text-emerald-600 font-bold underline">صفحة الأسئلة الشائعة</a>.</>,
                ] : [
                    <><strong>For buyers</strong>: create a free account, browse offers around your location, book what suits you in a single tap, then visit the store within the offer window to claim the discount.</>,
                    <><strong>For merchants</strong>: create a store account, set up your branches and activity, publish offers with prices and timeframes you choose, accept bookings, and communicate with buyers through the booking chat.</>,
                    <>For more detail, see the <a href="/faq" className="text-emerald-600 font-bold underline">Frequently Asked Questions</a>.</>,
                ]} />
            </Section>

            <Section title={isRTL ? 'التزامنا القانوني والأمني' : 'Our legal and security commitment'}>
                <Bullets items={isRTL ? [
                    'الامتثال لأنظمة المملكة العربية السعودية بشكل كامل (التجارة الإلكترونية، حماية المستهلك، حماية البيانات الشخصية، مكافحة جرائم المعلوماتية).',
                    'تطبيق أعلى معايير الأمان: تشفير TLS، صلاحيات صفّ صارمة، سياسة محتوى صارمة، تشفير قاعدة البيانات.',
                    'الشفافية الكاملة في الوثائق القانونية: شروط الاستخدام، سياسة الخصوصية، سياسة الاسترداد — كلّها متاحة لكلّ مستخدم.',
                ] : [
                    'Full compliance with the laws of the Kingdom of Saudi Arabia (E-Commerce Law, Consumer Protection, Personal Data Protection, and the Anti-Cyber Crime Law).',
                    'High security standards: TLS encryption, strict row-level controls, a firm content policy, and encryption at rest in the database.',
                    'Full transparency across the legal documents: Terms of Service, Privacy Policy and Refund Policy — all available to every user.',
                ]} />
            </Section>

            <Section title={isRTL ? 'تواصل معنا' : 'Get in touch'}>
                <Paragraph>
                    {isRTL ? (
                        <>
                            نُحبّ سماع رأيك واقتراحاتك. زُر صفحة{' '}
                            <a href="/contact" className="text-emerald-600 font-bold underline">اتصل بنا</a>{' '}
                            أو راسلنا عبر زرّ «📣 الشكاوى / تواصل الإدارة» داخل التطبيق.
                        </>
                    ) : (
                        <>
                            We would love to hear your feedback and suggestions. Visit the{' '}
                            <a href="/contact" className="text-emerald-600 font-bold underline">Contact Us</a>{' '}
                            page or message us through the «📣 Complaints / Contact the Admin» button inside the app.
                        </>
                    )}
                </Paragraph>
            </Section>
        </LegalLayout>
    );
};

export default About;
