import React, { useState, useEffect } from 'react';
import { useHistory } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import { useApp } from '../context/AppContext';
import { paymentService } from '../services/paymentService';
import { subscriptionRepository } from '../repositories/subscriptionRepository';

const Subscription: React.FC = () => {
    const history = useHistory();
    const { user, storeProfiles, customAlert } = useApp();
    const [branches, setBranches] = useState(1);
    const [isPaying, setIsPaying] = useState(false);
    const [isPaymentEnabled, setIsPaymentEnabled] = useState(true);
    
    const BASE_PRICE = 199; // Monthly base
    const EXTRA_BRANCH_PRICE = 49;

    const profile = storeProfiles[user?.id || ''];
    const maxBranches = profile?.max_branches || 3;

    useEffect(() => {
        // If payment gateway is disabled, they shouldn't even be here normally,
        // but if they navigate manually, we should tell them.
        supabase.from('platform_settings').select('value').eq('key', 'payment_gateway_enabled').maybeSingle().then(({ data }) => {
            if (data && data.value === false) {
                setIsPaymentEnabled(false);
            }
        });
    }, []);

    // Price calculation
    const branchesToCharge = Math.max(0, branches - 3); // first 3 are free with base
    const totalMonthly = BASE_PRICE + (branchesToCharge * EXTRA_BRANCH_PRICE);

    const handleSubscribe = async () => {
        if (!user) return;
        setIsPaying(true);
        try {
            // 1. Call Payment Service
            const response = await paymentService.initiateMoyasarPayment({
                amount: totalMonthly,
                currency: 'SAR',
                description: `Subscription for ${user.shop || user.name} - ${branches} branches`,
                customerEmail: user.email || '',
                customerName: user.name || ''
            });

            if (response.success) {
                // 2. If payment successful (or after redirect verification), update subscription
                await subscriptionRepository.updateSubscription(user.id, 'premium', 30);
                
                // 3. Update branches cap if they paid for more
                if (branches > 3) {
                    await supabase.from('store_profiles').update({ max_branches: branches }).eq('store_id', user.id);
                }

                await customAlert('✅ تم الاشتراك بنجاح! شكراً لثقتك في تاكي.');
                history.push('/seller');
            } else {
                await customAlert('❌ فشل عملية الدفع: ' + (response.error || 'خطأ غير معروف'));
            }
        } catch (err) {
            console.error(err);
            await customAlert('❌ حدث خطأ أثناء تفعيل الاشتراك.');
        } finally {
            setIsPaying(false);
        }
    };

    if (!user || user.userType !== 'seller') {
        return <div className="p-8 text-center text-red-500 font-tajawal">غير مصرح لك بالدخول لهذه الصفحة.</div>;
    }

    if (!isPaymentEnabled) {
        return (
            <div className="p-8 text-center font-tajawal animate-fade-in" dir="rtl">
                <h2 className="text-2xl font-bold mb-4">التطبيق حالياً مجاني بالكامل 🎉</h2>
                <p className="text-gray-600 mb-6">لا حاجة للاشتراك في الوقت الحالي بناءً على صلاحيات الإدارة.</p>
                <button onClick={() => history.push('/seller')} className="bg-taki-green text-white px-6 py-2 rounded-lg font-bold">العودة للوحة التحكم</button>
            </div>
        );
    }

    return (
        <div className="pb-24 pt-8 px-4 max-w-2xl mx-auto font-tajawal animate-fade-in" dir="rtl">
            <div className="flex justify-between items-center mb-8">
                <h1 className="text-3xl font-bold text-gray-800">باقات الاشتراك 🚀</h1>
                <button onClick={() => history.goBack()} className="text-gray-500 hover:text-gray-800 font-bold">رجوع →</button>
            </div>

            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
                <div className="bg-taki-green p-6 text-white text-center">
                    <h2 className="text-2xl font-bold mb-2">الباقة الأساسية</h2>
                    <p className="opacity-90 text-sm">ابدأ الآن بدون أي عمولات على الحجوزات!</p>
                </div>
                
                <div className="p-6">
                    <div className="flex justify-center items-end gap-1 mb-8">
                        <span className="text-5xl font-black text-gray-800">{totalMonthly}</span>
                        <span className="text-gray-500 font-bold mb-2">ريال / شهرياً</span>
                    </div>

                    <ul className="space-y-4 mb-8">
                        <li className="flex items-center gap-3">
                            <span className="bg-green-100 text-green-600 rounded-full w-6 h-6 flex items-center justify-center font-bold">✓</span>
                            <span className="text-gray-700 font-medium">عدد غير محدود من العروض والحجوزات</span>
                        </li>
                        <li className="flex items-center gap-3">
                            <span className="bg-green-100 text-green-600 rounded-full w-6 h-6 flex items-center justify-center font-bold">✓</span>
                            <span className="text-gray-700 font-medium">0% عمولة على المبيعات</span>
                        </li>
                        <li className="flex items-center gap-3">
                            <span className="bg-green-100 text-green-600 rounded-full w-6 h-6 flex items-center justify-center font-bold">✓</span>
                            <span className="text-gray-700 font-medium">تغطي حتى 3 فروع مجاناً</span>
                        </li>
                    </ul>

                    <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 mb-8">
                        <label className="block text-sm font-bold text-gray-700 mb-3">عدد الفروع النشطة</label>
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                                <button 
                                    onClick={() => setBranches(Math.max(1, branches - 1))}
                                    className="w-10 h-10 rounded-lg bg-white border border-gray-300 font-bold text-xl flex items-center justify-center hover:bg-gray-100"
                                >-</button>
                                <span className="text-xl font-bold text-gray-800 w-8 text-center">{branches}</span>
                                <button 
                                    onClick={() => setBranches(branches + 1)}
                                    className="w-10 h-10 rounded-lg bg-white border border-gray-300 font-bold text-xl flex items-center justify-center hover:bg-gray-100"
                                >+</button>
                            </div>
                            <div className="text-sm font-bold text-taki-green">
                                {branchesToCharge > 0 ? `+ ${branchesToCharge * EXTRA_BRANCH_PRICE} ريال` : 'مشمول بالباقة'}
                            </div>
                        </div>
                    </div>

                    <button 
                        onClick={handleSubscribe}
                        disabled={isPaying}
                        className="w-full bg-gray-900 text-white font-bold py-4 rounded-xl hover:bg-black transition-colors flex items-center justify-center gap-2 shadow-md"
                    >
                        {isPaying ? 'جاري التحويل لبوابة الدفع...' : `الاشتراك ودفع ${totalMonthly} ريال`}
                        {!isPaying && <span>💳</span>}
                    </button>
                    
                    <p className="text-center text-xs text-gray-400 mt-4">بوابة دفع آمنة وموثوقة (PayTabs / Moyasar)</p>
                </div>
            </div>
        </div>
    );
};

export default Subscription;
