import React, { useMemo, useState, useEffect, useRef } from 'react';
import { useParams, useHistory } from 'react-router-dom';
import BottomNav from '../components/BottomNav';
import DealCard from '../components/DealCard';
import { getStore } from '../data/mock';
import { useApp } from '../context/AppContext';
import { SellerTopBar } from '../components/SellerTopBar';
import { userRepository } from '../repositories/userRepository';
import { dealService } from '../services/dealService';
import ReportDialog from '../components/ReportDialog';
import { getShopStatus, statusPill, todayHoursLabel, weekHoursLines } from '../utils/workingHours';

const StoreDetails: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const history = useHistory();
    const { deals, language, user, effectiveUserType, followedMerchants, toggleFollowMerchant, blockedMerchants, toggleBlockMerchant, deleteDeal, updateDeal, storeProfiles, updateStoreProfile, customAlert, customConfirm, addReply } = useApp();
    const isRTL = language === 'ar';
    const isFollowed = followedMerchants.includes(id);
    const isBlocked = blockedMerchants.includes(id);
    const [showReport, setShowReport] = useState(false);

    const profile = storeProfiles[id] || {};
    const [isEditingStore, setIsEditingStore] = useState(false);
    const [followerCount, setFollowerCount] = useState<number | null>(null);
    const avatarInputRef = useRef<HTMLInputElement>(null);

    // Real follower count from the database. Updates whenever this user
    // follows / unfollows so the badge reflects reality immediately.
    useEffect(() => {
        let cancelled = false;
        userRepository.getFollowerCount(id).then(c => {
            if (!cancelled) setFollowerCount(c);
        });
        return () => { cancelled = true; };
    }, [id, isFollowed]);

    const [editPhone, setEditPhone] = useState(profile.phone || '');
    // Provide phone number as default bio if empty
    const defaultBio = profile.bio ? profile.bio : (isRTL 
        ? `متخصصون في تقديم أفضل المنتجات والعروض الحصرية. نفخر بخدمتكم وتوفير تجربة تسوق استثنائية وبأسعار مجنونة وحصرية في تاكي.\n\nللتواصل الجوال: ${profile.phone || ''}` 
        : `Specialized in providing the best products and exclusive deals. We take pride in serving you with an exceptional shopping experience.\n\nContact: ${profile.phone || ''}`);
    const [editBio, setEditBio] = useState(defaultBio);
    const [editAddress, setEditAddress] = useState(profile.address || '');
    const [isUploading, setIsUploading] = useState(false);
    const [viewTab, setViewTab] = useState<'active' | 'past' | 'reviews'>('active');
    // FB-style inline reply state for the Reviews tab — same pattern as
    // SellerDashboard/DealDetails. activeReplyId selects which review is in
    // compose/edit mode; replyDrafts keeps per-rating text so blurring or
    // re-opening the composer doesn't lose work.
    const [activeReplyId, setActiveReplyId] = useState<string | null>(null);
    const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});

    const toggleFollow = () => {
        toggleFollowMerchant(id);
        if (!isFollowed) {
             customAlert(isRTL ? 'سيصلك تنبيه بأحدث عروض هذا المحل 🔔' : 'You will be notified of new deals from this store 🔔');
        }
    };

    const toggleBlock = async () => {
        if (!isBlocked) {
            const ok = await customConfirm(isRTL
                ? 'حظر هذا المتجر؟ لن تظهر لك عروضه في الرئيسية ولا في «حولي» ولن تصلك أي تنبيهات منه — حتى لو طابقت تنبيهك الذكي. يمكنك إلغاء الحظر في أي وقت.'
                : 'Block this store? Its deals will be hidden from Home and Nearby and you will get no alerts from it — even if they match your smart alert. You can unblock anytime.');
            if (!ok) return;
            await toggleBlockMerchant(id);
            customAlert(isRTL ? '🚫 تم حظر المتجر. لن تظهر لك عروضه ولن تصلك تنبيهاته.' : '🚫 Store blocked. Its deals and alerts are now hidden from you.');
        } else {
            await toggleBlockMerchant(id);
            customAlert(isRTL ? '✅ تم إلغاء حظر المتجر.' : '✅ Store unblocked.');
        }
    };

    const [store, setStore] = useState<any>(null);
    const [loadingStore, setLoadingStore] = useState(true);

    // Initial store resolution (Sync/Mock fallback)
    useEffect(() => {
        let s = getStore(id);
        if (!s && id) {
            if (user?.id === id && user.userType === 'seller') {
                s = {
                    id: user.id,
                    name: user.name || (user as any).shop || 'متجر جديد',
                    rating: 5,
                    lat: 0,
                    lng: 0,
                    address: isRTL ? 'معلومات الموقع غير متوفرة' : 'Location Not Available'
                };
            } else {
                const inferDeal = deals.find(d => d.storeId === id);
                if (inferDeal) {
                    s = {
                        id,
                        name: inferDeal.shopName || 'متجر غير معروف',
                        rating: 5,
                        lat: 0,
                        lng: 0,
                        address: isRTL ? 'معلومات الموقع غير متوفرة' : 'Location Not Available'
                    };
                }
            }
        }
        
        if (s) {
            setStore(s);
            setLoadingStore(false);
        }

        // Fetch real profile if missing or to ensure freshness
        if (id) {
            userRepository.findById(id).then(u => {
                if (u) {
                    setStore({
                        id: u.id,
                        name: u.shop || u.name || 'متجر',
                        rating: 5,
                        lat: 0,
                        lng: 0,
                        address: u.address || (isRTL ? 'معلومات الموقع غير متوفرة' : 'Location Not Available')
                    });
                }
                setLoadingStore(false);
            }).catch(() => {
                setLoadingStore(false);
            });
        } else {
            setLoadingStore(false);
        }
    }, [id, deals, user, isRTL]);

    const handleSaveProfile = () => {
        updateStoreProfile(id, {
            phone: editPhone,
            contactPhone: editPhone,
            email: profile.email,
            avatar_url: profile.avatar_url,
            bio: editBio,
            address: editAddress,
        });
        setIsEditingStore(false);
        customAlert(isRTL ? '✅ تم حفظ التعديلات' : '✅ Changes saved');
    };

    const reActivateDeal = async (deal: any) => {
        const confirmed = await customConfirm(isRTL ? 'هل تريد تجديد هذا العرض ليعود للظهور في الصفحة الرئيسية؟' : 'Do you want to renew this deal to appear on the home page?');
        if (!confirmed) return;
        const restoreQty = deal.initialQuantity !== undefined ? deal.initialQuantity : (deal.quantity === 0 ? 10 : deal.quantity);
        const ok = await updateDeal({
            ...deal,
            quantity: restoreQty,
            createdAt: Date.now(),
            status: 'active'
        });
        if (!ok) {
            // Renew REJECTED by the DB (almost always: this deal's old
            // location slot was deleted/changed and the server
            // location-cap trigger refuses to re-activate it). This is the
            // 2nd renew entry point — unlike the Seller Dashboard it has
            // no edit form with the "deleted location" re-pick banner, so
            // it was lying with a success toast while the deal silently
            // stayed expired (the exact bug Nasser hit twice). Send the
            // seller to the dashboard where the renew can actually finish.
            await customAlert(isRTL
                ? '⚠️ تعذّر تجديد العرض — لم يعد موقعه السابق ضمن مواقعك أو وصلت لحد المواقع في باقتك. جدّده من «لوحة التاجر ← عروضي» لإعادة اختيار الموقع.'
                : '⚠️ Couldn\'t renew — its old location is no longer one of yours, or you hit your package location limit. Renew it from "Seller Dashboard → My Deals" to re-pick a location.');
            history.push('/seller');
            return;
        }
        customAlert(isRTL ? '✅ تم تجديد العرض بنجاح!' : '✅ Deal renewed successfully!');
    };

    const togglePauseDeal = async (deal: any) => {
        const isCurrentlyPaused = deal.status === 'paused';
        const msg = isCurrentlyPaused 
            ? (isRTL ? 'هل تريد استئناف العرض ليعود نشطاً للمشترين؟' : 'Do you want to resume this deal and make it active for buyers?')
            : (isRTL ? 'هل تريد إيقاف العرض مؤقتاً؟ سينتقل للعروض السابقة ولن يراه المشترون.' : 'Do you want to pause this deal? It will move to previous deals and buyers won\'t see it.');
        
        const confirmed = await customConfirm(msg);
        if (confirmed) {
            await updateDeal({
                ...deal,
                status: isCurrentlyPaused ? 'active' : 'paused'
            });
            customAlert(isRTL 
                ? (isCurrentlyPaused ? '✅ تم استئناف العرض بنجاح!' : '⏸️ تم إيقاف العرض مؤقتاً!') 
                : (isCurrentlyPaused ? '✅ Deal resumed!' : '⏸️ Deal paused!')
            );
        }
    };

    const handleDeleteDeal = async (dealId: string) => {
        const confirmed = await customConfirm(isRTL ? 'هل تريد حذف هذا العرض نهائياً؟ لا يمكن التراجع عن هذه الخطوة.' : 'Are you sure you want to delete this deal permanently? This action cannot be undone.');
        if (confirmed) {
            await deleteDeal(dealId);
            customAlert(isRTL ? '🗑️ تم حذف العرض بنجاح' : '🗑️ Deal deleted successfully');
        }
    };

    const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setIsUploading(true);
        try {
            const { storageService } = await import('../services/storageService');
            const url = await storageService.uploadImage(file);
            if (url) {
                updateStoreProfile(id, { ...profile, avatar_url: url });
            } else {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    const newAvatar = ev.target?.result as string;
                    updateStoreProfile(id, { ...profile, avatar_url: newAvatar });
                };
                reader.readAsDataURL(file);
            }
        } finally {
            setIsUploading(false);
        }
    };

    // Mirror SellerDashboard's predicates so a deal is in EXACTLY one bucket.
    // The previous past-filter said "quantity <= 0 → past" without checking
    // whether the seller actually capped stock. A time-based deal (no
    // initialQuantity set) can sit at quantity=0 while still being active —
    // the countdown is what gates visibility, not the number. That made the
    // deal show up in both "Active" and "Past" tabs at the same time.
    const isTimedOut = (d: any) => {
        // v11.20 — scheduled deals don't start their lifespan clock until
        // startsAt. Without this guard a "2 hours validity" deal scheduled
        // a week out would be born already expired.
        const lifespanStart = (typeof d.startsAt === 'number') ? Math.max(d.startsAt, d.createdAt || 0) : (d.createdAt || 0);
        const lifespanMs = (d.expiresInMinutes || 120) * 60 * 1000;
        return Date.now() > (lifespanStart + lifespanMs);
    };

    // v11.20 — Coming Soon = scheduled deal whose startsAt is in the future.
    const isComingSoonLocal = (d: any) =>
        typeof d.startsAt === 'number' && d.startsAt > Date.now();

    // Sold-out requires a real stock cap. Without initialQuantity > 0 the
    // deal is time-based, so quantity=0 is meaningless — don't treat it
    // as sold-out.
    const isSoldOut = (d: any) => d.quantity !== 'unlimited'
        && typeof d.quantity === 'number' && d.quantity <= 0
        && typeof d.initialQuantity === 'number' && d.initialQuantity > 0;

    const storeDeals = useMemo(() => {
        // v11.20 — Coming Soon deals stay in this tab. Buyers (and the
        // merchant themselves) need to see what's scheduled. The DealCard
        // already renders them locked + dimmed; the booking page itself
        // blocks the actual book click until startsAt passes.
        return deals.filter(d =>
            d.storeId === id &&
            d.status === 'active' &&
            !isSoldOut(d) &&
            !isTimedOut(d)
        );
    }, [deals, id]);

    const pastStoreDeals = useMemo(() => {
        return deals.filter(d =>
            d.storeId === id && (
                d.status === 'expired' ||
                d.status === 'paused' ||
                (d.status === 'active' && (isSoldOut(d) || isTimedOut(d)))
            )
        );
    }, [deals, id]);

    const allStoreReviews = useMemo(() => {
        return deals
            .filter(d => d.storeId === id)
            .flatMap(d => (d.ratings || []).map(r => ({ ...r, itemName: d.itemName, dealId: d.id })))
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }, [deals, id]);

    // Real average rating across all of this store's deals (active + expired
    // alike — historical reviews are still meaningful).
    const storeRating = useMemo(() => {
        const allRatings = deals
            .filter(d => d.storeId === id)
            .flatMap(d => d.ratings || []);
        return dealService.calculateRating(allRatings);
    }, [deals, id]);

    if (loadingStore) {
        return (
            <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--body-bg)' }}>
                <div style={{ width: 40, height: 40, border: '4px solid var(--border-color)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'taki-spin 1s linear infinite' }} />
                <style>{`@keyframes taki-spin{to{transform:rotate(360deg)}}`}</style>
            </div>
        );
    }

    if (!store) {
        return (
            <div className="empty-state animate-fade-in" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ fontSize: '4rem', marginBottom: 16 }}>🏪</div>
                <div style={{ fontWeight: 800, color: 'var(--gray-400)' }}>{isRTL ? 'المتجر غير موجود' : 'Store Not Found'}</div>
                <button onClick={() => history.push('/')} style={{ marginTop: 20, padding: '12px 28px', borderRadius: 14, background: 'var(--dark)', color: 'white', fontWeight: 800, border: 'none' }}>
                    {isRTL ? 'العودة' : 'Go Back'}
                </button>
            </div>
        );
    }

    return (
        <div className="page-content" style={{ background: 'var(--body-bg)', minHeight: '100vh', direction: isRTL ? 'rtl' : 'ltr' }}>
            {/* Header */}
            <div className="animate-fade-in" style={{
                position: 'relative',
                background: 'var(--header-gradient)',
                color: 'white',
                // Same safe-area pattern as Bookings.tsx (v10.22): the back
                // button used to land beside the camera cutout on iPhones
                // with a notch. env() resolves to 0 on devices without one.
                padding: 'calc(env(safe-area-inset-top, 12px) + 6px) 20px 16px',
                borderRadius: '0 0 24px 24px',
                boxShadow: '0 8px 30px rgba(15,23,42,0.15)'
            }}>
                {/* Back Button & Top Action */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <button onClick={() => history.goBack()} style={{ background: 'rgba(80, 80, 90, 0.3)', border: 'none', color: 'white', padding: '8px 16px', borderRadius: 12, fontSize: '0.85rem', fontWeight: 800 }}>
                        {isRTL ? '→ رجوع' : '← Back'}
                    </button>
                    {user?.id === store.id && (
                        <button onClick={() => setIsEditingStore(!isEditingStore)} style={{ background: isEditingStore ? '#ef4444' : 'rgba(80, 80, 95, 0.2)', color: 'white', border: 'none', borderRadius: 12, padding: '8px 16px', fontSize: '0.85rem', fontWeight: 800 }}>
                            {isEditingStore ? (isRTL ? 'إلغاء' : 'Cancel') : (isRTL ? 'تعديل البروفايل' : 'Edit Profile')}
                        </button>
                    )}
                </div>

                {/* Main Profile Info (Centered) */}
                <div style={{ textAlign: 'center', marginBottom: 14 }}>
                    <div style={{ position: 'relative', width: 100, height: 100, margin: '0 auto 10px' }}>
                        <div style={{ width: '100%', height: '100%', borderRadius: 28, background: ((profile as any).avatar_url || (profile as any).avatar) ? 'transparent' : 'rgba(80, 80, 90, 0.3)', border: '3px solid rgba(80, 80, 95, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '3rem', overflow: 'hidden', textTransform: 'uppercase' }}>
                            {((profile as any).avatar_url || (profile as any).avatar) ? <img src={(profile as any).avatar_url || (profile as any).avatar} loading="lazy" alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : store.name.charAt(0)}
                        </div>
                        {user?.id === store.id && isEditingStore && (
                            <div
                                style={{ position: 'absolute', bottom: -5, right: -5, background: 'var(--primary)', borderRadius: '50%', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', border: '2px solid white', boxShadow: '0 4px 10px rgba(0,0,0,0.3)', WebkitTapHighlightColor: 'transparent', userSelect: 'none', overflow: 'hidden' }}
                            >
                                <span style={{ pointerEvents: 'none' }}>📸</span>
                                <input
                                    id="store-avatar-upload"
                                    ref={avatarInputRef}
                                    type="file"
                                    accept="image/*"
                                    onChange={handleAvatarUpload}
                                    onClick={(e) => { (e.target as HTMLInputElement).value = ''; }}
                                    aria-label={isRTL ? 'تغيير صورة المتجر' : 'Change store avatar'}
                                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', fontSize: 0, zIndex: 2 }}
                                />
                            </div>
                        )}
                    </div>
                    
                    <h1 style={{ fontSize: '1.6rem', fontWeight: 900, marginBottom: 4 }}>{store.name}</h1>
                    <div style={{ fontSize: '1rem', opacity: 0.9, fontWeight: 700, marginBottom: 4 }}>📍 {profile.address || store.address}</div>
                    <div style={{ fontSize: '0.85rem', opacity: 0.7, fontWeight: 600, marginBottom: 16 }}>📅 {isRTL ? 'تاريخ الانضمام: ' : 'Joined: '} {new Date().getFullYear()}/01</div>
                    
                    <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                        <span style={{ background: 'rgba(245,158,11,0.2)', color: '#fbbf24', padding: '8px 16px', borderRadius: 14, fontSize: '1rem', fontWeight: 900 }}
                            title={isRTL ? `${storeRating.count} تقييم` : `${storeRating.count} reviews`}>
                            ★ {storeRating.count > 0 ? storeRating.average : (isRTL ? 'جديد' : 'New')}
                            {storeRating.count > 0 && (
                                <span style={{ fontSize: '0.7rem', opacity: 0.85, marginInlineStart: 6, fontWeight: 700 }}>
                                    ({storeRating.count})
                                </span>
                            )}
                        </span>
                        <div style={{ background: 'rgba(80, 80, 90, 0.3)', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', borderRadius: 14 }}>
                            <span style={{ color: '#fff', fontSize: '1rem', fontWeight: 900 }}>
                                👥 {followerCount === null ? '…' : followerCount.toLocaleString(isRTL ? 'ar-SA' : 'en-US')}
                            </span>
                            {user?.id !== store.id && (
                                <>
                                    <button onClick={toggleFollow}
                                        aria-label={isFollowed ? (isRTL ? 'إلغاء المتابعة' : 'Unfollow') : (isRTL ? 'متابعة' : 'Follow')}
                                        title={isFollowed ? (isRTL ? 'إلغاء المتابعة' : 'Unfollow') : (isRTL ? 'متابعة المتجر' : 'Follow store')}
                                        style={{
                                            background: isFollowed ? '#ef4444' : 'rgba(80, 80, 95, 0.2)',
                                            color: 'white',
                                            border: 'none', borderRadius: '50%', width: 28, height: 28,
                                            fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            transition: 'all 0.2s ease', cursor: 'pointer'
                                        }}>
                                        {isFollowed ? '❤️' : '🤍'}
                                    </button>
                                    <button onClick={toggleBlock}
                                        aria-label={isBlocked ? (isRTL ? 'إلغاء حظر المتجر' : 'Unblock store') : (isRTL ? 'حظر المتجر' : 'Block store')}
                                        title={isBlocked ? (isRTL ? 'إلغاء حظر المتجر' : 'Unblock store') : (isRTL ? 'حظر المتجر — إخفاء عروضه وتنبيهاته' : 'Block store — hide its deals & alerts')}
                                        style={{
                                            background: isBlocked ? '#ef4444' : 'rgba(80, 80, 95, 0.2)',
                                            color: 'white',
                                            border: 'none', borderRadius: '50%', width: 28, height: 28,
                                            fontSize: '0.95rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            transition: 'all 0.2s ease', cursor: 'pointer',
                                            marginInlineStart: 6
                                        }}>
                                        🚫
                                    </button>
                                    {effectiveUserType === 'buyer' && (
                                        <button onClick={() => setShowReport(true)}
                                            aria-label={isRTL ? 'إبلاغ عن المتجر' : 'Report store'}
                                            title={isRTL ? 'إبلاغ عن المتجر للإدارة' : 'Report this store to admin'}
                                            style={{
                                                background: 'rgba(80, 80, 95, 0.2)',
                                                color: 'white',
                                                border: 'none', borderRadius: '50%', width: 28, height: 28,
                                                fontSize: '0.95rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                transition: 'all 0.2s ease', cursor: 'pointer',
                                                marginInlineStart: 6
                                            }}>
                                            🚩
                                        </button>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                </div>

                {/* About & Contact Section */}
                <div style={{ marginTop: 24, background: 'rgba(0,0,0,0.2)', padding: 20, borderRadius: 20, border: '1px solid rgba(80, 80, 90, 0.3)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                        <div style={{ fontSize: '0.9rem', fontWeight: 800, opacity: 0.6 }}>{isRTL ? 'نبذة عن المحل' : 'About Store'}</div>
                    </div>
                    
                    {isEditingStore ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
                            <textarea value={editBio} onChange={e => setEditBio(e.target.value)} style={{ width: '100%', background: 'rgba(80, 80, 90, 0.2)', border: '1px solid rgba(80, 80, 90, 0.3)', color: 'white', padding: '12px', borderRadius: 14, fontSize: '0.95rem', minHeight: 80, outline: 'none' }} />
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                <label style={{ fontSize: '0.8rem', fontWeight: 800, opacity: 0.7 }}>{isRTL ? 'رقم التواصل:' : 'Contact Phone:'}</label>
                                <input value={editPhone} onChange={e => setEditPhone(e.target.value)} style={{ background: 'rgba(80, 80, 90, 0.2)', border: '1px solid rgba(80, 80, 90, 0.3)', color: 'white', padding: '12px', borderRadius: 14, fontSize: '1rem', outline: 'none' }} />
                            </div>
                            <button onClick={handleSaveProfile} style={{ background: 'var(--primary)', color: 'white', border: 'none', borderRadius: 14, padding: '14px', fontSize: '1rem', fontWeight: 900 }}>
                                {isRTL ? 'حفظ البيانات' : 'Save Profile'}
                            </button>
                        </div>
                    ) : (
                        <>
                            <p style={{ fontSize: '0.95rem', lineHeight: 1.6, margin: '0 0 20px', fontWeight: 500, opacity: 0.9 }}>{defaultBio}</p>
                            {(profile.contactPhone || profile.phone) && (
                                <div style={{ display: 'flex', gap: 10 }}>
                                    <a href={`tel:${profile.contactPhone || profile.phone}`} style={{
                                        flex: 1,
                                        background: 'rgba(255,255,255,0.92)',
                                        color: '#0f172a',
                                        border: '1px solid rgba(80, 80, 95, 0.2)',
                                        borderRadius: 16,
                                        padding: '15px 14px',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                                        textDecoration: 'none', fontWeight: 900, fontSize: '1rem',
                                        boxShadow: '0 8px 24px rgba(0,0,0,0.12)'
                                    }}>
                                        📞 {isRTL ? 'اتصال' : 'Call'}
                                    </a>
                                    <a href={`https://wa.me/966${(profile.contactPhone || profile.phone)?.replace(/^0/, '')}`} target="_blank" rel="noopener noreferrer" style={{
                                        flex: 1,
                                        background: '#25d366',
                                        color: '#fff',
                                        border: 'none',
                                        borderRadius: 16,
                                        padding: '15px 14px',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                                        textDecoration: 'none', fontWeight: 900, fontSize: '1rem',
                                        boxShadow: '0 8px 24px rgba(37,211,102,0.25)'
                                    }}>
                                        WhatsApp 💬
                                    </a>
                                </div>
                            )}
                        </>
                    )}
                </div>

                {/* Upload Status Overlay */}
                {isUploading && (
                    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <div style={{ background: 'var(--card-bg)', color: 'var(--text-primary)', padding: '24px 32px', borderRadius: 16, fontWeight: 800 }}>
                            {isRTL ? '⏳ جاري رفع الصورة...' : '⏳ Uploading Image...'}
                        </div>
                    </div>
                )}

                <div style={{ marginTop: 24, paddingBottom: 8 }}>
                    <SellerTopBar storeId={store.id} />
                </div>
            </div>

            {/* Working hours (ساعات عمل المحل) — visible to buyers on the store page */}
            {(() => {
                const wh = (profile as any)?.workingHours;
                const st = getShopStatus(wh);
                if (!st.configured) return null;
                const pill = statusPill(wh, isRTL);
                const bg = pill.tone === 'open' ? 'rgba(16,185,129,0.12)' : pill.tone === 'soon' ? 'rgba(245,158,11,0.14)' : 'rgba(239,68,68,0.12)';
                const col = pill.tone === 'open' ? '#10b981' : pill.tone === 'soon' ? '#f59e0b' : '#ef4444';
                const dot = pill.tone === 'closed' ? '🔴' : pill.tone === 'soon' ? '🟠' : '🟢';
                const week = weekHoursLines(wh, isRTL);
                return (
                    <div style={{ margin: '12px 16px', background: 'var(--card-bg)', borderRadius: 20, padding: 18, boxShadow: '0 4px 20px rgba(0,0,0,0.04)', border: '1px solid var(--border-color)' }}>
                        <h3 style={{ fontWeight: 900, marginBottom: 10, fontSize: '0.95rem', color: 'var(--text-primary)' }}>🕐 {isRTL ? 'ساعات عمل المحل' : 'Working Hours'}</h3>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                            <span style={{ background: bg, color: col, fontWeight: 900, fontSize: '0.8rem', padding: '5px 12px', borderRadius: 999 }}>{dot} {pill.text}</span>
                            <span style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', fontWeight: 700 }}>{isRTL ? 'اليوم: ' : 'Today: '}<span style={{ direction: 'ltr', display: 'inline-block' }}>{todayHoursLabel(wh, isRTL)}</span></span>
                        </div>
                        <details>
                            <summary style={{ cursor: 'pointer', color: 'var(--primary)', fontWeight: 800, fontSize: '0.8rem' }}>{isRTL ? 'عرض كل أيام الأسبوع' : 'View all week'}</summary>
                            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
                                {week.map((w, i) => (
                                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: '0.8rem', fontWeight: w.today ? 900 : 700, color: w.today ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                                        <span>{w.day}{w.today ? (isRTL ? ' (اليوم)' : ' (today)') : ''}</span>
                                        <span style={{ direction: 'ltr' }}>{w.label}</span>
                                    </div>
                                ))}
                            </div>
                        </details>
                    </div>
                );
            })()}

            {/* Tabs */}
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', background: 'var(--card-bg)', position: 'sticky', top: 0, zIndex: 10 }}>
                <button onClick={() => setViewTab('active')}
                    style={{ flex: 1, padding: '16px', border: 'none', background: 'none', color: viewTab === 'active' ? 'var(--primary)' : 'var(--gray-400)', fontWeight: 900, borderBottom: viewTab === 'active' ? '3px solid var(--primary)' : 'none', transition: 'all 0.2s' }}>
                    {isRTL ? 'عروض نشطة' : 'Active'}
                </button>
                <button onClick={() => setViewTab('past')}
                    style={{ flex: 1, padding: '16px', border: 'none', background: 'none', color: viewTab === 'past' ? 'var(--primary)' : 'var(--gray-400)', fontWeight: 900, borderBottom: viewTab === 'past' ? '3px solid var(--primary)' : 'none', transition: 'all 0.2s' }}>
                    {isRTL ? 'عروض سابقة' : 'Past'}
                </button>
                <button onClick={() => setViewTab('reviews')}
                    style={{ flex: 1, padding: '16px', border: 'none', background: 'none', color: viewTab === 'reviews' ? 'var(--primary)' : 'var(--gray-400)', fontWeight: 900, borderBottom: viewTab === 'reviews' ? '3px solid var(--primary)' : 'none', transition: 'all 0.2s' }}>
                    {isRTL ? 'آراء المشترين' : 'Reviews'}
                </button>
            </div>

            {/* Content Sections */}
            <div style={{ padding: 16, paddingBottom: 100 }}>
                {viewTab === 'active' && (
                    <div className="animate-fade-in">
                        <div className="taki-deals-grid" style={{ display: 'grid', gap: 10 }}>
                            {storeDeals.length > 0 ? storeDeals.map(deal => (
                                <div key={deal.id} style={{ display: 'flex', flexDirection: 'column' }}>
                                    <DealCard deal={deal} onClick={(id) => history.push(`/deal/${id}`)} isSponsored={(storeProfiles[store?.id || ''] as any)?.is_pinned} />
                                    {user?.id === store?.id && (
                                        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                                            <button onClick={() => history.push(`/seller?tab=form&edit=${deal.id}&origin=active&source=store`)} style={{ flex: 1, padding: '6px', fontSize: '0.7rem', borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--gray-100)', color: 'var(--text-primary)', fontWeight: 800 }}>✏️ {isRTL ? 'تعديل' : 'Edit'}</button>
                                            <button onClick={() => togglePauseDeal(deal)} style={{ flex: 1, padding: '6px', fontSize: '0.7rem', borderRadius: 8, border: '1px solid rgba(245, 158, 11, 0.3)', background: 'rgba(245, 158, 11, 0.15)', color: 'var(--secondary)', fontWeight: 800 }}>⏸️ {isRTL ? 'إيقاف' : 'Pause'}</button>
                                            <button onClick={() => handleDeleteDeal(deal.id)} style={{ flex: 1, padding: '6px', fontSize: '0.7rem', borderRadius: 8, border: '1px solid rgba(239, 68, 68, 0.3)', background: 'rgba(239, 68, 68, 0.15)', color: 'var(--danger)', fontWeight: 800 }}>🗑️ {isRTL ? 'حذف' : 'Del'}</button>
                                        </div>
                                    )}
                                </div>
                            )) : (
                                <div style={{ gridColumn: 'span 2', textAlign: 'center', padding: '60px 20px', color: 'var(--gray-400)' }}>
                                    <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>📦</div>
                                    <div style={{ fontWeight: 800 }}>{isRTL ? 'لا توجد عروض حالياً' : 'No active deals'}</div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {viewTab === 'past' && (
                    <div className="animate-fade-in">
                        <div className="taki-deals-grid" style={{ display: 'grid', gap: 10 }}>
                            {pastStoreDeals.length > 0 ? pastStoreDeals.map(deal => (
                                <div key={deal.id} style={{ display: 'flex', flexDirection: 'column', opacity: 0.85 }}>
                                    <DealCard deal={deal} onClick={(id) => history.push(`/deal/${id}`)} isSponsored={(storeProfiles[store?.id || ''] as any)?.is_pinned} />
                                    {user?.id === store?.id && (
                                        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                                            <button
                                                onClick={() => {
                                                    if (deal.status === 'paused') togglePauseDeal(deal);
                                                    else reActivateDeal(deal);
                                                }}
                                                title={deal.status === 'paused' ? (isRTL ? 'استئناف العرض' : 'Resume Deal') : (isRTL ? 'تجديد العرض' : 'Renew Deal')}
                                                style={{
                                                    flex: 1.3, padding: '7px 4px', fontSize: '0.7rem', borderRadius: 10,
                                                    border: 'none',
                                                    background: 'var(--primary)',
                                                    color: 'white', fontWeight: 900, cursor: 'pointer',
                                                    boxShadow: 'var(--shadow-sm)',
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3,
                                                    whiteSpace: 'nowrap'
                                                }}>
                                                {deal.status === 'paused' ? (isRTL ? '▶️ استئناف' : '▶️ Resume') : (isRTL ? '🔄 تجديد' : '🔄 Renew')}
                                            </button>
                                            <button
                                                onClick={() => history.push(`/seller?tab=form&edit=${deal.id}&origin=expired&source=store`)}
                                                title={isRTL ? 'تعديل العرض' : 'Edit Deal'}
                                                style={{
                                                    flex: 1, padding: '7px 4px', fontSize: '0.7rem', borderRadius: 10,
                                                    border: '1px solid var(--border-color)',
                                                    background: 'var(--card-bg)', color: 'var(--text-primary)',
                                                    fontWeight: 800, cursor: 'pointer',
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3,
                                                    whiteSpace: 'nowrap'
                                                }}>
                                                ✏️ {isRTL ? 'تعديل' : 'Edit'}
                                            </button>
                                            <button
                                                onClick={() => handleDeleteDeal(deal.id)}
                                                title={isRTL ? 'حذف العرض' : 'Delete Deal'}
                                                style={{
                                                    flex: 1, padding: '7px 4px', fontSize: '0.7rem', borderRadius: 10,
                                                    border: '1px solid rgba(239, 68, 68, 0.3)',
                                                    background: 'rgba(239, 68, 68, 0.15)', color: 'var(--danger)',
                                                    fontWeight: 800, cursor: 'pointer',
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3,
                                                    whiteSpace: 'nowrap'
                                                }}>
                                                🗑️ {isRTL ? 'حذف' : 'Del'}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )) : (
                                <div style={{ gridColumn: 'span 2', textAlign: 'center', padding: '60px 20px', color: 'var(--gray-400)' }}>
                                    <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>📜</div>
                                    <div style={{ fontWeight: 800 }}>{isRTL ? 'لا توجد عروض سابقة' : 'No past deals'}</div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {viewTab === 'reviews' && (
                    <div className="animate-fade-in">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            {allStoreReviews.length > 0 ? allStoreReviews.map((r: any) => {
                                // The merchant viewing their own store can reply/edit/remove
                                // every review here, just like in the SellerDashboard
                                // "التقييمات" tab — so they never need to leave this page.
                                const canManage = user?.id === store?.id && !!r.id;
                                const isEditing = canManage && activeReplyId === r.id;
                                return (
                                <div key={r.id || r.date} style={{ background: 'var(--card-bg)', padding: 16, borderRadius: 20, border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-sm)' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                                        <div style={{ fontWeight: 800, fontSize: '0.9rem' }}>{r.userName}</div>
                                        <div style={{ color: '#f59e0b', fontSize: '0.8rem' }}>{'★'.repeat(r.score)}{'☆'.repeat(5 - r.score)}</div>
                                    </div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--primary)', fontWeight: 800, marginBottom: 8 }}>
                                        🏷️ {r.itemName}
                                    </div>
                                    <p style={{ margin: 0, fontSize: '0.85rem', lineHeight: 1.6, color: 'var(--text-primary)', fontWeight: 500 }}>{r.comment}</p>
                                    <div style={{ marginTop: 8, fontSize: '0.7rem', color: 'var(--gray-400)', fontWeight: 700 }}>{r.date}</div>

                                    {/* Existing reply (shown when not actively editing).
                                        Merchant gets Edit + Remove controls inline. */}
                                    {r.reply && !isEditing && (
                                        <div style={{ marginTop: 12, padding: 12, background: 'var(--body-bg)', borderRadius: 12, borderRight: isRTL ? '3px solid var(--primary)' : 'none', borderLeft: !isRTL ? '3px solid var(--primary)' : 'none' }}>
                                            <div style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--primary)', marginBottom: 4, display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                                <span>💬 {canManage ? (isRTL ? 'ردك:' : 'Your reply:') : (isRTL ? 'رد المتجر:' : 'Store Reply:')}</span>
                                                {canManage && (
                                                    <div style={{ display: 'flex', gap: 6 }}>
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setReplyDrafts(prev => ({ ...prev, [r.id]: r.reply || '' }));
                                                                setActiveReplyId(r.id);
                                                            }}
                                                            style={{ background: 'none', border: 'none', color: 'var(--primary)', fontWeight: 800, fontSize: '0.72rem', cursor: 'pointer' }}
                                                            aria-label={isRTL ? 'تعديل الرد' : 'Edit reply'}
                                                        >
                                                            ✏️ {isRTL ? 'تعديل' : 'Edit'}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={async () => {
                                                                const ok = await customConfirm(isRTL ? 'حذف هذا الردّ؟' : 'Remove this reply?');
                                                                if (ok) await addReply(r.dealId, r.id, '');
                                                            }}
                                                            style={{ background: 'none', border: 'none', color: 'var(--gray-400)', fontWeight: 700, fontSize: '0.72rem', cursor: 'pointer' }}
                                                            aria-label={isRTL ? 'حذف الرد' : 'Remove reply'}
                                                        >
                                                            ✕ {isRTL ? 'حذف' : 'Remove'}
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600 }}>{r.reply}</div>
                                        </div>
                                    )}

                                    {/* Compose UI — handles both first-reply and edit
                                        modes. When editing, the textarea is pre-filled
                                        with the existing reply so the merchant can tweak
                                        wording without retyping (true "high flexibility").
                                        Cancel just closes — it never deletes existing data. */}
                                    {canManage && isEditing && (
                                        <div style={{ marginTop: 12 }}>
                                            <textarea
                                                value={replyDrafts[r.id] || ''}
                                                onChange={e => setReplyDrafts({ ...replyDrafts, [r.id]: e.target.value })}
                                                placeholder={isRTL ? 'اكتب ردك على هذا التعليق...' : 'Write your reply...'}
                                                style={{ width: '100%', padding: 12, borderRadius: 12, border: '1.5px solid var(--gray-200)', minHeight: 70, outline: 'none', resize: 'vertical', fontSize: '0.9rem' }}
                                            />
                                            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                                                <button
                                                    type="button"
                                                    onClick={async () => {
                                                        const text = (replyDrafts[r.id] || '').trim();
                                                        if (!text) return;
                                                        await addReply(r.dealId, r.id, text);
                                                        setReplyDrafts(prev => { const n = { ...prev }; delete n[r.id]; return n; });
                                                        setActiveReplyId(null);
                                                    }}
                                                    style={{ flex: 1, padding: '10px', borderRadius: 12, background: 'var(--primary)', color: 'white', fontWeight: 800, border: 'none', fontSize: '0.9rem', cursor: 'pointer' }}
                                                >
                                                    {r.reply ? (isRTL ? '💾 حفظ التعديل' : '💾 Save edit') : (isRTL ? '💬 إرسال الردّ' : '💬 Send reply')}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setActiveReplyId(null);
                                                        setReplyDrafts(prev => { const n = { ...prev }; delete n[r.id]; return n; });
                                                    }}
                                                    style={{ padding: '10px 14px', borderRadius: 12, background: 'var(--gray-100)', color: 'var(--text-secondary)', fontWeight: 800, border: 'none', fontSize: '0.9rem', cursor: 'pointer' }}
                                                >
                                                    {isRTL ? 'إلغاء' : 'Cancel'}
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {/* "Reply" affordance when no reply exists yet. */}
                                    {canManage && !r.reply && !isEditing && (
                                        <button
                                            type="button"
                                            onClick={() => setActiveReplyId(r.id)}
                                            style={{ marginTop: 10, padding: '6px 14px', borderRadius: 10, background: 'var(--body-bg)', border: '1px solid var(--gray-200)', color: 'var(--primary)', fontSize: '0.8rem', fontWeight: 800, cursor: 'pointer' }}
                                        >
                                            💬 {isRTL ? 'الردّ على هذا التعليق' : 'Reply to this review'}
                                        </button>
                                    )}
                                </div>
                                );
                            }) : (
                                <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--gray-400)' }}>
                                    <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>💬</div>
                                    <div style={{ fontWeight: 800 }}>{isRTL ? 'لا توجد تقييمات بعد' : 'No reviews yet'}</div>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {showReport && (
                <ReportDialog
                    reportedId={id}
                    reportedRole="seller"
                    reportedName={store?.name}
                    isRTL={isRTL}
                    onClose={() => setShowReport(false)}
                />
            )}

            <BottomNav />
        </div>
    );
};

export default StoreDetails;
