package net.takisa.app;

import androidx.annotation.NonNull;
import com.android.billingclient.api.*;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.List;

/**
 * TakiIapPlugin — اشتراكُ التاجر داخل التطبيق عبر Google Play Billing (v15.67)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 **الإقرارُ (acknowledge) ليس تفصيلاً: غيابُه يُلغي البيع.** تنصّ قوقل على
 *    أن شراءً لم يُقَرّ خلال **ثلاثة أيّام** يُستردّ مالُه تلقائياً ويُلغى
 *    الاشتراك. وهو عيبٌ لا يظهر في أي اختبار: الشراءُ ينجح، والاشتراكُ
 *    يُفعَّل، ثمّ يتبخّر بعد ثلاثة أيّام بلا أيّ رسالة.
 *    ⇒ ولذلك الإقرارُ **خطوةٌ مستقلّة** (`finalize`) يُناديها الجسرُ بعد أن
 *      يتحقّق خادمُنا من الشراء. والترتيبُ مقصود: إقرارٌ قبل التحقّق يعني
 *      أننا أسقطنا شبكةَ الأمان (إعادةَ التسليم) قبل أن نمنح شيئاً.
 *
 * 🪤 و`queryProductDetailsAsync` للاشتراكات تلزمها `offerToken` من
 *    `subscriptionOfferDetails` — ولا يمكن إطلاقُ الشراء بلا هذا الرمز،
 *    وغيابُه يردّ `DEVELOPER_ERROR` بلا شرحٍ مفيد.
 *
 * 🪤 و«المستخدمُ أغلق الورقة» ليس خطأً: `USER_CANCELED` حالةٌ طبيعيّة تُردّ
 *    `cancelled` كي لا تُعرض رسالةُ عطلٍ لمن غيّر رأيه فحسب.
 *
 * 🪤 و`PENDING` حالةٌ حقيقيّة: قوقل تسمح بالدفع نقداً في متجرٍ فعليّ فيبقى
 *    الشراءُ أيّاماً. لا يُفعَّل شيءٌ عندها، والتفعيلُ يأتي من إشعار الخادم.
 */
@CapacitorPlugin(name = "TakiIap")
public class TakiIapPlugin extends Plugin {

    private BillingClient client;
    private PluginCall pendingPurchase;

    private final PurchasesUpdatedListener listener = (result, purchases) -> {
        PluginCall call = pendingPurchase;
        pendingPurchase = null;
        if (call == null) return;

        int code = result.getResponseCode();
        if (code == BillingClient.BillingResponseCode.USER_CANCELED) {
            JSObject o = new JSObject();
            o.put("state", "cancelled");
            call.resolve(o);
            return;
        }
        if (code != BillingClient.BillingResponseCode.OK || purchases == null || purchases.isEmpty()) {
            call.reject("billing_failed:" + code + " " + result.getDebugMessage());
            return;
        }
        Purchase p = purchases.get(0);
        JSObject o = new JSObject();
        o.put("purchaseToken", p.getPurchaseToken());
        // ولا يُدّعى النجاحُ على شراءٍ معلّق — الحالةُ تُنقل كما هي.
        o.put("state", p.getPurchaseState() == Purchase.PurchaseState.PURCHASED
                ? "purchased" : "pending");
        call.resolve(o);
    };

    /** اتّصالٌ واحدٌ يُعاد استعماله، ويُعاد بناؤه إن انقطع. */
    private void withClient(@NonNull PluginCall call, @NonNull Runnable ready) {
        if (client != null && client.isReady()) { ready.run(); return; }
        client = BillingClient.newBuilder(getContext())
                .setListener(listener)
                // 🪤 و`enablePendingPurchases` إلزاميّة للاشتراكات في Billing 7،
                //    وبلا ضبطها يفشل البناءُ عند التشغيل لا عند الترجمة.
                .enablePendingPurchases(
                        PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
                .build();
        client.startConnection(new BillingClientStateListener() {
            @Override public void onBillingSetupFinished(@NonNull BillingResult r) {
                if (r.getResponseCode() == BillingClient.BillingResponseCode.OK) ready.run();
                else call.reject("billing_unavailable:" + r.getResponseCode());
            }
            @Override public void onBillingServiceDisconnected() { client = null; }
        });
    }

    @PluginMethod
    public void products(PluginCall call) {
        JSArray ids = call.getArray("productIds");
        if (ids == null || ids.length() == 0) { call.reject("no_product_ids"); return; }
        List<QueryProductDetailsParams.Product> list = new ArrayList<>();
        try {
            for (int i = 0; i < ids.length(); i++) {
                list.add(QueryProductDetailsParams.Product.newBuilder()
                        .setProductId(ids.getString(i))
                        .setProductType(BillingClient.ProductType.SUBS).build());
            }
        } catch (Exception e) { call.reject("bad_product_ids"); return; }

        withClient(call, () -> client.queryProductDetailsAsync(
                QueryProductDetailsParams.newBuilder().setProductList(list).build(),
                (r, details) -> {
                    if (r.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                        call.reject("query_failed:" + r.getResponseCode()); return;
                    }
                    JSArray out = new JSArray();
                    for (ProductDetails d : details) {
                        List<ProductDetails.SubscriptionOfferDetails> offers =
                                d.getSubscriptionOfferDetails();
                        if (offers == null || offers.isEmpty()) continue;
                        ProductDetails.SubscriptionOfferDetails o = offers.get(0);
                        List<ProductDetails.PricingPhase> ph =
                                o.getPricingPhases().getPricingPhaseList();
                        JSObject j = new JSObject();
                        j.put("productId", d.getProductId());
                        j.put("title", d.getTitle());
                        j.put("description", d.getDescription());
                        // السعرُ **كما يصيغه المتجر** بعملة المستخدم — لا يُصاغ عندنا.
                        j.put("priceLabel", ph.isEmpty() ? "" : ph.get(ph.size() - 1).getFormattedPrice());
                        j.put("offerToken", o.getOfferToken());
                        out.put(j);
                    }
                    JSObject res = new JSObject();
                    res.put("products", out);
                    call.resolve(res);
                }));
    }

    @PluginMethod
    public void purchase(PluginCall call) {
        String pid = call.getString("productId");
        if (pid == null || pid.isEmpty()) { call.reject("no_product_id"); return; }
        List<QueryProductDetailsParams.Product> q = new ArrayList<>();
        q.add(QueryProductDetailsParams.Product.newBuilder()
                .setProductId(pid).setProductType(BillingClient.ProductType.SUBS).build());

        withClient(call, () -> client.queryProductDetailsAsync(
                QueryProductDetailsParams.newBuilder().setProductList(q).build(),
                (r, details) -> {
                    if (r.getResponseCode() != BillingClient.BillingResponseCode.OK || details.isEmpty()) {
                        call.reject("product_not_found:" + pid); return;
                    }
                    ProductDetails d = details.get(0);
                    List<ProductDetails.SubscriptionOfferDetails> offers = d.getSubscriptionOfferDetails();
                    if (offers == null || offers.isEmpty()) { call.reject("no_offer:" + pid); return; }
                    BillingFlowParams.ProductDetailsParams pdp =
                            BillingFlowParams.ProductDetailsParams.newBuilder()
                                    .setProductDetails(d)
                                    .setOfferToken(offers.get(0).getOfferToken()).build();
                    List<BillingFlowParams.ProductDetailsParams> l = new ArrayList<>();
                    l.add(pdp);
                    pendingPurchase = call;
                    call.setKeepAlive(true);
                    BillingResult br = client.launchBillingFlow(getActivity(),
                            BillingFlowParams.newBuilder().setProductDetailsParamsList(l).build());
                    if (br.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                        pendingPurchase = null;
                        call.reject("launch_failed:" + br.getResponseCode());
                    }
                }));
    }

    /** الاستعادة — يُلزم بها متجرُ أبل، وتُنقذ من تبديل الجهاز في المتجرين. */
    @PluginMethod
    public void restore(PluginCall call) {
        withClient(call, () -> client.queryPurchasesAsync(
                QueryPurchasesParams.newBuilder()
                        .setProductType(BillingClient.ProductType.SUBS).build(),
                (r, purchases) -> {
                    JSObject o = new JSObject();
                    for (Purchase p : purchases) {
                        if (p.getPurchaseState() == Purchase.PurchaseState.PURCHASED) {
                            o.put("purchaseToken", p.getPurchaseToken());
                            break;
                        }
                    }
                    call.resolve(o);
                }));
    }

    /**
     * الإقرارُ — **بعد** تحقّق الخادم. وبلا هذه الخطوة تستردّ قوقل المالَ
     * تلقائياً بعد ثلاثة أيّام وتُلغي الاشتراك، بلا أيّ رسالة.
     * 🪤 وإقرارُ ما هو مُقَرٌّ أصلاً لا يُخطئ — فالنداءُ آمنُ التكرار.
     */
    @PluginMethod
    public void finalizePurchase(PluginCall call) {
        String token = call.getString("purchaseToken");
        if (token == null || token.isEmpty()) { call.reject("no_token"); return; }
        withClient(call, () -> client.acknowledgePurchase(
                AcknowledgePurchaseParams.newBuilder().setPurchaseToken(token).build(),
                r -> {
                    JSObject o = new JSObject();
                    o.put("acknowledged", r.getResponseCode() == BillingClient.BillingResponseCode.OK);
                    o.put("code", r.getResponseCode());
                    call.resolve(o);
                }));
    }
}
