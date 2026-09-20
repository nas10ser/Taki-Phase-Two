import React from 'react';

/**
 * clickable — v14.63
 * ═══════════════════════════════════════════════════════════════════════════
 * يجعل عنصراً غير تفاعليّ (div/span/img) قابلاً للتشغيل بلوحة المفاتيح: Enter
 * و Space يفعلان ما تفعله النقرة بالضبط، ويُعلنه قارئ الشاشة زرّاً له اسم.
 *
 * 🪤 دالة عادية تُرجع props — **وليست hook عمداً**: عدّة مواضع تستعملها بعد
 * `return` مبكّر، وأي hook هناك يُسقط الشجرة عند أوّل تبديل بين الفرعين.
 *
 * النمط نفسه كان مكتوباً بخطّ اليد في DealsList.tsx وHome.tsx — فهذه توحيدٌ
 * لعُرفٍ قائم لا اختراع جديد.
 */
export function clickable(
    onActivate: (e: React.SyntheticEvent) => void,
    label?: string,
) {
    return {
        role: 'button' as const,
        tabIndex: 0,
        ...(label ? { 'aria-label': label } : {}),
        onClick: onActivate,
        onKeyDown: (e: React.KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();   // بدونها تُمرّر المسافةُ الصفحةَ لأسفل
                onActivate(e);
            }
        },
    };
}

export default clickable;
