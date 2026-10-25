"""أدواتُ صورٍ بلا PIL: قراءةُ BMP (يُنتجها sips) وكتابةُ PNG من numpy."""
import struct, zlib, subprocess, os, tempfile
import numpy as np

def read_png(path):
    """PNG → ndarray RGBA عبر sips (أسرعُ وأضمنُ من فكّ PNG بايدن نقيّ)."""
    fd, bmp = tempfile.mkstemp(suffix='.bmp'); os.close(fd)
    subprocess.run(['sips','-s','format','bmp',path,'--out',bmp],
                   check=True, capture_output=True)
    d = open(bmp,'rb').read(); os.unlink(bmp)
    off = struct.unpack('<I', d[10:14])[0]
    w, h = struct.unpack('<ii', d[18:26])
    bpp = struct.unpack('<H', d[28:30])[0]
    ch = bpp // 8
    a = np.frombuffer(d[off:off + abs(h)*w*ch], dtype=np.uint8).reshape(abs(h), w, ch)
    if h > 0: a = a[::-1]
    a = a.copy()
    # BMP يخزّن BGRA
    if ch == 4: a = a[:, :, [2,1,0,3]]
    elif ch == 3:
        a = a[:, :, [2,1,0]]
        a = np.dstack([a, np.full(a.shape[:2], 255, np.uint8)])
    return a

def write_png(path, arr, level=9):
    """ndarray RGBA/RGB → PNG.

    🪤 بمرشّحٍ **تكيّفيّ** لا صفريّ: أوّلُ صياغةٍ كتبتُها استعملت المرشّحَ صفر
       لكلّ سطر، فخرج بوسترٌ بـ١٧٫٦ م.ب وأيقونةٌ ٥١٢ بـ١٩١ ك.ب (سبعةُ أضعاف
       القديمة). والمعيارُ القياسيّ (أقلُّ مجموعِ فروقٍ مطلقة) يختار لكلّ سطرٍ
       أفضلَ خمسة.
    🪤 وتُسقَط قناةُ الشفافية إن كانت مُصمتةً بالكامل: ربعُ البايتات بلا فائدة،
       وهي تُفسد ضغطَ البقيّة.
    """
    arr = np.ascontiguousarray(arr)
    if arr.shape[2] == 4 and bool((arr[:, :, 3] == 255).all()):
        arr = np.ascontiguousarray(arr[:, :, :3])
    h, w = arr.shape[:2]
    ch = arr.shape[2]
    ct = {1: 0, 3: 2, 4: 6}[ch]
    stride = w * ch
    lines = arr.reshape(h, stride).astype(np.int16)
    prev = np.zeros(stride, np.int16)
    raw = bytearray()
    for y in range(h):
        cur = lines[y]
        left = np.zeros(stride, np.int16); left[ch:] = cur[:-ch]
        upleft = np.zeros(stride, np.int16); upleft[ch:] = prev[:-ch]
        cands = []
        cands.append((0, cur))
        cands.append((1, (cur - left) & 0xFF))
        cands.append((2, (cur - prev) & 0xFF))
        cands.append((3, (cur - ((left + prev) >> 1)) & 0xFF))
        pa = np.abs(prev - upleft); pb = np.abs(left - upleft)
        pc = np.abs(left + prev - 2 * upleft)
        pred = np.where((pa <= pb) & (pa <= pc), left, np.where(pb <= pc, prev, upleft))
        cands.append((4, (cur - pred) & 0xFF))
        # 🪤 المعيارُ القياسيّ (MSAD): البايتُ يُقرأ **بإشارة**، فـ250 تساوي -6
        #    لا 250. وأوّلُ صياغةٍ لي قارنت نوعَ الصفر بمقياسٍ آخر فاختارت
        #    مرشّحاً أسوأ — وهو خطأٌ لا يظهر إلا في حجم الملفّ.
        def msad(v):
            b = np.asarray(v, np.int32) & 0xFF
            return int(np.minimum(b, 256 - b).sum())
        ft, best = min(cands, key=lambda c: msad(c[1]))
        raw.append(ft)
        raw += best.astype(np.uint8).tobytes()
        prev = cur
    def chunk(t, data):
        c = struct.pack('>I', len(data)) + t + data
        return c + struct.pack('>I', zlib.crc32(t + data) & 0xffffffff)
    png = b'\x89PNG\r\n\x1a\x0a'[:8]
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, ct, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(bytes(raw), level))
    png += chunk(b'IEND', b'')
    open(path, 'wb').write(png)

def bbox(arr, thr=8):
    ys, xs = np.nonzero(arr[:, :, 3] > thr)
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())

def over(bg_rgb, fg):
    """تركيبُ RGBA فوق لونٍ صلب."""
    a = fg[:, :, 3:4].astype(np.float32) / 255.0
    rgb = fg[:, :, :3].astype(np.float32) * a + np.array(bg_rgb, np.float32) * (1 - a)
    return np.dstack([rgb.astype(np.uint8), np.full(fg.shape[:2], 255, np.uint8)])
