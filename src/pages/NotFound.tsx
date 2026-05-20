/**
 * NotFound — 404 page.
 *
 * Catch-all for any unknown route. Shown in Arabic with a clear path back
 * to the home page. Important for SEO too — without this, unknown URLs
 * still return index.html (200), which confuses search engines.
 */

import React from 'react';
import { useHistory, useLocation } from 'react-router-dom';

const NotFound: React.FC = () => {
    const history = useHistory();
    const location = useLocation();

    return (
        <div
            className="min-h-screen flex flex-col items-center justify-center text-center p-6 bg-[var(--body-bg)]"
            dir="rtl"
            style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 24px)' }}
        >
            <div className="text-8xl mb-3 animate-fade-in">🧭</div>
            <h1 className="text-3xl font-extrabold text-[var(--text-primary)] mb-2">
                الصفحة غير موجودة
            </h1>
            <p className="text-sm text-[var(--text-secondary)] max-w-sm mb-1 font-medium">
                الرابط الذي طلبته غير صحيح أو تمّ نقله.
            </p>
            <p className="text-[11px] text-[var(--gray-400)] font-mono mb-6" dir="ltr">
                {location.pathname}
            </p>
            <div className="flex flex-col gap-2 w-full max-w-xs">
                <button
                    onClick={() => history.push('/')}
                    className="w-full px-5 py-3 bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-extrabold rounded-2xl shadow-md hover:shadow-lg transition-all"
                >
                    🏠 العودة للرئيسية
                </button>
                <button
                    onClick={() => (history.length > 1 ? history.goBack() : history.push('/'))}
                    className="w-full px-5 py-3 bg-[var(--card-bg)] border border-[var(--border-color)] text-[var(--text-primary)] font-bold rounded-2xl"
                >
                    → رجوع للخلف
                </button>
            </div>
            <div className="mt-6 flex items-center gap-3 text-xs text-[var(--text-secondary)]">
                <a href="/about" className="font-bold hover:text-emerald-600">من نحن</a>
                <span className="text-[var(--gray-400)]">·</span>
                <a href="/contact" className="font-bold hover:text-emerald-600">اتصل بنا</a>
                <span className="text-[var(--gray-400)]">·</span>
                <a href="/terms" className="font-bold hover:text-emerald-600">الشروط</a>
                <span className="text-[var(--gray-400)]">·</span>
                <a href="/privacy" className="font-bold hover:text-emerald-600">الخصوصية</a>
            </div>
        </div>
    );
};

export default NotFound;
