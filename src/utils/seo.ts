/**
 * seo.ts — العنوان والوصف والبيانات المهيكلة لكل صفحة (v13.94)
 * ---------------------------------------------------------------------------
 * الموقع تطبيق صفحة واحدة، فالعنوان والوصف في index.html ثابتان لكل المسارات.
 * جوجل يُنفّذ JavaScript ويقرأ ما نكتبه هنا، فتحصل كل صفحة عرض ومتجر على
 * عنوانها ووصفها وبياناتها المهيكلة الخاصة — وهذا ما يُظهر السعر والتوفّر
 * داخل نتيجة البحث نفسها بدل سطر نصّي عام.
 *
 * ⚠️ ما لا تفعله هذه الوحدة: زواحف محرّكات الإجابات (GPTBot وPerplexityBot)
 * لا تُنفّذ JavaScript غالباً، فلا ترى شيئاً من هذا. ما تراه هو كتلة
 * <noscript> الدلالية في index.html. لذلك الاثنان ضروريان معاً لا بديلان.
 */

const SITE = 'https://www.takisa.net';

/** لا نترك وسماً مكرّراً خلفنا: كل وسم نكتبه يحمل هذه السمة فنعرف ملكيّتنا له. */
const OWNED = 'data-taki-seo';

const setMeta = (selector: string, create: () => HTMLElement, value: string) => {
    let el = document.head.querySelector<HTMLElement>(selector);
    if (!el) {
        el = create();
        el.setAttribute(OWNED, '1');
        document.head.appendChild(el);
    }
    return el;
};

const setNamedMeta = (name: string, content: string) => {
    const el = setMeta(`meta[name="${name}"]`, () => {
        const m = document.createElement('meta');
        m.setAttribute('name', name);
        return m;
    }, content);
    el.setAttribute('content', content);
};

const setPropMeta = (property: string, content: string) => {
    const el = setMeta(`meta[property="${property}"]`, () => {
        const m = document.createElement('meta');
        m.setAttribute('property', property);
        return m;
    }, content);
    el.setAttribute('content', content);
};

const setCanonical = (href: string) => {
    const el = setMeta('link[rel="canonical"]', () => {
        const l = document.createElement('link');
        l.setAttribute('rel', 'canonical');
        return l;
    }, href);
    el.setAttribute('href', href);
};

/** القيم الأصلية من index.html — نعود إليها عند مغادرة الصفحة. */
const DEFAULTS = {
    title: 'TAKI — حجز التخفيضات الذكية في السعودية',
    description: 'TAKI - منصة حجوزات التخفيضات الذكية في المملكة العربية السعودية. احجز أفضل العروض في المولات والأسواق قبل الجميع.',
    canonical: `${SITE}/`,
    image: `${SITE}/og-image.png`,
};

export interface PageSeo {
    title: string;
    description: string;
    /** المسار فقط، مثل `/deal/abc` — يُبنى العنوان الكامل داخلياً. */
    path: string;
    image?: string;
}

/**
 * يضبط عنوان الصفحة ووصفها ووسوم المشاركة، ويعيدها لأصلها عند الخروج.
 * يُستدعى داخل useEffect في الصفحة.
 */
export const applyPageSeo = (seo: PageSeo | null): (() => void) => {
    if (!seo) return () => {};

    const url = SITE + (seo.path.startsWith('/') ? seo.path : `/${seo.path}`);
    const img = seo.image || DEFAULTS.image;

    document.title = seo.title;
    setNamedMeta('description', seo.description);
    setCanonical(url);
    setPropMeta('og:title', seo.title);
    setPropMeta('og:description', seo.description);
    setPropMeta('og:url', url);
    setPropMeta('og:image', img);
    setNamedMeta('twitter:title', seo.title);
    setNamedMeta('twitter:description', seo.description);
    setNamedMeta('twitter:image', img);

    return () => {
        document.title = DEFAULTS.title;
        setNamedMeta('description', DEFAULTS.description);
        setCanonical(DEFAULTS.canonical);
        setPropMeta('og:title', DEFAULTS.title);
        setPropMeta('og:description', DEFAULTS.description);
        setPropMeta('og:url', DEFAULTS.canonical);
        setPropMeta('og:image', DEFAULTS.image);
        setNamedMeta('twitter:title', DEFAULTS.title);
        setNamedMeta('twitter:description', DEFAULTS.description);
        setNamedMeta('twitter:image', DEFAULTS.image);
    };
};

/**
 * يحقن كتلة JSON-LD خاصة بالصفحة ويزيلها عند الخروج.
 * المعرّف يمنع التكرار حين تعيد React التركيب مرتين (StrictMode).
 */
export const applyJsonLd = (id: string, data: unknown | null): (() => void) => {
    const elId = `taki-jsonld-${id}`;
    document.getElementById(elId)?.remove();
    if (!data) return () => { document.getElementById(elId)?.remove(); };

    const s = document.createElement('script');
    s.type = 'application/ld+json';
    s.id = elId;
    // JSON.stringify يهرّب المحارف الخاصة، لكن `</script>` داخل نصّ وصفٍ
    // كتبه تاجر سيُنهي الوسم مبكراً — نغلق هذا الباب صراحةً.
    s.textContent = JSON.stringify(data).replace(/</g, '\\u003c');
    document.head.appendChild(s);

    return () => { document.getElementById(elId)?.remove(); };
};

const clean = (s: unknown, max = 300): string =>
    String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export interface DealSeoInput {
    id: string;
    itemName: string;
    description?: string;
    images?: string[];
    discountedPrice: number;
    originalPrice?: number;
    shopName?: string;
    storeId?: string;
    city?: string;
    category?: string;
    quantity?: number | 'unlimited';
    expiryDate?: string;
}

/** بيانات مهيكلة لصفحة عرض: نوع Product مع Offer — يُظهر السعر في نتيجة البحث. */
export const dealJsonLd = (d: DealSeoInput) => {
    const inStock = d.quantity === 'unlimited' || (typeof d.quantity === 'number' && d.quantity > 0);
    const node: Record<string, unknown> = {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: clean(d.itemName, 120),
        description: clean(d.description || d.itemName, 500),
        sku: d.id,
        url: `${SITE}/deal/${d.id}`,
        offers: {
            '@type': 'Offer',
            url: `${SITE}/deal/${d.id}`,
            price: Number(d.discountedPrice) || 0,
            priceCurrency: 'SAR',
            availability: inStock
                ? 'https://schema.org/InStock'
                : 'https://schema.org/OutOfStock',
            // نية الشراء في تاكي «احجز ثم استلم من المتجر» — وschema.org يسمّيها
            // هكذا بالضبط، فلا نصفها شحناً ولا شراءً إلكترونياً.
            availableDeliveryMethod: 'https://schema.org/OnSitePickup',
            ...(d.expiryDate ? { priceValidUntil: d.expiryDate } : {}),
            ...(d.shopName ? { seller: { '@type': 'Organization', name: clean(d.shopName, 100) } } : {}),
        },
    };
    const imgs = (d.images || []).filter(Boolean).slice(0, 5);
    if (imgs.length) node.image = imgs;
    if (d.category) node.category = clean(d.category, 60);
    if (d.shopName) node.brand = { '@type': 'Brand', name: clean(d.shopName, 100) };
    return node;
};

export interface StoreSeoInput {
    id: string;
    shop?: string;
    name?: string;
    bio?: string;
    avatarUrl?: string;
    city?: string;
    lat?: number;
    lng?: number;
}

/** بيانات مهيكلة لصفحة متجر: LocalBusiness — يخدم البحث المحلّي والخرائط. */
export const storeJsonLd = (s: StoreSeoInput) => {
    const name = clean(s.shop || s.name || '', 100);
    if (!name) return null;
    const node: Record<string, unknown> = {
        '@context': 'https://schema.org',
        '@type': 'LocalBusiness',
        name,
        url: `${SITE}/store/${s.id}`,
        ...(s.bio ? { description: clean(s.bio, 500) } : {}),
        ...(s.avatarUrl ? { image: s.avatarUrl } : {}),
        address: {
            '@type': 'PostalAddress',
            addressCountry: 'SA',
            ...(s.city ? { addressLocality: clean(s.city, 60) } : {}),
        },
    };
    if (typeof s.lat === 'number' && typeof s.lng === 'number') {
        node.geo = { '@type': 'GeoCoordinates', latitude: s.lat, longitude: s.lng };
    }
    return node;
};

/** مسار التنقّل — يُظهر في جوجل فتات الطريق بدل عنوان URL خام. */
export const breadcrumbJsonLd = (items: Array<{ name: string; path: string }>) => ({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: clean(it.name, 100),
        item: SITE + it.path,
    })),
});
