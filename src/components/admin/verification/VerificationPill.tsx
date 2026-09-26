/**
 * VerificationPill — حالةُ طلب التوثيق في شارةٍ واحدة (v14.95)
 * ═══════════════════════════════════════════════════════════════════════════
 * غلافٌ رفيع حول `AdmPill` مصدرُه `verificationStatus` وحده: لا حرف ولا لون
 * يُكتب في شاشةٍ أخرى. فإن أُضيفت حالةٌ على القاعدة غداً، ظهرت في كل موضعٍ
 * بنفس اللفظ ونفس اللون — أو ظهرت باسمها الخام بلا سقوط، ولا ثالث.
 */
import React from 'react';
import { AdmPill } from '../ui';
import { statusMeta } from './verificationStatus';
import type { VerificationStatus } from './verificationStatus';

export const VerificationPill: React.FC<{
    status: VerificationStatus | string | null | undefined;
    /** سطرُ المعنى في `title` — يُطفأ حين يكون الشرح مكتوباً بجانبها أصلاً. */
    hint?: boolean;
}> = ({ status, hint = true }) => {
    const m = statusMeta(status);
    return (
        <AdmPill tone={m.tone} title={hint ? m.hint : undefined}>
            <span aria-hidden="true">{m.icon}</span> {m.label}
        </AdmPill>
    );
};

export default VerificationPill;
