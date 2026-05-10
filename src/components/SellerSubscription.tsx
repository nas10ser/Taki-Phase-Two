import React from 'react';
import { useHistory } from 'react-router-dom';

interface Props { isRTL: boolean }

/**
 * Compact entry-point inside the seller dashboard. The real billing UI
 * lives at /subscription so it stays a single source of truth.
 */
const SellerSubscription: React.FC<Props> = ({ isRTL }) => {
    const history = useHistory();
    return (
        <div style={{
            background: 'var(--card-bg, white)',
            borderRadius: 18, padding: 22,
            boxShadow: '0 6px 18px rgba(0,0,0,0.06)',
            textAlign: 'center'
        }}>
            <div style={{ fontSize: '2.2rem', marginBottom: 8 }}>💎</div>
            <h3 style={{ margin: '0 0 6px', fontWeight: 900 }}>
                {isRTL ? 'إدارة الاشتراك والفواتير' : 'Subscription & Billing'}
            </h3>
            <p style={{ margin: '0 0 16px', color: 'var(--text-secondary)', fontWeight: 600, lineHeight: 1.6 }}>
                {isRTL
                    ? 'استعرض الباقات، أسعار الفروع الإضافية، وسجل الفواتير في صفحة مخصصة.'
                    : 'View plans, extra branch pricing, and invoice history on the dedicated page.'}
            </p>
            <button onClick={() => history.push('/subscription')} style={{
                padding: '12px 24px', borderRadius: 14, border: 'none',
                background: 'linear-gradient(135deg, #10b981, #047857)',
                color: 'white', fontWeight: 900, cursor: 'pointer'
            }}>
                {isRTL ? 'فتح صفحة الاشتراك ←' : 'Open Subscription page →'}
            </button>
        </div>
    );
};

export default SellerSubscription;
