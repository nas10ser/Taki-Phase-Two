/**
 * About page — من نحن.
 */

import React from 'react';
import { LegalLayout, Section, Paragraph, Bullets } from './LegalLayout';

const About: React.FC = () => (
    <LegalLayout
        title="من نحن"
        subtitle="About TAKI"
        lastUpdated="2026-05-20"
        draftNotice={false}
    >
        <Paragraph>
            <strong>TAKI</strong> منصة سعودية لحجز التخفيضات الذكية. نربط بين
            التجار الذين يقدّمون عروضاً مميّزة، والمشترين الباحثين عن أفضل
            الصفقات في مدنهم — بضغطة واحدة.
        </Paragraph>

        <Section title="رسالتنا">
            <Paragraph>
                نُهدر مليارات الريالات سنوياً على منتجات لا تباع، وأطعمة لا
                تُستهلك، وعروض لا يعرف بها أحد. TAKI تُساعد التاجر على بيع
                مخزونه، والمشتري على توفير ماله — بطريقة لحظية، شفّافة، وممتعة.
            </Paragraph>
        </Section>

        <Section title="ما يميّزنا">
            <Bullets items={[
                'لحظية: العروض حقيقية، لمدّة محدودة، وتُحجز بضغطة واحدة.',
                'محلية: نُركّز على السعودية أولاً، وندعم اللغة العربية كلغة أساسية.',
                'موثوقة: نظام تقييم وبلاغات شفاف يحمي المشتري والتاجر.',
                'مجانية للمشتري دائماً: لا اشتراكات، لا رسوم خفية.',
            ]} />
        </Section>

        <Section title="تواصل معنا">
            <Paragraph>
                نحبّ سماع رأيك. زُر صفحة{' '}
                <a href="/contact" className="text-emerald-600 font-bold underline">اتصل بنا</a>{' '}
                أو راسلنا عبر زر «📣 شكوى للإدارة» داخل التطبيق.
            </Paragraph>
        </Section>
    </LegalLayout>
);

export default About;
