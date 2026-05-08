import React, { useMemo, useState, useEffect } from 'react';
import { useParams, useHistory } from 'react-router-dom';
import BottomNav from '../components/BottomNav';
import DealCard from '../components/DealCard';
import { getStore } from '../data/mock';
import { useApp } from '../context/AppContext';
import { SellerTopBar } from '../components/SellerTopBar';
import { userRepository } from '../repositories/userRepository';
import { dealService } from '../services/dealService';

const StoreDetails: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const history = useHistory();
    const { deals, language, user, followedMerchants, toggleFollowMerchant, deleteDeal, updateDeal, storeProfiles, updateStoreProfile, customAlert, customConfirm } = useApp();
    const isRTL = language === 'ar';
    const isFollowed = followedMerchants.includes(id);

    const profile = storeProfiles[id] || {};
    const [isEditingStore, setIsEditingStore] = useState(false);
    const [followerCount, setFollowerCount] = useState<number | null>(null);

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

    const toggleFollow = () => {
        toggleFollowMerchant(id);
        if (!isFollowed) {
             customAlert(isRTL ? 'سيصلك تنبيه بأحدث عروض هذا المحل 🔔' : 'You will be notified of new deals from this store 🔔');
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
        if (confirmed) {
            const restoreQty = deal.initialQuantity !== undefined ? deal.initialQuantity : (deal.quantity === 0 ? 10 : deal.quantity);
            await updateDeal({
                ...deal,
                quantity: restoreQty,
                createdAt: Date.now(),
                status: 'active'
            });
            customAlert(isRTL ? '✅ تم تجديد العرض بنجاح!' : '✅ Deal renewed successfully!');
        }
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

    const storeDeals = useMemo(() => {
        return deals.filter(d => {
            if (d.storeId !== id || d.status !== 'active') return false;
            
            // Time-based check
            const lifespanMs = (d.expiresInMinutes || 120) * 60 * 1000;
            const isTimedOut = Date.now() > (d.createdAt + lifespanMs);
            if (isTimedOut) return false;

            if (d.quantity === 'unlimited') return true;
            if (typeof d.quantity === 'number' && d.quantity > 0) return true;
            
            // No stock cap → time-based; let the countdown gate visibility.
            const hasCap = typeof d.initialQuantity === 'number' && d.initialQuantity > 0;
            return !hasCap;
        });
    }, [deals, id]);

    const pastStoreDeals = useMemo(() => {
        return deals.filter(d => {
            if (d.storeId !== id) return false;
            
            const lifespanMs = (d.expiresInMinutes || 120) * 60 * 1000;
            const isTimedOut = Date.now() > (d.createdAt + lifespanMs);
            
            return d.status === 'expired' || 
                   d.status === 'paused' || 
                   isTimedOut ||
                   (typeof d.quantity === 'number' && d.quantity <= 0);
        });
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
                color: 'white', padding: '24px 20px 30px', borderRadius: '0 0 28px 28px',
                boxShadow: '0 8px 30px rgba(15,23,42,0.15)'
            }}>
                {/* Back Button & Top Action */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
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
                <div style={{ textAlign: 'center', marginBottom: 24 }}>
                    <div style={{ position: 'relative', width: 100, height: 100, margin: '0 auto 16px' }}>
                        <div style={{ width: '100%', height: '100%', borderRadius: 28, background: ((profile as any).avatar_url || (profile as any).avatar) ? 'transparent' : 'rgba(80, 80, 90, 0.3)', border: '3px solid rgba(80, 80, 95, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '3rem', overflow: 'hidden', textTransform: 'uppercase' }}>
                            {((profile as any).avatar_url || (profile as any).avatar) ? <img src={(profile as any).avatar_url || (profile as any).avatar} loading="lazy" alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : store.name.charAt(0)}
                        </div>
                        {user?.id === store.id && isEditingStore && (
                            <div onClick={() => document.getElementById('store-avatar-upload')?.click()} style={{ position: 'absolute', bottom: -5, right: -5, background: 'var(--primary)', borderRadius: '50%', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', border: '2px solid white', boxShadow: '0 4px 10px rgba(0,0,0,0.3)' }}>
                                📸
                                <input id="store-avatar-upload" type="file" accept="image/*" onChange={handleAvatarUpload} onClick={e => { (e.target as HTMLInputElement).value = ''; }} style={{ display: 'none' }} />
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
                                <button onClick={toggleFollow} style={{
                                    background: isFollowed ? '#ef4444' : 'rgba(80, 80, 95, 0.2)',
                                    color: 'white',
                                    border: 'none', borderRadius: '50%', width: 28, height: 28,
                                    fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    transition: 'all 0.2s ease', cursor: 'pointer'
                                }}>
                                    {isFollowed ? '❤️' : '🤍'}
                                </button>
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
                            <div style={{ display: 'flex', gap: 12 }}>
                                {(profile.contactPhone || profile.phone) && (
                                    <div style={{ display: 'flex', gap: 10, width: '100%' }}>
                                        <a href={`tel:${profile.contactPhone || profile.phone}`} style={{ 
                                            flex: 1, 
                                            background: 'linear-gradient(135deg, rgba(100, 100, 100, 0.15), rgba(80, 80, 90, 0.2))', 
                                            backdropFilter: 'blur(10px)',
                                            border: '1px solid rgba(80, 80, 95, 0.2)', 
                                            borderRadius: 20, 
                                            padding: '14px 20px', 
                                            display: 'flex', 
                                            alignItems: 'center', 
                                            justifyContent: 'space-between', 
                                            textDecoration: 'none', 
                                            color: 'white',
                                            boxShadow: '0 8px 32px rgba(0,0,0,0.1)'
                                        }}>
                                            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                                                <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(80, 80, 90, 0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem' }}>📞</div>
                                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                    <span style={{ fontSize: '0.7rem', fontWeight: 800, opacity: 0.6, letterSpacing: '0.5px' }}>{isRTL ? 'اتصال مباشر' : 'Direct Call'}</span>
                                                    <span style={{ fontSize: '1.1rem', fontWeight: 900 }}>{profile.contactPhone || profile.phone}</span>
                                                </div>
                                            </div>
                                        </a>
                                        <a href={`https://wa.me/966${(profile.contactPhone || profile.phone)?.replace(/^0/, '')}`} target="_blank" rel="noopener noreferrer" style={{ 
                                            width: 60, 
                                            height: 60, 
                                            background: 'linear-gradient(135deg, #25d366, #128c7e)', 
                                            borderRadius: 20, 
                                            display: 'flex', 
                                            alignItems: 'center', 
                                            justifyContent: 'center', 
                                            fontSize: '1.8rem',
                                            boxShadow: '0 8px 32px rgba(37,211,102,0.2)',
                                            border: '1px solid rgba(80, 80, 95, 0.2)'
                                        }}>
                                            💬
                                        </a>
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>

                {/* Upload Status Overlay */}
                {isUploading && (
                    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <div style={{ background: 'var(--card-bg)', color: 'black', padding: '24px 32px', borderRadius: 16, fontWeight: 800 }}>
                            {isRTL ? '⏳ جاري رفع الصورة...' : '⏳ Uploading Image...'}
                        </div>
                    </div>
                )}

                <div style={{ marginTop: 24, paddingBottom: 8 }}>
                    <SellerTopBar storeId={store.id} />
                </div>
            </div>

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
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
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
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
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
                            {allStoreReviews.length > 0 ? allStoreReviews.map((r, i) => (
                                <div key={i} style={{ background: 'var(--card-bg)', padding: 16, borderRadius: 20, border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-sm)' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                                        <div style={{ fontWeight: 800, fontSize: '0.9rem' }}>{r.userName}</div>
                                        <div style={{ color: '#f59e0b', fontSize: '0.8rem' }}>{'★'.repeat(r.score)}{'☆'.repeat(5 - r.score)}</div>
                                    </div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--primary)', fontWeight: 800, marginBottom: 8 }}>
                                        🏷️ {r.itemName}
                                    </div>
                                    <p style={{ margin: 0, fontSize: '0.85rem', lineHeight: 1.6, color: 'var(--text-primary)', fontWeight: 500 }}>{r.comment}</p>
                                    <div style={{ marginTop: 8, fontSize: '0.7rem', color: 'var(--gray-400)', fontWeight: 700 }}>{r.date}</div>
                                    {r.reply && (
                                        <div style={{ marginTop: 12, padding: 12, background: 'var(--body-bg)', borderRadius: 12, borderRight: isRTL ? '3px solid var(--primary)' : 'none', borderLeft: !isRTL ? '3px solid var(--primary)' : 'none' }}>
                                            <div style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--primary)', marginBottom: 4 }}>💬 {isRTL ? 'رد المتجر:' : 'Store Reply:'}</div>
                                            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600 }}>{r.reply}</div>
                                        </div>
                                    )}
                                </div>
                            )) : (
                                <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--gray-400)' }}>
                                    <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>💬</div>
                                    <div style={{ fontWeight: 800 }}>{isRTL ? 'لا توجد تقييمات بعد' : 'No reviews yet'}</div>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            <BottomNav />
        </div>
    );
};

export default StoreDetails;
