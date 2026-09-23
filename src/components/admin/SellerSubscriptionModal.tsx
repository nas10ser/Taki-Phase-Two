/**
 * SellerSubscriptionModal — بطاقة التاجر ونافذة اشتراكه (v14.89)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🪤 استُخرج من `AdminSellers.tsx` لأن ذلك الملفّ بلغ ٢٢٢٨ سطراً — فوق حدّ
 *    «ما يُقرأ في جلسة واحدة»، وهو أعلى مصدرٍ لكسر ميزةٍ أثناء إصلاح أخرى
 *    (درس مسجَّل في قواعد المشروع، وسقّافة `check-file-size.js` تفرضه).
 *    لم يتغيّر سطرٌ من منطقه: نفس نداءات القاعدة ونفس الصلاحيات.
 */

import React, { useEffect, useState, useCallback, useMemo, memo } from 'react';
import { adminService, AdminUserRow, ApplySubscriptionParams } from '../../services/adminService';
import { useApp } from '../../context/AppContext';
import { LOCATION_PACKAGES, packageForMax, effectivePrice, branchesShort, LocationPackage } from '../../data/packages';
import { packageRepository } from '../../repositories/packageRepository';
import { sponsorRepository } from '../../repositories/sponsorRepository';
import { subscriptionRepository } from '../../repositories/subscriptionRepository';
import { useEscClose } from '../../hooks/useEscClose';
import { CATEGORIES, REGIONS, CITIES } from '../../data/mock';
import { CopyButton } from './CopyButton';
import PromoteToAdminDialog from './PromoteToAdminDialog';
import { AdmButton, AdmPill, AdmStat, AdmStatGrid, admNum, toDateInput } from './ui';
import { fieldCss, labelCss, pickCss } from './sellerStyles';
import { Tooltip } from './Tooltip';

// ============================================================
// Subscription Control Modal — أهم مكوّن في اللوحة
// ============================================================
export const SubscriptionModal = memo<{
    seller: AdminUserRow;
    onClose: () => void;
    onSaved: () => void;
}>(({ seller, onClose, onSaved }) => {
    const { customAlert, startImpersonating, hasPermission, isSuperAdmin } = useApp();
    // v11.19 — both admin powers (impersonate + promote) are
    // permission-gated. The super admin gets both automatically.
    const canImpersonate = hasPermission('action_impersonate');
    const canPromote = isSuperAdmin && seller.user_type !== 'admin';
    const canManageSponsors = hasPermission('action_manage_sponsors');
    // v14.38 — الأرقام المالية والتعديل على الحسابات صارا محروسين فعلاً.
    const canSeeFinance = hasPermission('action_view_finance');
    const canManageUsers = hasPermission('action_manage_users');
    // Loading flag for the "act as seller" button — see AdminBuyers comment.
    const [opening, setOpening] = useState(false);
    const [promoting, setPromoting] = useState(false);
    const handleOpenAsUser = useCallback(async () => {
        if (opening) return;
        setOpening(true);
        try { await startImpersonating(seller.id); }
        finally { setOpening(false); }
    }, [opening, startImpersonating, seller.id]);

    const handlePromote = useCallback(async () => {
        if (promoting || !canPromote) return;
        const { default: openPromoteDialog } = await import('../../components/admin/PromoteToAdminDialog');
        const perms = await openPromoteDialog(seller.shop || seller.name || seller.email || seller.id);
        if (!perms) return;
        setPromoting(true);
        try {
            const { supabase } = await import('../../services/supabaseClient');
            const { error } = await supabase.rpc('admin_promote_user', { target_id: seller.id, perms });
            if (error) throw error;
            await customAlert('✅ تمت الترقية لمسؤول. الصلاحيات نشطة فوراً.');
            onSaved();
            onClose();
        } catch (e: any) {
            await customAlert('❌ ' + (e?.message || 'فشلت الترقية'));
        } finally {
            setPromoting(false);
        }
    }, [promoting, canPromote, seller.id, seller.name, seller.shop, seller.email, customAlert, onSaved, onClose]);
    const today = new Date();
    // Defensive: subscription_expires_at can be a malformed string from
    // legacy rows. Fall back to "today + 30 days" instead of letting an
    // Invalid Date crash the modal (was a white-screen culprit).
    const defaultExpiry = (() => {
        if (seller.subscription_expires_at) {
            const d = new Date(seller.subscription_expires_at);
            if (!isNaN(d.getTime())) return d;
        }
        return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    })();

    const [plan, setPlan] = useState<'free' | 'trial' | 'premium'>(
        (seller.subscription_plan as any) ?? 'premium'
    );
    const [startedAt, setStartedAt] = useState(toDateInput(today));
    const [expiresAt, setExpiresAt] = useState(toDateInput(defaultExpiry));
    const [discount, setDiscount] = useState(Number(seller.discount_percentage) || 0);
    const [amount, setAmount] = useState(Number(seller.subscription_amount) || 199);
    const [notes, setNotes] = useState('');
    const [sendNotif, setSendNotif] = useState(true);
    const [saving, setSaving] = useState(false);
    // Location package (1/3/6/10). max_branches isn't on AdminUserRow, so we
    // pull the store's current value once and default the picker to it.
    const [maxBranches, setMaxBranches] = useState<number>(3);
    useEffect(() => {
        let alive = true;
        subscriptionRepository.getStoreSubscription(seller.id)
            .then(s => { if (alive && s?.maxBranches) setMaxBranches(s.maxBranches); })
            .catch(() => {});
        return () => { alive = false; };
    }, [seller.id]);
    // v11.37 — the location-package grid reads the LIVE catalogue (the same one
    // the owner edits in "💎 باقات المواقع والأسعار"), not the static defaults,
    // so every package the owner adds/edits (incl. 7, 8, …) shows up here too.
    const [pkgCatalog, setPkgCatalog] = useState<LocationPackage[]>(LOCATION_PACKAGES);
    useEffect(() => {
        let alive = true;
        packageRepository.get()
            .then(list => { if (alive && list.length) setPkgCatalog(list); })
            .catch(() => {});
        return () => { alive = false; };
    }, []);
    const activePkgs = pkgCatalog.filter(p => p.active);
    const currentPkg = pkgCatalog.find(p => p.max === maxBranches) || packageForMax(maxBranches);

    // ── v11.23 Sponsor (راعٍ رسمي) state ──────────────────────────────
    const [sponsorOn, setSponsorOn] = useState(false);
    const [spLabel, setSpLabel] = useState<'ad' | 'sponsor' | 'none' | 'star'>('ad'); // v11.25 badge text
    const [spCategory, setSpCategory] = useState('');   // '' = كل التصنيفات
    const [spRegion, setSpRegion] = useState('');        // '' = كل المناطق
    const [spCity, setSpCity] = useState('');            // '' = كل المدن
    const [spRadius, setSpRadius] = useState('');        // كم (اختياري) — يتطلب موقع المتجر
    const [spPriority, setSpPriority] = useState(0);
    const [spStarts, setSpStarts] = useState(toDateInput(new Date()));
    const [spExpires, setSpExpires] = useState(toDateInput(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)));
    const [savingSponsor, setSavingSponsor] = useState(false);
    // Load current sponsor state for this seller so the toggle reflects reality.
    useEffect(() => {
        let alive = true;
        (async () => {
            const all = await sponsorRepository.listAll();
            if (!alive) return;
            const mine = all.find(s => s.storeId === seller.id);
            if (mine) {
                setSponsorOn(!!mine.isActive);
                setSpCategory(mine.targetCategory || '');
                setSpRegion(mine.targetRegion || '');
                setSpCity(mine.targetCity || '');
                setSpRadius(mine.targetRadiusKm != null ? String(mine.targetRadiusKm) : '');
                setSpLabel((mine.labelType as any) || 'ad');
                setSpPriority(mine.priority || 0);
                if (mine.startsAt) {
                    const d = new Date(mine.startsAt);
                    if (!isNaN(d.getTime())) setSpStarts(toDateInput(d));
                }
                if (mine.expiresAt) {
                    const d = new Date(mine.expiresAt);
                    if (!isNaN(d.getTime())) setSpExpires(toDateInput(d));
                }
            }
        })();
        return () => { alive = false; };
    }, [seller.id]);

    const handleSaveSponsor = async () => {
        if (savingSponsor) return;
        const startMs = spStarts ? new Date(spStarts).getTime() : null;
        const expMs = spExpires ? new Date(spExpires).getTime() : null;
        if (sponsorOn && startMs !== null && Number.isNaN(startMs)) {
            await customAlert('❌ تاريخ ابتداء غير صالح.');
            return;
        }
        if (sponsorOn && expMs !== null && Number.isNaN(expMs)) {
            await customAlert('❌ تاريخ انتهاء غير صالح.');
            return;
        }
        if (sponsorOn && startMs !== null && expMs !== null && expMs <= startMs) {
            await customAlert('❌ تاريخ الانتهاء يجب أن يكون بعد تاريخ الابتداء.');
            return;
        }
        setSavingSponsor(true);
        let res: { success: boolean; error?: string } = { success: false };
        try {
            if (sponsorOn) {
                res = await sponsorRepository.set({
                    storeId: seller.id,
                    isActive: true,
                    targetCategory: spCategory || null,
                    targetRegion: spRegion || null,
                    targetCity: spCity || null,
                    targetRadiusKm: spRadius ? Number(spRadius) || null : null,
                    priority: Number(spPriority) || 0,
                    startsAt: spStarts ? new Date(spStarts).toISOString() : null,
                    expiresAt: spExpires ? new Date(spExpires).toISOString() : null,
                    labelType: spLabel,
                });
            } else {
                res = await sponsorRepository.remove(seller.id);
            }
        } catch (e: any) {
            res = { success: false, error: e?.message || 'فشل الحفظ' };
        } finally {
            setSavingSponsor(false);
        }
        if (res.success) {
            await customAlert(sponsorOn ? '🌟 تم تفعيل الراعي الرسمي — تظهر منتجاته كإعلان ذهبي.' : '✅ تم إلغاء الرعاية.');
            onSaved();
        } else {
            await customAlert('❌ ' + (res.error ?? 'فشل حفظ الرعاية'));
        }
    };

    // أزرار سريعة لتغيير المدة
    const quickDurations = [
        { label: 'أسبوع', days: 7 },
        { label: 'شهر', days: 30 },
        { label: '3 أشهر', days: 90 },
        { label: '6 أشهر', days: 180 },
        { label: 'سنة', days: 365 },
    ];

    const setQuickDuration = (days: number) => {
        const start = new Date(startedAt);
        const end = new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
        setExpiresAt(toDateInput(end));
    };

    const finalAmount = useMemo(() => {
        return Math.max(0, amount - (amount * discount) / 100);
    }, [amount, discount]);

    const handleApply = async () => {
        if (saving) return;
        // Validate dates up front — a bad value must show a clear error, never a
        // silent hang on the button (v11.22).
        const startMs = new Date(startedAt).getTime();
        const expMs = expiresAt ? new Date(expiresAt).getTime() : null;
        if (Number.isNaN(startMs) || (expMs !== null && Number.isNaN(expMs))) {
            await customAlert('❌ تاريخ غير صالح. تحقّق من تاريخ البداية والنهاية.');
            return;
        }
        if (expMs !== null && expMs <= startMs) {
            await customAlert('❌ تاريخ النهاية يجب أن يكون بعد تاريخ البداية.');
            return;
        }
        setSaving(true);
        // Resolve outside the try so the alert/navigation runs AFTER the button
        // is re-enabled in finally — no eternal spinner on any path (v11.22).
        let res: { success: boolean; error?: string } = { success: false };
        try {
            const params: ApplySubscriptionParams = {
                storeId: seller.id,
                plan,
                startedAt: new Date(startedAt),
                expiresAt: expiresAt ? new Date(expiresAt) : null,
                discount,
                amount,
                notes: notes || undefined,
                sendNotification: sendNotif,
                maxBranches,
                // v13.16 — نربط المتجر بالباقة نفسها (لا بعدد مواقعها فقط)، فتصله
                // تعديلات عدد المواقع لاحقاً عبر admin_sync_package_limits.
                packageId: pkgCatalog.find(p => p.max === maxBranches)?.id,
            };
            res = await adminService.applySubscription(params);
        } catch (e: any) {
            res = { success: false, error: e?.message || 'فشل التطبيق' };
        } finally {
            setSaving(false);
        }
        if (res.success) {
            await customAlert(`✅ تم تطبيق الاشتراك على متجر "${seller.shop ?? seller.name}"`);
            onSaved();
            onClose();
        } else {
            await customAlert('❌ ' + (res.error ?? 'فشل التطبيق'));
        }
    };

    // Esc closes the modal. The subscription form is intentionally
    // close-on-Esc without an unsaved-changes prompt — applying the
    // subscription is an explicit action (the "تطبيق" button), so
    // Esc is just "cancel" and that matches the seller's mental model.
    useEscClose(true, onClose);

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[3000] flex items-center justify-center p-4 animate-fade-in">
            <div
                className="max-w-2xl w-full max-h-[92vh] overflow-y-auto"
                style={{ background: 'var(--adm-surface)', borderRadius: 'var(--adm-r)', border: '1px solid var(--adm-border)', boxShadow: 'var(--adm-shadow-lift)' }}
            >
                {/* Header */}
                <div
                    className="sticky top-0 p-4 flex items-center justify-between z-10"
                    style={{ background: 'var(--adm-surface-2)', borderBottom: '1px solid var(--adm-border)' }}
                >
                    <div className="min-w-0">
                        <div className="text-[.7rem] font-bold" style={{ color: 'var(--adm-fg-3)' }}>إدارة الاشتراك</div>
                        <div className="text-lg font-extrabold truncate" style={{ color: 'var(--adm-fg)' }}>{seller.shop ?? seller.name}</div>
                        <div className="text-xs mt-0.5 flex items-center gap-1.5" dir="ltr" style={{ color: 'var(--adm-fg-2)' }}>
                            <span>{seller.phone ?? '—'}</span>
                            {seller.phone && (
                                <CopyButton value={seller.phone} label="الجوال" size="xs" />
                            )}
                        </div>
                    </div>
                    <Tooltip text="إغلاق (Esc)">
                        <button
                            onClick={onClose}
                            aria-label="إغلاق"
                            className="adm-focusable w-9 h-9 rounded-full flex items-center justify-center text-lg flex-shrink-0"
                            style={{ background: 'var(--adm-surface-3)', color: 'var(--adm-fg-2)', border: '1px solid var(--adm-border)', cursor: 'pointer' }}
                        >
                            ✕
                        </button>
                    </Tooltip>
                </div>

                <div className="p-5 space-y-5">
                    {/* Act-as-user action — full session swap. After clicking,
                        the admin's Supabase session becomes this seller's:
                        every deal, message, deletion is attributed to them.
                        v11.19 — gated on `action_impersonate` permission. */}
                    {(canImpersonate || canPromote) && (
                        <div className="space-y-2">
                            {canImpersonate && (
                                <>
                                    <button
                                        type="button"
                                        onClick={handleOpenAsUser}
                                        disabled={opening}
                                        className="adm-focusable w-full p-3 font-extrabold text-sm flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-wait"
                                        style={{ background: 'var(--adm-bad-bg)', color: 'var(--adm-bad-fg)', border: '1px solid currentColor', borderRadius: 'var(--adm-r-sm)', cursor: 'pointer' }}
                                    >
                                        {opening ? (
                                            <>
                                                <span className="inline-block w-4 h-4 rounded-full animate-spin" style={{ border: '2px solid transparent', borderTopColor: 'currentColor', borderInlineStartColor: 'currentColor' }} />
                                                <span>جاري فَتح الجَلسة...</span>
                                            </>
                                        ) : (
                                            <>
                                                <span className="text-base">🔓</span>
                                                <span>دخول كَهذا التاجِر (جَلسة كاملة)</span>
                                            </>
                                        )}
                                    </button>
                                    <div className="text-[10px] text-center leading-relaxed" style={{ color: 'var(--adm-fg-2)' }}>
                                        كأنّك سَجَّلت دخول بِحسابه — تَنشر عُروض، تَحذف، تُراسِل، تُعدِّل بَيانات المتجر. كل إجراء مُسجَّل في سِجل التَّدقيق.
                                    </div>
                                </>
                            )}
                            {canPromote && (
                                <button
                                    type="button"
                                    onClick={handlePromote}
                                    disabled={promoting}
                                    className="adm-focusable w-full p-3 font-extrabold text-sm flex items-center justify-center gap-2 disabled:opacity-60"
                                    style={{ background: 'var(--adm-warn-bg)', color: 'var(--adm-warn-fg)', border: '1px solid currentColor', borderRadius: 'var(--adm-r-sm)', cursor: 'pointer' }}
                                >
                                    {promoting ? (
                                        <>
                                            <span className="inline-block w-4 h-4 rounded-full animate-spin" style={{ border: '2px solid transparent', borderTopColor: 'currentColor', borderInlineStartColor: 'currentColor' }} />
                                            <span>جاري الترقية...</span>
                                        </>
                                    ) : (
                                        <>
                                            <span className="text-base">👑</span>
                                            <span>ترقية لمسؤول (مع اختيار الصلاحيات)</span>
                                        </>
                                    )}
                                </button>
                            )}
                        </div>
                    )}

                    {/* اختيار الباقة */}
                    <div>
                        <label className="block text-xs font-bold mb-2" style={labelCss}>
                            🎯 الباقة
                        </label>
                        <div className="grid grid-cols-3 gap-2">
                            {([
                                { value: 'free', label: 'مجانية', icon: '🆓' },
                                { value: 'trial', label: 'تجريبية', icon: '🎁' },
                                { value: 'premium', label: 'مميزة', icon: '⭐' },
                            ] as const).map((p) => (
                                <button
                                    key={p.value}
                                    onClick={() => setPlan(p.value)}
                                    aria-pressed={plan === p.value}
                                    className="adm-focusable text-sm"
                                    style={pickCss(plan === p.value)}
                                >
                                    <div className="text-xl mb-1" aria-hidden="true">{p.icon}</div>
                                    {p.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* باقة المواقع — كم لوكيشن مسموح للتاجر */}
                    <div>
                        <label className="block text-xs font-bold mb-2" style={labelCss}>
                            📍 باقة المواقع (عدد اللوكيشنات المسموحة)
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                            {activePkgs.map((pkg) => {
                                const selected = maxBranches === pkg.max;
                                return (
                                    <button
                                        key={pkg.id}
                                        onClick={() => setMaxBranches(pkg.max)}
                                        aria-pressed={selected}
                                        className="adm-focusable text-sm text-right"
                                        style={pickCss(selected)}
                                    >
                                        <div className="font-extrabold">{pkg.ar}</div>
                                        <div className="text-xs mt-0.5" style={{ color: 'var(--adm-fg-3)' }}>{pkg.descAr}</div>
                                        <div className="text-[11px] font-bold mt-1 tabular-nums">
                                            {admNum(effectivePrice(pkg))} ر.س/شهر
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                        <div className="text-[11px] mt-2" style={labelCss}>
                            الباقة الحالية: <span className="font-bold">{currentPkg.ar}</span> — {currentPkg.descAr}
                        </div>
                    </div>

                    {/* تاريخ البداية والنهاية */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-bold mb-1.5" style={labelCss}>
                                📅 تاريخ البداية
                            </label>
                            <input
                                type="date"
                                value={startedAt}
                                onChange={(e) => setStartedAt(e.target.value)}
                                className="adm-focusable"
                                style={fieldCss}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold mb-1.5" style={labelCss}>
                                📅 تاريخ الانتهاء
                            </label>
                            <input
                                type="date"
                                value={expiresAt}
                                onChange={(e) => setExpiresAt(e.target.value)}
                                className="adm-focusable"
                                style={fieldCss}
                            />
                        </div>
                    </div>

                    {/* أزرار سريعة للمدة */}
                    <div>
                        <div className="text-xs font-bold mb-2" style={labelCss}>⚡ مدد سريعة:</div>
                        <div className="flex flex-wrap gap-2">
                            {quickDurations.map((d) => (
                                <AdmButton key={d.days} size="sm" onClick={() => setQuickDuration(d.days)}>
                                    {d.label}
                                </AdmButton>
                            ))}
                        </div>
                    </div>

                    {/* المبلغ الشهري */}
                    <div>
                        <label className="block text-xs font-bold mb-1.5" style={labelCss}>
                            💰 المبلغ الشهري (ر.س)
                        </label>
                        <input
                            type="number"
                            min={0}
                            step={1}
                            value={amount}
                            onChange={(e) => setAmount(Number(e.target.value))}
                            className="adm-focusable"
                            style={fieldCss}
                        />
                    </div>

                    {/* نسبة الخصم — slider */}
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <label className="text-xs font-bold" style={labelCss}>
                                🎉 نسبة الخصم
                            </label>
                            <span className="text-lg font-extrabold tabular-nums" style={{ color: 'var(--adm-accent)' }}>
                                {discount}%
                            </span>
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
                        <div className="flex justify-between text-[10px] mt-1" style={{ color: 'var(--adm-fg-3)' }}>
                            <span>0%</span>
                            <span>50%</span>
                            <span>100% (مجاني)</span>
                        </div>
                    </div>

                    {/* 🪤 v14.89 — `canSeeFinance` كان مُعرَّفاً هنا ولا يحرس شيئاً:
                        مبلغ الاشتراك وقيمته بعد الخصم يُعرضان لكل مسؤولٍ يفتح
                        بطاقة التاجر، ولو مُنعت عنه «الأمور المالية». الإخفاء لا
                        التعطيل — كما في بقيّة اللوحة (درس v14.38). */}
                    {canSeeFinance && (
                    <div className="p-3.5" style={{ background: 'var(--adm-surface-2)', border: '1px solid var(--adm-border)', borderRadius: 'var(--adm-r-sm)' }}>
                        <div className="text-xs font-bold mb-2" style={labelCss}>💡 ملخّص الاشتراك</div>
                        <div className="grid grid-cols-2 gap-3 text-sm">
                            <div>
                                <div className="text-xs" style={{ color: 'var(--adm-fg-3)' }}>السعر الأصلي</div>
                                <div className="font-bold tabular-nums" style={{ color: 'var(--adm-fg)' }}>
                                    {admNum(amount)} ر.س
                                </div>
                            </div>
                            <div>
                                <div className="text-xs" style={{ color: 'var(--adm-fg-3)' }}>بعد الخصم</div>
                                <div className="text-xl font-extrabold tabular-nums" style={{ color: 'var(--adm-ok-fg)' }}>
                                    {admNum(finalAmount)} ر.س
                                </div>
                            </div>
                        </div>
                    </div>
                    )}

                    {/* ملاحظات */}
                    <div>
                        <label className="block text-xs font-bold mb-1.5" style={labelCss}>
                            📝 ملاحظات (اختياري)
                        </label>
                        <textarea
                            rows={2}
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="مثال: عميل VIP، ممنوح من إدارة المنصة..."
                            className="adm-focusable"
                            style={fieldCss}
                        />
                    </div>

                    {/* إرسال إشعار */}
                    <div className="flex items-center justify-between gap-3 p-3" style={{ background: 'var(--adm-surface-2)', border: '1px solid var(--adm-border)', borderRadius: 'var(--adm-r-sm)' }}>
                        <div>
                            <div className="font-bold text-sm" style={{ color: 'var(--adm-fg)' }}>
                                إرسال إشعار للبائع
                            </div>
                            <div className="text-xs mt-0.5" style={{ color: 'var(--adm-fg-2)' }}>
                                سيتم إخباره بالاشتراك الجديد فوراً
                            </div>
                        </div>
                        <button
                            onClick={() => setSendNotif(!sendNotif)}
                            aria-pressed={sendNotif}
                            aria-label="إرسال إشعار للبائع"
                            className="adm-focusable relative inline-flex h-6 w-11 items-center rounded-full flex-shrink-0"
                            style={{ background: sendNotif ? 'var(--adm-accent)' : 'var(--adm-surface-3)', border: '1px solid var(--adm-border)', cursor: 'pointer' }}
                        >
                            <span
                                className={`inline-block h-4 w-4 transform rounded-full transition-transform ${sendNotif ? 'translate-x-6' : 'translate-x-1'}`}
                                style={{ background: 'var(--adm-surface)' }}
                            />
                        </button>
                    </div>
                </div>

                {/* ── v11.23 Sponsor (راعٍ رسمي) ───────────────────────────
                    A separate, self-contained block with its own save button —
                    sponsorship is independent of the subscription above. Gold
                    theme to match the on-card ad styling. Gated on the
                    action_manage_sponsors permission (v11.24). */}
                {canManageSponsors && (
                <div className="px-5 pb-5">
                    <div className="p-4" style={{ border: '1px solid var(--adm-border)', borderInlineStartWidth: 4, borderInlineStartColor: 'var(--adm-warn-fg)', borderRadius: 'var(--adm-r-sm)', background: 'var(--adm-surface-2)' }}>
                        <div className="flex items-center justify-between gap-3 mb-3">
                            <div>
                                <div className="font-extrabold text-sm flex items-center gap-2" style={{ color: 'var(--adm-fg)' }}>
                                    <span aria-hidden="true">⭐</span> راعٍ رسمي (إعلان ذهبي)
                                </div>
                                <div className="text-[11px] mt-0.5 leading-relaxed" style={{ color: 'var(--adm-fg-2)' }}>
                                    منتجاته تظهر كإعلان بإطار ذهبي بعد كل ٥ عروض، بالمداورة مع باقي الرعاة.
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setSponsorOn(v => !v)}
                                aria-pressed={sponsorOn}
                                aria-label="تفعيل الراعي الرسمي"
                                className="adm-focusable relative inline-flex h-7 w-12 items-center rounded-full flex-shrink-0"
                                style={{ background: sponsorOn ? 'var(--adm-warn-fg)' : 'var(--adm-surface-3)', border: '1px solid var(--adm-border)', cursor: 'pointer' }}
                            >
                                <span
                                    className={`inline-block h-5 w-5 transform rounded-full transition-transform ${sponsorOn ? 'translate-x-6' : 'translate-x-1'}`}
                                    style={{ background: 'var(--adm-surface)' }}
                                />
                            </button>
                        </div>

                        {sponsorOn && (
                            <div className="space-y-3">
                                {/* v11.25 — badge text on the gold frame */}
                                <div>
                                    <label className="block text-[11px] font-bold mb-1" style={labelCss}>النص على الإطار الذهبي</label>
                                    <div className="grid grid-cols-2 gap-2">
                                        {([
                                            { v: 'ad', label: '📢 إعلان' },
                                            { v: 'sponsor', label: '⭐ راعٍ رسمي' },
                                            { v: 'none', label: '⬜ بدون (إطار فقط)' },
                                            { v: 'star', label: '✨ نجمة بالزاوية' },
                                        ] as const).map(o => (
                                            <button
                                                key={o.v}
                                                type="button"
                                                onClick={() => setSpLabel(o.v)}
                                                aria-pressed={spLabel === o.v}
                                                className="adm-focusable text-xs"
                                                style={{ ...pickCss(spLabel === o.v), padding: '8px' }}
                                            >
                                                {o.label}
                                            </button>
                                        ))}
                                    </div>
                                    <div className="text-[10px] mt-1 leading-relaxed" style={{ color: 'var(--adm-fg-3)' }}>
                                        💡 «راعٍ رسمي» يظهر دائماً قبل «إعلان» في كل الصفحات. «بدون» = إطار ذهبي بلا كلمة. «نجمة بالزاوية» = إطار ذهبي + ⭐ صغيرة في الزاوية العلوية بدون شريط نص.
                                    </div>
                                </div>
                                {/* Targeting */}
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-[11px] font-bold mb-1" style={labelCss}>التصنيف المستهدف</label>
                                        <select value={spCategory} onChange={(e) => setSpCategory(e.target.value)}
                                            className="adm-focusable" style={fieldCss}>
                                            <option value="">كل التصنيفات</option>
                                            {CATEGORIES.filter(c => c.id !== 'all').map(c => (
                                                <option key={c.id} value={c.id}>{c.emoji} {c.ar}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-[11px] font-bold mb-1" style={labelCss}>المنطقة المستهدفة</label>
                                        <select value={spRegion} onChange={(e) => { setSpRegion(e.target.value); setSpCity(''); }}
                                            className="adm-focusable" style={fieldCss}>
                                            <option value="">كل المناطق</option>
                                            {REGIONS.map(r => (<option key={r.id} value={r.id}>{r.name}</option>))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-[11px] font-bold mb-1" style={labelCss}>المدينة المستهدفة</label>
                                        <select value={spCity} onChange={(e) => setSpCity(e.target.value)}
                                            className="adm-focusable" style={fieldCss}>
                                            <option value="">كل المدن</option>
                                            {CITIES.filter(c => !spRegion || c.regionId === spRegion).map(c => (
                                                <option key={c.id} value={c.id}>{c.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-[11px] font-bold mb-1" style={labelCss}>نطاق كيلومتري (اختياري)</label>
                                        <input type="tel" inputMode="numeric" value={spRadius}
                                            onChange={(e) => setSpRadius(e.target.value.replace(/\D/g, ''))}
                                            placeholder="مثال: 10 كم"
                                            className="adm-focusable" style={fieldCss} />
                                    </div>
                                </div>
                                {/* v11.28 — explicit start + end dates, each in its own box. */}
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-[11px] font-bold mb-1" style={labelCss}>يبدأ في</label>
                                        <input type="date" value={spStarts} onChange={(e) => setSpStarts(e.target.value)}
                                            className="adm-focusable" style={fieldCss} />
                                    </div>
                                    <div>
                                        <label className="block text-[11px] font-bold mb-1" style={labelCss}>ينتهي في (فارغ = بلا انتهاء)</label>
                                        <input type="date" value={spExpires} onChange={(e) => setSpExpires(e.target.value)}
                                            className="adm-focusable" style={fieldCss} />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-[11px] font-bold mb-1" style={labelCss}>الأولوية (الأعلى يظهر أولاً)</label>
                                    <input type="tel" inputMode="numeric" value={String(spPriority)}
                                        onChange={(e) => setSpPriority(Number(e.target.value.replace(/\D/g, '')) || 0)}
                                        className="adm-focusable" style={fieldCss} />
                                </div>
                                <div className="text-[10px] leading-relaxed" style={{ color: 'var(--adm-fg-3)' }}>
                                    💡 النطاق الكيلومتري يتطلب وجود موقع محدد للمتجر على الخريطة. اترك كل الحقول فارغة ليظهر الإعلان في كل مكان.
                                </div>
                            </div>
                        )}

                        <div className="mt-3">
                            <AdmButton
                                full
                                variant={sponsorOn ? 'primary' : 'danger'}
                                onClick={handleSaveSponsor}
                                disabled={savingSponsor}
                            >
                                {savingSponsor ? 'جاري الحفظ...' : (sponsorOn ? '⭐ حفظ إعدادات الراعي' : '🚫 إلغاء الرعاية')}
                            </AdmButton>
                        </div>
                    </div>
                </div>
                )}

                {/* Footer */}
                <div
                    className="sticky bottom-0 p-4 flex gap-3"
                    style={{ background: 'var(--adm-surface-2)', borderTop: '1px solid var(--adm-border)' }}
                >
                    <div className="flex-1"><AdmButton full onClick={onClose}>إلغاء</AdmButton></div>
                    {/* 🪤 v14.89 — `canManageUsers` كان مُعرَّفاً في هذا الملفّ
                        **ولا يحرس شيئاً**: زرُّ تطبيق الاشتراك يعدّل حساب
                        التاجر (باقة · مدّة · مبلغ · خصم) وكان ظاهراً للجميع.
                        القاعدة ترفض الكتابة لمن لا يملك الصلاحية (v14.38)،
                        لكن الواجهة كانت تَعِد بما سيُرفض — والوعدُ الكاذب أسوأ
                        من المنع الصريح. */}
                    <div className="flex-[2]">
                        {canManageUsers ? (
                            <AdmButton full variant="primary" onClick={handleApply} disabled={saving}>
                                {saving ? 'جاري التطبيق...' : '⚡ تطبيق فوري'}
                            </AdmButton>
                        ) : (
                            <div
                                style={{
                                    padding: '9px 12px', borderRadius: 'var(--adm-r-sm)', textAlign: 'center',
                                    background: 'var(--adm-surface-3)', color: 'var(--adm-fg-3)',
                                    fontSize: '.8rem', fontWeight: 700,
                                }}
                            >
                                تعديل الاشتراكات ليس ضمن صلاحياتك
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
});
SubscriptionModal.displayName = 'SubscriptionModal';
