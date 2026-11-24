#!/usr/bin/env node
/**
 * build-alarm-tone.js — ملفُّ إنذار الطلب الجديد، مبنيٌّ من نغمة الإشعار (v16.58)
 * ═══════════════════════════════════════════════════════════════════════════
 * أمرُ ناصر (٢٤ نوفمبر ٢٠٢٦، بعد تجربة v16.57): «النغمةُ الآن لا تُعاد وتسكت
 * على طول. أريد أن أسمع الصوتَ **بدون توقّف** إلى أن يؤكّد التاجرُ الاستلام أو
 * تُلغى من أحد الطرفين… ونغمةٌ واحدةٌ لن يفرّق بها التاجرُ بينها وبين إشعار،
 * خصوصاً مع عشرات الطلبات في نفس الوقت».
 *
 * 🔴 **ولماذا ملفٌّ لا مؤقّت.** كان التكرارُ في v16.57 بـ`setInterval` كلَّ ١٥
 *    ثانية، وذاك خطأٌ من وجهين: فجوةُ صمتٍ طويلةٌ تُسمع «سكوتاً»، و**كروم
 *    يُبطّئ المؤقّتاتِ في التاب الخلفيّ إلى نحو واحدةٍ في الدقيقة** — أي في
 *    اللحظة التي يكون التاجرُ فيها مشغولاً بشاشةٍ أخرى. أمّا تشغيلُ الوسائط
 *    فلا يُبطّأ: عنصرٌ بـ`loop` يرنّ إلى أن يُوقَف، مهما فعل المتصفّح.
 *
 * فالملفُّ = نفسُ نغمة الإشعار + فسحةٌ قصيرة، مكرّرةٌ خمسَ مرّات. و`loop`
 * يجعلها بلا نهاية بإيقاعٍ ثابت.
 * 🪤 ولا تُبنى بنغمةٍ متّصلةٍ بلا فسحة: النغمةُ ٠٫٣٩ ث فيصير الناتجُ أزيزاً
 *    (رنّتان ونصفٌ في الثانية) لا تنبيهاً.
 * 🪤 ويُطابَق الترميزُ حرفياً (mp3 · أحاديّ · ٤٤٫١ ك.هرتز · ٤٨ ك.بت): صيغةٌ
 *    جديدة = مخاطرةُ متصفّحٍ لا يفكّها، والنغمةُ الحالية **مُجرَّبةٌ تعمل**.
 *
 *   node scripts/build-alarm-tone.js        # يبني ويُقارن
 *   node scripts/build-alarm-tone.js --check # يتحقّق فقط (في npm test)
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const SRC = path.join(root, 'notify.mp3');
const OUT = path.join(root, 'order-alarm.mp3');

/** فسحةُ الصمت بين رنّتين — ٠٫٨ ث: محسوسةٌ كإيقاعٍ ولا تُسمع سكوتاً. */
const GAP_S = 0.8;
/** دوراتٌ في الملفّ — طولُه ≈ ٦ ثوانٍ، وأيُّ أقصرَ يُسمع حدُّ اللفّ. */
const CYCLES = 5;

const check = process.argv.includes('--check');

if (check) {
    if (!fs.existsSync(OUT)) {
        console.error('❌ `order-alarm.mp3` غيرُ موجود — شغّل: node scripts/build-alarm-tone.js');
        process.exit(1);
    }
    const size = fs.statSync(OUT).size;
    // 🪤 يُقاس **المحتوى** لا الوجود: ملفٌّ فارغٌ أو مقطوعٌ يمرّ من فحص الوجود.
    const head = fs.readFileSync(OUT).subarray(0, 4);
    const isMp3 = (head[0] === 0xFF && (head[1] & 0xE0) === 0xE0)
        || (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33);   // ID3
    if (!isMp3 || size < 8000) {
        console.error(`❌ \`order-alarm.mp3\` ليس mp3 سليماً (${size} بايت)`);
        process.exit(1);
    }
    console.log(`✅ إنذارُ الطلب: order-alarm.mp3 · ${(size / 1024).toFixed(1)} ك.ب`);
    process.exit(0);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'taki-alarm-'));
const padded = path.join(tmp, 'padded.mp3');
try {
    // ① رنّةٌ + فسحة، بنفس الترميز
    execFileSync('ffmpeg', ['-y', '-i', SRC, '-af', `apad=pad_dur=${GAP_S}`,
        '-c:a', 'libmp3lame', '-b:a', '48k', '-ar', '44100', '-ac', '1', padded], { stdio: 'pipe' });
    // ② تُلصق الدوراتُ بلا إعادة ترميز (فلا تتراكم خسارةُ الضغط)
    execFileSync('ffmpeg', ['-y', '-stream_loop', String(CYCLES - 1), '-i', padded,
        '-c', 'copy', OUT], { stdio: 'pipe' });
} catch (e) {
    console.error('❌ فشل البناء — يحتاج ffmpeg (على جهاز ناصر فقط؛ الملفُّ يُحفظ في المستودع)');
    console.error(String(e.stderr || e.stdout || e).slice(0, 600));
    process.exit(1);
} finally {
    fs.rmSync(tmp, { recursive: true, force: true });
}
const size = fs.statSync(OUT).size;
console.log(`✅ بُني order-alarm.mp3 — ${(size / 1024).toFixed(1)} ك.ب · ${CYCLES} دورة × (رنّة + ${GAP_S} ث)`);
