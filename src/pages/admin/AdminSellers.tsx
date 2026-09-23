/**
 * AdminSellers — إدارة البائعين والاشتراكات
 *
 * الميزات الكاملة:
 *  - بحث + فلترة بالباقة (premium / trial / free / suspended)
 *  - النقر على البائع يفتح Sub Modal الذكي:
 *      • تاريخ بداية الاشتراك (date picker)
 *      • تاريخ نهاية الاشتراك (date picker)
 *      • نسبة الخصم (slider 0-100)
 *      • المبلغ الشهري (number input)
 *      • الباقة (select: free / trial / premium)
 *      • الإشعار للبائع (toggle)
 *      • ملاحظات
 *  - أزرار سريعة: شهر / 3 أشهر / سنة / إلغاء
 *  - بطاقات إحصائية: MRR، عدد المشتركين، الباقات
 */

import React, { useEffect, useState, useCallback, useMemo, memo } from 'react';
import { StoreNameRequests } from '../../components/admin/StoreNameRequests';
import { adminService, AdminUserRow, ApplySubscriptionParams } from '../../services/adminService';
import { useApp } from '../../context/AppContext';
import { LOCATION_PACKAGES, packageForMax, effectivePrice, branchesShort, LocationPackage } from '../../data/packages';
import { packageRepository } from '../../repositories/packageRepository';
import { subscriptionRepository } from '../../repositories/subscriptionRepository';
import { sponsorRepository, AdminSponsorRow } from '../../repositories/sponsorRepository';
import { CATEGORIES, REGIONS, CITIES } from '../../data/mock';
import { useEscClose } from '../../hooks/useEscClose';
import { useLocalStringList } from '../../hooks/useLocalStringList';
import { useAdminRecents } from '../../hooks/useAdminRecents';
import { CopyButton } from '../../components/admin/CopyButton';
import { Tooltip } from '../../components/admin/Tooltip';
import { PinButton } from '../../components/admin/PinButton';
import { ExportButton } from '../../components/admin/ExportButton';
import { SmartChip } from '../../components/admin/SmartChip';
import { admNum, toDateInput } from '../../components/admin/ui';
import { fieldCss, labelCss, pickCss } from '../../components/admin/sellerStyles';
import {
    AdmSection, AdmStat, AdmStatGrid, AdmPill,
    AdmEmpty, AdmSkeleton, AdmButton, toneFg,
} from '../../components/admin/ui';
import type { Tone } from '../../components/admin/ui';
import PackagePricingPanel from '../../components/admin/PackagePricingPanel';
import SponsorLayoutPanel from '../../components/admin/SponsorLayoutPanel';
import { CsvColumn } from '../../utils/csvExport';

const SELLER_CSV_COLUMNS: CsvColumn<AdminUserRow>[] = [
    { header: 'المتجر',           accessor: (s) => s.shop ?? '' },
    { header: 'اسم المالك',       accessor: (s) => s.name },
    { header: 'الجوال',           accessor: (s) => s.phone ?? '' },
    { header: 'الإيميل',          accessor: (s) => s.email ?? '' },
    { header: 'الباقة',           accessor: (s) => s.subscription_plan ?? 'free' },
    { header: 'تنتهي في',         accessor: (s) => s.subscription_expires_at ?? '' },
    { header: 'المبلغ الشهري',    accessor: (s) => s.subscription_amount ?? 0 },
    { header: 'الخصم %',          accessor: (s) => s.discount_percentage ?? 0 },
    { header: 'معلّق',            accessor: (s) => (s.is_suspended ? 'نعم' : 'لا') },
    { header: 'آخر نشاط',         accessor: (s) => s.last_active_at ?? '' },
    { header: 'تاريخ التسجيل',    accessor: (s) => s.created_at ?? '' },
    { header: 'المعرّف',           accessor: (s) => s.id },
];

type FilterTab = 'all' | 'premium' | 'trial' | 'free' | 'suspended';

/**
 * سقف ما تحمّله هذه الشاشة دفعةً واحدة. مذكورٌ هنا مرّةً واحدة لأن كل بطاقة
 * رقمٍ في الأعلى تُعلنه في `scope` — الرقم المحسوب في المتصفّح لا يصف المنصّة.
 */
const LOADED_CAP = 200;

// 🪤 v14.89 — نافذة اشتراك التاجر استُخرجت إلى
//    `src/components/admin/SellerSubscriptionModal.tsx` (٧٣٥ سطراً):
//    هذا الملفّ كان ٢٢٢٨ سطراً، فوق حدّ ما يُقرأ في جلسة واحدة.
import { SubscriptionModal } from '../../components/admin/SellerSubscriptionModal';



// ============================================================
// Seller Row
// ============================================================
const SellerRow = memo<{
    seller: AdminUserRow;
    onEdit: (s: AdminUserRow) => void;
    pinned: boolean;
    onTogglePin: (id: string) => void;
}>(({ seller, onEdit, pinned, onTogglePin }) => {
    const expiresAt = seller.subscription_expires_at
        ? new Date(seller.subscription_expires_at)
        : null;
    const daysLeft = expiresAt
        ? Math.ceil((expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
        : null;

    const planMeta: Record<string, { label: string; tone: Tone; icon: string }> = {
        premium: { label: 'مميزة', tone: 'ok', icon: '⭐' },
        trial: { label: 'تجريبية', tone: 'warn', icon: '🎁' },
        free: { label: 'مجانية', tone: 'neutral', icon: '🆓' },
    };
    const meta = planMeta[seller.subscription_plan ?? 'free'] ?? planMeta.free;
    // نغمة الانتهاء: أحمرُ في الأسبوع الأخير، وكهرمانيّ في الشهر الأخير.
    const expiryTone: Tone = daysLeft === null ? 'neutral' : daysLeft < 7 ? 'bad' : daysLeft < 30 ? 'warn' : 'neutral';

    return (
        <button
            onClick={() => onEdit(seller)}
            className="adm-focusable w-full text-right p-3.5"
            style={{
                background: 'var(--adm-surface)',
                border: '1px solid var(--adm-border)',
                borderRadius: 'var(--adm-r)',
                borderInlineStartWidth: seller.is_suspended ? 4 : 1,
                borderInlineStartColor: seller.is_suspended ? 'var(--adm-bad-fg)' : 'var(--adm-border)',
                cursor: 'pointer',
            }}
        >
            <div className="flex items-center gap-3">
                <div
                    className="w-11 h-11 flex items-center justify-center text-lg font-bold flex-shrink-0"
                    style={{ borderRadius: 'var(--adm-r-sm)', background: 'var(--adm-surface-3)', color: 'var(--adm-fg-2)' }}
                    aria-hidden="true"
                >
                    {seller.shop?.[0] ?? seller.name?.[0] ?? '?'}
                </div>
                <div className="flex-1 min-w-0 text-right">
                    <div className="font-bold text-sm truncate flex items-center gap-2" style={{ color: 'var(--adm-fg)' }}>
                        {seller.shop ?? seller.name}
                        <AdmPill tone={meta.tone}>{meta.icon} {meta.label}</AdmPill>
                        {seller.is_suspended && <AdmPill tone="bad">🚫 معلّق</AdmPill>}
                    </div>
                    <div className="text-xs mt-1 truncate flex items-center gap-1.5" dir="ltr" style={{ color: 'var(--adm-fg-2)' }}>
                        <span>{seller.phone ?? '—'}</span>
                        {seller.phone && <CopyButton value={seller.phone} label="الجوال" size="xs" />}
                    </div>
                    {expiresAt && daysLeft !== null && (
                        <div className="text-[10px] mt-1 font-bold" style={{ color: toneFg(expiryTone) }}>
                            {daysLeft > 0 ? `ينتهي خلال ${daysLeft} يوم` : 'منتهي'} ·{' '}
                            {expiresAt.toLocaleDateString('ar-SA-u-ca-gregory')}
                        </div>
                    )}
                </div>
                <div className="flex-shrink-0 text-left flex items-center gap-2">
                    <div>
                        <div className="text-base font-extrabold tabular-nums" style={{ color: 'var(--adm-fg)' }}>
                            {admNum((seller.subscription_amount ?? 0))}
                        </div>
                        <div className="text-[10px] font-medium" style={{ color: 'var(--adm-fg-3)' }}>ر.س/شهر</div>
                        {(seller.discount_percentage ?? 0) > 0 && (
                            <div className="mt-1"><AdmPill tone="warn">خصم {seller.discount_percentage}%</AdmPill></div>
                        )}
                    </div>
                    <PinButton pinned={pinned} onToggle={() => onTogglePin(seller.id)} />
                </div>
            </div>
        </button>
    );
});
SellerRow.displayName = 'SellerRow';

// ============================================================
// Global Subscription Mode — platform-wide controls.
// Sets the default subscription amount + lets the admin flip the entire
// site between "free for everyone" and "paid for everyone" with one tap.
// This is the answer to the "exception became the default" feedback —
// the global mode lives at the top, and the bulk panel below handles
// per-store exceptions.
// ============================================================
const GlobalSubscriptionMode = memo<{ onApplied: () => void }>(({ onApplied }) => {
    const { customAlert, customConfirm } = useApp();
    const [loaded, setLoaded] = useState(false);
    const [globalAmount, setGlobalAmount] = useState<number>(199);
    const [trialDays, setTrialDays] = useState<number>(14);
    const [gatewayEnabled, setGatewayEnabled] = useState<boolean>(false);
    const [busyMode, setBusyMode] = useState<null | 'free' | 'paid' | 'trial-paid' | 'trial-all'>(null);
    // v12.35 — unified pricing: the default amount is no longer a free number;
    // it's one of the الباقات (location_packages). One price source, no drift.
    const [pkgs, setPkgs] = useState<LocationPackage[]>([]);
    const [defaultPkgId, setDefaultPkgId] = useState<number>(1);
    const [pkgSaveState, setPkgSaveState] = useState<'' | 'saving' | 'saved' | 'error'>('');
    // v12.35 — how sellers get told when the mode flips (persisted setting).
    const [notifInapp, setNotifInapp] = useState(true);
    const [notifEmail, setNotifEmail] = useState(false);

    const activePkgs = pkgs.filter((p) => p.active);
    const selPkg = activePkgs.find((p) => p.id === defaultPkgId) ?? activePkgs[0] ?? null;

    // Hydrate current settings on mount.
    useEffect(() => {
        let alive = true;
        (async () => {
            const [amount, enabled, trial, defId, notifyPrefs, catalogue] = await Promise.all([
                adminService.getPlatformSetting<number>('basic_plan_price_sar'),
                adminService.getPlatformSetting<boolean>('payment_gateway_enabled'),
                adminService.getPlatformSetting<number>('trial_days'),
                adminService.getPlatformSetting<number>('default_package_id'),
                adminService.getPlatformSetting<{ inapp?: boolean; email?: boolean }>('mode_change_notify'),
                packageRepository.get(),
            ]);
            if (!alive) return;
            setPkgs(catalogue);
            const actives = catalogue.filter((p) => p.active);
            const pick = actives.find((p) => p.id === Number(defId)) ?? actives[0] ?? null;
            setDefaultPkgId(pick ? pick.id : 1);
            setGlobalAmount(pick ? effectivePrice(pick) : (Number(amount) || 199));
            setTrialDays(Math.max(1, Number(trial) || 14));
            setGatewayEnabled(Boolean(enabled));
            setNotifInapp(notifyPrefs?.inapp !== false);
            setNotifEmail(notifyPrefs?.email === true);
            setLoaded(true);
        })();
        return () => { alive = false; };
    }, []);

    // Picking a package IS the price: persist the id + mirror the effective
    // price into basic_plan_price_sar (the new-seller DB trigger reads both,
    // package first). Auto-saves — no extra button for the owner to forget.
    const changePackage = async (id: number) => {
        const pkg = activePkgs.find((p) => p.id === id);
        if (!pkg) return;
        setDefaultPkgId(id);
        setGlobalAmount(effectivePrice(pkg));
        setPkgSaveState('saving');
        try {
            const [r1, r2] = await Promise.all([
                adminService.setPlatformSetting('default_package_id', id),
                adminService.setPlatformSetting('basic_plan_price_sar', effectivePrice(pkg)),
            ]);
            setPkgSaveState(r1.success && r2.success ? 'saved' : 'error');
        } catch {
            setPkgSaveState('error');
        }
    };

    // Persist the tell-the-sellers channels the moment a checkbox flips.
    const saveNotifyPrefs = (inapp: boolean, email: boolean) => {
        setNotifInapp(inapp);
        setNotifEmail(email);
        adminService.setPlatformSetting('mode_change_notify', { inapp, email }).catch(() => {});
    };

    /**
     * Broadcast the mode change to sellers over the enabled channels.
     * Returns a line to append to the success alert (or '' when disabled).
     */
    const announceModeChange = async (titleAr: string, bodyAr: string): Promise<string> => {
        if (!notifInapp && !notifEmail) return '';
        try {
            const r = await adminService.broadcastNotification({
                titleAr, bodyAr,
                audience: 'sellers',
                type: 'system',
                meta: { event: 'platform_mode' },
                inapp: notifInapp,
                email: notifEmail,
            });
            if (!r.success) return '\n⚠️ تعذّر إرسال التبليغ للتجار: ' + (r.error ?? '');
            const parts: string[] = [];
            if (notifInapp) parts.push(`إشعار داخل الموقع لـ${admNum(r.notified)}`);
            if (notifEmail) parts.push(`بريد إلكتروني لـ${admNum(r.emailed)}`);
            return parts.length ? `\n📣 تم التبليغ: ${parts.join(' + ')}.` : '';
        } catch (e: any) {
            return '\n⚠️ تعذّر إرسال التبليغ للتجار: ' + (e?.message ?? '');
        }
    };

    const handleFreeForAll = async () => {
        const ok = await customConfirm(
            'سيتم:\n' +
            '• تعطيل بوابة الدفع (الموقع مجاني تماماً)\n' +
            '• تحويل كل البائعين النشطين إلى باقة مجانية بلا انتهاء\n\n' +
            'متابعة؟'
        );
        if (!ok) return;
        setBusyMode('free');
        // try/finally so a thrown bulk call never leaves the button stuck.
        let r: { ok: number; failed: number; total: number } | null = null;
        try {
            const settingRes = await adminService.setPlatformSetting('payment_gateway_enabled', false);
            if (!settingRes.success) {
                await customAlert('❌ تعذر تعطيل البوابة: ' + (settingRes.error ?? ''));
                return;
            }
            setGatewayEnabled(false);

            r = await adminService.bulkSetAllActiveSellers({
                plan: 'free',
                amount: 0,
                discount: 100,
                expiresAt: null,
                notes: 'Platform mode: free for all',
            });
        } catch (e: any) {
            await customAlert('❌ تعذّر التطبيق: ' + (e?.message ?? ''));
            return;
        } finally {
            setBusyMode(null);
        }
        const announced = await announceModeChange(
            '🎉 المنصة الآن مجانية بالكامل',
            'قرّرنا جعل النشر مجانياً لجميع المتاجر — تم تحويل متجرك إلى الباقة المجانية بلا أي رسوم. استمتع بنشر عروضك!'
        );
        await customAlert(
            (r.failed === 0
                ? `🆓 الموقع الآن مجاني تماماً.\n${r.ok} متجر تم ضبطه على الباقة المجانية.`
                : `⚠️ نجح: ${r.ok} | فشل: ${r.failed} (من ${r.total})`) + announced
        );
        onApplied();
    };

    const handlePaidForAll = async () => {
        const ok = await customConfirm(
            'سيتم:\n' +
            '• تفعيل بوابة الدفع\n' +
            `• تحويل كل البائعين النشطين إلى «${selPkg?.ar ?? 'الباقة الافتراضية'}» بمبلغ ${admNum(globalAmount)} ر.س/شهر بلا خصم\n` +
            '• إلغاء أي خصومات أو فترات مجانية حالية\n\n' +
            'متابعة؟'
        );
        if (!ok) return;
        setBusyMode('paid');
        let r: { ok: number; failed: number; total: number } | null = null;
        try {
            const settingRes = await adminService.setPlatformSetting('payment_gateway_enabled', true);
            if (!settingRes.success) {
                await customAlert('❌ تعذر تفعيل البوابة: ' + (settingRes.error ?? ''));
                return;
            }
            setGatewayEnabled(true);

            r = await adminService.bulkSetAllActiveSellers({
                plan: 'premium',
                amount: globalAmount,
                discount: 0,
                expiresAt: null,
                notes: 'Platform mode: mandatory paid for all',
                maxBranches: selPkg?.max,
            });
        } catch (e: any) {
            await customAlert('❌ تعذّر التطبيق: ' + (e?.message ?? ''));
            return;
        } finally {
            setBusyMode(null);
        }
        const announced = await announceModeChange(
            '💳 أصبح الاشتراك مطلوباً لنشر العروض',
            `تم تفعيل الاشتراك الإلزامي على المنصة: ${admNum(globalAmount)} ر.س/شهر` +
            (selPkg ? ` («${selPkg.ar}» — ${branchesShort(selPkg.max, true)})` : '') +
            '. فعّل اشتراكك من لوحة التاجر → الاشتراك.'
        );
        await customAlert(
            (r.failed === 0
                ? `💰 الموقع الآن إلزامي.\n${r.ok} متجر يدفع ${admNum(globalAmount)} ر.س/شهر.`
                : `⚠️ نجح: ${r.ok} | فشل: ${r.failed} (من ${r.total})`) + announced
        );
        onApplied();
    };

    const handleTrialThenPaid = async () => {
        const ok = await customConfirm(
            'سيتم:\n' +
            '• تفعيل بوابة الدفع\n' +
            `• كل تاجر يسجّل حساب جديد من الآن يحصل على ${trialDays} يوم تجريبي مجاناً\n` +
            `• بعد انتهاء التجربة → اشتراك ${admNum(globalAmount)} ر.س/شهر\n` +
            '• التجار الحاليون لن يتأثروا (يبقون على باقتهم الحالية)\n\n' +
            'متابعة؟'
        );
        if (!ok) return;
        setBusyMode('trial-paid');
        try {
            const settingRes = await adminService.setPlatformSetting('payment_gateway_enabled', true);
            if (!settingRes.success) {
                await customAlert('❌ تعذر تفعيل البوابة: ' + (settingRes.error ?? ''));
                return;
            }
            setGatewayEnabled(true);

            // Persist trial config so the DB trigger `tr_new_seller_trial` reads
            // the latest values when a new seller signs up. We only update the
            // platform-wide settings — existing sellers keep their current plan.
            await Promise.allSettled([
                adminService.setPlatformSetting('trial_days', trialDays),
                adminService.setPlatformSetting('basic_plan_price_sar', globalAmount),
            ]);
        } catch (e: any) {
            await customAlert('❌ تعذّر التطبيق: ' + (e?.message ?? ''));
            return;
        } finally {
            setBusyMode(null);
        }
        await customAlert(
            `🎁 الوضع مُفعّل.\nالتجار الجدد فقط يحصلون على ${trialDays} يوم تجربة، ثم ${admNum(globalAmount)} ر.س/شهر.\nالتجار الحاليون لم يتأثروا.`
        );
        onApplied();
    };

    // 4th mode — grant the trial to EVERYONE (existing sellers too), starting now.
    const handleTrialForAll = async () => {
        const ok = await customConfirm(
            'سيتم:\n' +
            '• تفعيل بوابة الدفع\n' +
            `• منح كل التجار (الحاليين والجدد) ${trialDays} يوم تجربة مجانية تبدأ الآن\n` +
            `• بعد انتهاء التجربة → اشتراك ${admNum(globalAmount)} ر.س/شهر\n\n` +
            'متابعة؟'
        );
        if (!ok) return;
        setBusyMode('trial-all');
        let r: { ok: number; failed: number; total: number } | null = null;
        try {
            const settingRes = await adminService.setPlatformSetting('payment_gateway_enabled', true);
            if (!settingRes.success) {
                await customAlert('❌ تعذر تفعيل البوابة: ' + (settingRes.error ?? ''));
                return;
            }
            setGatewayEnabled(true);
            await Promise.allSettled([
                adminService.setPlatformSetting('trial_days', trialDays),
                adminService.setPlatformSetting('basic_plan_price_sar', globalAmount),
            ]);
            const expires = new Date(Date.now() + trialDays * 86400000);
            r = await adminService.bulkSetAllActiveSellers({
                plan: 'trial',
                amount: globalAmount,
                discount: 0,
                expiresAt: expires,
                notes: 'Platform mode: trial for everyone (new + existing)',
                maxBranches: selPkg?.max,
            });
        } catch (e: any) {
            await customAlert('❌ تعذّر التطبيق: ' + (e?.message ?? ''));
            return;
        } finally {
            setBusyMode(null);
        }
        const announced = await announceModeChange(
            '🎁 حصل متجرك على فترة تجربة مجانية',
            `منحناك ${trialDays} يوم تجربة مجانية تبدأ الآن — انشر عروضك بلا رسوم، وبعد انتهائها يصبح الاشتراك ${admNum(globalAmount)} ر.س/شهر.`
        );
        await customAlert(
            (r.failed === 0
                ? `🎉 تم منح ${r.ok} متجراً ${trialDays} يوم تجربة مجانية، ثم ${admNum(globalAmount)} ر.س/شهر.\nوالتجار الجدد أيضاً يحصلون على التجربة تلقائياً.`
                : `⚠️ نجح: ${r.ok} | فشل: ${r.failed} (من ${r.total})`) + announced
        );
        onApplied();
    };

    return (
        <AdmSection
            icon="💼"
            title="وضع الاشتراك العام للموقع"
            desc="يضبط الباقة الافتراضية للتجار الجدد، ويطبّق وضعاً واحداً على كل المتاجر النشطة دفعةً واحدة. للاستثناء الفردي (إعفاء متجر، خصم مؤقّت) افتح بطاقة المتجر نفسه أو «التحكّم الجماعي» بالأسفل."
            collapsible
            defaultOpen={false}
        >
            {/* 🪤 v14.89 — مفتاح بوّابة الدفع إعدادُ منصّةٍ واحد، ومكانُ ضبطه شاشةٌ
                أخرى. هنا يُقرأ للعرض فقط بلا أي زرّ، فلا يصير لهذا المفتاح مكانان
                يُقلَب منهما ويختلفان. */}
            <div
                className="flex items-center gap-2 flex-wrap mb-4 text-[.8rem] font-bold"
                style={{
                    padding: '9px 12px', borderRadius: 'var(--adm-r-sm)',
                    background: 'var(--adm-surface-2)', border: '1px solid var(--adm-border)',
                    color: 'var(--adm-fg-2)',
                }}
            >
                <span>بوّابة الدفع:</span>
                {loaded
                    ? <AdmPill tone={gatewayEnabled ? 'ok' : 'warn'}>{gatewayEnabled ? 'مفعّلة' : 'مطفأة'}</AdmPill>
                    : <span style={{ color: 'var(--adm-fg-3)' }}>جارٍ القراءة…</span>}
                <span style={{ color: 'var(--adm-fg-3)', fontWeight: 600 }}>
                    — مفتاحها المباشر في «البانرات والحملات». وأزرار الوضع أدناه تغيّرها
                    ضمن تغيير الوضع كلّه (فـ«مجاني للجميع» يطفئها و«إلزامي فوراً» يفعّلها).
                </span>
            </div>

            {/* v12.35 — unified default package picker (one price source: الباقات) */}
            <div
                className="p-3 mb-3"
                style={{ background: 'var(--adm-surface-2)', border: '1px solid var(--adm-border)', borderRadius: 'var(--adm-r-sm)' }}
            >
                <div className="text-xs font-bold mb-1.5" style={{ color: 'var(--adm-fg-2)' }}>
                    💎 الباقة الافتراضية للاشتراك (تُطبَّق على التجار الجدد وأزرار الوضع)
                </div>
                <select
                    value={selPkg?.id ?? ''}
                    onChange={(e) => changePackage(Number(e.target.value))}
                    disabled={!loaded || activePkgs.length === 0}
                    aria-label="الباقة الافتراضية للاشتراك"
                    className="adm-focusable"
                    style={{ ...fieldCss, background: 'var(--adm-surface)', fontWeight: 700 }}
                >
                    {activePkgs.map((p) => (
                        <option key={p.id} value={p.id}>
                            {p.ar} — {branchesShort(p.max, true)} — {admNum(effectivePrice(p))} ر.س/شهر
                        </option>
                    ))}
                </select>
                <div className="text-[10px] mt-1.5 leading-relaxed">
                    {pkgSaveState === 'saving' && <span style={{ color: 'var(--adm-warn-fg)' }}>⏳ جاري الحفظ...</span>}
                    {pkgSaveState === 'saved' && <span className="font-bold" style={{ color: 'var(--adm-ok-fg)' }}>✓ محفوظ — السعر موحّد مع «💎 باقات المواقع والأسعار»</span>}
                    {pkgSaveState === 'error' && <span className="font-bold" style={{ color: 'var(--adm-bad-fg)' }}>❌ تعذّر الحفظ — حاول مجدداً</span>}
                    {pkgSaveState === '' && (
                        <span style={{ color: 'var(--adm-fg-3)' }}>
                            السعر يأتي مباشرة من لوحة «💎 باقات المواقع والأسعار» بالأسفل — عدّل السعر هناك وسيتحدّث هنا تلقائياً (لا يوجد مبلغ منفصل).
                        </span>
                    )}
                </div>
            </div>

            {/* أزرار الوضع — كلٌّ منها إجراءٌ جماعيّ يسأل تأكيداً قبل التنفيذ.
                اللون للدلالة وحدها: الأخضر يوسّع، والأحمر يُلزم. */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {([
                    { key: 'free', icon: '🆓', tone: 'ok', title: 'مجاني للجميع', desc: 'إيقاف البوابة + تحويل كل التجار للباقة المجانية', run: handleFreeForAll },
                    { key: 'trial-paid', icon: '🎁', tone: 'warn', title: `${trialDays} يوم تجريبي للجدد فقط`, desc: `التجار الجدد يجرّبون مجاناً ثم ${admNum(globalAmount)} ر.س/شهر`, run: handleTrialThenPaid },
                    { key: 'trial-all', icon: '🎉', tone: 'info', title: `${trialDays} يوم تجربة للجميع`, desc: <>منح الجدد <b>والحاليين</b> تجربة تبدأ الآن، ثم {admNum(globalAmount)} ر.س/شهر</>, run: handleTrialForAll },
                    { key: 'paid', icon: '💰', tone: 'bad', title: 'إلزامي فوراً', desc: `تفعيل البوابة + إلزام الكل بـ ${admNum(globalAmount)} ر.س/شهر بدون تجربة`, run: handlePaidForAll },
                ] as const).map((m) => (
                    <button
                        key={m.key}
                        onClick={m.run}
                        disabled={busyMode !== null}
                        className="adm-focusable p-3.5 text-right disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{
                            background: 'var(--adm-surface-2)', borderRadius: 'var(--adm-r-sm)',
                            border: '1px solid var(--adm-border)', cursor: 'pointer',
                            borderInlineStartWidth: 4, borderInlineStartColor: toneFg(m.tone),
                        }}
                    >
                        <div className="text-sm font-extrabold flex items-center gap-2" style={{ color: 'var(--adm-fg)' }}>
                            <span aria-hidden="true">{m.icon}</span>{m.title}
                        </div>
                        <div className="text-[11px] mt-1 leading-relaxed" style={{ color: 'var(--adm-fg-2)' }}>{m.desc}</div>
                        {busyMode === m.key && <div className="text-[11px] mt-1.5 font-bold" style={{ color: 'var(--adm-fg-3)' }}>⏳ جاري التطبيق…</div>}
                    </button>
                ))}
            </div>

            {/* v12.35 — tell-the-sellers channels when a mode button is applied */}
            <div
                className="mt-3 p-2.5 text-[11px]"
                style={{ background: 'var(--adm-surface-2)', border: '1px solid var(--adm-border)', borderRadius: 'var(--adm-r-sm)' }}
            >
                <div className="font-bold mb-1.5" style={{ color: 'var(--adm-fg)' }}>📣 عند تغيير الوضع، بلّغ التجار عبر:</div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                    <label className="flex items-center gap-1.5 cursor-pointer" style={{ color: 'var(--adm-fg)' }}>
                        <input
                            type="checkbox"
                            className="w-4 h-4"
                            style={{ accentColor: 'var(--adm-accent)' }}
                            checked={notifInapp}
                            onChange={(e) => saveNotifyPrefs(e.target.checked, notifEmail)}
                        />
                        🔔 إشعار داخل الموقع
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer" style={{ color: 'var(--adm-fg)' }}>
                        <input
                            type="checkbox"
                            className="w-4 h-4"
                            style={{ accentColor: 'var(--adm-accent)' }}
                            checked={notifEmail}
                            onChange={(e) => saveNotifyPrefs(notifInapp, e.target.checked)}
                        />
                        📧 بريد إلكتروني
                    </label>
                    <span style={{ color: 'var(--adm-fg-2)' }}>
                        — يُحفظ تلقائياً. زر «تجريبي للجدد فقط» لا يُبلّغ الحاليين لأنهم لا يتأثرون.
                    </span>
                </div>
            </div>

            {/* Editable trial duration — affects the trial-then-paid button label & action */}
            <div
                className="flex items-center gap-2 flex-wrap mt-3 p-2 text-[11px]"
                style={{ background: 'var(--adm-surface-2)', border: '1px solid var(--adm-border)', borderRadius: 'var(--adm-r-sm)' }}
            >
                <span className="font-bold" style={{ color: 'var(--adm-fg)' }}>⏱ مدة التجربة:</span>
                <input
                    type="number"
                    min={1}
                    max={365}
                    value={trialDays}
                    onChange={(e) => setTrialDays(Math.max(1, Math.min(365, Number(e.target.value) || 14)))}
                    onBlur={() => adminService.setPlatformSetting('trial_days', trialDays).catch(() => {})}
                    aria-label="مدة التجربة بالأيام"
                    className="adm-focusable w-14 px-2 py-1 text-center font-bold outline-none"
                    style={{ background: 'var(--adm-surface)', border: '1px solid var(--adm-border)', borderRadius: 'var(--adm-r-sm)', color: 'var(--adm-fg)' }}
                />
                <span style={{ color: 'var(--adm-fg-2)' }}>يوم — تطبَّق على زرَّي التجربة. تُحفظ تلقائياً.</span>
            </div>
        </AdmSection>
    );
});
GlobalSubscriptionMode.displayName = 'GlobalSubscriptionMode';

// ============================================================
// Bulk Subscription Panel — full control over ANY subset of sellers.
// Pick stores by name (search), set plan, dates, amount, discount,
// then apply once. Replaces the previous 2-button limitation.
// ============================================================
type BulkPlan = 'free' | 'trial' | 'premium';

const BulkSubscriptionPanel = memo<{
    sellers: AdminUserRow[];
    isOpen: boolean;
    onToggle: () => void;
    onApplied: () => void;
}>(({ sellers, isOpen, onToggle, onApplied }) => {
    const { customAlert, customConfirm } = useApp();
    const [scope, setScope] = useState<'all-active' | 'pick'>('pick');
    const [pickedIds, setPickedIds] = useState<Set<string>>(new Set());
    const [searchQ, setSearchQ] = useState('');
    const [debouncedSearchQ, setDebouncedSearchQ] = useState('');

    const [plan, setPlan] = useState<BulkPlan>('free');
    const today = new Date();
    const [startedAt, setStartedAt] = useState(toDateInput(today));
    const [expiresAt, setExpiresAt] = useState<string>(''); // empty = no expiry
    const [amount, setAmount] = useState<number>(0);
    const [discount, setDiscount] = useState<number>(100);
    const [sendNotif, setSendNotif] = useState(false);
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

    // Debounce the inline seller search so typing stays buttery on big lists.
    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearchQ(searchQ.trim().toLowerCase()), 150);
        return () => clearTimeout(t);
    }, [searchQ]);

    const visibleSellers = useMemo(() => {
        const list = sellers.filter((s) => !s.is_suspended);
        if (!debouncedSearchQ) return list;
        return list.filter((s) => {
            const blob = `${s.shop ?? ''} ${s.name ?? ''} ${s.phone ?? ''} ${s.email ?? ''}`.toLowerCase();
            return blob.includes(debouncedSearchQ);
        });
    }, [sellers, debouncedSearchQ]);

    const targetIds = useMemo(() => {
        if (scope === 'all-active') return sellers.filter((s) => !s.is_suspended).map((s) => s.id);
        return Array.from(pickedIds);
    }, [scope, pickedIds, sellers]);

    const togglePick = useCallback((id: string) => {
        setPickedIds((prev) => {
            const n = new Set(prev);
            if (n.has(id)) n.delete(id); else n.add(id);
            return n;
        });
    }, []);

    const selectAllVisible = () => {
        setPickedIds((prev) => {
            const n = new Set(prev);
            visibleSellers.forEach((s) => n.add(s.id));
            return n;
        });
    };
    const clearPicks = () => setPickedIds(new Set());

    // ---- Plan presets — one tap fills sensible defaults ---------------
    const applyPreset = (preset: 'free-perpetual' | 'free-30d' | 'trial-30d' | 'premium-full' | 'premium-half') => {
        const now = new Date();
        if (preset === 'free-perpetual') {
            setPlan('free'); setAmount(0); setDiscount(100); setExpiresAt('');
        } else if (preset === 'free-30d') {
            setPlan('free'); setAmount(0); setDiscount(100);
            setExpiresAt(toDateInput(new Date(now.getTime() + 30 * 86400000)));
        } else if (preset === 'trial-30d') {
            setPlan('trial'); setAmount(199); setDiscount(0);
            setExpiresAt(toDateInput(new Date(now.getTime() + 30 * 86400000)));
        } else if (preset === 'premium-full') {
            setPlan('premium'); setAmount(199); setDiscount(0);
            setExpiresAt(toDateInput(new Date(now.getTime() + 365 * 86400000)));
        } else if (preset === 'premium-half') {
            setPlan('premium'); setAmount(199); setDiscount(50);
            setExpiresAt(toDateInput(new Date(now.getTime() + 365 * 86400000)));
        }
    };

    // ---- Quick durations for the end date ---------------------------
    const setQuickDuration = (days: number | null) => {
        if (days === null) { setExpiresAt(''); return; }
        const start = startedAt ? new Date(startedAt) : new Date();
        if (isNaN(start.getTime())) return;
        setExpiresAt(toDateInput(new Date(start.getTime() + days * 86400000)));
    };

    const finalAmount = Math.max(0, amount - (amount * discount) / 100);

    const handleApply = async () => {
        if (targetIds.length === 0) {
            await customAlert('⚠️ اختر بائعاً واحداً على الأقل، أو حوّل الفلتر إلى "كل النشطين".');
            return;
        }
        const expiresLabel = expiresAt
            ? `حتى ${new Date(expiresAt).toLocaleDateString('ar-SA-u-ca-gregory')}`
            : 'بلا انتهاء';
        const planLabel = plan === 'free' ? 'مجانية' : plan === 'trial' ? 'تجريبية' : 'مميزة';
        const ok = await customConfirm(
            `سيتم تطبيق:\n` +
            `• الباقة: ${planLabel}\n` +
            `• المبلغ: ${admNum(finalAmount)} ر.س/شهر${discount > 0 ? ` (خصم ${discount}%)` : ''}\n` +
            `• الانتهاء: ${expiresLabel}\n` +
            `على ${targetIds.length} متجر. متابعة؟`
        );
        if (!ok) return;

        setBusy(true);
        setProgress({ done: 0, total: targetIds.length });
        const expiresDate = expiresAt ? new Date(expiresAt) : null;
        const startDate = startedAt ? new Date(startedAt) : new Date();

        // Run in chunks of 8 — keeps Supabase happy and updates progress as we go.
        // try/finally so a thrown chunk never leaves the panel stuck "busy"
        // with a frozen progress bar (v11.22).
        const CHUNK = 8;
        let okCount = 0;
        let failCount = 0;
        try {
            for (let i = 0; i < targetIds.length; i += CHUNK) {
                const slice = targetIds.slice(i, i + CHUNK);
                const results = await Promise.allSettled(
                    slice.map((sid) =>
                        adminService.applySubscription({
                            storeId: sid,
                            plan,
                            startedAt: startDate,
                            expiresAt: expiresDate,
                            discount,
                            amount,
                            notes: 'Bulk panel (admin)',
                            sendNotification: sendNotif,
                        })
                    )
                );
                results.forEach((r) => {
                    if (r.status === 'fulfilled' && (r.value as any).success) okCount++;
                    else failCount++;
                });
                setProgress({ done: Math.min(i + CHUNK, targetIds.length), total: targetIds.length });
            }
        } finally {
            setBusy(false);
            setProgress(null);
        }

        await customAlert(
            failCount === 0
                ? `✅ تم تطبيق الإعدادات على ${okCount} متجر بنجاح.`
                : `⚠️ نجح: ${okCount} | فشل: ${failCount}. افتح DevTools Console للتفاصيل.`
        );
        if (okCount > 0) {
            // Reset picks so the admin doesn't accidentally re-apply on the next click.
            setPickedIds(new Set());
            onApplied();
        }
    };

    if (!isOpen) {
        // 🪤 مطويّاً يبقى الجسم غير مُصيَّر أصلاً (لا `hidden`) — فقائمة الاختيار
        //    على كل المتاجر لا تُبنى إلا عند الفتح.
        return (
            <button
                onClick={onToggle}
                aria-expanded={false}
                className="adm-focusable w-full p-4 text-right"
                style={{ background: 'var(--adm-surface)', border: '1px solid var(--adm-border)', borderRadius: 'var(--adm-r)', boxShadow: 'var(--adm-shadow)', cursor: 'pointer' }}
            >
                <div className="flex items-center gap-3">
                    <div className="text-xl" aria-hidden="true">⚡</div>
                    <div className="flex-1">
                        <div className="font-extrabold text-sm" style={{ color: 'var(--adm-fg)' }}>تحكّم جماعي بالاشتراكات</div>
                        <div className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--adm-fg-2)' }}>
                            اختر متاجر معيّنة (بحثاً بالاسم) أو كلّ النشطين، وحدّد الباقة والمبلغ والتاريخ والخصم، ثم طبّق دفعةً واحدة.
                        </div>
                    </div>
                    <span className="text-sm flex-shrink-0" style={{ color: 'var(--adm-fg-3)' }} aria-hidden="true">▼</span>
                </div>
            </button>
        );
    }

    return (
        <div style={{ background: 'var(--adm-surface)', border: '1px solid var(--adm-border)', borderRadius: 'var(--adm-r)', boxShadow: 'var(--adm-shadow)', overflow: 'hidden' }}>
            <div
                className="p-4 flex items-center justify-between gap-3"
                style={{ background: 'var(--adm-surface-2)', borderBottom: '1px solid var(--adm-border)' }}
            >
                <div>
                    <div className="font-extrabold text-sm flex items-center gap-2" style={{ color: 'var(--adm-fg)' }}>⚡ تحكّم جماعي بالاشتراكات</div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--adm-fg-2)' }}>يطبّق نفس الإعداد على كل متجرٍ تختاره — يسأل تأكيداً قبل التنفيذ.</div>
                </div>
                <button
                    onClick={onToggle}
                    aria-label="طيّ اللوحة"
                    aria-expanded={true}
                    className="adm-focusable w-8 h-8 flex items-center justify-center text-base flex-shrink-0"
                    style={{ background: 'var(--adm-surface-3)', border: '1px solid var(--adm-border)', borderRadius: 'var(--adm-r-sm)', color: 'var(--adm-fg-2)', cursor: 'pointer' }}
                >
                    ✕
                </button>
            </div>

            <div className="p-4 space-y-5">
                {/* --- 1) Scope -------------------------------------------------- */}
                <section>
                    <div className="text-xs font-bold mb-2" style={labelCss}>👥 على من تُطبَّق؟</div>
                    <div className="grid grid-cols-2 gap-2 mb-2">
                        <button
                            onClick={() => setScope('all-active')}
                            aria-pressed={scope === 'all-active'}
                            className="adm-focusable text-sm"
                            style={pickCss(scope === 'all-active')}
                        >
                            🌐 كل النشطين
                            <div className="text-[10px] font-normal mt-0.5 tabular-nums">
                                {sellers.filter((s) => !s.is_suspended).length} متجر
                            </div>
                        </button>
                        <button
                            onClick={() => setScope('pick')}
                            aria-pressed={scope === 'pick'}
                            className="adm-focusable text-sm"
                            style={pickCss(scope === 'pick')}
                        >
                            🎯 متاجر محددة
                            <div className="text-[10px] font-normal mt-0.5 tabular-nums">
                                {pickedIds.size} مختار
                            </div>
                        </button>
                    </div>

                    {scope === 'pick' && (
                        <div style={{ background: 'var(--adm-surface-2)', border: '1px solid var(--adm-border)', borderRadius: 'var(--adm-r-sm)', overflow: 'hidden' }}>
                            <div className="p-2" style={{ borderBottom: '1px solid var(--adm-border)' }}>
                                <input
                                    type="search"
                                    value={searchQ}
                                    onChange={(e) => setSearchQ(e.target.value)}
                                    placeholder="🔍 ابحث باسم المتجر، الاسم، الجوال أو الإيميل..."
                                    aria-label="بحث في المتاجر لاختيارها"
                                    className="adm-focusable"
                                    style={{ ...fieldCss, background: 'var(--adm-surface)' }}
                                />
                                <div className="flex gap-2 mt-2">
                                    <AdmButton size="sm" onClick={selectAllVisible}>✓ اختر كل المعروض ({visibleSellers.length})</AdmButton>
                                    <AdmButton size="sm" variant="ghost" onClick={clearPicks}>مسح الاختيار</AdmButton>
                                </div>
                            </div>
                            <div className="max-h-56 overflow-y-auto">
                                {visibleSellers.length === 0 ? (
                                    <AdmEmpty icon="🔍" title="لا متجر بهذا البحث" hint="البحث هنا على المتاجر المحمّلة في الشاشة فقط." />
                                ) : visibleSellers.map((s) => {
                                    const checked = pickedIds.has(s.id);
                                    const planIcon: Record<string, string> = { premium: '⭐', trial: '🎁', free: '🆓' };
                                    return (
                                        <label
                                            key={s.id}
                                            className="flex items-center gap-3 p-2.5 cursor-pointer"
                                            style={{
                                                background: checked ? 'var(--adm-accent-weak)' : 'transparent',
                                                borderBottom: '1px solid var(--adm-border)',
                                            }}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={checked}
                                                onChange={() => togglePick(s.id)}
                                                className="adm-focusable w-4 h-4"
                                                style={{ accentColor: 'var(--adm-accent)' }}
                                            />
                                            <div className="flex-1 min-w-0">
                                                <div className="text-sm font-bold truncate flex items-center gap-1.5" style={{ color: 'var(--adm-fg)' }}>
                                                    {planIcon[s.subscription_plan ?? 'free'] ?? '🆓'} {s.shop ?? s.name ?? '(بدون اسم)'}
                                                </div>
                                                <div className="text-[10px] truncate" dir="ltr" style={{ color: 'var(--adm-fg-3)' }}>
                                                    {s.phone ?? s.email ?? '—'}
                                                </div>
                                            </div>
                                            {(s.subscription_amount ?? 0) > 0 && (
                                                <span className="text-[10px] font-bold flex-shrink-0 tabular-nums" style={{ color: 'var(--adm-ok-fg)' }}>
                                                    {admNum((s.subscription_amount ?? 0))} ر.س
                                                </span>
                                            )}
                                        </label>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </section>

                {/* --- 2) Quick presets --------------------------------------- */}
                <section>
                    <div className="text-xs font-bold mb-2" style={labelCss}>⚡ قوالب سريعة (تعبّي الحقول لك):</div>
                    <div className="flex flex-wrap gap-2">
                        {([
                            { p: 'free-perpetual', label: '🆓 مجاني دائم' },
                            { p: 'free-30d', label: '🆓 مجاني 30 يوم' },
                            { p: 'trial-30d', label: '🎁 تجريبي 30 يوم' },
                            { p: 'premium-half', label: '⭐ مميز -50%' },
                            { p: 'premium-full', label: '⭐ مميز سنة كاملة' },
                        ] as const).map((o) => (
                            <AdmButton key={o.p} size="sm" onClick={() => applyPreset(o.p)}>{o.label}</AdmButton>
                        ))}
                    </div>
                </section>

                {/* --- 3) Plan ------------------------------------------------- */}
                <section>
                    <div className="text-xs font-bold mb-2" style={labelCss}>📦 الباقة</div>
                    <div className="grid grid-cols-3 gap-2">
                        {([
                            { v: 'free', label: 'مجانية', icon: '🆓' },
                            { v: 'trial', label: 'تجريبية', icon: '🎁' },
                            { v: 'premium', label: 'مميزة', icon: '⭐' },
                        ] as const).map((o) => (
                            <button
                                key={o.v}
                                onClick={() => setPlan(o.v)}
                                aria-pressed={plan === o.v}
                                className="adm-focusable text-sm"
                                style={{ ...pickCss(plan === o.v), padding: '9px' }}
                            >
                                <div className="text-xl mb-0.5" aria-hidden="true">{o.icon}</div>
                                {o.label}
                            </button>
                        ))}
                    </div>
                </section>

                {/* --- 4) Dates ------------------------------------------------ */}
                <section>
                    <div className="text-xs font-bold mb-2" style={labelCss}>📅 الفترة</div>
                    <div className="grid grid-cols-2 gap-3 mb-2">
                        <div>
                            <div className="text-[10px] mb-1" style={{ color: 'var(--adm-fg-3)' }}>يبدأ</div>
                            <input
                                type="date"
                                value={startedAt}
                                onChange={(e) => setStartedAt(e.target.value)}
                                aria-label="تاريخ البداية"
                                className="adm-focusable"
                                style={fieldCss}
                            />
                        </div>
                        <div>
                            <div className="text-[10px] mb-1" style={{ color: 'var(--adm-fg-3)' }}>ينتهي (فارغ = بلا انتهاء)</div>
                            <input
                                type="date"
                                value={expiresAt}
                                onChange={(e) => setExpiresAt(e.target.value)}
                                aria-label="تاريخ الانتهاء"
                                className="adm-focusable"
                                style={fieldCss}
                            />
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                        {[
                            { label: 'أسبوع', d: 7 },
                            { label: 'شهر', d: 30 },
                            { label: '3 أشهر', d: 90 },
                            { label: '6 أشهر', d: 180 },
                            { label: 'سنة', d: 365 },
                            { label: 'بلا انتهاء', d: null as null | number },
                        ].map((q) => (
                            <AdmButton key={q.label} size="sm" onClick={() => setQuickDuration(q.d)}>
                                {q.label}
                            </AdmButton>
                        ))}
                    </div>
                </section>

                {/* --- 5) Amount + Discount ----------------------------------- */}
                <section className="grid grid-cols-2 gap-3">
                    <div>
                        <div className="text-xs font-bold mb-1.5" style={labelCss}>💰 المبلغ الشهري (ر.س)</div>
                        <input
                            type="number"
                            min={0}
                            step={1}
                            value={amount}
                            onChange={(e) => setAmount(Number(e.target.value) || 0)}
                            aria-label="المبلغ الشهري"
                            className="adm-focusable"
                            style={fieldCss}
                        />
                    </div>
                    <div>
                        <div className="flex justify-between items-center mb-1.5">
                            <div className="text-xs font-bold" style={labelCss}>🎉 الخصم</div>
                            <span className="text-sm font-extrabold tabular-nums" style={{ color: 'var(--adm-accent)' }}>{discount}%</span>
                        </div>
                        <input
                            type="range"
                            min={0}
                            max={100}
                            step={5}
                            value={discount}
                            onChange={(e) => setDiscount(Number(e.target.value))}
                            aria-label="نسبة الخصم"
                            className="adm-focusable w-full"
                            style={{ accentColor: 'var(--adm-accent)' }}
                        />
                    </div>
                </section>

                {/* --- 6) Summary --------------------------------------------- */}
                <div className="p-3" style={{ background: 'var(--adm-surface-2)', border: '1px solid var(--adm-border)', borderRadius: 'var(--adm-r-sm)' }}>
                    <div className="text-xs font-bold mb-1" style={labelCss}>💡 الخلاصة:</div>
                    <div className="text-sm leading-relaxed" style={{ color: 'var(--adm-fg)' }}>
                        سيتم تطبيق <strong>{plan === 'free' ? 'باقة مجانية' : plan === 'trial' ? 'باقة تجريبية' : 'باقة مميزة'}</strong>
                        {' '}بمبلغ صافي <strong className="tabular-nums" style={{ color: 'var(--adm-ok-fg)' }}>{admNum(finalAmount)} ر.س/شهر</strong>
                        {discount > 0 && <> (بعد خصم {discount}%)</>}
                        {' '}على <strong className="tabular-nums" style={{ color: 'var(--adm-accent)' }}>{targetIds.length}</strong> متجر
                        {expiresAt ? <>، ينتهي <strong>{new Date(expiresAt).toLocaleDateString('ar-SA-u-ca-gregory')}</strong>.</> : <>، <strong>بلا انتهاء</strong>.</>}
                    </div>
                </div>

                {/* --- 7) Notify toggle --------------------------------------- */}
                <label
                    className="flex items-center justify-between gap-3 p-3 cursor-pointer"
                    style={{ background: 'var(--adm-surface-2)', border: '1px solid var(--adm-border)', borderRadius: 'var(--adm-r-sm)' }}
                >
                    <div>
                        <div className="font-bold text-sm" style={{ color: 'var(--adm-fg)' }}>إرسال إشعار للبائعين</div>
                        <div className="text-xs mt-0.5" style={{ color: 'var(--adm-fg-2)' }}>قد تحتاج إيقافه لو الإجراء كبير لتجنّب إزعاج الجميع.</div>
                    </div>
                    <input
                        type="checkbox"
                        checked={sendNotif}
                        onChange={(e) => setSendNotif(e.target.checked)}
                        className="adm-focusable w-5 h-5 flex-shrink-0"
                        style={{ accentColor: 'var(--adm-accent)' }}
                    />
                </label>

                {/* --- 8) Apply button ---------------------------------------- */}
                {progress && (
                    <div
                        className="overflow-hidden h-2"
                        role="progressbar"
                        aria-valuenow={progress.done}
                        aria-valuemax={progress.total}
                        style={{ background: 'var(--adm-surface-3)', borderRadius: 999 }}
                    >
                        <div
                            className="h-full transition-all"
                            style={{ width: `${(progress.done / progress.total) * 100}%`, background: 'var(--adm-accent)' }}
                        />
                    </div>
                )}
                <AdmButton full variant="primary" onClick={handleApply} disabled={busy || targetIds.length === 0}>
                    {busy
                        ? `... جاري التطبيق ${progress ? `(${progress.done}/${progress.total})` : ''}`
                        : targetIds.length === 0
                        ? 'اختر متاجر أولاً'
                        : `⚡ تطبيق على ${targetIds.length} متجر`}
                </AdmButton>
            </div>
        </div>
    );
});
BulkSubscriptionPanel.displayName = 'BulkSubscriptionPanel';

// ============================================================
// Main Component
// ============================================================
type SellerSmartFilter = 'pinned' | 'expiring_7d' | 'expiring_30d' | 'no_plan' | 'high_discount';

// ============================================================
// Sponsors box — every sponsor/advertiser in ONE place, with its own search,
// so the gold-frame accounts are instantly distinguishable among thousands of
// ordinary sellers. Each row jumps straight to that store's subscription modal.
// ============================================================
const SPONSOR_LABEL_BADGE: Record<string, string> = {
    ad: '📢 إعلان',
    sponsor: '⭐ راعٍ رسمي',
    none: '⬜ إطار فقط',
    star: '✨ نجمة بالزاوية',
};

const SponsorsBox: React.FC<{
    refreshKey: number;
    onManage: (storeId: string, name: string) => void;
}> = ({ refreshKey, onManage }) => {
    const [rows, setRows] = useState<AdminSponsorRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [q, setQ] = useState('');

    useEffect(() => {
        let alive = true;
        setLoading(true);
        sponsorRepository.listAll().then((r) => { if (alive) { setRows(r); setLoading(false); } });
        return () => { alive = false; };
    }, [refreshKey]);

    const filtered = useMemo(() => {
        const term = q.trim().toLowerCase();
        if (!term) return rows;
        return rows.filter((r) =>
            (r.storeName || '').toLowerCase().includes(term) || (r.shop || '').toLowerCase().includes(term));
    }, [rows, q]);

    const activeCount = rows.filter((r) => r.isActive).length;

    return (
        <AdmSection
            icon="🌟"
            title="الرعاة والمعلنون"
            desc="المتاجر التي تظهر عروضها بإطار ذهبي. «إدارة» تفتح بطاقة اشتراك المتجر نفسه، فالرعاية تُضبط من هناك."
            collapsible
            defaultOpen={false}
            badge={{ text: `${admNum(activeCount)} نشط`, tone: activeCount > 0 ? 'ok' : 'neutral' }}
        >
            <div className="space-y-2">
                <input
                    type="search"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="🔍 ابحث باسم المتجر الراعي..."
                    aria-label="بحث في الرعاة"
                    className="adm-focusable w-full px-3 py-2.5 text-sm outline-none"
                    style={{ background: 'var(--adm-surface-2)', border: '1px solid var(--adm-border)', borderRadius: 'var(--adm-r-sm)', color: 'var(--adm-fg)' }}
                />
                {loading ? (
                    <AdmSkeleton rows={3} height={58} />
                ) : filtered.length === 0 ? (
                    <AdmEmpty
                        icon="🌟"
                        title={rows.length === 0 ? 'لا رعاة بعد' : 'لا نتيجة مطابقة'}
                        hint={rows.length === 0
                            ? 'الرعاية تُفعَّل من بطاقة التاجر نفسه: افتح متجره من «قائمة المتاجر» بالأسفل ثم بدّل مفتاح «راعٍ رسمي».'
                            : 'جرّب اسماً أقصر — البحث هنا على الرعاة المحمّلين فقط.'}
                    />
                ) : (
                    <div className="space-y-2 max-h-80 overflow-y-auto">
                        {filtered.map((r) => (
                            <div
                                key={r.storeId}
                                className="p-3 flex items-center gap-3"
                                style={{ background: 'var(--adm-surface-2)', border: '1px solid var(--adm-border)', borderRadius: 'var(--adm-r-sm)' }}
                            >
                                <span
                                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                                    style={{ background: r.isActive ? 'var(--adm-ok-fg)' : 'var(--adm-fg-3)' }}
                                    aria-hidden="true"
                                />
                                <div className="flex-1 min-w-0">
                                    <div className="font-bold text-sm truncate" style={{ color: 'var(--adm-fg)' }}>{r.storeName || r.shop || r.storeId}</div>
                                    <div className="text-[11px] mt-1 flex flex-wrap items-center gap-1.5" style={{ color: 'var(--adm-fg-2)' }}>
                                        <AdmPill tone="warn">{SPONSOR_LABEL_BADGE[r.labelType || 'ad']}</AdmPill>
                                        <AdmPill tone={r.isActive ? 'ok' : 'neutral'}>{r.isActive ? 'نشط' : 'متوقف'}</AdmPill>
                                        {r.expiresAt && <span>حتى {new Date(r.expiresAt).toLocaleDateString('ar-SA-u-ca-gregory')}</span>}
                                    </div>
                                </div>
                                <AdmButton size="sm" onClick={() => onManage(r.storeId, r.storeName || r.shop || '')}>⚙️ إدارة</AdmButton>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </AdmSection>
    );
};

const AdminSellers: React.FC = () => {
    // v14.38 — الأرقام المالية تُخفى عمّن لا يملك «💰 الأمور المالية».
    const { hasPermission: hasPerm } = useApp();
    const canSeeFinanceMain = hasPerm('action_view_finance');
    const { customAlert } = useApp();
    const [query, setQuery] = useState('');
    const [boxesRefresh, setBoxesRefresh] = useState(0);
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [filter, setFilter] = useState<FilterTab>('all');
    const [smartFilter, setSmartFilter] = useState<SellerSmartFilter | null>(null);
    const [sellers, setSellers] = useState<AdminUserRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState<AdminUserRow | null>(null);
    const [bulkPanelOpen, setBulkPanelOpen] = useState(false);
    const pins = useLocalStringList('taki:admin:sellers:pins', { maxItems: 100 });
    const { push: pushRecent } = useAdminRecents();

    // Push to recents whenever the admin opens a seller's subscription modal.
    useEffect(() => {
        if (editing) {
            pushRecent({
                id: editing.id,
                name: editing.name ?? 'تاجر',
                shop: editing.shop,
                type: 'seller',
                phone: editing.phone,
            });
        }
    }, [editing, pushRecent]);

    useEffect(() => {
        const t = setTimeout(() => setDebouncedQuery(query), 300);
        return () => clearTimeout(t);
    }, [query]);

    const fetchSellers = useCallback(async () => {
        setLoading(true);
        const data = await adminService.searchUsers(debouncedQuery, 'seller', LOADED_CAP, 0);
        setSellers(data);
        setLoading(false);
    }, [debouncedQuery]);

    useEffect(() => {
        fetchSellers();
    }, [fetchSellers]);

    const filtered = useMemo(() => {
        // Step 1: plan/status filter (the existing tabs).
        let base: AdminUserRow[];
        if (filter === 'all') base = sellers;
        else if (filter === 'suspended') base = sellers.filter((s) => s.is_suspended);
        else base = sellers.filter((s) => s.subscription_plan === filter && !s.is_suspended);

        // Step 2: smart filter on top (optional).
        if (!smartFilter) return base;
        const now = Date.now();
        const in7d = now + 7 * 24 * 60 * 60 * 1000;
        const in30d = now + 30 * 24 * 60 * 60 * 1000;
        if (smartFilter === 'pinned') return base.filter((s) => pins.has(s.id));
        if (smartFilter === 'expiring_7d') return base.filter((s) => {
            if (!s.subscription_expires_at) return false;
            const t = new Date(s.subscription_expires_at).getTime();
            return Number.isFinite(t) && t >= now && t <= in7d;
        });
        if (smartFilter === 'expiring_30d') return base.filter((s) => {
            if (!s.subscription_expires_at) return false;
            const t = new Date(s.subscription_expires_at).getTime();
            return Number.isFinite(t) && t >= now && t <= in30d;
        });
        if (smartFilter === 'no_plan') return base.filter((s) => !s.subscription_plan || s.subscription_plan === 'free');
        if (smartFilter === 'high_discount') return base.filter((s) => (s.discount_percentage ?? 0) >= 30);
        return base;
    }, [sellers, filter, smartFilter, pins]);

    // Split into pinned vs the rest so favourites float to the top.
    const { pinnedSellers, restSellers } = useMemo(() => {
        const pinnedSellers: AdminUserRow[] = [];
        const restSellers: AdminUserRow[] = [];
        for (const s of filtered) {
            if (pins.has(s.id)) pinnedSellers.push(s);
            else restSellers.push(s);
        }
        return { pinnedSellers, restSellers };
    }, [filtered, pins]);

    const stats = useMemo(() => {
        const premium = sellers.filter((s) => s.subscription_plan === 'premium').length;
        const trial = sellers.filter((s) => s.subscription_plan === 'trial').length;
        const free = sellers.filter((s) => !s.subscription_plan || s.subscription_plan === 'free').length;
        const mrr = sellers
            .filter((s) => s.subscription_plan === 'premium')
            .reduce((sum, s) => {
                const amount = s.subscription_amount ?? 0;
                const discount = s.discount_percentage ?? 0;
                return sum + (amount - (amount * discount) / 100);
            }, 0);
        return { premium, trial, free, mrr };
    }, [sellers]);

    // Open a sponsor's subscription modal: reuse the loaded row if present,
    // otherwise look it up by name so the modal works even for stores outside
    // the current 200-row page.
    const manageSponsor = useCallback(async (storeId: string, name: string) => {
        const found = sellers.find((s) => s.id === storeId);
        if (found) { setEditing(found); return; }
        const rows = await adminService.searchUsers(name || '', 'seller', 20, 0);
        const match = rows.find((r) => r.id === storeId) || (rows.length === 1 ? rows[0] : undefined);
        if (match) setEditing(match);
        else await customAlert('تعذّر فتح حساب هذا المتجر تلقائياً. ابحث عنه بالأسفل بالاسم.');
    }, [sellers, customAlert]);

    return (
        <div className="space-y-5 animate-fade-in" dir="rtl">
            {/* v14.36 — طلبات تغيير اسم المتجر أولاً: طلبٌ معلّق يجب أن يُرى قبل
                أي شيء آخر، والبطاقة تُخفي نفسها حين لا يوجد طلب. */}
            <StoreNameRequests />
            {/* 🪤 v14.89b — كان هنا عنوان الشاشة ووصفها، وقشرةُ اللوحة تطبع
                الاثنين من `adminNav.ts` — فظهر العنوان مرّتين فوق بعضه بصياغتين
                مختلفتين (بلاغ ناصر). بقي الوصفُ التشغيليّ والإجراءات. */}
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <p style={{ flex: '1 1 260px', margin: 0, fontSize: '.85rem', lineHeight: 1.8, color: 'var(--adm-fg-2)' }}>
                    البحث يسأل الخادم، والأرقام أدناه تُحسب من الصفحة المحمّلة وحدها — لذلك يقول كلٌّ منها نطاقه.
                </p>
                <ExportButton
                    rows={filtered}
                    columns={SELLER_CSV_COLUMNS}
                    filenameStem="taki-sellers"
                    accent="purple"
                    tooltip="تنزيل القائمة المعروضة حالياً كملف CSV — يحتوي على الباقة، تاريخ الانتهاء، الخصم، والمبلغ لكل تاجر"
                />
            </div>

            {/* 🪤 v14.89 — هذه الأرقام تُحسب في المتصفّح من الصفحة المحمّلة (٢٠٠ صفّاً
                كحدٍّ أقصى) لا من المنصّة كلّها، وشاشة «الرئيسية» تحسب اشتراكاتها بطريقةٍ
                أخرى. لذلك `scope` هنا إلزامي، واسم بطاقة المال يقول «هذه القائمة» صراحةً
                حتى لا تُقرأ كإيراد المنصّة. */}
            <AdmStatGrid cols={canSeeFinanceMain ? 4 : 3}>
                {canSeeFinanceMain && (
                    <AdmStat
                        icon="💰"
                        label="اشتراكات هذه القائمة (بعد الخصم)"
                        value={`${admNum(stats.mrr)} ر.س`}
                        tone="ok"
                        scope={`مجموع الباقات المميزة ضمن ${admNum(LOADED_CAP)} متجرٍ محمّلة`}
                        title="مجموع المبالغ الشهرية للباقات المميزة في هذه القائمة بعد طرح خصم كل تاجر. ليس إيراد المنصّة كاملاً."
                    />
                )}
                <AdmStat
                    icon="⭐"
                    label="مميز"
                    value={stats.premium}
                    tone="ok"
                    scope={`ضمن ${admNum(LOADED_CAP)} متجرٍ محمّلة`}
                    onClick={() => setFilter('premium')}
                    title="اعرض المتاجر المميزة وحدها"
                />
                <AdmStat
                    icon="🎁"
                    label="تجريبي"
                    value={stats.trial}
                    tone="warn"
                    scope={`ضمن ${admNum(LOADED_CAP)} متجرٍ محمّلة`}
                    onClick={() => setFilter('trial')}
                    title="اعرض المتاجر التجريبية وحدها"
                />
                <AdmStat
                    icon="🆓"
                    label="مجاني"
                    value={stats.free}
                    scope={`ضمن ${admNum(LOADED_CAP)} متجرٍ محمّلة`}
                    onClick={() => setFilter('free')}
                    title="اعرض المتاجر المجانية وحدها"
                />
            </AdmStatGrid>

            {/* Dedicated boxes so sponsors & admins are distinguishable among
                thousands of ordinary accounts (each with its own search). */}
            <SponsorsBox refreshKey={boxesRefresh} onManage={manageSponsor} />
            {/* v12.50 — تحكم يدوي كامل بنمط ظهور الرعاة/المعلنين في القوائم.
                نفس شرط ظهور تبويب البائعين (tab_sellers) يكفي هنا — الحفظ نفسه
                محمي في القاعدة بصلاحية الأدمن على platform_settings. */}
            <SponsorLayoutPanel />

            {/* Platform-wide subscription mode — set the default amount + flip
                the entire site to free / paid in one click. This is the
                "default" that applies to everyone unless an exception is set. */}
            <GlobalSubscriptionMode onApplied={fetchSellers} />

            {/* Per-package monthly pricing — owner edits every package freely. */}
            <PackagePricingPanel />


            {/* Per-store exceptions: pick any subset of sellers and apply ANY
                plan / dates / amount / discount. */}
            <BulkSubscriptionPanel
                sellers={sellers}
                isOpen={bulkPanelOpen}
                onToggle={() => setBulkPanelOpen((v) => !v)}
                onApplied={fetchSellers}
            />

            {/* القائمة — عمل هذه الشاشة الأساسي، فهي وحدها المفتوحة دائماً. */}
            <AdmSection
                icon="🏪"
                title="قائمة المتاجر"
                desc="البحث يسأل الخادم فيصل إلى ما هو خارج الصفحة؛ والمرشّحان أدناه يعملان على المحمّل. اضغط أي متجر لفتح اشتراكه."
                badge={{ text: `${admNum(filtered.length)} معروض`, tone: 'info' }}
            >
                <div className="space-y-3">
                    <input
                        type="search"
                        placeholder="🔍 ابحث باسم المتجر، الجوال، الإيميل..."
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        aria-label="بحث في المتاجر"
                        className="adm-focusable w-full text-sm font-semibold outline-none"
                        style={{
                            padding: '10px 14px', borderRadius: 'var(--adm-r-sm)',
                            border: '1px solid var(--adm-border)',
                            background: 'var(--adm-surface-2)', color: 'var(--adm-fg)',
                        }}
                    />
                    <div>
                        <div className="text-[11px] font-extrabold mb-1.5" style={{ color: 'var(--adm-fg-3)' }}>الباقة أو الحالة</div>
                        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
                            {([
                                { value: 'all', label: 'الكل', icon: '👥' },
                                { value: 'premium', label: 'مميز', icon: '⭐' },
                                { value: 'trial', label: 'تجريبي', icon: '🎁' },
                                { value: 'free', label: 'مجاني', icon: '🆓' },
                                { value: 'suspended', label: 'معلّق', icon: '🚫' },
                            ] as const).map((f) => (
                                <SmartChip
                                    key={f.value}
                                    active={filter === f.value}
                                    onClick={() => setFilter(f.value)}
                                    icon={f.icon}
                                    label={f.label}
                                />
                            ))}
                        </div>
                    </div>
                    {/* مرشّحٌ ثانٍ يُركَّب فوق الأوّل لا يستبدله. */}
                    <div>
                        <div className="text-[11px] font-extrabold mb-1.5" style={{ color: 'var(--adm-fg-3)' }}>مرشّح ذكي (يُركَّب فوق ما سبق)</div>
                        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
                            <SmartChip active={smartFilter === null}             onClick={() => setSmartFilter(null)}             icon="✓" label="بلا فلتر ذكي" />
                            <SmartChip active={smartFilter === 'pinned'}         onClick={() => setSmartFilter('pinned')}         icon="★" label="المفضّلة" count={pins.list.length} />
                            <SmartChip active={smartFilter === 'expiring_7d'}    onClick={() => setSmartFilter('expiring_7d')}    icon="⏰" label="ينتهي خلال 7 أيام" />
                            <SmartChip active={smartFilter === 'expiring_30d'}   onClick={() => setSmartFilter('expiring_30d')}   icon="📅" label="ينتهي خلال 30 يوم" />
                            <SmartChip active={smartFilter === 'no_plan'}        onClick={() => setSmartFilter('no_plan')}        icon="🆓" label="بدون اشتراك" />
                            <SmartChip active={smartFilter === 'high_discount'}  onClick={() => setSmartFilter('high_discount')}  icon="🏷️" label="خصم ≥ 30%" />
                        </div>
                    </div>

                    {loading ? (
                        <AdmSkeleton rows={5} height={76} />
                    ) : filtered.length === 0 ? (
                        <AdmEmpty
                            icon={smartFilter === 'pinned' ? '★' : '🔍'}
                            title={smartFilter === 'pinned' ? 'لا متاجر في مفضّلتك بعد' : 'لا متجر يطابق هذا المرشّح'}
                            hint={
                                smartFilter === 'pinned'
                                    ? 'اضغط ★ بجانب أي متجر في القائمة ليصعد إلى أعلى الشاشة في كل زيارة.'
                                    : 'جرّب «الكل» مع «بلا فلتر ذكي»، أو ابحث بالاسم — البحث يسأل الخادم فيصل إلى ما هو خارج الصفحة المحمّلة.'
                            }
                            action={
                                (filter !== 'all' || smartFilter !== null) ? (
                                    <AdmButton size="sm" onClick={() => { setFilter('all'); setSmartFilter(null); }}>مسح المرشّحات</AdmButton>
                                ) : undefined
                            }
                        />
                    ) : (
                        <div className="space-y-3">
                            {pinnedSellers.length > 0 && smartFilter !== 'pinned' && (
                                <div>
                                    <div className="text-xs font-extrabold mb-2 px-1" style={{ color: 'var(--adm-warn-fg)' }}>
                                        ★ المفضّلة ({pinnedSellers.length})
                                    </div>
                                    <div className="space-y-2">
                                        {pinnedSellers.map((s) => (
                                            <SellerRow
                                                key={s.id}
                                                seller={s}
                                                onEdit={setEditing}
                                                pinned={true}
                                                onTogglePin={pins.toggle}
                                            />
                                        ))}
                                    </div>
                                </div>
                            )}
                            {restSellers.length > 0 && (
                                <div>
                                    {pinnedSellers.length > 0 && smartFilter !== 'pinned' && (
                                        <div className="text-xs font-extrabold mb-2 px-1" style={{ color: 'var(--adm-fg-3)' }}>
                                            باقي المتاجر ({restSellers.length})
                                        </div>
                                    )}
                                    <div className="space-y-2">
                                        {restSellers.map((s) => (
                                            <SellerRow
                                                key={s.id}
                                                seller={s}
                                                onEdit={setEditing}
                                                pinned={false}
                                                onTogglePin={pins.toggle}
                                            />
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </AdmSection>

            {/* Subscription Modal */}
            {editing && (
                <SubscriptionModal
                    seller={editing}
                    onClose={() => { setEditing(null); setBoxesRefresh((k) => k + 1); }}
                    onSaved={() => { fetchSellers(); setBoxesRefresh((k) => k + 1); }}
                />
            )}
        </div>
    );
};

export default memo(AdminSellers);
