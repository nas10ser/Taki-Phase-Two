import React, { useEffect, useState, useMemo } from 'react';
import { useHistory } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import { useApp } from '../context/AppContext';
import { bannerRepository, Banner, BannerSlot } from '../repositories/bannerRepository';

interface StoreData {
  id: string;
  name: string;
  shop: string;
  phone: string;
  address: string;
  created_at: string;
  store_profiles: {
    subscription_plan: string;
    subscription_expires_at: string;
    discount_percentage: number;
    is_pinned: boolean;
    max_branches: number;
  } | null;
}

const AdminDashboard: React.FC = () => {
  const { user, viewAs, setViewAs } = useApp();
  const history = useHistory();
  const [stores, setStores] = useState<StoreData[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStores, setSelectedStores] = useState<Set<string>>(new Set());
  const [isPaymentEnabled, setIsPaymentEnabled] = useState(false);

  // Grant Modal state
  const [isGrantModalOpen, setIsGrantModalOpen] = useState(false);
  const [grantType, setGrantType] = useState<'discount' | 'free'>('discount');
  const [grantDiscount, setGrantDiscount] = useState(50);
  const [grantDuration, setGrantDuration] = useState<'week' | 'month' | '3months' | 'custom'>('month');
  const [customDays, setCustomDays] = useState(30);
  const [activeTab, setActiveTab] = useState<'stores' | 'banners' | 'analytics'>('stores');

  // Analytics state
  type FunnelRow = {
    views: number; clicks: number; booking_started: number;
    booking_abandoned: number; booking_completed: number;
    abandoned_rate: number; conversion_rate: number;
    unique_sessions: number; avg_time_ms: number;
  };
  type DailyRow = { day: string; views: number; clicks: number; bookings: number };
  const [analyticsStoreId, setAnalyticsStoreId] = useState<string>('');
  const [analyticsRange, setAnalyticsRange] = useState<7 | 14 | 30 | 90>(14);
  const [analyticsFunnel, setAnalyticsFunnel] = useState<FunnelRow | null>(null);
  const [analyticsDaily, setAnalyticsDaily] = useState<DailyRow[]>([]);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  
  // Banner system state
  const [banners, setBanners] = useState<Banner[]>([]);
  const [slots, setSlots] = useState<BannerSlot[]>([]);
  const [bannersMasterEnabled, setBannersMasterEnabled] = useState(true);
  const [selectedBanners, setSelectedBanners] = useState<Set<string>>(new Set());
  const [isBannerModalOpen, setIsBannerModalOpen] = useState(false);
  const [editingBannerId, setEditingBannerId] = useState<string | null>(null);
  const emptyBannerForm: Partial<Banner> = {
    title_ar: '', title_en: '', text_ar: '', text_en: '',
    image_url: '', bg_color: '#10b981', display_type: 'image',
    target_url: '', deal_id: '', store_id: '',
    position: 'home_top', is_active: true, display_order: 0,
    publish_at: '', expires_at: ''
  };
  const [bannerForm, setBannerForm] = useState<Partial<Banner>>(emptyBannerForm);

  // Group banners by their slot for the slotted UI
  const bannersBySlot = useMemo(() => {
    const m: Record<string, Banner[]> = {};
    for (const b of banners) {
      (m[b.position] = m[b.position] || []).push(b);
    }
    return m;
  }, [banners]);

  useEffect(() => {
    if (user?.userType === 'admin') {
      fetchStores();
      fetchSettings();
      fetchBannerSystem();
    }
  }, [user]);

  const fetchBannerSystem = async () => {
    const [bs, sl, master] = await Promise.all([
      bannerRepository.getAll().catch(() => []),
      bannerRepository.getSlots(),
      bannerRepository.getMasterEnabled()
    ]);
    setBanners(bs);
    setSlots(sl);
    setBannersMasterEnabled(master);
  };

  const toggleBannersMaster = async () => {
    const next = !bannersMasterEnabled;
    setBannersMasterEnabled(next);
    try { await bannerRepository.setMasterEnabled(next); }
    catch (e: any) { alert('فشل التحديث: ' + e.message); setBannersMasterEnabled(!next); }
  };

  const toggleSlotEnabled = async (slot: BannerSlot) => {
    const next = !slot.is_enabled;
    setSlots(prev => prev.map(s => s.slot_key === slot.slot_key ? { ...s, is_enabled: next } : s));
    try { await bannerRepository.updateSlot(slot.slot_key, { is_enabled: next }); }
    catch (e: any) { alert('فشل التحديث: ' + e.message); fetchBannerSystem(); }
  };

  const updateSlotMax = async (slot: BannerSlot, max: number) => {
    if (max < 0) return;
    setSlots(prev => prev.map(s => s.slot_key === slot.slot_key ? { ...s, max_banners: max } : s));
    try { await bannerRepository.updateSlot(slot.slot_key, { max_banners: max }); }
    catch (e: any) { alert('فشل التحديث: ' + e.message); fetchBannerSystem(); }
  };

  const openBannerModal = (existing?: Banner, presetSlot?: string) => {
    if (existing) {
      setEditingBannerId(existing.id);
      setBannerForm({
        ...existing,
        publish_at: existing.publish_at ? existing.publish_at.slice(0, 16) : '',
        expires_at: existing.expires_at ? existing.expires_at.slice(0, 16) : ''
      });
    } else {
      setEditingBannerId(null);
      setBannerForm({ ...emptyBannerForm, position: presetSlot || 'home_top' });
    }
    setIsBannerModalOpen(true);
  };

  const saveBanner = async () => {
    const f = bannerForm;
    // Validation: must have at least image OR text
    const hasImage = f.display_type !== 'text' && !!f.image_url;
    const hasText = f.display_type !== 'image' && (!!f.text_ar || !!f.text_en);
    if (f.display_type === 'image' && !hasImage) return alert('بانر صورة يحتاج رابط صورة.');
    if (f.display_type === 'text' && !hasText) return alert('بانر نص يحتاج نص عربي أو إنجليزي.');
    if (f.display_type === 'both' && !hasImage && !hasText) return alert('أضف صورة أو نص على الأقل.');

    // Slot capacity check (skip when editing the same slot)
    const slot = slots.find(s => s.slot_key === f.position);
    if (slot) {
      const inSlot = (bannersBySlot[f.position!] || []).filter(b => b.id !== editingBannerId);
      if (inSlot.length >= slot.max_banners) {
        return alert(`تم بلوغ الحد الأقصى لهذا المكان (${slot.max_banners}). ارفع الحد أو احذف بانر آخر.`);
      }
    }

    const payload: Partial<Banner> = {
      title_ar: f.title_ar || undefined,
      title_en: f.title_en || undefined,
      text_ar: f.text_ar || undefined,
      text_en: f.text_en || undefined,
      image_url: f.image_url || undefined,
      bg_color: f.bg_color || '#10b981',
      display_type: f.display_type || 'image',
      target_url: f.target_url || undefined,
      deal_id: f.deal_id || undefined,
      store_id: f.store_id || undefined,
      position: f.position!,
      is_active: !!f.is_active,
      display_order: Number(f.display_order) || 0,
      publish_at: f.publish_at ? new Date(f.publish_at).toISOString() : new Date().toISOString(),
      expires_at: f.expires_at ? new Date(f.expires_at).toISOString() : undefined,
    };

    try {
      if (editingBannerId) await bannerRepository.update(editingBannerId, payload);
      else await bannerRepository.create(payload);
      setIsBannerModalOpen(false);
      setEditingBannerId(null);
      setBannerForm(emptyBannerForm);
      fetchBannerSystem();
    } catch (e: any) {
      alert('فشل الحفظ: ' + e.message);
    }
  };

  const toggleBannerActive = async (banner: Banner) => {
    try {
      await bannerRepository.update(banner.id, { is_active: !banner.is_active });
      setBanners(prev => prev.map(b => b.id === banner.id ? { ...b, is_active: !b.is_active } : b));
    } catch (e: any) { alert('فشل التحديث: ' + e.message); }
  };

  const deleteBanner = async (id: string) => {
    if (!confirm('حذف هذا البانر نهائياً؟')) return;
    try {
      await bannerRepository.remove(id);
      setBanners(prev => prev.filter(b => b.id !== id));
      setSelectedBanners(prev => { const n = new Set(prev); n.delete(id); return n; });
    } catch (e: any) { alert('فشل الحذف: ' + e.message); }
  };

  const bulkSetActive = async (active: boolean) => {
    const ids = Array.from(selectedBanners);
    if (ids.length === 0) return;
    try {
      await bannerRepository.setActiveBulk(ids, active);
      setBanners(prev => prev.map(b => ids.includes(b.id) ? { ...b, is_active: active } : b));
      setSelectedBanners(new Set());
    } catch (e: any) { alert('فشل: ' + e.message); }
  };

  const bulkDelete = async () => {
    const ids = Array.from(selectedBanners);
    if (ids.length === 0 || !confirm(`حذف ${ids.length} بانر؟`)) return;
    try {
      await bannerRepository.removeBulk(ids);
      setBanners(prev => prev.filter(b => !ids.includes(b.id)));
      setSelectedBanners(new Set());
    } catch (e: any) { alert('فشل: ' + e.message); }
  };

  // ---------- Analytics: fetch funnel + daily for the selected store ----------
  const fetchAnalytics = async (storeId: string, days: number) => {
    if (!storeId) { setAnalyticsFunnel(null); setAnalyticsDaily([]); return; }
    setAnalyticsLoading(true);
    try {
      const start = new Date(Date.now() - days * 86400000).toISOString();
      const end = new Date().toISOString();
      const [funnelRes, dailyRes] = await Promise.all([
        supabase.rpc('get_store_funnel', { p_store_id: storeId, p_start: start, p_end: end }),
        supabase.rpc('get_store_daily',  { p_store_id: storeId, p_days: days })
      ]);
      if (funnelRes.error) console.warn('funnel error', funnelRes.error.message);
      if (dailyRes.error)  console.warn('daily error',  dailyRes.error.message);
      setAnalyticsFunnel(Array.isArray(funnelRes.data) ? funnelRes.data[0] || null : funnelRes.data || null);
      setAnalyticsDaily(dailyRes.data || []);
    } finally { setAnalyticsLoading(false); }
  };

  // Auto-fetch when entering analytics tab, when the store changes, or when range changes.
  useEffect(() => {
    if (activeTab !== 'analytics') return;
    // Default to first store if none chosen yet
    const sid = analyticsStoreId || stores[0]?.id || '';
    if (!analyticsStoreId && sid) setAnalyticsStoreId(sid);
    fetchAnalytics(sid, analyticsRange);
  }, [activeTab, analyticsStoreId, analyticsRange, stores.length]);

  // Status pill: scheduled / live / expired / paused
  const bannerStatus = (b: Banner): { label: string; color: string } => {
    const now = Date.now();
    const pub = b.publish_at ? new Date(b.publish_at).getTime() : 0;
    const exp = b.expires_at ? new Date(b.expires_at).getTime() : Infinity;
    if (!b.is_active) return { label: 'متوقف', color: 'bg-gray-400' };
    if (now < pub)    return { label: 'مجدول', color: 'bg-blue-500' };
    if (now > exp)    return { label: 'منتهي', color: 'bg-red-500' };
    return { label: 'نشط', color: 'bg-green-500' };
  };

  const fetchSettings = async () => {
    const { data } = await supabase.from('global_settings').select('value').eq('key', 'is_payment_gateway_enabled').single();
    if (data) {
      setIsPaymentEnabled(data.value === 'true');
    }
  };

  const togglePaymentGateway = async () => {
    const newValue = !isPaymentEnabled;
    setIsPaymentEnabled(newValue);
    await supabase.from('global_settings').upsert({ key: 'is_payment_gateway_enabled', value: newValue.toString(), updated_at: new Date().toISOString() });
    alert(newValue ? 'تم تفعيل بوابة الدفع. يجب على التجار الاشتراك لإضافة عروض.' : 'تم تعطيل بوابة الدفع وإخفاؤها. التطبيق الآن مجاني بالكامل.');
  };

  const fetchStores = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('users')
        .select(`
          id, name, shop, phone, address, created_at,
          store_profiles (
            subscription_plan,
            subscription_expires_at,
            discount_percentage,
            is_pinned,
            max_branches
          )
        `)
        .eq('user_type', 'seller');

      if (error) throw error;
      
      // Some users might not have a store_profile yet
      setStores(data as any || []);
    } catch (err) {
      console.error("Error fetching stores:", err);
    } finally {
      setLoading(false);
    }
  };

  const filteredStores = stores.filter(store => 
    store.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    store.shop?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    store.phone?.includes(searchTerm) ||
    store.address?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedStores(new Set(filteredStores.map(s => s.id)));
    } else {
      setSelectedStores(new Set());
    }
  };

  const handleSelectStore = (id: string) => {
    const newSet = new Set(selectedStores);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedStores(newSet);
  };

  const handleApplyGrant = async () => {
    if (selectedStores.size === 0) return;
    
    let daysToAdd = 0;
    if (grantDuration === 'week') daysToAdd = 7;
    else if (grantDuration === 'month') daysToAdd = 30;
    else if (grantDuration === '3months') daysToAdd = 90;
    else daysToAdd = customDays;

    const updates = Array.from(selectedStores).map(storeId => {
      // UPSERT logic: if store_profile doesn't exist, we should ideally create it.
      // For now, we update existing ones. A proper backend RPC would be better for upserting safely.
      return supabase
        .from('store_profiles')
        .upsert({
          store_id: storeId,
          subscription_plan: grantType === 'free' ? 'premium' : 'free', // 'premium' means active sub
          discount_percentage: grantType === 'discount' ? grantDiscount : 0,
          // We set expiry date to current date + daysToAdd
          subscription_expires_at: new Date(Date.now() + daysToAdd * 24 * 60 * 60 * 1000).toISOString(),
          updated_at: new Date().toISOString()
        });
    });

    try {
      await Promise.all(updates);
      alert('تم تطبيق المنحة بنجاح!');
      setIsGrantModalOpen(false);
      setSelectedStores(new Set());
      fetchStores();
    } catch (err) {
      console.error("Error applying grants", err);
    }
  };

  if (user?.userType !== 'admin' && user?.user_type !== 'admin') {
    return <div className="p-8 text-center text-red-500">غير مصرح لك بالدخول لهذه الصفحة. (نوع حسابك الحالي: {user?.userType || user?.user_type || 'غير معروف'})</div>;
  }

  return (
    <div className="pb-24 pt-4 px-4 max-w-6xl mx-auto font-tajawal animate-fade-in" dir="rtl">
      {/* Top bar — title + role switcher */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <h1 className="text-3xl font-bold text-gray-800">🛠️ مركز تحكم الإدارة</h1>

        {/* View-as switcher: lets the admin preview the app as a buyer or seller
            and execute every action available to that role. setViewAs(null) is
            already wired to bring the badge back; here we expose the full
            switch directly at the top of the dashboard. */}
        <div className="flex items-center gap-1 p-1 bg-gray-100 rounded-xl border border-gray-200">
          <span className="px-2 text-[11px] font-bold text-gray-500">عرض كـ:</span>
          <button
            onClick={() => { setViewAs(null); }}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${!viewAs ? 'bg-white shadow text-taki-green' : 'text-gray-500 hover:text-gray-700'}`}>
            👑 أدمن
          </button>
          <button
            onClick={() => { setViewAs('seller'); history.push('/seller'); }}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${viewAs === 'seller' ? 'bg-white shadow text-amber-600' : 'text-gray-500 hover:text-gray-700'}`}>
            🛍️ بائع
          </button>
          <button
            onClick={() => { setViewAs('buyer'); history.push('/'); }}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${viewAs === 'buyer' ? 'bg-white shadow text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>
            🛒 مشترٍ
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 bg-gray-100 p-1 rounded-xl w-fit">
        <button
          onClick={() => setActiveTab('stores')}
          className={`px-5 py-2 rounded-lg font-bold transition-all ${activeTab === 'stores' ? 'bg-white shadow text-taki-green' : 'text-gray-500 hover:text-gray-700'}`}>
          🏪 المتاجر والاشتراكات
        </button>
        <button
          onClick={() => setActiveTab('banners')}
          className={`px-5 py-2 rounded-lg font-bold transition-all ${activeTab === 'banners' ? 'bg-white shadow text-taki-green' : 'text-gray-500 hover:text-gray-700'}`}>
          🖼️ البانرات الإعلانية
        </button>
        <button
          onClick={() => setActiveTab('analytics')}
          className={`px-5 py-2 rounded-lg font-bold transition-all ${activeTab === 'analytics' ? 'bg-white shadow text-taki-green' : 'text-gray-500 hover:text-gray-700'}`}>
          📊 التحليلات
        </button>
      </div>

      
      {/* Stores Management View */}
      {activeTab === 'stores' && (
        <>
          {/* Search and Filters */}
          <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 mb-6 flex flex-col md:flex-row gap-4 justify-between items-center">
            {/* Toggle Payment Gateway */}
            <div className="w-full md:w-auto bg-gray-50 p-3 rounded-lg flex items-center justify-between gap-4 border border-gray-200">
              <div className="flex flex-col">
                <span className="font-bold text-sm text-gray-800">بوابة الدفع (SaaS)</span>
                <span className="text-xs text-gray-500">{isPaymentEnabled ? 'مفعلة (التطبيق مدفوع)' : 'معطلة ومخفية (التطبيق مجاني)'}</span>
              </div>
              <button 
                onClick={togglePaymentGateway}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isPaymentEnabled ? 'bg-taki-green' : 'bg-gray-300'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isPaymentEnabled ? '-translate-x-6' : '-translate-x-1'}`} />
              </button>
            </div>
            <div className="relative w-full md:w-1/2">
              <span className="absolute right-3 top-3 text-gray-400">🔍</span>
              <input 
                type="text" 
                placeholder="البحث باسم المتجر، السجل، أو المدينة..." 
                className="w-full pr-10 pl-4 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-taki-green focus:border-transparent transition-all"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div className="w-full md:w-auto flex gap-2">
              <button 
                disabled={selectedStores.size === 0}
                onClick={() => setIsGrantModalOpen(true)}
                className="flex-1 md:flex-none px-6 py-2 bg-taki-green text-white font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-green-600 transition-colors shadow-sm"
              >
                🎁 المنح السريع ({selectedStores.size})
              </button>
            </div>
          </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="p-4 w-12 text-center">
                  <input 
                    type="checkbox" 
                    className="w-4 h-4 rounded text-taki-green focus:ring-taki-green border-gray-300"
                    checked={filteredStores.length > 0 && selectedStores.size === filteredStores.length}
                    onChange={handleSelectAll}
                  />
                </th>
                <th className="p-4 text-gray-600 font-semibold text-sm">المتجر</th>
                <th className="p-4 text-gray-600 font-semibold text-sm hidden md:table-cell">المدينة/العنوان</th>
                <th className="p-4 text-gray-600 font-semibold text-sm">الباقة الحالية</th>
                <th className="p-4 text-gray-600 font-semibold text-sm">الخصم الممنوح</th>
                <th className="p-4 text-gray-600 font-semibold text-sm">تاريخ الانتهاء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-gray-400">جاري التحميل...</td>
                </tr>
              ) : filteredStores.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-gray-400">لا توجد متاجر مطابقة للبحث</td>
                </tr>
              ) : (
                filteredStores.map((store) => {
                  const sp = store.store_profiles;
                  const isSelected = selectedStores.has(store.id);
                  const expiryDate = sp?.subscription_expires_at ? new Date(sp.subscription_expires_at) : null;
                  const isExpired = expiryDate ? expiryDate.getTime() < Date.now() : true;

                  return (
                    <tr key={store.id} className={`hover:bg-gray-50 transition-colors ${isSelected ? 'bg-green-50' : ''}`}>
                      <td className="p-4 text-center">
                        <input 
                          type="checkbox" 
                          className="w-4 h-4 rounded text-taki-green focus:ring-taki-green border-gray-300"
                          checked={isSelected}
                          onChange={() => handleSelectStore(store.id)}
                        />
                      </td>
                      <td className="p-4">
                        <div className="font-bold text-gray-800">{store.shop || store.name}</div>
                        <div className="text-xs text-gray-500 mt-1" dir="ltr">{store.phone}</div>
                      </td>
                      <td className="p-4 text-gray-600 text-sm hidden md:table-cell">{store.address || 'غير محدد'}</td>
                      <td className="p-4">
                        <span className={`inline-block px-2 py-1 rounded text-xs font-bold ${
                          sp?.subscription_plan === 'premium' ? 'bg-yellow-100 text-yellow-800' : 
                          sp?.subscription_plan === 'trial' ? 'bg-blue-100 text-blue-800' : 
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {sp?.subscription_plan === 'premium' ? 'ممتاز ⭐' : 
                           sp?.subscription_plan === 'trial' ? 'تجريبي' : 'مجاني'}
                        </span>
                        {sp?.is_pinned && <span className="mr-2 inline-block px-2 py-1 rounded text-xs font-bold bg-purple-100 text-purple-800">📌 مثبت</span>}
                      </td>
                      <td className="p-4 font-medium text-taki-green">
                        {sp?.discount_percentage ? `${sp.discount_percentage}%` : '-'}
                      </td>
                      <td className="p-4">
                        {expiryDate ? (
                          <div className={`text-sm font-medium ${isExpired ? 'text-red-500' : 'text-gray-700'}`}>
                            {expiryDate.toLocaleDateString('ar-SA')}
                            {isExpired && <span className="block text-xs">منتهي</span>}
                          </div>
                        ) : (
                          <span className="text-gray-400 text-sm">غير محدد</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Grant Modal */}
      {isGrantModalOpen && (
        <div className="fixed inset-0 z-[5000] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-5 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
              <h3 className="text-lg font-bold text-gray-800">🎁 المنح السريع لـ {selectedStores.size} متجر</h3>
              <button onClick={() => setIsGrantModalOpen(false)} className="text-gray-400 hover:text-gray-600 w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-200 transition-colors">✕</button>
            </div>
            
            <div className="p-6 overflow-y-auto">
              <div className="space-y-5">
                {/* Type */}
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">نوع المنحة</label>
                  <div className="flex bg-gray-100 p-1 rounded-lg">
                    <button 
                      onClick={() => setGrantType('discount')}
                      className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${grantType === 'discount' ? 'bg-white shadow text-taki-green' : 'text-gray-500 hover:bg-gray-200'}`}
                    >
                      خصم نسبة %
                    </button>
                    <button 
                      onClick={() => setGrantType('free')}
                      className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${grantType === 'free' ? 'bg-white shadow text-taki-green' : 'text-gray-500 hover:bg-gray-200'}`}
                    >
                      اشتراك مجاني
                    </button>
                  </div>
                </div>

                {/* Value */}
                {grantType === 'discount' && (
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2">نسبة الخصم</label>
                    <div className="relative">
                      <input 
                        type="number" min="1" max="100" 
                        value={grantDiscount} onChange={(e) => setGrantDiscount(Number(e.target.value))}
                        className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-taki-green"
                      />
                      <span className="absolute left-3 top-2 text-gray-500">%</span>
                    </div>
                  </div>
                )}

                {/* Duration */}
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">المدة (سريان المنحة)</label>
                  <select 
                    value={grantDuration} 
                    onChange={(e) => setGrantDuration(e.target.value as any)}
                    className="w-full p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-taki-green bg-white"
                  >
                    <option value="week">أسبوع واحد</option>
                    <option value="month">شهر واحد</option>
                    <option value="3months">3 أشهر</option>
                    <option value="custom">مخصص (أيام)</option>
                  </select>
                </div>

                {grantDuration === 'custom' && (
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2">عدد الأيام</label>
                    <input 
                      type="number" min="1" 
                      value={customDays} onChange={(e) => setCustomDays(Number(e.target.value))}
                      className="w-full p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-taki-green"
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="p-5 border-t border-gray-100 bg-gray-50 flex gap-3">
              <button 
                onClick={handleApplyGrant}
                className="flex-1 bg-taki-green text-white font-bold py-2.5 rounded-lg hover:bg-green-600 transition-colors shadow-sm"
              >
                تطبيق فوري
              </button>
              <button 
                onClick={() => setIsGrantModalOpen(false)}
                className="px-6 py-2.5 bg-white border border-gray-200 text-gray-600 font-bold rounded-lg hover:bg-gray-50 transition-colors"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
        </>
      )}

      {/* Banner Management View */}
      {activeTab === 'banners' && (
        <div className="space-y-6 animate-fade-in">
          {/* Master kill switch */}
          <div className={`p-5 rounded-2xl border-2 transition-all ${bannersMasterEnabled ? 'bg-green-50 border-green-200' : 'bg-gray-100 border-gray-300'}`}>
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xl">{bannersMasterEnabled ? '✨' : '🚫'}</span>
                  <h2 className="text-lg font-bold text-gray-800">نظام البانرات</h2>
                </div>
                <p className="text-xs text-gray-600 mt-1">
                  {bannersMasterEnabled
                    ? 'النظام مُفعّل — البانرات تظهر في كل المواضع المسموح بها.'
                    : 'النظام موقوف بالكامل — لن تظهر أي بانرات في الموقع. الموقع يعمل بشكل طبيعي بدونها.'}
                </p>
              </div>
              <button
                onClick={toggleBannersMaster}
                className={`relative w-16 h-9 rounded-full transition-colors flex-shrink-0 ${bannersMasterEnabled ? 'bg-green-500' : 'bg-gray-400'}`}>
                <span className={`absolute top-1 w-7 h-7 bg-white rounded-full shadow transition-all ${bannersMasterEnabled ? 'right-1' : 'right-8'}`} />
              </button>
            </div>
          </div>

          {/* Bulk-action bar (visible when there's a selection) */}
          {selectedBanners.size > 0 && (
            <div className="sticky top-2 z-20 p-3 bg-white border-2 border-taki-green rounded-xl shadow-lg flex items-center justify-between">
              <span className="font-bold text-sm text-gray-700">{selectedBanners.size} بانر محدد</span>
              <div className="flex gap-2">
                <button onClick={() => bulkSetActive(true)}  className="px-3 py-1.5 text-xs font-bold rounded-lg bg-green-100 text-green-700 hover:bg-green-200">تفعيل الكل</button>
                <button onClick={() => bulkSetActive(false)} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-yellow-100 text-yellow-700 hover:bg-yellow-200">إيقاف الكل</button>
                <button onClick={bulkDelete}                 className="px-3 py-1.5 text-xs font-bold rounded-lg bg-red-100 text-red-700 hover:bg-red-200">حذف الكل</button>
                <button onClick={() => setSelectedBanners(new Set())} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200">إلغاء التحديد</button>
              </div>
            </div>
          )}

          {/* Slot cards */}
          {slots.length === 0 ? (
            <div className="p-12 text-center text-gray-400 bg-white rounded-2xl border border-dashed border-gray-200">
              لم يتم إعداد أماكن للبانرات بعد. شغّل migration v16 ثم حدّث الصفحة.
            </div>
          ) : slots.map(slot => {
            const inSlot = bannersBySlot[slot.slot_key] || [];
            const atCapacity = inSlot.length >= slot.max_banners;
            const slotMuted = !bannersMasterEnabled || !slot.is_enabled;
            return (
              <div key={slot.slot_key} className={`bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden ${slotMuted ? 'opacity-60' : ''}`}>
                {/* Slot header */}
                <div className="p-4 bg-gradient-to-r from-gray-50 to-white border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <h3 className="font-bold text-gray-800">{slot.label_ar}</h3>
                    <p className="text-[11px] text-gray-500 mt-0.5">
                      <code className="px-1 rounded bg-gray-100">{slot.slot_key}</code>
                      {slot.description && <span className="mx-2">•</span>}
                      {slot.description}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className={`px-2.5 py-1 text-xs font-bold rounded-full ${atCapacity ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-600'}`}>
                      {inSlot.length} / {slot.max_banners}
                    </span>
                    <label className="flex items-center gap-2 text-xs font-bold text-gray-600">
                      الحد الأقصى:
                      <input type="number" min={0} value={slot.max_banners}
                             onChange={e => updateSlotMax(slot, parseInt(e.target.value || '0', 10))}
                             className="w-16 p-1 border border-gray-200 rounded text-center text-sm" />
                    </label>
                    <button onClick={() => toggleSlotEnabled(slot)}
                            className={`px-3 py-1 text-xs font-bold rounded-lg transition-colors ${slot.is_enabled ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}>
                      {slot.is_enabled ? 'مفعّل' : 'متوقف'}
                    </button>
                    <button onClick={() => openBannerModal(undefined, slot.slot_key)}
                            disabled={atCapacity}
                            className="px-4 py-1.5 text-xs font-bold rounded-lg bg-taki-green text-white hover:bg-green-600 disabled:opacity-40 disabled:cursor-not-allowed">
                      ➕ إضافة بانر
                    </button>
                  </div>
                </div>

                {/* Banners list */}
                {inSlot.length === 0 ? (
                  <div className="p-8 text-center text-sm text-gray-400">
                    لا توجد بانرات في هذا المكان.
                  </div>
                ) : (
                  <div className="divide-y divide-gray-100">
                    {inSlot.map(banner => {
                      const status = bannerStatus(banner);
                      const isSelected = selectedBanners.has(banner.id);
                      return (
                        <div key={banner.id} className={`p-4 flex items-center gap-4 hover:bg-gray-50 transition-colors ${isSelected ? 'bg-green-50/50' : ''}`}>
                          <input type="checkbox" checked={isSelected}
                                 onChange={() => setSelectedBanners(prev => {
                                   const n = new Set(prev);
                                   n.has(banner.id) ? n.delete(banner.id) : n.add(banner.id);
                                   return n;
                                 })}
                                 className="w-4 h-4 rounded text-taki-green focus:ring-taki-green flex-shrink-0" />
                          {/* Preview */}
                          <div className="w-24 h-14 rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center text-white text-xs font-bold text-center"
                               style={{ background: banner.image_url && banner.display_type !== 'text' ? '#000' : (banner.bg_color || '#10b981') }}>
                            {banner.image_url && banner.display_type !== 'text'
                              ? <img src={banner.image_url} alt="" className="w-full h-full object-cover" />
                              : <span className="px-2 truncate">{banner.text_ar || banner.text_en || banner.title_ar}</span>}
                          </div>
                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-sm text-gray-800 truncate">
                                {banner.title_ar || banner.text_ar || '— بدون عنوان —'}
                              </span>
                              <span className={`px-2 py-0.5 text-[10px] font-bold text-white rounded-full ${status.color}`}>{status.label}</span>
                              <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-gray-100 text-gray-600">
                                {banner.display_type === 'image' ? 'صورة' : banner.display_type === 'text' ? 'نص' : 'صورة + نص'}
                              </span>
                            </div>
                            <div className="text-[11px] text-gray-500 mt-1">
                              {banner.publish_at && <>📅 ينشر: {new Date(banner.publish_at).toLocaleString('ar-SA')} </>}
                              {banner.expires_at && <>• ينتهي: {new Date(banner.expires_at).toLocaleString('ar-SA')}</>}
                            </div>
                          </div>
                          {/* Actions */}
                          <div className="flex gap-1 flex-shrink-0">
                            <button onClick={() => toggleBannerActive(banner)}
                                    className={`px-3 py-1.5 text-xs font-bold rounded-lg ${banner.is_active ? 'bg-yellow-50 text-yellow-700 hover:bg-yellow-100' : 'bg-green-50 text-green-700 hover:bg-green-100'}`}>
                              {banner.is_active ? 'إيقاف' : 'تفعيل'}
                            </button>
                            <button onClick={() => openBannerModal(banner)}
                                    className="px-3 py-1.5 text-xs font-bold rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100">
                              تعديل
                            </button>
                            <button onClick={() => deleteBanner(banner.id)}
                                    className="px-3 py-1.5 text-xs font-bold rounded-lg bg-red-50 text-red-700 hover:bg-red-100">
                              حذف
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Analytics View */}
      {activeTab === 'analytics' && (
        <div className="space-y-6 animate-fade-in">
          {/* Controls */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[220px]">
              <label className="block text-xs font-bold text-gray-500 mb-1">المتجر</label>
              <select className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm"
                      value={analyticsStoreId}
                      onChange={e => setAnalyticsStoreId(e.target.value)}>
                {stores.length === 0 && <option value="">— لا توجد متاجر —</option>}
                {stores.map(s => (
                  <option key={s.id} value={s.id}>{s.shop || s.name} ({s.id.slice(0,8)})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">المدى الزمني</label>
              <div className="flex gap-1 p-1 bg-gray-100 rounded-lg">
                {[7, 14, 30, 90].map(d => (
                  <button key={d} onClick={() => setAnalyticsRange(d as any)}
                          className={`px-3 py-1 text-xs font-bold rounded-md ${analyticsRange === d ? 'bg-white shadow text-taki-green' : 'text-gray-500'}`}>
                    {d} يوم
                  </button>
                ))}
              </div>
            </div>
            <button onClick={() => fetchAnalytics(analyticsStoreId, analyticsRange)}
                    className="px-4 py-2.5 text-sm font-bold rounded-lg bg-taki-green text-white hover:bg-green-600">
              🔄 تحديث
            </button>
          </div>

          {analyticsLoading ? (
            <div className="p-12 text-center text-gray-400 bg-white rounded-2xl border border-gray-100">جاري التحميل...</div>
          ) : !analyticsStoreId ? (
            <div className="p-12 text-center text-gray-400 bg-white rounded-2xl border border-dashed border-gray-200">اختر متجراً لعرض تحليلاته.</div>
          ) : !analyticsFunnel ? (
            <div className="p-12 text-center text-gray-500 bg-white rounded-2xl border border-gray-100">
              لا توجد بيانات تحليلات لهذا المتجر في المدى المحدد.
              <p className="text-xs text-gray-400 mt-2">RPCs: get_store_funnel, get_store_daily — تأكد من تشغيل migrations v9_4 و v13.</p>
            </div>
          ) : (
            <>
              {/* Funnel KPI cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: 'مشاهدات',    value: analyticsFunnel.views,    icon: '👁️',  color: 'blue' },
                  { label: 'نقرات',      value: analyticsFunnel.clicks,   icon: '👆', color: 'purple' },
                  { label: 'حجوزات بدأت', value: analyticsFunnel.booking_started,   icon: '🛒', color: 'amber' },
                  { label: 'حجوزات تمت',  value: analyticsFunnel.booking_completed, icon: '✅', color: 'green' },
                ].map(card => (
                  <div key={card.label} className={`p-4 rounded-2xl bg-white border border-gray-100 shadow-sm`}>
                    <div className="text-xs font-bold text-gray-500 mb-1">{card.icon} {card.label}</div>
                    <div className={`text-2xl font-black text-${card.color}-600`}>{Number(card.value || 0).toLocaleString('ar-SA')}</div>
                  </div>
                ))}
              </div>

              {/* Conversion / abandonment */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="p-5 rounded-2xl bg-gradient-to-br from-green-50 to-white border border-green-100">
                  <div className="text-xs font-bold text-green-700 mb-1">🎯 معدل التحويل</div>
                  <div className="text-3xl font-black text-green-700">{Number(analyticsFunnel.conversion_rate || 0).toFixed(1)}%</div>
                  <p className="text-[11px] text-gray-500 mt-1">نسبة المشاهدات التي اكتملت كحجوزات</p>
                </div>
                <div className="p-5 rounded-2xl bg-gradient-to-br from-red-50 to-white border border-red-100">
                  <div className="text-xs font-bold text-red-700 mb-1">📉 معدل التسرب</div>
                  <div className="text-3xl font-black text-red-700">{Number(analyticsFunnel.abandoned_rate || 0).toFixed(1)}%</div>
                  <p className="text-[11px] text-gray-500 mt-1">حجوزات بدأت ولم تكتمل</p>
                </div>
                <div className="p-5 rounded-2xl bg-gradient-to-br from-blue-50 to-white border border-blue-100">
                  <div className="text-xs font-bold text-blue-700 mb-1">👥 جلسات فريدة</div>
                  <div className="text-3xl font-black text-blue-700">{Number(analyticsFunnel.unique_sessions || 0).toLocaleString('ar-SA')}</div>
                  <p className="text-[11px] text-gray-500 mt-1">متوسط الزمن: {Math.round(Number(analyticsFunnel.avg_time_ms || 0) / 1000)} ث</p>
                </div>
              </div>

              {/* Daily trend chart (pure CSS bars) */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <h3 className="font-bold text-gray-800 mb-4">📈 الاتجاه اليومي ({analyticsDaily.length} يوم)</h3>
                {analyticsDaily.length === 0 ? (
                  <div className="text-center text-gray-400 py-8 text-sm">لا توجد بيانات يومية</div>
                ) : (() => {
                  const max = Math.max(1, ...analyticsDaily.map(d => Math.max(Number(d.views), Number(d.clicks), Number(d.bookings))));
                  return (
                    <div className="space-y-2">
                      {/* Legend */}
                      <div className="flex gap-4 text-[11px] font-bold">
                        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-400" /> مشاهدات</span>
                        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-purple-400" /> نقرات</span>
                        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-500" /> حجوزات</span>
                      </div>
                      {/* Bars */}
                      <div className="flex items-end gap-1 h-48 mt-3 overflow-x-auto pb-2">
                        {analyticsDaily.map((d, i) => {
                          const v = Number(d.views || 0), c = Number(d.clicks || 0), b = Number(d.bookings || 0);
                          return (
                            <div key={i} className="flex-shrink-0 w-10 flex flex-col items-center gap-0.5"
                                 title={`${d.day}\nمشاهدات: ${v}\nنقرات: ${c}\nحجوزات: ${b}`}>
                              <div className="flex items-end gap-px h-40 w-full">
                                <div style={{ height: `${(v / max) * 100}%` }} className="flex-1 bg-blue-400 rounded-t hover:bg-blue-500 transition-colors min-h-[2px]" />
                                <div style={{ height: `${(c / max) * 100}%` }} className="flex-1 bg-purple-400 rounded-t hover:bg-purple-500 transition-colors min-h-[2px]" />
                                <div style={{ height: `${(b / max) * 100}%` }} className="flex-1 bg-green-500 rounded-t hover:bg-green-600 transition-colors min-h-[2px]" />
                              </div>
                              <span className="text-[9px] text-gray-500 font-bold">
                                {new Date(d.day).toLocaleDateString('ar-SA', { day: 'numeric', month: 'short' })}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </div>
            </>
          )}
        </div>
      )}

      {/* Banner Modal — create / edit */}
      {isBannerModalOpen && (
        <div className="fixed inset-0 z-[5000] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-5 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
              <h3 className="text-lg font-bold text-gray-800">
                {editingBannerId ? '✏️ تعديل البانر' : '➕ إضافة بانر جديد'}
              </h3>
              <button onClick={() => { setIsBannerModalOpen(false); setEditingBannerId(null); }}
                      className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <div className="p-6 space-y-5 overflow-y-auto">
              {/* Display type */}
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-2">نوع البانر</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['image','text','both'] as const).map(t => (
                    <button key={t} type="button"
                            onClick={() => setBannerForm({ ...bannerForm, display_type: t })}
                            className={`p-3 rounded-xl border-2 text-sm font-bold transition-all ${bannerForm.display_type === t ? 'border-taki-green bg-green-50 text-taki-green' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                      {t === 'image' ? '🖼️ صورة' : t === 'text' ? '📝 نص' : '🎨 صورة + نص'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Slot picker */}
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">المكان</label>
                <select className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm"
                        value={bannerForm.position}
                        onChange={e => setBannerForm({ ...bannerForm, position: e.target.value })}>
                  {slots.map(s => (
                    <option key={s.slot_key} value={s.slot_key}>
                      {s.label_ar} ({(bannersBySlot[s.slot_key] || []).filter(b => b.id !== editingBannerId).length}/{s.max_banners})
                    </option>
                  ))}
                </select>
              </div>

              {/* Image fields */}
              {bannerForm.display_type !== 'text' && (
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">رابط الصورة (URL)</label>
                  <input className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm"
                         value={bannerForm.image_url || ''}
                         onChange={e => setBannerForm({ ...bannerForm, image_url: e.target.value })}
                         placeholder="https://..." />
                </div>
              )}

              {/* Text fields */}
              {bannerForm.display_type !== 'image' && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-gray-500 mb-1">النص (عربي)</label>
                      <textarea rows={2} className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm resize-none"
                                value={bannerForm.text_ar || ''}
                                onChange={e => setBannerForm({ ...bannerForm, text_ar: e.target.value })} />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 mb-1">النص (English)</label>
                      <textarea rows={2} className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm resize-none"
                                value={bannerForm.text_en || ''}
                                onChange={e => setBannerForm({ ...bannerForm, text_en: e.target.value })} />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1">لون الخلفية (للنص)</label>
                    <div className="flex gap-2 items-center">
                      <input type="color" value={bannerForm.bg_color || '#10b981'}
                             onChange={e => setBannerForm({ ...bannerForm, bg_color: e.target.value })}
                             className="w-12 h-10 rounded cursor-pointer" />
                      <input type="text" value={bannerForm.bg_color || ''}
                             onChange={e => setBannerForm({ ...bannerForm, bg_color: e.target.value })}
                             placeholder="#10b981 أو linear-gradient(...)"
                             className="flex-1 p-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm" />
                    </div>
                  </div>
                </>
              )}

              {/* Titles (optional, used as caption) */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">العنوان (عربي) — اختياري</label>
                  <input className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm"
                         value={bannerForm.title_ar || ''}
                         onChange={e => setBannerForm({ ...bannerForm, title_ar: e.target.value })} />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">العنوان (English) — اختياري</label>
                  <input className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm"
                         value={bannerForm.title_en || ''}
                         onChange={e => setBannerForm({ ...bannerForm, title_en: e.target.value })} />
                </div>
              </div>

              {/* Link target */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">رابط التنقل (اختياري)</label>
                  <input className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm"
                         value={bannerForm.target_url || ''}
                         onChange={e => setBannerForm({ ...bannerForm, target_url: e.target.value })}
                         placeholder="/seasonal أو https://..." />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">ID العرض (deal)</label>
                  <input className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm"
                         value={bannerForm.deal_id || ''}
                         onChange={e => setBannerForm({ ...bannerForm, deal_id: e.target.value })} />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">ID المتجر</label>
                  <input className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm"
                         value={bannerForm.store_id || ''}
                         onChange={e => setBannerForm({ ...bannerForm, store_id: e.target.value })} />
                </div>
              </div>

              {/* Schedule */}
              <div className="p-4 bg-blue-50 rounded-xl border border-blue-100 space-y-3">
                <div className="text-xs font-bold text-blue-900">⏰ جدولة النشر</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1">يبدأ النشر في</label>
                    <input type="datetime-local"
                           className="w-full p-2.5 bg-white border border-gray-200 rounded-lg text-sm"
                           value={bannerForm.publish_at || ''}
                           onChange={e => setBannerForm({ ...bannerForm, publish_at: e.target.value })} />
                    <p className="text-[10px] text-gray-500 mt-1">اتركه فارغاً للنشر فوراً</p>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1">ينتهي النشر في (اختياري)</label>
                    <input type="datetime-local"
                           className="w-full p-2.5 bg-white border border-gray-200 rounded-lg text-sm"
                           value={bannerForm.expires_at || ''}
                           onChange={e => setBannerForm({ ...bannerForm, expires_at: e.target.value })} />
                    <p className="text-[10px] text-gray-500 mt-1">اتركه فارغاً للنشر بدون انتهاء</p>
                  </div>
                </div>
              </div>

              {/* Order + Active */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">ترتيب العرض</label>
                  <input type="number"
                         className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm"
                         value={bannerForm.display_order ?? 0}
                         onChange={e => setBannerForm({ ...bannerForm, display_order: parseInt(e.target.value || '0', 10) })} />
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={!!bannerForm.is_active}
                           onChange={e => setBannerForm({ ...bannerForm, is_active: e.target.checked })}
                           className="w-5 h-5 rounded text-taki-green" />
                    <span className="text-sm font-bold text-gray-700">تفعيل البانر</span>
                  </label>
                </div>
              </div>
            </div>
            <div className="p-5 border-t border-gray-100 bg-gray-50 flex gap-3">
              <button onClick={() => { setIsBannerModalOpen(false); setEditingBannerId(null); }}
                      className="px-6 py-2.5 bg-white border border-gray-200 text-gray-600 font-bold rounded-lg">
                إلغاء
              </button>
              <button onClick={saveBanner}
                      className="flex-1 bg-taki-green text-white font-bold py-2.5 rounded-lg hover:bg-green-600 transition-colors">
                {editingBannerId ? '💾 حفظ التعديلات' : '✨ حفظ ونشر'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>

  );
};

export default AdminDashboard;
