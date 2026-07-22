/**
 * FAQ — الأسئلة الشائعة / Frequently Asked Questions. Bilingual (v11.9).
 *
 * مبنيّة على نموذج accordion بسيط (details/summary) لأنها تعمل بدون JS إضافي،
 * متوافقة مع قارئات الشاشة، وتدعم البحث داخل المتصفّح (Ctrl+F) دون مفاجآت.
 */

import React from 'react';
import { LegalLayout, Section } from './LegalLayout';
import { useApp } from '../../context/AppContext';

interface QA {
    q: string;
    a: React.ReactNode;
}

const Item: React.FC<QA> = ({ q, a }) => (
    <details className="group bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl overflow-hidden transition-shadow open:shadow-md">
        <summary className="cursor-pointer list-none px-4 py-3.5 flex items-start gap-3 font-extrabold text-[var(--text-primary)] text-sm leading-relaxed hover:bg-[var(--gray-50)]">
            <span className="text-emerald-600 text-base mt-0.5 transition-transform group-open:rotate-90 select-none">▸</span>
            <span className="flex-1">{q}</span>
        </summary>
        <div className="px-4 pb-4 pt-1 text-sm leading-relaxed text-[var(--text-secondary)] space-y-2">
            {a}
        </div>
    </details>
);

const Group: React.FC<{ title: string; emoji: string; items: QA[] }> = ({ title, emoji, items }) => (
    <Section title={`${emoji} ${title}`}>
        <div className="space-y-2.5">
            {items.map((it, i) => <Item key={i} q={it.q} a={it.a} />)}
        </div>
    </Section>
);

// ============================================================
// كيف تتم الخدمة / How the service works
// ============================================================
const howItWorksAR: QA[] = [
    {
        q: 'ما هي منصّة TAKI باختصار؟',
        a: <p>TAKI منصّة سعودية رقمية لحجز التخفيضات والعروض من التجار المحلّيين، تعمل عبر الموقع وتطبيق الهاتف. مهمّتنا أن نَربط المشتري الباحث عن صفقة بالتاجر الذي يريد تصريف مخزون أو زيادة الإقبال — بضغطة واحدة، وبدون رسوم على المشتري.</p>,
    },
    {
        q: 'هل TAKI تبيع المنتجات بنفسها؟',
        a: <p><strong>لا</strong>. TAKI <strong>منصّة وسيطة فقط</strong>. لا تشتري، ولا تبيع، ولا تخزّن، ولا تشحن. التجار يَنشرون عروضهم بأنفسهم، والمشترون يحجزون ويذهبون لاستلام البضاعة/الخدمة من التاجر مباشرة.</p>,
    },
    {
        q: 'ما الفرق بين TAKI والمتاجر الإلكترونية التقليدية؟',
        a: <p>في المتجر الإلكتروني التقليدي تشتري المنتج، يُحجَز ثمنه، ويُشحَن إليك. في TAKI أنت <strong>تَحجِز عرضاً</strong>، تذهب إلى موقع التاجر في المدّة المحدّدة، تتفقّد البضاعة بنفسك وتدفع ثمنها مباشرةً للتاجر. لا شحن، لا انتظار طويل، ولا حجز مال على بطاقتك.</p>,
    },
    {
        q: 'كيف تَكسِب TAKI من المنصّة إذاً؟',
        a: <p>المنصّة مجانية تماماً للمشتري. مصدر الدخل (حالياً أو مستقبلاً) قد يكون اشتراكات التجار مقابل خدمات النشر والظهور، أو شراكات مع علامات تجارية. لن تُفرض رسوم خفية على المشتري إطلاقاً.</p>,
    },
    {
        q: 'هل TAKI متوفّرة في كل مدن السعودية؟',
        a: <p>نعم، المنصّة تغطّي جغرافياً كل مناطق المملكة. نشاط التجار يتركّز حالياً في المدن الكبرى، ويتوسّع تدريجياً بحسب انضمام التجار في كل منطقة.</p>,
    },
    {
        q: 'على أيّ قنوات أستطيع استخدام TAKI؟',
        a: <p>عبر الموقع وتطبيق الويب على جوّالك، وعبر <strong>بوت تيليجرام الرسمي @TakiKSA_bot</strong> — اربط حسابك من داخل التطبيق برمز ربط آمن (لا نطلب رقم جوّالك في تيليجرام)، وتابع منه العروض والحجوزات وتصلك إشعاراتك هناك أيضاً. ودعم واتساب يُضاف تدريجياً. أيّ حساب آخر يدّعي أنّه TAKI لا يُمثّلنا.</p>,
    },
    {
        q: 'هل بياناتي محميّة؟',
        a: <p>نعم. نَلتزم بنظام حماية البيانات الشخصية السعودي ولوائحه التنفيذية، ونطبّق إجراءات وقائية فنّية وإدارية معقولة تجارياً لحماية بياناتك. للتفاصيل، راجع <a href="/privacy" className="text-emerald-600 font-bold underline">سياسة الخصوصية</a>.</p>,
    },
    {
        q: 'ما الذي يَحدث عند تَلقّي بَلاغ من مُستخدم؟',
        a: <p>تَستقبل الإدارة البلاغ وتُراجعه بحسب أولويّاتها وسلطتها التَقديرية. ولها — وَحدها — صلاحية اتّخاذ ما تَراه مناسباً (تَحذير، تَعليق، حذف، تَجميد) دون التزام بمدّة زمنية محدَّدة ودون شرح أسباب القرار. آليّات الكشف والعَتبات الداخلية تُعتبر أسراراً تَشغيلية لا يَحقّ لأيّ مستخدم الاطّلاع عليها.</p>,
    },
    {
        q: 'ما الذي يحدث عند نشوء خلاف بين المشتري والتاجر؟',
        a: <p>الخلاف يُحَلّ بين الطرفين مباشرة وفقاً لسياسة التاجر المُعلَنة والأنظمة السعودية لحماية المستهلك. تتدخّل TAKI كميسِّر للتواصل فقط عبر زر «📣 الشكاوى» داخل التطبيق. للنزاعات التي لا تُحلّ ودّياً، يحقّ للطرف غير الراضي اللجوء إلى وزارة التجارة، منصّة معروف، أو المحاكم السعودية المختصّة.</p>,
    },
];

const howItWorksEN: QA[] = [
    {
        q: 'What is TAKI, in short?',
        a: <p>TAKI is a Saudi digital platform for booking discounts and offers from local merchants, available through the website and mobile app. Our mission is to connect shoppers searching for a deal with merchants who want to clear stock or drive footfall — in a single tap, and at no cost to the buyer.</p>,
    },
    {
        q: 'Does TAKI sell products itself?',
        a: <p><strong>No.</strong> TAKI is an <strong>intermediary platform only</strong>. It does not buy, sell, store or ship. Merchants publish their own offers, and buyers book and then collect the goods/service from the merchant directly.</p>,
    },
    {
        q: 'How does TAKI differ from a traditional online store?',
        a: <p>In a traditional online store you buy the product, the price is charged, and it is shipped to you. On TAKI you <strong>book an offer</strong>, go to the merchant's location within the offer window, inspect the goods yourself, and pay for them directly to the merchant. No shipping, no long wait, and no hold on your card.</p>,
    },
    {
        q: 'So how does TAKI earn from the platform?',
        a: <p>The platform is entirely free for buyers. The revenue source — now or in the future — may include merchant subscriptions in return for listing and visibility services, or partnerships with brands. Hidden fees will never be imposed on buyers.</p>,
    },
    {
        q: 'Is TAKI available in every Saudi city?',
        a: <p>Yes — the platform geographically covers every region of the Kingdom. Merchant activity is currently concentrated in the larger cities and expands gradually as merchants join in each region.</p>,
    },
    {
        q: 'On which channels can I use TAKI?',
        a: <p>Through the website and the web app on your phone, and through the <strong>official Telegram bot @TakiKSA_bot</strong> — link your account from inside the app using a secure linking code (we never ask for your phone number on Telegram), then browse offers, manage bookings and receive your notifications there too. WhatsApp support is being rolled out gradually. Any other account claiming to be TAKI does not represent us.</p>,
    },
    {
        q: 'Is my data protected?',
        a: <p>Yes. We comply with the Saudi Personal Data Protection Law and its implementing regulations, and apply commercially reasonable technical and administrative safeguards to protect your data. For details, see the <a href="/privacy" className="text-emerald-600 font-bold underline">Privacy Policy</a>.</p>,
    },
    {
        q: 'What happens when a report is received from a user?',
        a: <p>The administration receives the report and reviews it according to its priorities and discretionary authority. The administration alone has the authority to take whatever action it deems appropriate (warning, suspension, deletion, freezing) without being bound to a specific timeframe and without explaining the reasons for the decision. Detection mechanisms and internal thresholds are considered operational secrets that no user is entitled to inspect.</p>,
    },
    {
        q: 'What happens if a dispute arises between buyer and merchant?',
        a: <p>The dispute is resolved between the two parties directly under the merchant's published policy and Saudi consumer-protection laws. TAKI intervenes only as a facilitator of communication, through the «📣 Complaints» button inside the app. For disputes that cannot be settled amicably, the dissatisfied party may approach the Ministry of Commerce, the Maroof Platform, or the competent Saudi courts.</p>,
    },
];

// ============================================================
// للمشتري / For buyers
// ============================================================
const buyerFAQ_AR: QA[] = [
    {
        q: 'هل التسجيل والاستخدام مجاني للمشتري؟',
        a: <p>نعم، 100% مجاني. لا اشتراك، لا عمولة، لا رسوم خفية. كلّ ما تحتاجه: تسجيل حساب بسيط برقم الجوّال أو البريد، ويمكنك تصفّح كل العروض حول موقعك.</p>,
    },
    {
        q: 'كيف أحجز عرضاً؟',
        a: <ol className="list-decimal ps-5 space-y-1">
            <li>تتصفّح العروض في الصفحة الرئيسية أو من قسم «حولي» لرؤية القريب من موقعك.</li>
            <li>تختار العرض وتقرأ تفاصيله، شروطه، ومدّة صلاحيّته.</li>
            <li>إذا كان للعرض <strong>نسخ</strong> (مقاسات أو أحجام بأسعار مختلفة) أو <strong>اختيارات</strong> (إضافات قد يكون لها سعر إضافي)، تحدّدها أثناء الحجز — <strong>ولكلّ قطعة اختياراتها الخاصّة</strong> (برغر بدون جبنة وآخر بجبنة في نفس الحجز)، ويظهر لك الإجمالي كاملاً قبل التأكيد.</li>
            <li>تضغط زرّ «احجز» — يصلك إشعار بتأكيد الحجز ويصل التاجر إشعار آخر.</li>
            <li>تذهب إلى موقع التاجر خلال المدّة، تستلم البضاعة/الخدمة، وتدفع له مباشرة.</li>
        </ol>,
    },
    {
        q: 'هل يتم سحب أي مبلغ من بطاقتي عند الحجز؟',
        a: <p><strong>لا أبداً</strong>. الحجز التزام مبدئيّ فقط — لا يحجز أيّ مبلغ على بطاقتك، ولا يستلم منك أيّ شيء. الدفع كاملاً يتمّ بينك وبين التاجر في موقعه عند الاستلام.</p>,
    },
    {
        q: 'كم مدّة صلاحية الحجز؟',
        a: <p><strong>ساعتان من لحظة التأكيد</strong>. استلم طلبك من المتجر خلال ساعتين، وإن انتهت المهلة دون استلام يُلغى الحجز تلقائياً وتعود الكمّية للبيع — دون أيّ التزام عليك. تظهر لك المهلة المتبقّية في صفحة «حجوزاتي».</p>,
    },
    {
        q: 'لماذا لا أستطيع الحجز أحياناً؟',
        a: <ul className="list-disc ps-5 space-y-1">
            <li><strong>المحلّ مغلق</strong>: الحجز يتقيّد بساعات عمل المتجر المُعلَنة، ويفتح تلقائياً فور فتح المحلّ (يظهر لك موعد الفتح).</li>
            <li><strong>العرض لم يبدأ بعد</strong>: العروض «القريبة» تعرض عدّاداً تنازلياً ويُفتح حجزها لحظة البداية.</li>
            <li><strong>حدود يضبطها التاجر</strong>: حدّ أقصى للكمّية في الحجز الواحد، حدّ أقصى لعدد حجوزاتك من نفس العرض، أو مدّة انتظار بين الحجوزات.</li>
            <li><strong>نفدت الكمّية</strong> أو نفدت كمّية النسخة (المقاس) التي تريدها.</li>
        </ul>,
    },
    {
        q: 'هل يمكنني إلغاء الحجز؟',
        a: <p>نعم، في أيّ وقت قبل انتهاء صلاحيّة العرض، من صفحة «حجوزاتي» بضغطة واحدة، بدون أيّ غرامة من المنصّة. لكن تجنّب الحجز المتكرّر بدون نيّة الحضور — قد يُقيَّد حسابك إن أُسيء الاستخدام.</p>,
    },
    {
        q: 'ماذا لو لم أحضر في الوقت المحدّد؟',
        a: <p>يحقّ للتاجر إلغاء الحجز من جانبه، وقد يَفقد العرض. إن كان العرض لا يزال متوفّراً يمكنك إعادة الحجز. تكرار التغيّب قد يؤدّي إلى تقييد حسابك لأنّه يُضرّ بثقة التجار.</p>,
    },
    {
        q: 'هل التاجر يَرى رقم جوّالي؟',
        a: <p>نعم، عند الحجز يَرى التاجر اسمك ورقم جوّالك وعدد الحجز لكي يتواصل معك ويسلّمك العرض. لا نُشارك بريدك الإلكتروني ولا بياناتك المالية معه. ولا يَحقّ للتاجر استخدام رقمك لأيّ غرض خارج هذا الحجز تحديداً.</p>,
    },
    {
        q: 'كيف أحصل على استرداد إذا كان المنتج تالفاً أو لم يطابق الوصف؟',
        a: <p>الاسترداد يتمّ <strong>عبر التاجر مباشرةً</strong> وفق سياسته المُعلَنة (كل تاجر له سياسته). تواصَل معه أوّلاً عبر شات الحجز. إن لم يستجب أو رفض الالتزام بسياسته، ارفع شكوى عبر «📣 الشكاوى» داخل التطبيق. للنزاعات التي لا تُحلّ، يحقّ لك التقدّم إلى <a href="https://mc.gov.sa" target="_blank" rel="noopener noreferrer" className="text-emerald-600 font-bold underline">وزارة التجارة</a> أو <a href="https://maroof.sa" target="_blank" rel="noopener noreferrer" className="text-emerald-600 font-bold underline">منصّة معروف</a>.</p>,
    },
    {
        q: 'كيف أقيّم تجربتي مع متجر؟',
        a: <p>بعد إتمام الحجز، يظهر لك خيار تقييم المتجر بنجوم وإضافة تعليق. لك <strong>تقييم واحد لكلّ متجر</strong>، ويمكنك <strong>تعديله أو حذفه</strong> في أيّ وقت، وللتاجر حقّ الردّ عليه. التقييم الصادق يُساعد المشترين الآخرين ويُحفّز التجار على تحسين خدماتهم. تجنّب التقييمات الكيدية أو غير الصادقة لأنّها قد تتعرّض للحذف.</p>,
    },
    {
        q: 'ما تصويت «أصالة المنتج»؟',
        a: <p>بعد استلام طلبك فعلياً، يمكنك التصويت على أصالة المنتج (🔵 أصلي / 🟡 غير أصلي). التصويت متاح <strong>فقط لمن أتمّ حجزاً حقيقياً</strong> — فلا يستطيع أحد التلاعب به — ويظهر مجموعه للمشترين في صفحة العرض، ويمكنك تعديل تصويتك لاحقاً.</p>,
    },
    {
        q: 'ما المسابقات والسحوبات في TAKI؟',
        a: <p>من صفحة «المسابقات» تُشارك مجاناً في مسابقات واستبيانات بجوائز تُعلنها المنصّة. التصحيح تلقائي، ونتائج السحب تُعرض <strong>بهوية مموّهة</strong> حفاظاً على الخصوصية، وإجاباتك لا يطّلع عليها غير الإدارة. المشاركة اختيارية بالكامل، ولكلّ مسابقة شروطها المُعلَنة وقتها.</p>,
    },
    {
        q: 'ما رمز الإحالة وكيف أستخدمه؟',
        a: <p>من صفحة «حسابي» تجد <strong>رمز إحالة</strong> خاصّاً بك مع رابط جاهز للمشاركة. عند تسجيل أصدقائك عبر رابطك تُحسب الإحالة لك، وقد تدخل بها في ترتيب النشاط أو سحوبات تُعلنها المنصّة من وقت لآخر.</p>,
    },
    {
        q: 'لاحظت عرضاً مخالفاً أو متجراً مشبوهاً، ماذا أفعل؟',
        a: <p>اضغط زرّ «🚩 إبلاغ» في صفحة العرض أو المتجر، اختر سبب البلاغ، واكتب التفاصيل. تُراجَع البلاغات يدوياً ولا تُكشف هويّتك للمُبلَّغ عنه. إذا كان البلاغ يخصّ جريمة (احتيال، تهديد، إلخ.)، أبلِغ الجهات الأمنية أيضاً بشكل مستقلّ.</p>,
    },
    {
        q: 'كيف أَحمي نفسي من الاحتيال؟',
        a: <ul className="list-disc ps-5 space-y-1">
            <li>تَأكّد من هوية التاجر قَبل أيّ تَعامل، وفَحص العرض/البضاعة عند الاستلام.</li>
            <li>تَعامل في مكان عامّ وآمن، وفي ساعات معروفة.</li>
            <li>لا تُشارك مع أحد بياناتك الشخصية أو رموز التحقّق أو كلمات المرور — مهما كان السبب.</li>
            <li>لا تَفتح روابط مَشبوهة تَصلك خارج المنصّة، حتى لو ادّعى المُرسِل أنّها آمنة.</li>
            <li>لا تَدفع لشخص لا تَعرفه بناءً على وَعد بوظيفة أو عمولة أو استثمار.</li>
            <li>لا تَنقل التعامل خارج المنصّة بطلب من التاجر — هذا غالباً مؤشّر احتيال.</li>
        </ul>,
    },
    {
        q: 'تَعرّضت لاحتيال أو إساءة من تاجر، ماذا أفعل؟',
        a: <ol className="list-decimal ps-5 space-y-1">
            <li>ارفع بَلاغاً فوريّاً عبر زرّ «🚩 إبلاغ» على المتجر أو العرض.</li>
            <li>راسل الإدارة عبر «📣 الشكاوى» مع كلّ التفاصيل والأدلّة.</li>
            <li>تَوجّه إلى أقرب مَركز شرطة وارفع شكوى رسمية ضدّ المُحتال.</li>
            <li>TAKI ليست طرفاً في النزاع، لكنّها تَتعاون مع الجهات الأمنية وتُقدّم البيانات المُتاحة عند ورود طلب رسميّ. وتُوقف الحسابات المُتورّطة لحماية المستخدمين الآخرين.</li>
        </ol>,
    },
    {
        q: 'تَعرّضت لمُضايقة أو تَهديد، ماذا أفعل؟',
        a: <>
            <p>تَلتزم TAKI بتَوفير بيئة آمنة. عند التَعرّض لأيّ مُضايقة أو تَهديد أو تَنمّر أو تَمييز:</p>
            <ul className="list-disc ps-5 space-y-1 mt-2">
                <li>احظر المُستخدم فوراً من خلال أدوات الحظر في الشات.</li>
                <li>ارفع بلاغاً عَلى الحساب المُسيء.</li>
                <li>راسل الإدارة عبر «📣 الشكاوى».</li>
                <li>عند وقوع ضرر، ارفع شكوى لدى الجهات الأمنية، أو هيئة حقوق الإنسان (<a href="https://www.hrc.gov.sa" target="_blank" rel="noopener noreferrer" className="text-emerald-600 font-bold underline">hrc.gov.sa</a>) عند الحاجة.</li>
            </ul>
        </>,
    },
    {
        q: 'كيف أحصل على تنبيهات للعروض المهمّة؟',
        a: <p>من صفحة «حسابي» يمكنك ضبط <strong>التنبيهات الذكية</strong>: حدّد فئات تهمّك، تجاراً تَتبَعهم، أو كلمات مفتاحية، وستصلك إشعارات فور نزول عرض يطابق تفضيلاتك. وتابع صفحة <strong>«العروض الموسمية»</strong> لعروض المواسم والحملات (رمضان، العيد، التخفيضات الموسمية…) مع تذكيرات قبل انطلاقها. الكلّ اختياري ويمكنك تعطيله متى تشاء — وإن ربطت حسابك ببوت تيليجرام تصلك الإشعارات هناك أيضاً.</p>,
    },
    {
        q: 'هل يمكنني حذف حسابي نهائياً؟',
        a: <p>نعم. من القائمة الجانبية (☰) ← «حذف الحساب نهائياً». ستُحذَف بياناتك خلال مدّة قصيرة، مع احتفاظنا بالحدّ الأدنى الذي تقتضيه الالتزامات النظامية المعمول بها (مثل سجلّات المعاملات للمدّة التي تتطلّبها الأنظمة).</p>,
    },
];

const buyerFAQ_EN: QA[] = [
    {
        q: 'Is registration and use free for buyers?',
        a: <p>Yes — 100% free. No subscriptions, no commission, no hidden fees. All you need is a quick account using your mobile number or email, and you can browse every offer around you.</p>,
    },
    {
        q: 'How do I book an offer?',
        a: <ol className="list-decimal ps-5 space-y-1">
            <li>Browse offers on the home page or in the «Nearby» section to see what is close to you.</li>
            <li>Choose an offer and read its details, conditions and validity window.</li>
            <li>If the offer has <strong>versions</strong> (sizes at different prices) or <strong>options</strong> (add-ons that may carry an extra price), pick them while booking — <strong>each item gets its own choices</strong> (one burger without cheese and another with cheese in the same booking), and the full total is shown before you confirm.</li>
            <li>Tap «Book» — you receive a booking confirmation and the merchant receives a notification.</li>
            <li>Visit the merchant's location within the window, collect the goods or service, and pay them directly.</li>
        </ol>,
    },
    {
        q: 'Is any amount charged to my card on booking?',
        a: <p><strong>Never.</strong> The booking is a preliminary commitment only — no amount is held on your card, and nothing is collected from you. Full payment is made between you and the merchant at their location on receipt.</p>,
    },
    {
        q: 'How long does a booking stay valid?',
        a: <p><strong>Two hours from the moment of confirmation.</strong> Collect your order from the store within two hours; if the window passes without pickup, the booking is cancelled automatically and the quantity returns to sale — at no obligation to you. The remaining time is shown on your «My Bookings» page.</p>,
    },
    {
        q: 'Why am I sometimes unable to book?',
        a: <ul className="list-disc ps-5 space-y-1">
            <li><strong>The shop is closed</strong>: booking follows the store's published working hours and re-opens automatically the moment the shop opens (the opening time is shown to you).</li>
            <li><strong>The offer has not started yet</strong>: «coming soon» offers show a countdown and become bookable the moment they start.</li>
            <li><strong>Merchant-set limits</strong>: a cap per single booking, a cap on your total bookings of the same offer, or a waiting period between bookings.</li>
            <li><strong>Sold out</strong> — either the whole offer or the specific version (size) you want.</li>
        </ul>,
    },
    {
        q: 'Can I cancel a booking?',
        a: <p>Yes, at any time before the offer expires, from the «My Bookings» page in a single tap, with no penalty from the platform. But avoid repeated bookings without intent to attend — your account may be restricted if the feature is misused.</p>,
    },
    {
        q: 'What if I do not attend on time?',
        a: <p>The merchant may cancel the booking from their side, and you may lose the offer. If the offer is still available you can re-book. Repeated no-shows may result in restrictions on your account, since they damage merchant trust.</p>,
    },
    {
        q: 'Does the merchant see my mobile number?',
        a: <p>Yes — on booking, the merchant sees your name, mobile number and booking quantity in order to contact you and hand over the offer. We do not share your email address or financial data with them. The merchant is not permitted to use your number for any purpose outside that booking.</p>,
    },
    {
        q: 'How do I obtain a refund if a product is faulty or does not match the description?',
        a: <p>The refund is processed <strong>directly through the merchant</strong> under their published policy (every merchant has its own). Contact them first via the booking chat. If they do not respond or refuse to honour their policy, raise a complaint via «📣 Complaints» inside the app. For unresolved disputes you may approach the <a href="https://mc.gov.sa" target="_blank" rel="noopener noreferrer" className="text-emerald-600 font-bold underline">Ministry of Commerce</a> or the <a href="https://maroof.sa" target="_blank" rel="noopener noreferrer" className="text-emerald-600 font-bold underline">Maroof Platform</a>.</p>,
    },
    {
        q: 'How do I rate my experience with a store?',
        a: <p>After completing a booking, you will see an option to rate the store in stars and add a comment. You have <strong>one rating per store</strong>, which you can <strong>edit or delete</strong> at any time, and the merchant may reply to it. An honest review helps other buyers and motivates merchants to improve. Avoid malicious or untruthful ratings — they may be removed.</p>,
    },
    {
        q: 'What is the «product authenticity» vote?',
        a: <p>After actually collecting your order, you can vote on the product's authenticity (🔵 genuine / 🟡 not genuine). The vote is available <strong>only to buyers who completed a real booking</strong> — so it cannot be gamed — its tally is shown to buyers on the offer page, and you can change your vote later.</p>,
    },
    {
        q: 'What are TAKI contests and draws?',
        a: <p>From the «Contests» page you can enter free contests and surveys with prizes announced by the platform. Grading is automatic, draw results are displayed with <strong>masked identities</strong> to protect privacy, and your answers are visible to the administration only. Participation is entirely optional, and each contest has its own rules announced at the time.</p>,
    },
    {
        q: 'What is the referral code and how do I use it?',
        a: <p>On the «My Account» page you will find your personal <strong>referral code</strong> with a ready-to-share link. When friends register through your link, the referral is credited to you, and it may count towards activity rankings or draws announced by the platform from time to time.</p>,
    },
    {
        q: 'I have noticed a non-compliant offer or a suspicious store — what do I do?',
        a: <p>Tap the «🚩 Report» button on the offer or store page, choose a reason and add details. Reports are reviewed manually and your identity is not disclosed to the reported party. If the matter concerns a crime (fraud, threats, etc.), also report it independently to the security authorities.</p>,
    },
    {
        q: 'How do I protect myself from fraud?',
        a: <ul className="list-disc ps-5 space-y-1">
            <li>Verify the merchant's identity before any interaction, and inspect the offer/goods on receipt.</li>
            <li>Meet in a safe public place during reasonable hours.</li>
            <li>Never share your personal data, verification codes or passwords with anyone, whatever the reason.</li>
            <li>Do not open suspicious links sent from outside the platform, even if the sender claims they are safe.</li>
            <li>Do not pay a person you do not know on the promise of a job, commission or investment.</li>
            <li>Do not take the dealing off-platform at the merchant's request — that is often a fraud signal.</li>
        </ul>,
    },
    {
        q: 'I have been defrauded or mistreated by a merchant — what do I do?',
        a: <ol className="list-decimal ps-5 space-y-1">
            <li>Raise an immediate report via the «🚩 Report» button on the store or offer.</li>
            <li>Message the administration via «📣 Complaints» with all the details and evidence.</li>
            <li>Visit the nearest police station and lodge a formal complaint against the offender.</li>
            <li>TAKI is not a party to the dispute, but it cooperates with the security authorities and provides available data on receipt of an official request. It also suspends the accounts involved to protect other users.</li>
        </ol>,
    },
    {
        q: 'I have been harassed or threatened — what do I do?',
        a: <>
            <p>TAKI is committed to providing a safe environment. If you are harassed, threatened, bullied or discriminated against:</p>
            <ul className="list-disc ps-5 space-y-1 mt-2">
                <li>Block the user immediately using the blocking tools in the chat.</li>
                <li>Report the offending account.</li>
                <li>Message the administration via «📣 Complaints».</li>
                <li>If harm has been done, lodge a complaint with the security authorities, or with the Human Rights Commission (<a href="https://www.hrc.gov.sa" target="_blank" rel="noopener noreferrer" className="text-emerald-600 font-bold underline">hrc.gov.sa</a>) where needed.</li>
            </ul>
        </>,
    },
    {
        q: 'How do I get alerts for offers that matter to me?',
        a: <p>From the «My Account» page you can configure <strong>Smart Alerts</strong>: pick categories of interest, merchants to follow, or keywords, and you will be notified whenever an offer matches your preferences. Also check the <strong>«Seasonal Offers»</strong> page for seasons and campaigns (Ramadan, Eid, seasonal sales…) with reminders before they launch. It is all optional and you can disable it at any time — and if you have linked your account to the Telegram bot, notifications reach you there too.</p>,
    },
    {
        q: 'Can I permanently delete my account?',
        a: <p>Yes. From the side menu (☰) → «Delete account permanently». Your data is deleted within a short period, save the minimum we are required by applicable law to retain (such as transaction records for the period required by the regulations).</p>,
    },
];

// ============================================================
// للتاجر / For merchants
// ============================================================
const merchantFAQ_AR: QA[] = [
    {
        q: 'كيف أُسجِّل كتاجر؟',
        a: <ol className="list-decimal ps-5 space-y-1">
            <li>ادخل صفحة التسجيل واختر «تاجر».</li>
            <li>أَدخِل بيانات متجرك: الاسم، الفئة، الموقع، الفروع، صور تعريفية.</li>
            <li>تَوافق على الشروط القانونية الإلزامية.</li>
            <li>يُفعَّل الحساب فوراً بعد الإكمال، وتَبدأ باستخدام لوحة التاجر مباشرةً. وللإدارة الحقّ في طَلب أيّ وثائق نظامية لاحقاً عند الحاجة.</li>
        </ol>,
    },
    {
        q: 'هل التسجيل كتاجر مدفوع؟',
        a: <p>يَحصل كلّ تاجر جديد على <strong>فترة تجريبية مجانية</strong> (تُحدِّد المنصّة مدّتها وقد تتغيّر من وقت لآخر) يَستخدم خلالها ميزات لوحة التاجر دون دفع. بعد انتهائها، يَلزم تَفعيل اشتراك مدفوع لمتابعة النشر واستقبال الحجوزات. تتعدّد الباقات <strong>بحسب عدد المواقع (اللوكيشنات)</strong> التي يحتاجها متجرك، وتُعرض أسعارها وتفاصيلها <strong>داخل التطبيق وقت الاشتراك وقد تتغيّر</strong> (لا سعر ثابت مُعلَن مسبقاً). النموذج العامّ: «ادفع للمدّة المختارة، ألغِ متى تشاء، واستفد حتى نهايتها» (راجع <a href="/refund" className="text-emerald-600 font-bold underline">سياسة الاسترداد</a>).</p>,
    },
    {
        q: 'كم سعر الاشتراك؟ وهل هو ثابت؟',
        a: <p>لا يوجد سعر واحد ثابت. هناك <strong>عدّة باقات تختلف بحسب عدد المواقع (اللوكيشنات)</strong> التي يَسري عليها نشاطك — كلّما زادت المواقع المطلوبة ارتفعت الباقة. تُعرض أسعار الباقات وتفاصيلها <strong>داخل التطبيق عند الاشتراك</strong>، وقد تُحدِّث الإدارة الأسعار أو الباقات من وقت لآخر، ويسري عليك السعر المُعلَن وقت اشتراكك.</p>,
    },
    {
        q: 'كيف أُضيف عرضاً جديداً؟',
        a: <ol className="list-decimal ps-5 space-y-1">
            <li>من «لوحة التاجر» اضغط «➕ إضافة عرض».</li>
            <li>اكتب عنوان العرض، وصفه، السعر قبل وبعد التخفيض.</li>
            <li>حدّد الكمّيّة المتاحة ومدّة صلاحيّة العرض (تاريخ بداية ونهاية).</li>
            <li>عند الحاجة، أضف <strong>نسخ المنتج</strong> (مقاسات/أحجام لكلّ منها سعرها وخصمها وكمّيتها وصورتها) و<strong>اختيارات المنتج</strong> (أقسام إضافات قد تحمل سعراً إضافياً يدخل تلقائياً في إجمالي الحجز — والمشتري يحدّد اختيارات كلّ قطعة على حدة).</li>
            <li>اضبط <strong>حدود الحجز</strong> إن أردت: حدّ أقصى للحجز الواحد، حدّ لكلّ مشترٍ، ومدّة انتظار بين الحجوزات.</li>
            <li>ارفع صوراً واضحة (يَدعم محرّر القصّ الذكيّ لتعديل النسبة).</li>
            <li>اختر الفرع أو الفروع التي يَسري عليها العرض، واربطه بموسم أو حملة عند توفّرها.</li>
            <li>اضغط «انشر» — يَظهر العرض فوراً للمشترين.</li>
        </ol>,
    },
    {
        q: 'هل يمكنني تحديد ساعات عمل محلّي؟',
        a: <p>نعم. من إعدادات المتجر حدّد <strong>ساعات العمل</strong> لكلّ يوم (حتى فترتين في اليوم الواحد). خارج هذه الساعات يُقفل زرّ الحجز تلقائياً ويظهر للمشتري موعد الفتح، ويستأنف الحجز فور فتح المحلّ — كما يستفيد متجرك من فلتر «مفتوح الآن» في التصفّح.</p>,
    },
    {
        q: 'ماذا يحدث عند انتهاء اشتراكي؟',
        a: <p>تصلك <strong>تذكيرات قبل الانتهاء</strong>، وعند انتهاء الاشتراك دون تجديد تتوقّف عروضك عن الظهور تلقائياً — <strong>ولا يوجد تجديد تلقائي ولا سحب إضافي</strong>. بعد التجديد تُعيد تفعيل عروضك بنفسك بما يوافق سقف المواقع في باقتك.</p>,
    },
    {
        q: 'ما خيارات الظهور الإضافية لمتجري؟',
        a: <p>تتوفّر خدمات ظهور مدفوعة — مثل «راعٍ رسمي» و«إعلان» و«⭐» — تمنح عروضك شارات مميّزة وترتيباً أعلى في التصفّح وفي البوت. تُعرض تفاصيلها وأسعارها داخل التطبيق، وتنتهي بانتهاء اشتراكها.</p>,
    },
    {
        q: 'هل أستطيع إدارة متجري من تيليجرام؟',
        a: <p>نعم. بعد ربط حسابك بالبوت الرسمي <strong>@TakiKSA_bot</strong> تستطيع إضافة عروض وتعديلها، ومتابعة الحجوزات الواردة وتأكيد الاستلام أو الإلغاء، ومحادثة المشتري — وتصلك إشعارات الحجوزات فور وقوعها.</p>,
    },
    {
        q: 'كيف أستقبل الحجوزات؟',
        a: <p>تَصِلك إشعارات فورية داخل التطبيق عند كلّ حجز جديد. من «لوحة التاجر» ← «الطلبات» تَرى كل الحجوزات الواردة مع بيانات المشتري الأساسية (الاسم ورقم الجوّال) ووقت الحجز. يمكنك التواصل مع المشتري عبر شات الحجز لتأكيد التفاصيل.</p>,
    },
    {
        q: 'ماذا أفعل عند حضور المشتري لاستلام العرض؟',
        a: <p>تحقّق من رقم الحجز من تطبيق المشتري (يَظهر في «حجوزاتي» عنده)، سلّمه البضاعة أو قدّم له الخدمة، استلم الثمن بالطريقة المناسبة (نقد / بطاقة / تحويل)، ثم اضغط «✓ إكمال الحجز» من لوحتك. هذا يُحدِّث الكمّيّة المتبقّية تلقائياً.</p>,
    },
    {
        q: 'ماذا أفعل إذا لم يحضر المشتري؟',
        a: <p>يحقّ لك إلغاء الحجز من «لوحة التاجر» بعد انتهاء مدّة صلاحيّته. لا توجد عقوبة عليك من المنصّة. تكرار عدم الحضور من نفس المشتري يُسجَّل تلقائياً في النظام وقد يؤدّي إلى تقييد حسابه.</p>,
    },
    {
        q: 'هل يمكنني إدارة فروع متعدّدة؟',
        a: <p>نعم. من إعدادات المتجر تَستطيع إضافة مواقع متعدّدة وربط كلّ عرض بالموقع/المواقع التي يَسري عليها. <strong>عدد المواقع المسموح يعتمد على باقتك</strong>: هناك عدّة باقات تزيد فيها المواقع المسموحة تدريجياً (باقة أساسية بعددٍ محدود، وباقات أعلى بمواقع أكثر) — وتُعرض تفاصيلها وأسعارها داخل التطبيق.</p>,
    },
    {
        q: 'هل يمكنني الردّ على تقييمات المشترين؟',
        a: <p>نعم. من «لوحة التاجر» ← <strong>تَبويب «⭐ التقييمات»</strong> تَجد كلّ التَقييمات على عُروضك في مكان واحد، وتحت كلّ تَقييم زرّ <strong>«💬 الردّ على هذا التعليق»</strong> (مثل فيسبوك تماماً) — اكتب ردّك واضغط «إرسال» فيَظهر تحت التَعليق مباشرةً. الردّ الهادئ والمهنيّ على التقييمات السلبية يَبني الثقة. لا تُجادل ولا تُهدِّد — أيّ ردّ غير لائق قد يُحذَف.</p>,
    },
    {
        q: 'هل يمكنني نَشر منتجات محظورة؟',
        a: <p>لا. نَشر أيّ منتج يخالف الأنظمة السعودية (مخدّرات، خمر، أدوية موصوفة، أسلحة، تَسويق شبكيّ، أوراق مالية، أجهزة تَجسّس، منتجات مقلَّدة، تَبغ، تَقسيط ومنتجات بنكية، إلخ.) يُؤدّي فوراً إلى حذف العرض، تعليق الحساب، وإحالة الواقعة للجهات الأمنية. القائمة الكاملة في <a href="/terms" className="text-emerald-600 font-bold underline">شروط الاستخدام (القسم 7)</a>.</p>,
    },
    {
        q: 'تَعرّضت لمُشتري احتياليّ، ماذا أفعل؟',
        a: <ol className="list-decimal ps-5 space-y-1">
            <li>ارفع بَلاغاً على المشتري عبر «🚩 إبلاغ» في صفحة الحجز مع وصف الواقعة.</li>
            <li>راسل الإدارة عبر «📣 الشكاوى» مع الأدلّة المتوفّرة.</li>
            <li>تَوجّه للجهات الأمنية لرفع شكوى رسمية إن وَقع ضرر فعليّ.</li>
            <li>TAKI تَتعاون مع الجهات الأمنية وتَستجيب لطلباتها الرسمية، وتُوقف الحسابات المُتورّطة لحماية باقي التجار.</li>
        </ol>,
    },
    {
        q: 'هل التاجر مسؤول عن سياسة الاسترجاع والاستبدال؟',
        a: <p><strong>نعم بشكل كامل</strong>. سياسة الاسترجاع والاستبدال محصورة بينك وبين المشتري، وتَخضع لِما تُعلِنه أنت في متجرك أو ما تَنصّ عليه الأنظمة السعودية لحماية المستهلك. TAKI ليست طرفاً في الاسترجاع، ولا تَضمنه، ولا تُنفِّذه. يُنصح بأن تَنشر سياستك بوضوح في صفحة متجرك لتجنّب الخلافات.</p>,
    },
    {
        q: 'هل TAKI تَستلم ثمن مبيعاتي؟',
        a: <p>لا. كلّ ثمن البضاعة/الخدمة يستلمه التاجر مباشرةً من المشتري عند الاستلام في الموقع. TAKI لا تتدخّل في تحويل الأموال بين الطرفين، ولا تستلم نيابةً عن أيّ تاجر، ولا تَحتفظ ببيانات بطاقة المشتري.</p>,
    },
    {
        q: 'ما المسؤوليات النظامية على عاتقي كتاجر؟',
        a: <ul className="list-disc ps-5 space-y-1">
            <li>حِيازَة سجلّ تجاري ساري أو وثيقة عمل حرّ، وأيّ ترخيص نظامي يَلزم نشاطك.</li>
            <li>إصدار فواتير ضريبية للمشتري إن انطبق عليك ذلك بحسب أنظمة هيئة الزكاة والضريبة.</li>
            <li>الالتزام بسياسة استرداد واضحة ومُعلَنة للمشتري، وفقاً لنظام حماية المستهلك.</li>
            <li>دقّة وصف العروض — لا «طُعم وتبديل» (bait-and-switch) ولا تسعير مُضلِّل.</li>
            <li>تنفيذ كلّ حجز صحيح ما لم يقع سبب نظاميّ يمنع ذلك.</li>
            <li>عدم استخدام بيانات اتصال المشتري لأيّ غرض خارج تنفيذ الحجز نفسه.</li>
        </ul>,
    },
    {
        q: 'كيف أقفل حسابي كتاجر؟',
        a: <p>من «إعدادات الحساب» ← «حذف الحساب». الحجوزات الجارية يجب تنفيذها أو إلغاؤها أوّلاً. عند تفعيل الاشتراك المدفوع، يبقى الاشتراك نافذاً حتى نهاية المدّة المدفوعة دون استرداد جزئي (راجع <a href="/refund" className="text-emerald-600 font-bold underline">سياسة الاسترداد</a>).</p>,
    },
];

const merchantFAQ_EN: QA[] = [
    {
        q: 'How do I register as a merchant?',
        a: <ol className="list-decimal ps-5 space-y-1">
            <li>Open the registration page and choose «Merchant».</li>
            <li>Enter your store details: name, category, location, branches, and introductory images.</li>
            <li>Accept the binding legal terms.</li>
            <li>The account is activated immediately on completion and you can start using the merchant dashboard right away. The administration retains the right to request regulatory documents at any later point if needed.</li>
        </ol>,
    },
    {
        q: 'Is merchant registration paid?',
        a: <p>Every new merchant gets a <strong>free trial period</strong> (its length is set by the platform and may change from time to time) during which the merchant-dashboard features are available at no charge. Once it ends, a paid subscription is required to continue publishing and receiving bookings. There are <strong>several packages that differ by the number of locations</strong> your store needs, and their prices and details are shown <strong>inside the app at the time of subscription and may change</strong> (no fixed price announced in advance). The general model is: «Pay for the chosen period, cancel anytime, and benefit until it ends» (see the <a href="/refund" className="text-emerald-600 font-bold underline">Refund Policy</a>).</p>,
    },
    {
        q: 'How much is the subscription? Is it fixed?',
        a: <p>There is no single fixed price. There are <strong>several packages that differ by the number of locations</strong> your activity covers — the more locations required, the higher the package. Package prices and details are shown <strong>inside the app at the time of subscription</strong>, and the administration may update prices or packages from time to time; the price that applies to you is the one shown when you subscribe.</p>,
    },
    {
        q: 'How do I add a new offer?',
        a: <ol className="list-decimal ps-5 space-y-1">
            <li>From the «Merchant Dashboard» tap «➕ Add offer».</li>
            <li>Enter the title, description, and price before and after discount.</li>
            <li>Set the available quantity and offer window (start and end date).</li>
            <li>Where needed, add <strong>product versions</strong> (sizes, each with its own price, discount, quantity and image) and <strong>product options</strong> (add-on groups that may carry an extra price which joins the booking total automatically — the buyer picks options for each item separately).</li>
            <li>Set <strong>booking limits</strong> if you wish: a cap per single booking, a cap per buyer, and a waiting period between bookings.</li>
            <li>Upload clear images (the smart crop editor lets you adjust the ratio).</li>
            <li>Select the branch or branches to which the offer applies, and link it to a season or campaign where available.</li>
            <li>Tap «Publish» — the offer appears to buyers immediately.</li>
        </ol>,
    },
    {
        q: 'Can I set my shop\'s working hours?',
        a: <p>Yes. From the store settings, set your <strong>working hours</strong> per day (up to two shifts a day). Outside those hours the booking button locks automatically and buyers see the opening time; booking resumes the moment the shop opens — and your store benefits from the «Open now» browsing filter.</p>,
    },
    {
        q: 'What happens when my subscription expires?',
        a: <p>You receive <strong>reminders before expiry</strong>. If the subscription ends without renewal, your offers stop appearing automatically — <strong>there is no auto-renewal and no extra charge</strong>. After renewing, you re-activate your offers yourself within the location cap of your package.</p>,
    },
    {
        q: 'What extra visibility options are available for my store?',
        a: <p>Paid visibility services are available — such as «Official Sponsor», «Ad» and «⭐» — giving your offers distinctive badges and higher placement in browsing and in the bot. Their details and prices are shown inside the app, and they end when their subscription ends.</p>,
    },
    {
        q: 'Can I manage my store from Telegram?',
        a: <p>Yes. After linking your account to the official bot <strong>@TakiKSA_bot</strong>, you can add and edit offers, track incoming bookings, confirm pickup or cancel, and chat with the buyer — with instant notifications for every new booking.</p>,
    },
    {
        q: 'How do I receive bookings?',
        a: <p>You receive instant in-app notifications for every new booking. From the «Merchant Dashboard» → «Orders» you can see all incoming bookings with basic buyer details (name and mobile number) and booking time. You can communicate with the buyer through the booking chat to confirm details.</p>,
    },
    {
        q: 'What do I do when the buyer arrives to collect the offer?',
        a: <p>Verify the booking number from the buyer's app (it appears in their «My Bookings»), hand over the goods or provide the service, take payment by the appropriate means (cash / card / transfer), then tap «✓ Complete booking» from your dashboard. This automatically updates the remaining quantity.</p>,
    },
    {
        q: 'What do I do if the buyer does not attend?',
        a: <p>You may cancel the booking from the «Merchant Dashboard» once it has expired. There is no penalty from the platform. Repeated no-shows from the same buyer are recorded automatically by the system and may result in restrictions on their account.</p>,
    },
    {
        q: 'Can I manage multiple branches?',
        a: <p>Yes. From the store settings you can add multiple locations and link each offer to the location(s) on which it applies. <strong>The number of locations allowed depends on your package</strong>: there are several packages that progressively increase the allowed locations (a basic package with a limited number, and higher packages with more) — their details and prices are shown inside the app.</p>,
    },
    {
        q: 'Can I reply to buyers\' ratings?',
        a: <p>Yes. From the «Merchant Dashboard» → the <strong>«⭐ Reviews» tab</strong>, you can see every rating on your deals in one place, with a <strong>«💬 Reply to this review»</strong> button under each one (just like Facebook). Type your reply and tap «Send» — it appears directly under the review. A calm, professional reply to negative ratings builds trust. Do not argue or threaten — any inappropriate reply may be removed.</p>,
    },
    {
        q: 'Can I publish prohibited products?',
        a: <p>No. Publishing any product that contravenes Saudi laws (drugs, alcohol, prescription medication, weapons, network/pyramid marketing, securities, surveillance devices, counterfeit goods, tobacco, instalment or banking products, etc.) leads immediately to removal of the offer, suspension of the account, and referral of the matter to the security authorities. The full list is in the <a href="/terms" className="text-emerald-600 font-bold underline">Terms of Service (Section 7)</a>.</p>,
    },
    {
        q: 'I have been targeted by a fraudulent buyer — what do I do?',
        a: <ol className="list-decimal ps-5 space-y-1">
            <li>Report the buyer via «🚩 Report» on the booking page with a description of the incident.</li>
            <li>Message the administration via «📣 Complaints» with whatever evidence you have.</li>
            <li>Approach the security authorities to lodge a formal complaint if actual harm has occurred.</li>
            <li>TAKI cooperates with the security authorities and responds to their official requests, and suspends accounts involved to protect other merchants.</li>
        </ol>,
    },
    {
        q: 'Is the merchant responsible for returns and exchange policy?',
        a: <p><strong>Yes, in full.</strong> The returns and exchange policy is confined to you and the buyer, and is governed by what you publish at your store or by the Saudi consumer-protection laws. TAKI is not a party to returns, does not guarantee them, and does not implement them. We recommend that you publish your policy clearly on your store page to avoid disputes.</p>,
    },
    {
        q: 'Does TAKI collect the price of my sales?',
        a: <p>No. All proceeds from the goods or services are received by the merchant directly from the buyer on receipt at the merchant's location. TAKI does not intervene in transferring funds between the parties, does not collect on behalf of any merchant, and does not retain the buyer's card data.</p>,
    },
    {
        q: 'What regulatory obligations do I bear as a merchant?',
        a: <ul className="list-disc ps-5 space-y-1">
            <li>Hold a valid commercial register or freelance permit, and any regulatory licence required by your activity.</li>
            <li>Issue tax invoices to the buyer where this applies to you under the Zakat, Tax and Customs Authority rules.</li>
            <li>Maintain a clear, published refund policy for the buyer, in line with the Consumer Protection Law.</li>
            <li>Accuracy of offer descriptions — no «bait-and-switch» and no misleading pricing.</li>
            <li>Honour every valid booking unless a regulatory reason prevents it.</li>
            <li>Do not use the buyer's contact details for any purpose outside performing the booking itself.</li>
        </ul>,
    },
    {
        q: 'How do I close my merchant account?',
        a: <p>From «Account settings» → «Delete account». Ongoing bookings must be fulfilled or cancelled first. Where a paid subscription is enabled, it remains effective until the end of the paid period with no partial refund (see the <a href="/refund" className="text-emerald-600 font-bold underline">Refund Policy</a>).</p>,
    },
];

const FAQ: React.FC = () => {
    const { language } = useApp();
    const isRTL = language === 'ar';

    return (
        <LegalLayout
            title={isRTL ? 'الأسئلة الشائعة' : 'Frequently Asked Questions'}
            subtitle={isRTL ? 'Frequently Asked Questions · TAKI' : 'الأسئلة الشائعة · TAKI'}
            lastUpdated="2026-07-22"
            draftNotice={false}
        >
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                {isRTL ? (
                    <>
                        في هذه الصفحة تجد أكثر الاستفسارات شيوعاً عن طريقة عمل المنصّة،
                        وما يَخصّ المشتري، وما يَخصّ التاجر. للاستفسارات التي لا تجد جوابها هنا،
                        استخدم زرّ <strong>«📣 الشكاوى / تواصل الإدارة»</strong> داخل التطبيق.
                    </>
                ) : (
                    <>
                        On this page you will find the most common queries about how the
                        platform works, what concerns buyers, and what concerns merchants.
                        For queries whose answers you cannot find here, use the{' '}
                        <strong>«📣 Complaints / Contact the Admin»</strong> button inside
                        the app.
                    </>
                )}
            </p>

            <Group
                title={isRTL ? 'كيف تتم الخدمة' : 'How the service works'}
                emoji="🔄"
                items={isRTL ? howItWorksAR : howItWorksEN}
            />
            <Group
                title={isRTL ? 'للمشتري' : 'For buyers'}
                emoji="🛒"
                items={isRTL ? buyerFAQ_AR : buyerFAQ_EN}
            />
            <Group
                title={isRTL ? 'للتاجر' : 'For merchants'}
                emoji="🏪"
                items={isRTL ? merchantFAQ_AR : merchantFAQ_EN}
            />

            <div className="mt-8 p-4 bg-emerald-50 border-2 border-emerald-200 rounded-2xl text-center">
                <div className="text-2xl mb-2">💬</div>
                <p className="text-sm font-extrabold text-emerald-900">
                    {isRTL ? 'لم تجد جواباً لسؤالك؟' : 'Did not find an answer to your question?'}
                </p>
                <p className="text-xs text-emerald-800 mt-1 font-medium">
                    {isRTL ? (
                        <>
                            راسلنا عبر زرّ «📣 الشكاوى / تواصل الإدارة» داخل التطبيق، أو زُر{' '}
                            <a href="/contact" className="font-bold underline">صفحة اتصل بنا</a>.
                        </>
                    ) : (
                        <>
                            Message us via the «📣 Complaints / Contact the Admin» button
                            inside the app, or visit the{' '}
                            <a href="/contact" className="font-bold underline">Contact Us</a> page.
                        </>
                    )}
                </p>
            </div>
        </LegalLayout>
    );
};

export default FAQ;
