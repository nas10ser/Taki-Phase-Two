/**
 * capacitor.ts — جسرُ التطبيق الأصليّ (v15.58)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 **كلُّ استيرادٍ هنا ديناميكيّ (`await import`) بلا استثناء.** الموقعُ
 *    يُحمَّل في متصفّحٍ لا يعرف Capacitor، وحزمةُ الدخول عند ٦٣٧ ك.ب من سقف
 *    ٧٦٠ — فاستيرادٌ ساكنٌ واحد يُدخل إضافاتِ المنصّتين في حزمة **كل زائر**
 *    ويكسر ميزانيّةَ الحزم (ودرسُ `@sentry/react` في v14.84 بعينه).
 *    و`isNative()` وحدها متزامنةٌ لأنها تقرأ كائناً يحقنه الجسرُ الأصليّ.
 *
 * 🪤 ولا يُفترض وجودُ إضافةٍ لأنها في `package.json`: البناءُ للويب لا يضمّها،
 *    وجهازٌ قديمٌ قد يفشل تحميلُها. كلُّ نداءٍ هنا داخل `try` يرتدّ بهدوء إلى
 *    سلوك الويب — فالتطبيقُ يعمل بالكامل حتى لو سقطت كلُّ الإضافات.
 */

type Platform = 'ios' | 'android' | 'web';

interface CapGlobal {
    isNativePlatform?: () => boolean;
    getPlatform?: () => Platform;
}

const cap = (): CapGlobal | undefined => (globalThis as any).Capacitor;

/** هل نحن داخل التطبيق المنشور في المتجر؟ (متزامنة — تُستعمل في التصيير) */
export const isNative = (): boolean => {
    try { return cap()?.isNativePlatform?.() === true; } catch { return false; }
};

export const nativePlatform = (): Platform => {
    try { return cap()?.getPlatform?.() ?? 'web'; } catch { return 'web'; }
};

/** يُنفَّذ مرّةً واحدة عند الإقلاع — ولا يُنادى في الويب إطلاقاً. */
export async function initNative(opts: {
    onDeepLink: (path: string) => void;
    onBack: () => boolean;      // تُرجع true إن ابتلعت الضغطة
}): Promise<void> {
    if (!isNative()) return;

    // ── شريطُ الحالة ──────────────────────────────────────────────────────
    try {
        const { StatusBar, Style } = await import('@capacitor/status-bar');
        await StatusBar.setStyle({ style: Style.Dark });   // أيقوناتٌ فاتحة
        if (nativePlatform() === 'android') {
            await StatusBar.setBackgroundColor({ color: '#0f172a' });
        }
    } catch { /* شريطُ حالةٍ غيرُ مضبوط لا يمنع التطبيق */ }

    // ── شاشةُ البدء: تُخفى بعد أوّل رسمٍ حقيقيّ لا بمؤقّت ──────────────────
    // 🪤 `launchAutoHide: false` في الإعداد، فلو لم يُنفَّذ هذا السطرُ بقيت
    //    الشاشةُ إلى الأبد. ولذلك هو **أوّلُ** ما يُستدعى بعد الرسم، وفي
    //    `finally` كي يُنفَّذ حتى لو سقط ما قبله.
    try {
        const { SplashScreen } = await import('@capacitor/splash-screen');
        requestAnimationFrame(() => { void SplashScreen.hide({ fadeOutDuration: 220 }); });
    } catch { /* لا شيء */ }

    // ── زرُّ الرجوع في أندرويد ─────────────────────────────────────────────
    // 🔴 بلا هذا المعالج يُغلق زرُّ الرجوع **التطبيقَ كلَّه** من أيّ شاشة —
    //    وهو أوّلُ ما يلاحظه المستخدم وأسرعُ سببٍ لتقييمٍ بنجمة.
    try {
        const { App } = await import('@capacitor/app');
        await App.addListener('backButton', ({ canGoBack }) => {
            if (opts.onBack()) return;              // ابتلعتها الشاشة (نافذةٌ مفتوحة)
            if (canGoBack) window.history.back();
            else void App.exitApp();                // الجذرُ وحده يُغلق التطبيق
        });

        // ── الروابطُ العميقة: رابطُ تاكي يفتح الشاشةَ لا الصفحةَ الرئيسية ──
        await App.addListener('appUrlOpen', ({ url }) => {
            try {
                const u = new URL(url);
                if (/(^|\.)takisa\.net$/i.test(u.hostname)) {
                    opts.onDeepLink(u.pathname + u.search + u.hash);
                }
            } catch { /* رابطٌ مشوّه يُتجاهل */ }
        });
    } catch { /* لا شيء */ }

    // ── لوحةُ المفاتيح: لا تُغطّي الحقلَ المركَّز ─────────────────────────
    try {
        const { Keyboard } = await import('@capacitor/keyboard');
        await Keyboard.setAccessoryBarVisible({ isVisible: true });
    } catch { /* الإضافةُ اختيارية */ }
}

/** اهتزازةٌ خفيفة عند نجاح المسح أو تأكيد الحجز. */
export async function tapFeedback(kind: 'light' | 'success' | 'error' = 'light'): Promise<void> {
    if (!isNative()) return;
    try {
        const { Haptics, ImpactStyle, NotificationType } = await import('@capacitor/haptics');
        if (kind === 'light') await Haptics.impact({ style: ImpactStyle.Light });
        else if (kind === 'success') await Haptics.notification({ type: NotificationType.Success });
        else await Haptics.notification({ type: NotificationType.Error });
    } catch { /* الاهتزازُ تحسينٌ لا وظيفة */ }
}

/**
 * مسحُ باركود بالماسح الأصليّ (ML Kit).
 * 🔴 وهذه **القيمةُ الأصليّة الأوضح** في التطبيق: الماسحُ في الويب يفكّ
 *    الصورةَ برمجياً (`jsQR`) إطاراً بإطار — بطيءٌ في الضوء الخافت وداخل
 *    المتاجر. والأصليُّ مُسرَّعٌ بالعتاد ويقرأ صيغاً أكثر.
 * تُرجع `null` إن ألغى المستخدم، و`undefined` إن تعذّر الماسحُ الأصليّ
 * (فيرتدّ المنادي إلى ماسح الويب — لا يُترك بلا وسيلة).
 */
export async function scanBarcodeNative(): Promise<string | null | undefined> {
    if (!isNative()) return undefined;
    try {
        const { BarcodeScanner, BarcodeFormat } = await import('@capacitor-mlkit/barcode-scanning');

        // 🪤 وأندرويد يُنزّل وحدةَ ML Kit من خدمات قوقل عند أوّل استعمال —
        //    فيجب التأكّد من توفّرها، وإلّا فشل المسحُ بخطأٍ غامض.
        if (nativePlatform() === 'android') {
            const { available } = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();
            if (!available) await BarcodeScanner.installGoogleBarcodeScannerModule();
        }

        const perm = await BarcodeScanner.requestPermissions();
        if (perm.camera !== 'granted' && perm.camera !== 'limited') return null;

        const { barcodes } = await BarcodeScanner.scan({
            formats: [BarcodeFormat.QrCode, BarcodeFormat.Code128, BarcodeFormat.Ean13],
        });
        if (!barcodes.length) return null;
        await tapFeedback('success');
        return barcodes[0].rawValue ?? null;
    } catch {
        return undefined;    // ارتدادٌ معلَن إلى ماسح الويب
    }
}

/**
 * تسجيلُ الجهاز للإشعارات الأصليّة (APNs / FCM).
 * 🔴 ولماذا هذا لا يُغني عنه Web Push: آيفون لا يُسلّم Web Push إلا لتطبيقٍ
 *    **مثبَّتٍ من المتصفّح**، ولا يُسلّمه إطلاقاً داخل تطبيقٍ من المتجر.
 *    فالإشعاراتُ في تطبيق أبل تمرّ بـAPNs حصراً.
 * 🪤 والإذنُ يُطلب **بزرٍّ صريح** لا عند الإقلاع — قاعدةٌ قائمة في المنصّة
 *    منذ v14.13، وأبل ترفض طلبَ الإذن بلا سياق.
 */
export async function registerNativePush(
    save: (token: string, platform: 'ios' | 'android') => Promise<void>,
): Promise<'granted' | 'denied' | 'unavailable'> {
    if (!isNative()) return 'unavailable';
    try {
        const { PushNotifications } = await import('@capacitor/push-notifications');
        let perm = await PushNotifications.checkPermissions();
        if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
            perm = await PushNotifications.requestPermissions();
        }
        if (perm.receive !== 'granted') return 'denied';

        const platform = nativePlatform() === 'ios' ? 'ios' : 'android';
        await PushNotifications.addListener('registration', (t) => { void save(t.value, platform); });
        await PushNotifications.register();
        return 'granted';
    } catch {
        return 'unavailable';
    }
}

/** فتحُ رابطٍ خارجيّ (بوّابةُ الدفع) في متصفّحٍ داخل التطبيق لا خارجه. */
export async function openExternal(url: string): Promise<boolean> {
    if (!isNative()) return false;
    try {
        const { Browser } = await import('@capacitor/browser');
        await Browser.open({ url, presentationStyle: 'popover', toolbarColor: '#0f172a' });
        return true;
    } catch { return false; }
}

/** مشاركةٌ أصليّة (ورقةُ المشاركة في النظام) بدل نسخِ الرابط. */
export async function shareNative(title: string, text: string, url: string): Promise<boolean> {
    if (!isNative()) return false;
    try {
        const { Share } = await import('@capacitor/share');
        await Share.share({ title, text, url, dialogTitle: title });
        return true;
    } catch { return false; }
}
