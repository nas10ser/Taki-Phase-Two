/**
 * Contact page — channels for users to reach TAKI.
 *
 * Doesn't include a contact form — the in-app "📣 شكوى للإدارة" already
 * routes to AdminReports with user attribution, so a separate form would
 * just duplicate that path while creating a second moderation queue.
 */

import React from 'react';
import { LegalLayout, Section, Paragraph } from './LegalLayout';

const Contact: React.FC = () => (
    <LegalLayout
        title="اتصل بنا"
        subtitle="Contact TAKI"
        lastUpdated="2026-05-20"
        draftNotice={false}
    >
        <Paragraph>
            نُحبّ سماعك. اختر القناة الأنسب لك:
        </Paragraph>

        <Section title="📣 الشكاوى والاقتراحات">
            <Paragraph>
                داخل التطبيق، من قائمة حسابك (👤) اختر «📣 شكوى للإدارة».
                هذا أسرع طريق — تصل لإدارتنا مباشرة مع كل تفاصيل حسابك. نسعى
                للردّ في أقرب وقت ممكن وفقاً لطبيعة الطلب وأولويات الإدارة.
            </Paragraph>
        </Section>

        <Section title="🚩 الإبلاغ عن مستخدم أو عرض">
            <Paragraph>
                على كل صفحة عرض أو متجر، زر «🚩 إبلاغ» يفتح نموذجاً مخصّصاً
                لذلك. البلاغات تُراجع يدوياً ولا تُكشف هوية المُبلِّغ للمُبلَّغ
                عنه.
            </Paragraph>
        </Section>

        <Section title="🛍️ التجار">
            <Paragraph>
                إذا أردت الانضمام كتاجر، سجّل عبر <a href="/register" className="text-emerald-600 font-bold underline">صفحة التسجيل</a>{' '}
                واختر «تاجر». سيتولّى فريقنا تفعيل حسابك خلال 24 ساعة.
            </Paragraph>
        </Section>

        <Section title="⚖️ الاستفسارات القانونية والخصوصية">
            <Paragraph>
                من «📣 شكوى للإدارة» اكتب في العنوان كلمة <strong>«خصوصية»</strong>{' '}
                أو <strong>«قانوني»</strong>. تُحوَّل مباشرة لمسؤول حماية البيانات (DPO).
            </Paragraph>
        </Section>

        <Section title="🏛️ الجهات الرقابية">
            <Paragraph>
                إذا لم تتفق مع قرار الإدارة، يمكنك رفع نزاع لـ:
            </Paragraph>
            <ul className="list-disc pr-6 space-y-1.5 text-sm">
                <li><strong>وزارة التجارة</strong> — <a href="https://mc.gov.sa" target="_blank" rel="noopener noreferrer" className="text-emerald-600 font-bold underline">mc.gov.sa</a></li>
                <li><strong>منصة معروف</strong> للتجارة الإلكترونية — <a href="https://maroof.sa" target="_blank" rel="noopener noreferrer" className="text-emerald-600 font-bold underline">maroof.sa</a></li>
                <li><strong>هيئة البيانات والذكاء الاصطناعي (SDAIA)</strong> — <a href="https://sdaia.gov.sa" target="_blank" rel="noopener noreferrer" className="text-emerald-600 font-bold underline">sdaia.gov.sa</a> — للشكاوى المتعلقة بالخصوصية وحماية البيانات.</li>
            </ul>
        </Section>
    </LegalLayout>
);

export default Contact;
