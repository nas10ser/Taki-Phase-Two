import Foundation
import Capacitor
import StoreKit

/**
 * TakiIapPlugin — اشتراكُ التاجر داخل التطبيق عبر StoreKit 2 (v15.67)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🟢 وميزةُ StoreKit 2 أنها **تتحقّق من التوقيع محلياً** بمفاتيح أبل: ما يخرج
 *    من `verificationResult.payloadValue` موقَّعٌ مُتحقَّقٌ منه، وما يفشل يُرمى.
 *    فلا نهندس تحليلَ شهاداتٍ بأيدينا — وذاك كودُ تشفيرٍ لا يمكن تجربتُه.
 *    ومع ذلك **لا يُفعَّل شيءٌ بهذا وحده**: الخادمُ يسأل أبل ثانيةً، لأن
 *    جهازاً مكسورَ الحماية يستطيع اعتراضَ ما بين الإضافة والـWebView.
 *
 * 🔴 و`transaction.finish()` **لا يُنادى هنا بعد الشراء.** معاملةٌ غيرُ منتهية
 *    يُعيد StoreKit تسليمَها عند كل إقلاع — وهي شبكةُ الأمان الوحيدة لو مات
 *    الاتّصالُ بخادمنا بين الدفع والتفعيل. فإنهاؤها قبل أن نمنح شيئاً يعني
 *    تاجراً دفع ولا اشتراكَ له ولا سبيلَ لاستعادته إلّا «استعادةُ المشتريات».
 *    ⇒ الإنهاءُ خطوةٌ مستقلّة (`finalizePurchase`) بعد تحقّق الخادم.
 *    (ونظيرُها في أندرويد `acknowledge` — وغيابُه هناك يُلغي البيعَ بعد
 *     ثلاثة أيّام بردٍّ تلقائيّ من قوقل.)
 *
 * 🪤 و«أغلق المستخدمُ الورقة» ليس خطأً: `.userCancelled` تُردّ `cancelled`.
 * 🪤 و`.pending` حالةٌ حقيقيّة (موافقةُ وليٍّ في حساب العائلة) — لا تُعدّ فشلاً.
 */
@objc(TakiIapPlugin)
public class TakiIapPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TakiIapPlugin"
    public let jsName = "TakiIap"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "products", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finalizePurchase", returnType: CAPPluginReturnPromise)
    ]

    @objc func products(_ call: CAPPluginCall) {
        guard let ids = call.getArray("productIds", String.self), !ids.isEmpty else {
            call.reject("no_product_ids"); return
        }
        Task {
            do {
                let found = try await Product.products(for: ids)
                let out: [[String: Any]] = found.map { p in
                    [
                        "productId": p.id,
                        "title": p.displayName,
                        "description": p.description,
                        // السعرُ **كما يصيغه المتجر** بعملة المستخدم ولغته.
                        "priceLabel": p.displayPrice
                    ]
                }
                call.resolve(["products": out])
            } catch {
                call.reject("query_failed:\(error.localizedDescription)")
            }
        }
    }

    @objc func purchase(_ call: CAPPluginCall) {
        guard let pid = call.getString("productId"), !pid.isEmpty else {
            call.reject("no_product_id"); return
        }
        Task {
            do {
                guard let product = try await Product.products(for: [pid]).first else {
                    call.reject("product_not_found:\(pid)"); return
                }
                let result = try await product.purchase()
                switch result {
                case .success(let verification):
                    // 🪤 `payloadValue` يرمي عند أيّ فشلِ تحقّق — ولا يُقرأ
                    //    `unsafePayloadValue` أبداً، فذاك يعني قبولَ إيصالٍ
                    //    مُلفَّقٍ من جهازٍ مكسورِ الحماية.
                    let txn = try verification.payloadValue
                    call.resolve([
                        "transactionId": String(txn.id),
                        "originalTransactionId": String(txn.originalID),
                        "state": "purchased"
                    ])
                case .userCancelled:
                    call.resolve(["state": "cancelled"])
                case .pending:
                    call.resolve(["state": "pending"])
                @unknown default:
                    call.reject("unknown_purchase_result")
                }
            } catch {
                call.reject("purchase_failed:\(error.localizedDescription)")
            }
        }
    }

    /** الاستعادة — **يُلزم بها البند ٣٫١٫١** لكل اشتراكٍ قابلٍ للتجديد. */
    @objc func restore(_ call: CAPPluginCall) {
        Task {
            // 🪤 ولا تُنادى `AppStore.sync()` إلّا بطلب المستخدم صراحةً: تطلب
            //    كلمةَ مرور Apple ID. وهذه الدالّةُ **خلف زرٍّ** يضغطه هو.
            try? await AppStore.sync()
            for await entitlement in Transaction.currentEntitlements {
                guard let txn = try? entitlement.payloadValue else { continue }
                guard txn.productType == .autoRenewable else { continue }
                if let rev = txn.revocationDate, rev <= Date() { continue }
                call.resolve([
                    "transactionId": String(txn.id),
                    "originalTransactionId": String(txn.originalID)
                ])
                return
            }
            call.resolve([:])
        }
    }

    /**
     * الإنهاءُ — **بعد** تحقّق الخادم. وقبله تبقى المعاملةُ في الطابور،
     * فيُعاد تسليمُها عند الإقلاع وتُنقذ تاجراً انقطع اتّصالُه لحظةَ الدفع.
     * 🪤 وإنهاءُ ما هو منتهٍ لا يُخطئ — فالنداءُ آمنُ التكرار.
     */
    @objc func finalizePurchase(_ call: CAPPluginCall) {
        guard let idStr = call.getString("transactionId"), let id = UInt64(idStr) else {
            call.reject("no_transaction_id"); return
        }
        Task {
            for await unfinished in Transaction.unfinished {
                guard let txn = try? unfinished.payloadValue else { continue }
                if txn.id == id || txn.originalID == id {
                    await txn.finish()
                    call.resolve(["finished": true])
                    return
                }
            }
            // لم تُوجد في الطابور = منتهيةٌ أصلاً، وهذا نجاحٌ لا فشل.
            call.resolve(["finished": true, "alreadyFinished": true])
        }
    }
}
