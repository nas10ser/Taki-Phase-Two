import React from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext';

const SellerTopBarImpl: React.FC<{ storeId?: string }> = ({ storeId }) => {
    const { user, language, notifications } = useApp();
    const history = useHistory();
    const location = useLocation();
    const isRTL = language === 'ar';

    // v13.72 — كان الشرط `userType === 'seller'` أيضاً، فالمتجر المملوك لحساب
    // **أدمن** (متجر ناصر) لا يرى الشريط إطلاقاً على صفحته. نفس فخّ v11.82 في
    // البوت: مالك المتجر يُعرَف بأنه صاحب الصفحة، لا بنوع حسابه.
    if (!user || user.id !== storeId) return null;

    const unreadOrdersCount = notifications.filter(n => n.userId === user?.id && !n.isRead && n.type === 'booking').length;

    return (
        <div style={{ display: 'flex', background: 'rgba(80, 80, 90, 0.2)', backdropFilter: 'blur(10px)', borderRadius: 16, padding: 6, overflowX: 'auto', gap: 4, scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch', marginBottom: 10 }}>
            {/* v13.72 — تبويبان صُحِّحا هنا:
                • `notifications` **لم تكن شاشة موجودة أصلاً** في لوحة التاجر، فكان
                  الضغط على «تنبيهات» يسقط إلى الفرع الأخير ويفتح **الماسح الضوئي**.
                  استُبدلت بـ`reviews` (التقييمات والردود) وهي ما يقصده الرمز 💬.
                • أُضيف `insights` = **التحليلات** (طلب ناصر) — كان موجوداً في
                  اللوحة ولا منفذ له من صفحة المتجر. */}
            {(['form', 'products', 'orders', 'reviews', 'insights', 'scanner'] as const).map(tab => {
                const badgeCount = tab === 'orders' ? unreadOrdersCount : 0;
                
                return (
                    <button key={tab} onClick={() => {
                        history.push(`/seller?tab=${tab}`);
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                    }} style={{
                        flex: 1, minWidth: 76, padding: '10px 4px', borderRadius: 12, border: 'none',
                        background: 'transparent', color: 'white',
                        fontWeight: 900, fontSize: '0.8rem', transition: 'all 0.2s ease', cursor: 'pointer',
                        display: 'flex', gap: 4, alignItems: 'center', justifyContent: 'center', position: 'relative'
                    }}>
                         {tab === 'products' ? '📦 ' : tab === 'orders' ? '🔔 ' : tab === 'reviews' ? '💬 ' : tab === 'insights' ? '📊 ' : tab === 'scanner' ? '📷 ' : '➕ '}
                         <span>
                            {tab === 'form' ? (isRTL ? 'إضافة' : 'Add') :
                             tab === 'products' ? (isRTL ? 'عروضي' : 'Deals') :
                             tab === 'orders' ? (isRTL ? 'طلبات' : 'Orders') :
                             tab === 'reviews' ? (isRTL ? 'تقييمات' : 'Reviews') :
                             tab === 'insights' ? (isRTL ? 'تحليلات' : 'Insights') :
                             (isRTL ? 'تحقق' : 'Scan')}
                         </span>
                         {badgeCount > 0 && (
                            <span style={{
                                position: 'absolute',
                                top: -2,
                                right: -2,
                                background: '#ef4444',
                                color: 'white',
                                fontSize: '0.65rem',
                                padding: '2px 6px',
                                borderRadius: '10px',
                                minWidth: '18px',
                                height: '18px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontWeight: 900,
                                border: '2px solid rgba(80, 80, 95, 0.2)',
                                boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
                                zIndex: 10
                            }}>
                                {badgeCount > 9 ? '+9' : badgeCount}
                            </span>
                         )}
                    </button>
                );
            })}
        </div>
    );
};

export const SellerTopBar = React.memo(SellerTopBarImpl);
