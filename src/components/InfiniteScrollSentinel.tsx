import React, { useEffect, useRef } from 'react';

/**
 * v13.22 — حارس التمرير اللانهائي.
 *
 * عنصر غير مرئي يوضع أسفل القائمة. حين يقترب من نافذة العرض يطلب الصفحة
 * التالية — وهو الأسلوب المعتمد في التطبيقات الكبرى (تحميل مسبق قبل أن يصل
 * المستخدم للنهاية فلا يشعر بأي انتظار).
 *
 * لماذا IntersectionObserver لا مستمع scroll: المستمع يعمل على الخيط الرئيسي
 * عشرات المرات في الثانية ويُسبّب تقطيعاً في التمرير؛ أما المراقب فيعمل خارجه
 * ويستدعينا مرة واحدة عند التقاطع فقط.
 *
 * `rootMargin` سخيّ (٦٠٠ بكسل) ليبدأ التحميل قبل النهاية بشاشة تقريباً.
 */
interface Props {
    /** هل بقيت صفحات؟ عند false لا يُركّب المراقب إطلاقاً. */
    hasMore: boolean;
    /** جارٍ التحميل الآن (يمنع الطلبات المتكرّرة ويُظهر المؤشّر). */
    loading: boolean;
    /** تحميل الصفحة التالية. */
    onLoadMore: () => void;
    isRTL?: boolean;
    /** نص النهاية (اختياري) — يظهر عند انتهاء القائمة. */
    endLabel?: string;
}

const InfiniteScrollSentinel: React.FC<Props> = ({ hasMore, loading, onLoadMore, isRTL = true, endLabel }) => {
    const ref = useRef<HTMLDivElement | null>(null);
    // مرجع دائم للدالة حتى لا يُعاد تركيب المراقب مع كل رسم.
    const cb = useRef(onLoadMore);
    useEffect(() => { cb.current = onLoadMore; }, [onLoadMore]);

    useEffect(() => {
        if (!hasMore) return;
        const el = ref.current;
        if (!el || typeof IntersectionObserver === 'undefined') return;
        const io = new IntersectionObserver(
            entries => { if (entries.some(e => e.isIntersecting)) cb.current(); },
            { rootMargin: '600px 0px' }
        );
        io.observe(el);
        return () => io.disconnect();
    }, [hasMore]);

    if (!hasMore) {
        return endLabel ? (
            <div style={{ textAlign: 'center', padding: '18px 12px', fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)', opacity: 0.75 }}>
                {endLabel}
            </div>
        ) : null;
    }

    return (
        <div ref={ref} style={{ padding: '18px 12px', display: 'flex', justifyContent: 'center' }}>
            {loading && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: '0.82rem', fontWeight: 800, color: 'var(--text-secondary)' }}>
                    <span style={{
                        width: 16, height: 16, borderRadius: '50%',
                        border: '2px solid var(--gray-200)', borderTopColor: 'var(--primary)',
                        display: 'inline-block', animation: 'spin 0.7s linear infinite'
                    }} />
                    {isRTL ? 'جارٍ تحميل المزيد…' : 'Loading more…'}
                </div>
            )}
        </div>
    );
};

export default InfiniteScrollSentinel;
