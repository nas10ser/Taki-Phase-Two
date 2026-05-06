import React, { useEffect, useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { useApp } from '../context/AppContext';

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
  const { user } = useApp();
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
  const [activeTab, setActiveTab] = useState<'stores' | 'banners'>('stores');
  
  // Banner state
  const [banners, setBanners] = useState<any[]>([]);
  const [isBannerModalOpen, setIsBannerModalOpen] = useState(false);
  const [newBanner, setNewBanner] = useState({
    title_ar: '', title_en: '', image_url: '', target_url: '', deal_id: '', store_id: '', position: 'home_top', is_active: true
  });

  useEffect(() => {
    if (user?.user_type === 'admin') {
      fetchStores();
      fetchSettings();
      fetchBanners();
    }
  }, [user]);

  const fetchBanners = async () => {
    const { data, error } = await supabase.from('banners').select('*').order('display_order', { ascending: true });
    if (error) console.error('Error fetching banners:', error);
    else setBanners(data || []);
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
      <h1 className="text-3xl font-bold mb-6 text-gray-800">🛠️ مركز تحكم الإدارة (Admin)</h1>

      {/* Tabs */}
      <div className="flex gap-4 mb-6 bg-gray-100 p-1 rounded-xl w-fit">
        <button 
          onClick={() => setActiveTab('stores')}
          className={`px-6 py-2 rounded-lg font-bold transition-all ${activeTab === 'stores' ? 'bg-white shadow text-taki-green' : 'text-gray-500 hover:text-gray-700'}`}
        >
          🏪 المتاجر والاشتراكات
        </button>
        <button 
          onClick={() => setActiveTab('banners')}
          className={`px-6 py-2 rounded-lg font-bold transition-all ${activeTab === 'banners' ? 'bg-white shadow text-taki-green' : 'text-gray-500 hover:text-gray-700'}`}
        >
          🖼️ البانرات الإعلانية
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
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-bold text-gray-800">🖼️ إدارة البانرات النشطة</h2>
            <button 
              onClick={() => setIsBannerModalOpen(true)}
              className="px-6 py-2 bg-taki-green text-white font-bold rounded-lg hover:bg-green-600 transition-all shadow-md"
            >
              ➕ إضافة بانر جديد
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {banners.length === 0 ? (
              <div className="col-span-full p-12 text-center text-gray-400 bg-white rounded-2xl border border-dashed border-gray-200">
                لا توجد بانرات حالياً. أضف أول بانر لظهوره في الصفحة الرئيسية.
              </div>
            ) : (
              banners.map((banner) => (
                <div key={banner.id} className="bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-100 group">
                  <div className="relative h-40">
                    <img src={banner.image_url} alt="" className="w-full h-full object-cover" />
                    <div className="absolute top-2 right-2 flex gap-2">
                      <span className={`px-2 py-1 rounded-md text-[10px] font-bold text-white ${banner.is_active ? 'bg-green-500' : 'bg-red-500'}`}>
                        {banner.is_active ? 'نشط' : 'متوقف'}
                      </span>
                    </div>
                  </div>
                  <div className="p-4">
                    <h3 className="font-bold text-gray-800 truncate">{banner.title_ar || 'بدون عنوان'}</h3>
                    <p className="text-xs text-gray-500 mt-1">{banner.position}</p>
                    <div className="flex gap-2 mt-4">
                      <button 
                        onClick={async () => {
                          await supabase.from('banners').update({ is_active: !banner.is_active }).eq('id', banner.id);
                          fetchBanners();
                        }}
                        className="flex-1 py-2 text-xs font-bold rounded-lg bg-gray-50 text-gray-600 hover:bg-gray-100 transition-all"
                      >
                        {banner.is_active ? 'إيقاف' : 'تفعيل'}
                      </button>
                      <button 
                        onClick={async () => {
                          if (confirm('هل أنت متأكد من حذف هذا البانر؟')) {
                            await supabase.from('banners').delete().eq('id', banner.id);
                            fetchBanners();
                          }
                        }}
                        className="flex-1 py-2 text-xs font-bold rounded-lg bg-red-50 text-red-500 hover:bg-red-100 transition-all"
                      >
                        حذف
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Banner Modal */}
      {isBannerModalOpen && (
        <div className="fixed inset-0 z-[5000] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-5 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
              <h3 className="text-lg font-bold text-gray-800">➕ إضافة بانر إعلاني جديد</h3>
              <button onClick={() => setIsBannerModalOpen(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <div className="p-6 space-y-4 overflow-y-auto">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">العنوان (عربي)</label>
                  <input className="w-full p-2 bg-gray-50 border border-gray-200 rounded-lg text-sm" value={newBanner.title_ar} onChange={e => setNewBanner({...newBanner, title_ar: e.target.value})} />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">العنوان (En)</label>
                  <input className="w-full p-2 bg-gray-50 border border-gray-200 rounded-lg text-sm" value={newBanner.title_en} onChange={e => setNewBanner({...newBanner, title_en: e.target.value})} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">رابط الصورة (URL)</label>
                <input className="w-full p-2 bg-gray-50 border border-gray-200 rounded-lg text-sm" value={newBanner.image_url} onChange={e => setNewBanner({...newBanner, image_url: e.target.value})} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">ID العرض (اختياري)</label>
                  <input className="w-full p-2 bg-gray-50 border border-gray-200 rounded-lg text-sm" value={newBanner.deal_id} onChange={e => setNewBanner({...newBanner, deal_id: e.target.value})} />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">ID المتجر (اختياري)</label>
                  <input className="w-full p-2 bg-gray-50 border border-gray-200 rounded-lg text-sm" value={newBanner.store_id} onChange={e => setNewBanner({...newBanner, store_id: e.target.value})} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">المكان</label>
                <select className="w-full p-2 bg-gray-50 border border-gray-200 rounded-lg text-sm" value={newBanner.position} onChange={e => setNewBanner({...newBanner, position: e.target.value})}>
                  <option value="home_top">أعلى الصفحة الرئيسية</option>
                  <option value="category_top">أعلى التصنيفات</option>
                </select>
              </div>
            </div>
            <div className="p-5 border-t border-gray-100 bg-gray-50 flex gap-3">
              <button 
                onClick={async () => {
                  if (!newBanner.image_url) return alert('يرجى إضافة رابط الصورة');
                  const { error } = await supabase.from('banners').insert([newBanner]);
                  if (error) alert(error.message);
                  else {
                    setIsBannerModalOpen(false);
                    setNewBanner({ title_ar: '', title_en: '', image_url: '', target_url: '', deal_id: '', store_id: '', position: 'home_top', is_active: true });
                    fetchBanners();
                  }
                }}
                className="flex-1 bg-taki-green text-white font-bold py-2.5 rounded-lg"
              >
                حفظ ونشر
              </button>
            </div>
          </div>
        </div>
      )}
    </div>

  );
};

export default AdminDashboard;
