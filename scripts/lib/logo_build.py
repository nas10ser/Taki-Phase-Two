#!/usr/bin/env python3
"""مولّدُ مقاسات الشعار — يُنادى من scripts/build-logo.js."""
import os, subprocess, sys, tempfile
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import img

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
SRC  = os.path.join(ROOT, 'لوقو شفاف بدون خلفيه دقه عاليه .png')
NAVY = (15, 23, 42)          # #0f172a — نفسُ background_color و theme_color في البيان

def resize(arr, w, h):
    """تصغيرٌ/تكبيرٌ عبر sips (CoreImage) مع حفظ الشفافية."""
    fd, a = tempfile.mkstemp(suffix='.png'); os.close(fd)
    fd, b = tempfile.mkstemp(suffix='.png'); os.close(fd)
    img.write_png(a, arr)
    subprocess.run(['sips', '-z', str(h), str(w), a, '--out', b],
                   check=True, capture_output=True)
    r = img.read_png(b)
    os.unlink(a); os.unlink(b)
    return r

def place(canvas_w, canvas_h, art, frac, bg=None, dy=0.0):
    """يضع الرسمةَ في لوحةٍ بنسبةٍ من أصغر بُعد، وسطاً."""
    base = min(canvas_w, canvas_h)
    ah, aw = art.shape[:2]
    scale = (base * frac) / max(ah, aw)
    nw, nh = max(1, int(round(aw * scale))), max(1, int(round(ah * scale)))
    small = resize(art, nw, nh)
    if bg is None:
        out = np.zeros((canvas_h, canvas_w, 4), np.uint8)
    else:
        out = np.zeros((canvas_h, canvas_w, 4), np.uint8)
        out[:, :, 0], out[:, :, 1], out[:, :, 2], out[:, :, 3] = bg[0], bg[1], bg[2], 255
    x = (canvas_w - nw) // 2
    y = (canvas_h - nh) // 2 + int(round(canvas_h * dy))
    y = max(0, min(canvas_h - nh, y))
    reg = out[y:y+nh, x:x+nw]
    a = small[:, :, 3:4].astype(np.float32) / 255.0
    reg[:, :, :3] = (small[:, :, :3].astype(np.float32) * a
                     + reg[:, :, :3].astype(np.float32) * (1 - a)).astype(np.uint8)
    reg[:, :, 3] = np.maximum(reg[:, :, 3], small[:, :, 3])
    return out

def main():
    if not os.path.exists(SRC):
        print('❌ أصلُ الشعار غير موجود:', SRC); sys.exit(1)
    src = img.read_png(SRC)
    x0, y0, x1, y1 = img.bbox(src)
    art = src[y0:y1+1, x0:x1+1]
    print(f'ℹ️ الأصل {src.shape[1]}×{src.shape[0]} · الرسمةُ فيه {art.shape[1]}×{art.shape[0]}')

    made = []
    def emit(rel, arr):
        p = os.path.join(ROOT, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        img.write_png(p, arr)
        made.append((rel, arr.shape[1], arr.shape[0], os.path.getsize(p)))

    # ── الأصلُ المقصوص: هو المرجع لكلّ ما بعده ─────────────────────────────
    emit('branding/taki-logo-master.png', art)

    # ── بوسترٌ عملاق: شفّافٌ وبخلفيةٍ داكنة ────────────────────────────────
    # 🪤 ٤٠٩٦ من أصلٍ ٢٥٤٤ = تكبيرٌ ١٫٦× — حدٌّ معقولٌ لرسمةٍ مسطّحة. وما فوقه
    #    يُلين الحوافّ بلا أن يُضيف تفصيلاً، فلا يُدَّعى.
    big = resize(art, 4096, int(round(4096 * art.shape[0] / art.shape[1])))
    emit('branding/taki-logo-poster-4096.png', big)
    emit('branding/taki-logo-poster-navy-4096.png', img.over(NAVY, big))

    # ── أيقوناتُ التطبيق: **شفّافة** (طلبُ ناصر ٢٥ أكتوبر) ─────────────────
    # 🔴 وثلاثةُ آثارٍ لهذا القرار تُقال كما هي، فهي سلوكُ أنظمةٍ لا رأي:
    #   • **آيفون يتجاهل الشفافية** في أيقونة الشاشة الرئيسية ويضعها على
    #     **أسود**. فالنتيجةُ هناك أسودُ لا أزرقُ داكن — وهو أقربُ لما طُلب.
    #   • **وأندرويد** يضع الشفّافَ على سطح المُشغّل (أبيضُ غالباً). والرسمةُ
    #     تبقى مقروءةً لأن حدودَها داكنةٌ سميكة، لكنّ ثوبَها أبيض.
    #   • و`purpose: maskable` **يُسقَط من البيان**: القناعُ يفترض أيقونةً
    #     مُصمتةً تملأ اللوحة، وشفّافةٌ تحته تُظهر خلفيةَ النظام لا الشعار.
    # 🪤 ولمّا زالت الحاجةُ لمساحة أمان القناع تُكبَّر الرسمةُ إلى ٠٫٩٢:
    #    كانت ٠٫٦٨ لأجل قصّ الدائرة وحده، فبدت صغيرةً في مربّع.
    for size in (512, 192):
        emit(f'logo{size}.png', place(size, size, art, 0.92))
    emit('apple-touch-icon.png', place(180, 180, art, 0.92))

    # ── علامةٌ شفّافةٌ خفيفةٌ للترويسة وشاشة الدخول ───────────────────────
    # 🪤 ولا تُستعمل `logo192` هناك: تلك على خلفيةٍ داكنةٍ صلبة، فتظهر مربّعاً
    #    فوق شريطٍ متدرّج. وما يلزم الواجهة شفّافٌ وخفيف.
    mark = resize(art, 256, int(round(256 * art.shape[0] / art.shape[1])))
    emit('logo-mark.png', mark)

    # ── صورةُ المشاركة: بطاقةٌ فيها الشعارُ والاسمُ والنطاق ────────────────
    # 🔴 والقديمةُ كانت تحمل نطاقاً ميتاً (`taki-test-eight.vercel.app`) —
    #    أي أن كلَّ رابطٍ شاركه أحدٌ في واتساب كان يعرض عنواناً خاطئاً.
    # 🪤 وتُبنى بمتصفّحٍ بلا رأس لأن فيها نصّاً عربياً: رسمُ الخطّ العربيّ
    #    (وصلُ الحروف واتجاهُها) ليس شيئاً يُصنع بتركيب بكسلات.
    card = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'og-card.html')
    chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    if os.path.exists(chrome) and os.path.exists(card):
        fd, tmp = tempfile.mkstemp(suffix='.png'); os.close(fd)
        subprocess.run([chrome, '--headless=new', '--disable-gpu', '--hide-scrollbars',
                        '--force-device-scale-factor=1', '--window-size=1200,630',
                        '--virtual-time-budget=4000', '--screenshot=' + tmp,
                        'file://' + card], capture_output=True)
        if os.path.getsize(tmp) > 1000:
            emit('og-image.png', img.read_png(tmp))
        os.unlink(tmp)
    if not any(r[0] == 'og-image.png' for r in made):
        # ارتدادٌ معلَن: شعارٌ على خلفيةٍ داكنة بلا نصّ، خيرٌ من صورةٍ قديمةٍ كاذبة
        print('⚠️ تعذّر بناءُ بطاقة المشاركة بالمتصفّح — تُبنى بلا نصّ.')
        emit('og-image.png', place(1200, 630, art, 0.80, NAVY))

    for rel, w, h, sz in made:
        print(f'   ✓ {rel:42} {w}×{h}  {sz/1024:.1f} KB')
    print(f'✅ الشعار: {len(made)} ملفّاً من أصلٍ واحد')

main()
