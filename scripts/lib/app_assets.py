#!/usr/bin/env python3
"""مصادرُ أصولِ تطبيقَي المتجرين — يُنادى من scripts/build-app-assets.js.

يُنتج **المصادرَ** الخمسة التي تقرؤها `@capacitor/assets` فتولّد منها عشراتِ
المقاسات لآيفون وآيباد وكلّ كثافات أندرويد.

🪤 ولماذا خمسةٌ لا واحد: الأيقونةُ على آيفون **مربّعةٌ مُصمتة** يقصّها النظام
   بحوافّه هو؛ وأيقونةُ أندرويد **تكيّفيّة** من طبقتين (أمامٌ شفّافٌ وخلفيّة)
   يقصّهما المشغّلُ بأشكالٍ مختلفة (دائرة · مربّع · معيّن)؛ وشاشةُ البدء
   مربّعةٌ ضخمةٌ تُقصّ من الوسط لأيّ نسبةِ شاشة.

🔴 ومساحةُ الأمان في الطبقة الأمامية ليست رأياً: أندرويد يقصّ خارج دائرةٍ
   قطرُها ٧٢٪ من الضلع في أسوأ الحالات، فالرسمةُ عند ٠٫٥٥ من الضلع تنجو من
   كلّ الأشكال. وأكبرُ منها يقطع رأسَ الرجل أو جوّالَه (قِيس في v15.25).
"""
import os, subprocess, sys, tempfile
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import img
from logo_build import resize, place, NAVY

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
SRC  = os.path.join(ROOT, 'branding', 'taki-logo-master.png')
OUT  = os.path.join(ROOT, 'assets')

made = []

def emit(rel, arr, drop_alpha=False):
    p = os.path.join(OUT, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    img.write_png(p, arr[:, :, :3] if drop_alpha else arr)
    with open(p, 'rb') as f:
        ct = f.read(26)[25]
    made.append((rel, arr.shape[1], arr.shape[0], ct, os.path.getsize(p)))

def main():
    if not os.path.exists(SRC):
        print('❌ أصلُ الشعار المقصوص غير موجود — شغّل `node scripts/build-logo.js`:', SRC)
        sys.exit(1)
    art = img.read_png(SRC)
    print(f'ℹ️ الأصلُ المقصوص {art.shape[1]}×{art.shape[0]}')

    # ── أيقونةُ آيفون/المتجر: مربّعةٌ مُصمتةٌ بلا قناةِ شفافية ───────────────
    # 🔴 أبل ترفض قناةَ ألفا صراحةً في أيقونة المتجر، والنظامُ هو من يستدير
    #    الحوافّ — فتدويرُها في الملفّ يُنتج هالةً مزدوجة.
    emit('icon.png', place(1024, 1024, art, 0.74, NAVY), drop_alpha=True)

    # ── أندرويد التكيّفيّة: طبقتان ─────────────────────────────────────────
    emit('icon-foreground.png', place(1024, 1024, art, 0.55, None))     # شفّافة
    bg = np.zeros((1024, 1024, 4), np.uint8)
    bg[:, :, 0], bg[:, :, 1], bg[:, :, 2], bg[:, :, 3] = NAVY[0], NAVY[1], NAVY[2], 255
    emit('icon-background.png', bg, drop_alpha=True)

    # ── شاشةُ البدء: مربّعٌ ٢٧٣٢ يُقصّ من الوسط لأيّ نسبة ───────────────────
    # 🪤 والرسمةُ عند ٠٫٣٨ فقط: الشاشةُ تُقصّ بقوّةٍ على الأجهزة الطويلة،
    #    وشعارٌ كبيرٌ هنا يخرج نصفُه خارج الإطار على آيفون الطويل.
    splash = place(2732, 2732, art, 0.38, NAVY)
    emit('splash.png', splash, drop_alpha=True)
    # وثيمُنا داكنٌ أصلاً، فنسخةُ الظلام هي نفسُها — ووجودُها يمنع ارتداداً أبيض.
    emit('splash-dark.png', splash, drop_alpha=True)

    for rel, w, h, ct, sz in made:
        kind = 'RGB' if ct == 2 else ('RGBA' if ct == 6 else str(ct))
        print(f'   ✓ {rel:26} {w}×{h}  {kind:4}  {sz/1024:.0f} KB')

    # عقدٌ صريح: أيقونةُ أبل وشاشاتُ البدء بلا ألفا، والطبقةُ الأمامية بألفا.
    d = {m[0]: m[3] for m in made}
    if d.get('icon.png') == 6:
        print('❌ icon.png خرجت بقناة ألفا — أبل ترفضها.'); sys.exit(1)
    if d.get('icon-foreground.png') != 6:
        print('❌ icon-foreground.png بلا قناة ألفا — الأيقونةُ التكيّفيّة تحتاجها.'); sys.exit(1)
    print(f'✅ مصادرُ أصول التطبيق: {len(made)} ملفّاتٍ في assets/')

main()
