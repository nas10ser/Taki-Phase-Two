// Client-side image compression.
//
// Why this exists: modern phone photos are 3–8 MB. Uploading them raw to
// Supabase storage from a Saudi mobile connection took up to ~10 s each.
// Downscaling to a sane web size (≤1600 px, JPEG ~0.82) shrinks a typical
// 4 MB photo to ~200–350 KB, so the same upload finishes in ~1 s.
//
// This runs on EVERY upload path (camera, gallery, crop-applied,
// crop-skipped, decode-fail) because it is wired into storageService —
// it is the single chokepoint, so no path can bypass it.
//
// Fail-open by contract: any decode/encode failure returns the ORIGINAL
// File untouched. Compression must never block a seller from uploading.

type CompressOptions = {
    maxDim?: number;        // longest-side cap in px
    quality?: number;       // JPEG quality 0..1
    skipUnderBytes?: number; // already-small JPEGs are passed through as-is
};

// v13.32 — نسختان لكل صورة (طلب ناصر بعد قياس النقل الفعلي):
//
//  • النسخة الكاملة (هذه) — لصفحة المنتج وعارض التكبير. رُفعت جودتها عن v13.31
//    (١٤٠٠ بكسل / ٠.٨٢ بدل ١٢٠٠ / ٠.٧٥) لأن البطاقات لم تعد تُنزّلها، فصار
//    بالإمكان إعطاء أوضح صورة حيث ينظر المشتري فعلاً.
//  • النسخة المصغّرة (THUMB أدناه) — للبطاقات والقوائم.
//
// القياس الذي دفع هذا: صور الإنتاج كان متوسطها ٨٣٨ كيلوبايت وأكبرها ٥.٤
// ميجابايت، فصفحة ٣٠ منتجاً تُنزّل ~٢٤ ميجابايت على شبكة الجوال — بينما بطاقة
// المنتج تعرض الصورة بعرض ~١٨٠ نقطة فقط.
const DEFAULTS: Required<CompressOptions> = {
    maxDim: 1400,
    quality: 0.82,
    skipUnderBytes: 150 * 1024,
};

// ٦٠٠ بكسل: البطاقة تُرسم بعرض ~١٨٠ نقطة، وحتى على شاشة آيفون برو (3x) تحتاج
// ٥٤٠ بكسل — فـ٦٠٠ أوضح مما تستطيع الشاشة إظهاره. الناتج ~٤٠–٦٠ كيلوبايت.
export const THUMB: Required<CompressOptions> = {
    maxDim: 600,
    quality: 0.72,
    skipUnderBytes: 0,   // المصغّرة تُنتَج دائماً — لا تمرير
};

// Decode a File to something canvas-drawable. Prefer createImageBitmap
// (off-main-thread, honours EXIF orientation via the options bag on
// modern Safari/Chrome). Fall back to an <img> for older engines.
const decode = async (
    file: File,
): Promise<{ draw: CanvasImageSource; w: number; h: number; cleanup: () => void }> => {
    if (typeof createImageBitmap === 'function') {
        try {
            const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
            return { draw: bmp, w: bmp.width, h: bmp.height, cleanup: () => bmp.close() };
        } catch {
            /* fall through to the <img> path */
        }
    }
    const url = URL.createObjectURL(file);
    try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const el = new Image();
            el.onload = () => resolve(el);
            el.onerror = () => reject(new Error('decode_failed'));
            el.src = url;
        });
        return {
            draw: img,
            w: img.naturalWidth,
            h: img.naturalHeight,
            cleanup: () => URL.revokeObjectURL(url),
        };
    } catch (e) {
        URL.revokeObjectURL(url);
        throw e;
    }
};

export const compressImage = async (
    file: File,
    opts: CompressOptions = {},
): Promise<File> => {
    const { maxDim, quality, skipUnderBytes } = { ...DEFAULTS, ...opts };

    // Non-images (shouldn't reach here, but be safe) and already-small
    // JPEGs are passed through untouched — re-encoding a small JPEG only
    // adds generation-loss artefacts for no bandwidth win.
    if (!file.type.startsWith('image/')) return file;
    if (
        skipUnderBytes > 0 &&
        (file.type === 'image/jpeg' || file.type === 'image/webp') &&
        file.size <= skipUnderBytes
    ) {
        return file;
    }

    let handle: Awaited<ReturnType<typeof decode>> | null = null;
    try {
        handle = await decode(file);
        const { draw, w, h } = handle;
        if (!w || !h) return file;

        const scale = Math.min(1, maxDim / Math.max(w, h));
        const outW = Math.max(1, Math.round(w * scale));
        const outH = Math.max(1, Math.round(h * scale));

        const canvas = document.createElement('canvas');
        canvas.width = outW;
        canvas.height = outH;
        const ctx = canvas.getContext('2d');
        if (!ctx) return file;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(draw, 0, 0, outW, outH);

        const blob = await new Promise<Blob | null>((resolve) =>
            canvas.toBlob(resolve, 'image/jpeg', quality),
        );
        if (!blob || blob.size === 0) return file;

        // If the "compressed" result is somehow larger than the source
        // (tiny images, already-optimised PNG screenshots), keep the
        // original — never make an upload heavier than it started.
        if (blob.size >= file.size) return file;

        const base = file.name.replace(/\.[^./\\]+$/, '') || 'image';
        return new File([blob], `${base}.jpg`, {
            type: 'image/jpeg',
            lastModified: Date.now(),
        });
    } catch {
        return file;
    } finally {
        handle?.cleanup();
    }
};
