import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    // ═══════════════════════════════════════════════════════════════════════
    // جسرُ الإشعاراتِ الأصليّة (APNs) — v15.81
    // ───────────────────────────────────────────────────────────────────────
    // 🔴 **هذا هو أخفضُ حلقةٍ في السلسلة، وكانت مفقودةً تماماً.** إضافةُ
    //    Capacitor للإشعارات **لا تستطيع** الحصولَ على رمز الجهاز بنفسها:
    //    هي تُراقب إشعارَ NotificationCenter باسم
    //    `.capacitorDidRegisterForRemoteNotifications` (انظر `load()` في
    //    `PushNotificationsPlugin.swift`)، **ويجب على التطبيقِ المضيفِ أن
    //    يبثّه**. وبلا هذين التابعين: `register()` يطلب التسجيل، ويُنادي
    //    النظامُ تابعاً لا وجودَ له، فيُسقط الرمزُ بلا أيّ خطأ، ويظلّ
    //    المستمعُ في الويب لا يُنادى أبداً — ثمّ ترفض الإضافةُ ثلاثةً من
    //    توابعها بالنصّ الحرفيّ
    //    «event capacitorDidRegisterForRemoteNotifications not called.»
    // 🪤 وهذان التابعان يبقيان على **مُفوِّض التطبيق** حتى في تطبيقٍ قائمٍ
    //    على المشاهد (`UIScene`): تسجيلُ الإشعاراتِ البعيدة ليس حدثَ مشهدٍ،
    //    فلا يُنقلان إلى `SceneDelegate`.
    // 🪤 ويُترجَمان بلا أيّ حسابِ أبل: بناءُ التحقّق في CI يمرّ بـ
    //    `CODE_SIGNING_ALLOWED=NO`، فالصلاحيّاتُ لا تُفحص هناك إطلاقاً.
    // ═══════════════════════════════════════════════════════════════════════
    func application(_ application: UIApplication,
                     didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(
            name: .capacitorDidRegisterForRemoteNotifications,
            object: deviceToken)
    }

    func application(_ application: UIApplication,
                     didFailToRegisterForRemoteNotificationsWithError error: Error) {
        // 🔴 والفشلُ يُبثّ أيضاً: بلا هذا السطر لا تَعلم الواجهةُ أن التسجيلَ
        //    فشل، فتبقى تنتظر رمزاً لن يأتي حتى تنقضي المهلة — وتُقرأ المهلةُ
        //    على أنها «شبكةٌ بطيئة» لا «مفتاحُ APNs خاطئ».
        NotificationCenter.default.post(
            name: .capacitorDidFailToRegisterForRemoteNotifications,
            object: error)
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}
