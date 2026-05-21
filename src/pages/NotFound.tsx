/**
 * NotFound — 404 page (bilingual).
 *
 * Catch-all for any unknown route. Important for SEO too — without this,
 * unknown URLs still return index.html (200), which confuses search engines.
 *
 * @version 2026-05-21 (v11.9 — EN support)
 */

import React from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext';

const NotFound: React.FC = () => {
    const history = useHistory();
    const location = useLocation();
    const { language } = useApp();
    const isRTL = language === 'ar';

    return (
        <div
            className="min-h-screen flex flex-col items-center justify-center text-center p-6 bg-[var(--body-bg)]"
            dir={isRTL ? 'rtl' : 'ltr'}
            style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 24px)' }}
        >
            <div className="text-8xl mb-3 animate-fade-in">🧭</div>
            <h1 className="text-3xl font-extrabold text-[var(--text-primary)] mb-2">
                {isRTL ? 'الصفحة غير موجودة' : 'Page not found'}
            </h1>
            <p className="text-sm text-[var(--text-secondary)] max-w-sm mb-1 font-medium">
                {isRTL
                    ? 'الرابط الذي طلبته غير صحيح أو تمّ نقله.'
                    : 'The link you requested is incorrect or has been moved.'}
            </p>
            <p className="text-[11px] text-[var(--gray-400)] font-mono mb-6" dir="ltr">
                {location.pathname}
            </p>
            <div className="flex flex-col gap-2 w-full max-w-xs">
                <button
                    onClick={() => history.push('/')}
                    className="w-full px-5 py-3 bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-extrabold rounded-2xl shadow-md hover:shadow-lg transition-all"
                >
                    {isRTL ? '🏠 العودة للرئيسية' : '🏠 Back to home'}
                </button>
                <button
                    onClick={() => (history.length > 1 ? history.goBack() : history.push('/'))}
                    className="w-full px-5 py-3 bg-[var(--card-bg)] border border-[var(--border-color)] text-[var(--text-primary)] font-bold rounded-2xl"
                >
                    {isRTL ? '→ رجوع للخلف' : '← Go back'}
                </button>
            </div>
            <div className="mt-6 flex items-center gap-3 text-xs text-[var(--text-secondary)]">
                <a href="/about" className="font-bold hover:text-emerald-600">{isRTL ? 'من نحن' : 'About'}</a>
                <span className="text-[var(--gray-400)]">·</span>
                <a href="/contact" className="font-bold hover:text-emerald-600">{isRTL ? 'اتصل بنا' : 'Contact'}</a>
                <span className="text-[var(--gray-400)]">·</span>
                <a href="/terms" className="font-bold hover:text-emerald-600">{isRTL ? 'الشروط' : 'Terms'}</a>
                <span className="text-[var(--gray-400)]">·</span>
                <a href="/privacy" className="font-bold hover:text-emerald-600">{isRTL ? 'الخصوصية' : 'Privacy'}</a>
            </div>
        </div>
    );
};

export default NotFound;
