/**
 * AdminDelivery — تبويب التوصيل في لوحة الإدارة (v14.39، طلب ناصر ٦)
 * ═══════════════════════════════════════════════════════════════════════════
 * ما كان ناقصاً بالقياس قبل هذا التبويب:
 *   • لا مفتاح إيقاف عام للتوصيل إطلاقاً — لو ظهر خلل في التسعير أو النطاقات
 *     لم يكن أمام ناصر إلا أن يطلب من كل تاجر إطفاءها بنفسه.
 *   • ولا مفتاح لكل متجر بيد الإدارة: `delivery_enabled` يملكه التاجر، فإيقاف
 *     ناصر له يُلغيه التاجر بضغطة. العمود الإداري منفصل ومحميّ بمشغّل.
 *   • ولا دالة إدارية واحدة تُرجع بيانات توصيل: كلمة `fulfillment` ترد في
 *     المخطط عشرين مرّة، ولا مرّة داخل دالة `admin_*`.
 *
 * كل الأرقام هنا من القاعدة على مستوى المنصّة كلها — لا من نافذة محمّلة في
 * المتصفّح (الدرس المتكرّر: بطاقةٌ تقول «الإجمالي» وتعدّ ما حُمّل).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { supabase } from '../../services/supabaseClient';

const money = (n: any) => (Number(n) || 0).toLocaleString('ar-SA', { maximumFractionDigits: 2 });

const Stat: React.FC<{ label: string; value: React.ReactNode; hint?: string; tone?: string }> =
({ label, value, hint, tone }) => (
    <div className="bg-[var(--card-bg)] rounded-2xl p-4 border border-[var(--border-color)] shadow-sm">
        <div className={`text-2xl font-extrabold tabular-nums ${tone || ''}`}>{value}</div>
        <div className="text-xs text-[var(--text-secondary)] mt-0.5">{label}</div>
        {hint && <div className="text-[0.65rem] text-[var(--gray-400)] mt-1 leading-relaxed">{hint}</div>}
    </div>
);

const STATUS_AR: Record<string, string> = {
    pending: 'بانتظار التاجر', acknowledged: 'قيد التجهيز',
    completed: 'مكتمل', cancelled: 'ملغى', expired: 'انتهت مهلته',
};
const TRACK_AR: Record<string, string> = {
    on_the_way: '🚚 في الطريق', arrived: '📍 وصل', delivered: '✅ سُلّم', cancelled: '—',
};

const AdminDelivery: React.FC = () => {
    const { customAlert, customConfirm, customPrompt } = useApp();
    const [ov, setOv] = useState<any>(null);
    const [orders, setOrders] = useState<any[]>([]);
    const [total, setTotal] = useState(0);
    const [stores, setStores] = useState<any[]>([]);
    const [status, setStatus] = useState<string>('');
    const [shown, setShown] = useState(25);
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        setBusy(true);
        const [a, b, c] = await Promise.all([
            supabase.rpc('admin_delivery_overview'),
            supabase.rpc('admin_delivery_orders', { p_status: status || null, p_limit: shown, p_offset: 0 }),
            supabase.rpc('admin_delivery_stores'),
        ]);
        setOv(a.data || null);
        setOrders(Array.isArray((b.data as any)?.rows) ? (b.data as any).rows : []);
        setTotal(Number((b.data as any)?.total) || 0);
        setStores(Array.isArray((c.data as any)?.rows) ? (c.data as any).rows : []);
        setBusy(false);
    }, [status, shown]);
    useEffect(() => { load(); }, [load]);

    const toggleGlobal = async () => {
        const on = !!ov?.global_on;
        const ok = await customConfirm(on
            ? '⏸ إيقاف التوصيل على المنصّة كلها؟\n\nلن يستطيع أي مشترٍ اختيار التوصيل في الموقع ولا في البوتين. الاستلام من المتجر يبقى متاحاً، والطلبات القائمة لا تتأثّر.'
            : '▶️ إعادة تشغيل التوصيل على المنصّة؟');
        if (!ok) return;
        const { error } = await supabase.rpc('admin_set_delivery_global', { p_enabled: !on });
        if (error) { await customAlert('❌ ' + error.message); return; }
        await customAlert(on ? '⏸ أُوقف التوصيل على المنصّة.' : '▶️ عاد التوصيل.');
        load();
    };

    const toggleStore = async (s: any) => {
        const blocked = !!s.delivery_blocked_by_admin;
        if (!blocked) {
            const why = await customPrompt(
                `⏸ إيقاف التوصيل على «${s.store_name}»؟\n\nيصله إشعار بالسبب، ولا يستطيع رفع الإيقاف بنفسه.\n\nاكتب السبب:`);
            if (why == null) return;
            const { error } = await supabase.rpc('admin_set_store_delivery', {
                p_store_id: s.store_id, p_blocked: true, p_reason: String(why).trim() || null,
            });
            if (error) { await customAlert('❌ ' + error.message); return; }
        } else {
            if (!(await customConfirm(`▶️ إعادة التوصيل على «${s.store_name}»؟`))) return;
            const { error } = await supabase.rpc('admin_set_store_delivery', {
                p_store_id: s.store_id, p_blocked: false, p_reason: null,
            });
            if (error) { await customAlert('❌ ' + error.message); return; }
        }
        load();
    };

    const dlv = Number(ov?.orders_delivery) || 0;
    const pick = Number(ov?.orders_pickup) || 0;
    const share = dlv + pick > 0 ? Math.round((dlv / (dlv + pick)) * 100) : 0;

    return (
        <div className="space-y-5 animate-fade-in" dir="rtl">
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                    <h2 className="text-xl font-extrabold">🚚 التوصيل</h2>
                    <p className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">
                        التوصيل خدمة يقدّمها التاجر بنفسه. تاكي لا تشحن ولا تتعاقد مع مندوبين،
                        لكنها تملك إيقاف الخدمة حين تُسيء.
                    </p>
                </div>
                <button
                    onClick={toggleGlobal}
                    className={`px-4 py-2.5 rounded-2xl font-black text-sm text-white shadow-lg ${
                        ov?.global_on ? 'bg-gradient-to-br from-rose-500 to-red-600'
                                      : 'bg-gradient-to-br from-emerald-500 to-teal-600'}`}
                >
                    {ov?.global_on ? '⏸ إيقاف التوصيل على المنصّة' : '▶️ إعادة تشغيل التوصيل'}
                </button>
            </div>

            {!ov?.global_on && (
                <div className="rounded-2xl p-4 bg-amber-500/10 border-2 border-amber-500/40 font-bold text-sm">
                    ⏸ التوصيل موقوف على المنصّة كلها الآن. لا يستطيع أي مشترٍ اختياره في الموقع
                    ولا في البوتين، والاستلام من المتجر يعمل طبيعياً.
                </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat label="طلبات توصيل" value={dlv} hint={`${share}% من كل الطلبات`} />
                <Stat label="طلبات استلام" value={pick} />
                <Stat label="متاجر مفعّلة" value={ov?.stores_enabled ?? '—'}
                      hint={Number(ov?.stores_blocked) > 0 ? `${ov.stores_blocked} موقوف إدارياً` : undefined} />
                <Stat label="نطاقات مرسومة" value={ov?.zones ?? '—'} />
                <Stat label="رسوم التوصيل المحصّلة" value={`${money(ov?.fees_collected)} ر.س`}
                      hint="تذهب للتاجر لا للمنصّة" />
                <Stat label="قيمة طلبات التوصيل" value={`${money(ov?.revenue_delivery)} ر.س`} hint="المكتملة فقط" />
                <Stat label="تتبّع حيّ الآن" value={ov?.tracks_live ?? 0}
                      tone={Number(ov?.tracks_live) > 0 ? 'text-emerald-600' : ''} />
            </div>

            {/* المتاجر */}
            <div className="bg-[var(--card-bg)] rounded-3xl p-4 border border-[var(--border-color)]">
                <h3 className="font-black text-sm mb-3">🏪 المتاجر التي تقدّم التوصيل</h3>
                {stores.length === 0 ? (
                    <div className="text-xs text-[var(--text-secondary)] py-6 text-center">
                        لا متجر فعّل التوصيل بعد.
                    </div>
                ) : (
                    <div className="space-y-2">
                        {stores.map(s => (
                            <div key={s.store_id}
                                 className={`p-3 rounded-2xl border ${s.delivery_blocked_by_admin
                                     ? 'border-rose-500/50 bg-rose-500/5' : 'border-[var(--border-color)] bg-[var(--body-bg)]'}`}>
                                <div className="flex items-center justify-between gap-3 flex-wrap">
                                    <div className="min-w-0">
                                        <div className="font-black text-sm">{s.store_name}</div>
                                        <div className="text-[0.68rem] text-[var(--text-secondary)] mt-0.5">
                                            رسوم {money(s.delivery_fee)} ر.س · حدّ أدنى {money(s.delivery_min_order)} ر.س
                                            {s.delivery_eta_min ? ` · ${s.delivery_eta_min} دقيقة` : ''}
                                            {' · '}{s.zones} نطاق · {s.orders} طلب
                                        </div>
                                        {s.delivery_blocked_by_admin && (
                                            <div className="text-[0.68rem] text-rose-600 font-bold mt-1">
                                                ⏸ موقوف إدارياً{s.delivery_block_reason ? ` — ${s.delivery_block_reason}` : ''}
                                            </div>
                                        )}
                                    </div>
                                    <button
                                        onClick={() => toggleStore(s)}
                                        className={`px-3 py-2 rounded-xl font-black text-xs whitespace-nowrap ${
                                            s.delivery_blocked_by_admin
                                                ? 'bg-emerald-500 text-white'
                                                : 'border border-[var(--border-color)] text-rose-600'}`}
                                    >
                                        {s.delivery_blocked_by_admin ? '▶️ إعادة' : '⏸ إيقاف'}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* الطلبات */}
            <div className="bg-[var(--card-bg)] rounded-3xl p-4 border border-[var(--border-color)]">
                <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                    <h3 className="font-black text-sm">📦 طلبات التوصيل ({total})</h3>
                    <select
                        value={status}
                        onChange={e => { setStatus(e.target.value); setShown(25); }}
                        className="text-xs font-bold rounded-xl px-3 py-2 bg-[var(--body-bg)] border border-[var(--border-color)]"
                    >
                        <option value="">كل الحالات</option>
                        {Object.entries(STATUS_AR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                </div>
                {orders.length === 0 ? (
                    <div className="text-xs text-[var(--text-secondary)] py-6 text-center">لا طلبات توصيل بهذه الحالة.</div>
                ) : (
                    <div className="space-y-2">
                        {orders.map(o => (
                            <div key={o.barcode} className="p-3 rounded-2xl bg-[var(--body-bg)] border border-[var(--border-color)]">
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                    <div className="font-black text-sm font-mono">{o.barcode}</div>
                                    <div className="text-[0.68rem] font-bold">
                                        {STATUS_AR[o.status] || o.status}
                                        {o.track_status ? ` · ${TRACK_AR[o.track_status] || o.track_status}` : ''}
                                    </div>
                                </div>
                                <div className="text-[0.7rem] text-[var(--text-secondary)] mt-1 leading-relaxed">
                                    {o.item_name} · {o.store_name}
                                    <br />
                                    {o.user_name}{o.user_phone ? ` · ${o.user_phone}` : ''}
                                    {o.addr_label ? ` · 📍 ${o.addr_label}` : ''}
                                    {o.addr_details ? ` (${o.addr_details})` : ''}
                                    <br />
                                    {money(o.total_amount)} ر.س
                                    {Number(o.delivery_fee) > 0 ? ` · رسوم ${money(o.delivery_fee)}` : ''}
                                    {' · '}{o.payment_method === 'online' ? (o.paid ? '💳 مدفوع' : '⏳ بانتظار الدفع') : '💵 عند الاستلام'}
                                </div>
                            </div>
                        ))}
                        {orders.length < total && (
                            <button
                                onClick={() => setShown(n => n + 25)}
                                disabled={busy}
                                className="w-full py-3 rounded-2xl border border-[var(--border-color)] font-black text-sm disabled:opacity-60"
                            >
                                {busy ? 'جارٍ التحميل…' : `عرض المزيد — ظهر ${orders.length} من ${total}`}
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default AdminDelivery;
