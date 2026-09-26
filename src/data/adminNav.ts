/**
 * adminNav — كتالوج تبويبات لوحة الإدارة: مصدرٌ واحد (v14.89)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🪤 كان الاسم مكتوباً **مرّتين** — في شريط `AdminDashboard` وفي بحث ⌘K —
 *    وانحرفا فعلاً: «المشترون» / «إدارة المشترين» · «الإطلاق» / «جاهزية
 *    الإطلاق» · «الأدوات» / «أدوات الإدارة» · «الرسائل» / «الرسائل (مراقبة
 *    المحادثات)». فالبحث يقول اسماً والشريط يقول آخر للشيء نفسه.
 *
 * 🪤 وثمانية عشر تبويباً في شريطٍ أفقيّ واحد ليست تنقّلاً: على جوّال ناصر
 *    يظهر منها ثلاثة، والبقيّة خلف تمريرٍ لا يقول إنه موجود. الحلّ الذي
 *    تعتمده لوحاتُ الإدارة الجادّة: **مجموعاتٌ قليلة** تُقرأ دفعةً واحدة،
 *    وبحثٌ يقفز مباشرةً لمن يعرف وجهته.
 *
 * كل تبويبٍ هنا يحمل: هويّته · اسمه الظاهر · مجموعته · سطرَ فائدةٍ واحداً
 * (يُعرض في القائمة وفي رأس الشاشة، فلا يُكتب مرّتين) · صلاحيّته ·
 * وكلماتٍ مفتاحيةً للبحث.
 */

export type AdminTabId =
    | 'overview'
    | 'buyers' | 'sellers' | 'admins'
    | 'reports' | 'verification' | 'moderation' | 'messages' | 'delivery'
    | 'invoices' | 'tax'
    | 'analytics' | 'analyst' | 'audience' | 'contests'
    | 'tools' | 'locations' | 'messaging' | 'launch';

export type AdminGroupId = 'home' | 'people' | 'ops' | 'money' | 'growth' | 'setup';

export interface AdminGroupDef {
    id: AdminGroupId;
    label: string;
    icon: string;
    /** سطرٌ يقول متى يفتح ناصر هذه المجموعة */
    hint: string;
}

export interface AdminTabDef {
    id: AdminTabId;
    label: string;
    icon: string;
    group: AdminGroupId;
    /** ما الذي تجيب عنه هذه الشاشة — سطرٌ واحد، يُعرض في القائمة ورأس الشاشة */
    hint: string;
    /** مفتاح الصلاحية — الأدمن الأعلى يرى كل شيء */
    permission: string;
    /** للأدمن الأعلى وحده */
    onlySuper?: boolean;
    /** كلمات البحث (عربي + إنجليزي) */
    keywords: string;
}

export const ADMIN_GROUPS: AdminGroupDef[] = [
    { id: 'home',   label: 'النظرة العامة', icon: '🏠', hint: 'حالة المنصّة الآن وما يحتاج انتباهك' },
    { id: 'ops',    label: 'التشغيل اليومي', icon: '🛎️', hint: 'ما يصل منك اليوم: بلاغات ورسائل وطلبات توصيل' },
    { id: 'people', label: 'الناس',          icon: '👥', hint: 'المشترون والتجار وفريق الإدارة' },
    { id: 'money',  label: 'المال',          icon: '💰', hint: 'المدفوعات والفواتير والضريبة' },
    { id: 'growth', label: 'النمو',          icon: '📈', hint: 'الأرقام والتحليل والمسابقات' },
    { id: 'setup',  label: 'الإعداد',        icon: '⚙️', hint: 'ما تضبطه مرّة ثم تنساه' },
];

export const ADMIN_TABS: AdminTabDef[] = [
    {
        id: 'overview', label: 'الرئيسية', icon: '🏠', group: 'home',
        hint: 'حالة المنصّة الآن: الأرقام الحيّة، وما يحتاج قراراً منك، وآخر ما جرى.',
        permission: 'tab_overview',
        keywords: 'overview home dashboard رئيسية نظرة عامة الحالة',
    },

    // ── التشغيل اليومي ───────────────────────────────────────────────────────
    {
        id: 'reports', label: 'البلاغات والشكاوى', icon: '🚩', group: 'ops',
        hint: 'بلاغات المستخدمين على بعضهم، وشكاوى المستخدمين للإدارة — في مكانٍ واحد.',
        permission: 'tab_reports',
        keywords: 'reports complaints بلاغ بلاغات شكوى شكاوى ابلاغ',
    },
    {
        id: 'verification', label: 'توثيق التجّار', icon: '🪪', group: 'ops',
        hint: 'طلبات التجّار لتوثيق سجلّهم قبل السماح بالنشر',
        permission: 'tab_verification',
        keywords: 'توثيق سجل تجاري عمل حر verification cr freelance وثيقة',
    },
    {
        id: 'moderation', label: 'الإنذارات', icon: '🛡', group: 'ops',
        hint: 'رصدٌ آليّ للمحتوى: كلماتٌ مسيئة في المحادثات والتقييمات والعروض، وصورٌ مرفوضة.',
        permission: 'tab_reports',
        keywords: 'moderation warnings nsfw filter انذار انذارات تحرش فلترة محتوى',
    },
    {
        id: 'messages', label: 'مراقبة المحادثات', icon: '💬', group: 'ops',
        hint: 'قراءة محادثات الطلبات بين المشتري والتاجر (قراءة فقط).',
        permission: 'tab_messages',
        keywords: 'messages chat monitor conversations رسائل محادثات مراقبة دردشة',
    },
    {
        id: 'delivery', label: 'التوصيل', icon: '🚚', group: 'ops',
        hint: 'طلبات التوصيل وحالاتها، والمتاجر المفعّلة ونطاقاتها، ومفاتيح الإيقاف.',
        permission: 'tab_delivery',
        keywords: 'delivery courier zones توصيل مندوب نطاق نطاقات شحن',
    },

    // ── الناس ────────────────────────────────────────────────────────────────
    {
        id: 'buyers', label: 'المشترون', icon: '🛒', group: 'people',
        hint: 'ابحث عن أي مشترٍ، اقرأ حسابه وحجوزاته، عدّله أو أوقفه.',
        permission: 'tab_buyers',
        keywords: 'buyers customers مشتري مشترين عميل عملاء',
    },
    {
        id: 'sellers', label: 'التجّار', icon: '🏪', group: 'people',
        hint: 'المتاجر واشتراكاتها وباقاتها وفروعها ورعايتها.',
        permission: 'tab_sellers',
        keywords: 'sellers merchants تاجر تجار متاجر بائع بائعين اشتراك باقة',
    },
    {
        id: 'admins', label: 'فريق الإدارة', icon: '👑', group: 'people',
        hint: 'من يدخل اللوحة، وماذا يملك أن يفعل فيها.',
        permission: 'tab_admins', onlySuper: true,
        keywords: 'admins team permissions roles مسؤول مسؤولون فريق صلاحيات ادمن',
    },

    // ── المال ────────────────────────────────────────────────────────────────
    {
        id: 'invoices', label: 'المدفوعات', icon: '💳', group: 'money',
        hint: 'سجلّ الدفع المباشر لحساب التاجر (بلا عمولة)، وبوّابات التجار.',
        permission: 'tab_launch',
        keywords: 'payments direct pay gateway invoices مدفوعات دفع مباشر بوابة فواتير سجل',
    },
    {
        id: 'tax', label: 'الزكاة والضريبة', icon: '🧾', group: 'money',
        hint: 'حالة التسجيل الضريبي، والجدول الشهري، والفواتير الجاهزة.',
        permission: 'tab_launch',
        keywords: 'tax vat zakat invoice زكاة ضريبة فاتورة فواتير هيئة زاتكا',
    },

    // ── النمو ────────────────────────────────────────────────────────────────
    {
        id: 'analytics', label: 'التحليلات', icon: '📊', group: 'growth',
        hint: 'أرقام المنصّة على فترةٍ تختارها: الحجوزات والمستخدمون وأعلى القوائم.',
        permission: 'tab_analytics',
        keywords: 'analytics stats charts إحصائيات تقارير تحليلات أرقام',
    },
    {
        id: 'analyst', label: 'المحلل الذكي', icon: '🧠', group: 'growth',
        hint: 'تشخيصٌ آليّ: من يضعف ولماذا، وذروة الساعات، وتوصيةٌ لكل تاجر.',
        permission: 'tab_analytics',
        keywords: 'ai analyst insights churn محلل ذكي رؤى عزوف توصيات ذروة',
    },
    {
        id: 'audience', label: 'جمهور المدن', icon: '🗺', group: 'growth',
        hint: 'أين يسكن المشترون، وكم دخلوا وحجزوا في كل منطقة ومدينة.',
        permission: 'tab_analytics',
        keywords: 'audience cities map geo جمهور مدن خريطة مناطق مصادر',
    },
    {
        id: 'contests', label: 'المسابقات', icon: '🎁', group: 'growth',
        hint: 'استبياناتٌ بجوائز، تصحيحٌ تلقائي، وسحبٌ على الفائزين.',
        permission: 'tab_contests',
        keywords: 'contests surveys draw prizes مسابقة مسابقات استبيان سحب جوائز فائز',
    },

    // ── الإعداد ──────────────────────────────────────────────────────────────
    {
        id: 'tools', label: 'البانرات والحملات', icon: '🛠️', group: 'setup',
        hint: 'البانرات داخل التطبيق، والحملات الترويجية، وإعدادات المنصّة.',
        permission: 'tab_tools',
        keywords: 'tools settings banners campaigns بانر بانرات حملة حملات اعدادات ادوات',
    },
    {
        id: 'messaging', label: 'الإشعارات والبريد', icon: '📨', group: 'setup',
        hint: 'نصّ كل رسالةٍ تُرسلها المنصّة وتوقيتها وقناتها.',
        permission: 'tab_tools',
        keywords: 'messaging notifications email templates اشعارات رسائل ايميل بريد قوالب تذكير',
    },
    {
        id: 'locations', label: 'المولات والأسواق', icon: '🏬', group: 'setup',
        hint: 'الأماكن التي يختار منها التجّار مواقع فروعهم.',
        permission: 'tab_tools',
        keywords: 'locations malls markets مول سوق مولات اسواق مواقع',
    },
    {
        id: 'launch', label: 'جاهزية الإطلاق', icon: '🚀', group: 'setup',
        hint: 'فحصٌ شامل لما ينقص قبل فتح المنصّة للجمهور.',
        permission: 'tab_launch',
        keywords: 'launch prelaunch health check اطلاق فحص جاهزية',
    },
];

/** بحثٌ سريع بالهويّة — يُستعمل في رأس الشاشة وفي مسار التنقّل. */
export const ADMIN_TAB_BY_ID: Record<AdminTabId, AdminTabDef> = ADMIN_TABS.reduce(
    (acc, t) => { acc[t.id] = t; return acc; },
    {} as Record<AdminTabId, AdminTabDef>
);

export const ADMIN_GROUP_BY_ID: Record<AdminGroupId, AdminGroupDef> = ADMIN_GROUPS.reduce(
    (acc, g) => { acc[g.id] = g; return acc; },
    {} as Record<AdminGroupId, AdminGroupDef>
);

/** تبويبات مجموعةٍ ما، بترتيب الكتالوج. */
export const tabsOfGroup = (g: AdminGroupId): AdminTabDef[] => ADMIN_TABS.filter((t) => t.group === g);
