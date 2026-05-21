/**
 * Contact page — قنوات التواصل مع TAKI.
 *
 * لا نُدرج نموذج تواصل خارجي — زرّ «📣 الشكاوى / تواصل الإدارة» داخل التطبيق
 * يُسلّم الرسالة مباشرةً لإدارة الموقع مع كامل بيانات حساب المرسل، فيُغني عن
 * نموذج موازٍ يفتح صفّ مراجعة منفصلاً.
 */

import React from 'react';
import { LegalLayout, Section, Paragraph } from './LegalLayout';

const Contact: React.FC = () => (
    <LegalLayout
        title="اتصل بنا"
        subtitle="Contact TAKI"
        lastUpdated="2026-05-21"
        draftNotice={false}
    >
        <Paragraph>
            نُحبّ سماعك دائماً. اختر القناة الأنسب لطلبك:
        </Paragraph>

        <Section title="📣 الشكاوى والاقتراحات والاستفسارات">
            <Paragraph>
                داخل التطبيق، اضغط على زرّ القائمة الجانبية (☰) ثم اختر
                <strong> «📣 الشكاوى / تواصل الإدارة»</strong>. هذه أسرع وأوثق
                قناة — تصل مباشرةً لإدارة المنصّة مع كامل تفاصيل حسابك، فلا
                تحتاج لإعادة شرح هويّتك. نسعى للردّ في أقرب وقت ممكن وفقاً
                لطبيعة الطلب وأولويّات الإدارة.
            </Paragraph>
        </Section>

        <Section title="🚩 الإبلاغ عن مستخدم أو عرض مُخالف">
            <Paragraph>
                في كلّ صفحة عرض أو متجر، ستجد زرّ <strong>«🚩 إبلاغ»</strong> يفتح
                نموذجاً مخصَّصاً. تُراجَع البلاغات يدوياً من فريق الإدارة، ولا
                تُكشف هويّة المُبلِّغ للمُبلَّغ عنه. تَوقَّع الإجراء بحسب طبيعة المخالفة
                وسلطة الإدارة التقديرية.
            </Paragraph>
        </Section>

        <Section title="🛍️ التسجيل كتاجر">
            <Paragraph>
                للانضمام كتاجر، سجِّل عبر <a href="/register" className="text-emerald-600 font-bold underline">صفحة التسجيل</a>{' '}
                واختر «تاجر». سيتولّى فريق الإدارة مراجعة وتفعيل حسابك في أقرب
                وقت ممكن وفقاً لتسلسل الطلبات. قد تطلب الإدارة وثائق إضافية
                للتحقّق من النشاط التجاري.
            </Paragraph>
        </Section>

        <Section title="⚖️ الاستفسارات القانونية وحماية البيانات (DPO)">
            <Paragraph>
                من زرّ «📣 الشكاوى / تواصل الإدارة»، اكتب في عنوان الرسالة كلمة
                <strong> «خصوصية»</strong> أو <strong>«قانوني»</strong>. تُحوَّل مباشرة
                إلى مسؤول حماية البيانات (DPO)، ويُرَدّ عليها خلال 30 يوماً
                كحدّ أقصى بموجب نظام حماية البيانات الشخصية السعودي.
            </Paragraph>
        </Section>

        <Section title="❓ الأسئلة الشائعة (FAQ)">
            <Paragraph>
                قبل التواصل، يُفضَّل تصفّح <a href="/faq" className="text-emerald-600 font-bold underline">صفحة الأسئلة الشائعة</a>{' '}
                — تجيب عن أكثر الاستفسارات شيوعاً للمشترين والتجار، وتشرح طريقة
                عمل المنصّة بالتفصيل.
            </Paragraph>
        </Section>

        <Section title="🏛️ الجهات الرقابية السعودية (للنزاعات)">
            <Paragraph>
                إذا لم تتفق مع قرار الإدارة، يحقّ لك التقدّم للجهات التالية بحسب
                طبيعة الشكوى:
            </Paragraph>
            <ul className="list-disc pr-6 space-y-1.5 text-sm">
                <li><strong>وزارة التجارة</strong> — <a href="https://mc.gov.sa" target="_blank" rel="noopener noreferrer" className="text-emerald-600 font-bold underline">mc.gov.sa</a> — لقضايا التجارة الإلكترونية وحماية المستهلك.</li>
                <li><strong>منصّة معروف</strong> — <a href="https://maroof.sa" target="_blank" rel="noopener noreferrer" className="text-emerald-600 font-bold underline">maroof.sa</a> — لتوثيق المتاجر والشكاوى عليها.</li>
                <li><strong>البنك المركزي السعودي (SAMA)</strong> — <a href="https://sama.gov.sa" target="_blank" rel="noopener noreferrer" className="text-emerald-600 font-bold underline">sama.gov.sa</a> — للنزاعات المتعلّقة بالمدفوعات الإلكترونية.</li>
                <li><strong>هيئة البيانات والذكاء الاصطناعي (SDAIA)</strong> — <a href="https://sdaia.gov.sa" target="_blank" rel="noopener noreferrer" className="text-emerald-600 font-bold underline">sdaia.gov.sa</a> — للشكاوى المتعلّقة بالخصوصية وحماية البيانات.</li>
            </ul>
        </Section>
    </LegalLayout>
);

export default Contact;
