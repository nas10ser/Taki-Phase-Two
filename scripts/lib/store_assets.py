#!/usr/bin/env python3
"""مولّدُ أصول المتاجر — يُنادى من scripts/build-store-assets.js.

🔴 ولماذا سكربتٌ لا ملفّاتٌ مرفوعة يدوياً: مقاساتُ المتاجر خمسة، وكلُّ تعديلٍ
   للشعار يُلزِم إعادتها كلَّها — وخطوةٌ منسيّةٌ واحدة تعني أيقونةً قديمةً في
   قائمةٍ يراها كلُّ من يبحث عن التطبيق (نفسُ منطق build-logo.js).

🪤 وأيقونةُ أبل **لا تحمل قناةَ شفافية إطلاقاً**: App Store Connect يرفض
   `must not contain an alpha channel` رفضاً صريحاً عند الرفع. فتُكتب RGB
   بثلاث قنوات لا RGBA — وهذا هو الفرقُ الوحيد عن أيقونة أندرويد، ولا يظهر
   في أي معاينةٍ بصرية.
"""
import os, subprocess, sys, tempfile
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import img
from logo_build import resize, place, BRAND_BG  # نفسُ الأصل ونفسُ طريقة التركيب

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT  = os.path.join(ROOT, 'store', 'assets')
SRC  = os.path.join(ROOT, 'branding', 'taki-logo-master.png')
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

made = []

def emit(rel, arr):
    p = os.path.join(OUT, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    img.write_png(p, arr)
    made.append((rel, arr.shape[1], arr.shape[0], arr.shape[2], os.path.getsize(p)))

def main():
    if not os.path.exists(SRC):
        print('❌ أصلُ الشعار المقصوص غير موجود — شغّل `node scripts/build-logo.js` أوّلاً:', SRC)
        sys.exit(1)
    art = img.read_png(SRC)
    print(f'ℹ️ الأصلُ المقصوص {art.shape[1]}×{art.shape[0]}')

    # ── أيقونةُ App Store: ١٠٢٤×١٠٢٤ · بلا شفافية · بلا حوافٍّ مستديرة ──────
    # 🪤 والنظامُ هو من يستدير الحوافّ؛ تدويرُها في الملفّ يُنتج هالةً مزدوجة.
    icon = place(1024, 1024, art, 0.74, BRAND_BG)          # نفسُ نسبة apple-touch-icon
    emit('appstore-icon-1024.png', icon[:, :, :3])      # ← RGB: إسقاطُ قناة ألفا

    # ── أيقونةُ قوقل بلاي: ٥١٢×٥١٢ · ٣٢ بت (الشفافيةُ مسموحة) ─────────────
    # 🪤 وبلاي يقصّ خارج دائرةٍ كما المُشغّل، فتبقى نسبةُ ٠٫٦٨ المقيسة.
    emit('play-icon-512.png', place(512, 512, art, 0.68, BRAND_BG))

    # ── الصورةُ المميَّزة في بلاي: ١٠٢٤×٥٠٠ · إلزاميّةٌ لنشر أي تطبيق ───────
    # 🪤 وتُبنى بمتصفّحٍ بلا رأس لأن فيها نصّاً عربياً — رسمُ الخطّ العربيّ
    #    (وصلُ الحروف واتجاهُها) ليس شيئاً يُصنع بتركيب بكسلات.
    card = os.path.join(HERE, 'play-feature.html')
    ok = False
    if os.path.exists(CHROME) and os.path.exists(card):
        fd, tmp = tempfile.mkstemp(suffix='.png'); os.close(fd)
        subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars',
                        '--force-device-scale-factor=1', '--window-size=1024,500',
                        '--virtual-time-budget=4000', '--screenshot=' + tmp,
                        'file://' + card], capture_output=True)
        if os.path.getsize(tmp) > 1000:
            a = img.read_png(tmp)
            if a.shape[0] == 500 and a.shape[1] == 1024:
                emit('play-feature-graphic-1024x500.png', a[:, :, :3]); ok = True
        os.unlink(tmp)
    if not ok:
        # ارتدادٌ معلَن لا صامت: شعارٌ بلا نصّ خيرٌ من صورةٍ قديمةٍ كاذبة
        print('⚠️ تعذّر بناءُ الصورة المميَّزة بالمتصفّح — تُبنى بلا نصّ.')
        emit('play-feature-graphic-1024x500.png', place(1024, 500, art, 0.72, BRAND_BG)[:, :, :3])

    # 🔴 والتحقّقُ يقرأ **الملفَّ المكتوب** لا المصفوفةَ التي بُنيت منه: قياسُ
    #    `arr.shape[2]` قاس نيّتي لا ما خرج — و`img.write_png` تُسقط ألفا حين
    #    تكون مُصمتةً كلُّها، فكانت المصفوفةُ أربعاً والملفُّ ثلاثاً. العقدُ هو
    #    `color_type` في ترويسة IHDR: ٢ = RGB · ٦ = RGBA.
    def color_type(rel):
        with open(os.path.join(OUT, rel), 'rb') as f:
            return f.read(26)[25]

    for rel, w, h, ch, sz in made:
        ct = color_type(rel)
        if rel.startswith('appstore') and ct == 6:
            print(f'❌ {rel} خرجت بقناة ألفا (color_type=6) — App Store يرفضها صراحةً.')
            sys.exit(1)
        print(f'   ✓ {rel:38} {w}×{h}  color_type={ct}  {sz/1024:.1f} KB')
    print(f'✅ أصولُ المتاجر: {len(made)} ملفّاً في store/assets/')

main()
