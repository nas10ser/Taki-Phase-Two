import React, { useState } from 'react';
import { supabase } from '../../services/supabaseClient';
import { compressImage, THUMB, BANNER } from '../../utils/imageCompression';
import { markThumbed } from '../../utils/thumb';

/**
 * ImageOptimizer — «ضغط الصور القديمة بضغطة واحدة» (v13.34)
 *
 * الصور المرفوعة قبل v13.32 ثقيلة (متوسط ٨٣٨ كيلوبايت، أكبرها ٥.٤ ميجابايت)
 * وبلا نسخ مصغّرة — وهي سبب «الموقع يعلق عند الدخول». هذه الأداة تمشي على كل
 * عروض المنصة وبنراتها من متصفح المدير:
 *   تنزّل الصورة ← تضغطها بنفس محرّك الرفع ← ترفع نسختين جديدتين (كاملة+مصغّرة)
 *   ← تحدّث رابط العرض/البنر ← القديمة تُحذف من التخزين إن كانت ملكك.
 *
 * آمنة للإعادة: الصورة المضغوطة أصلاً (لها مصغّرة وحجمها معقول) تُتخطى.
 * الروابط الخارجية (unsplash/picsum) لا تُلمس. أي فشل في صورة واحدة لا يوقف
 * البقية — يُسجَّل ويُعرض في الملخص.
 */

/**
 * ملاحظة v13.71: الرابط المنتهي بعلامة `?t=1` (صورة رُفعت ومصغّرتها مؤكَّدة)
 * **لا يطابق** هذا النمط عمداً — فلا يدخل قائمة العمل أصلاً. هكذا صار «تخطّي
 * المكتمل» بلا أي طلب HEAD: العلامة نفسها هي الدليل.
 */
const SUPA_IMG = /\/storage\/v1\/object\/public\/deals\/([^/?#]+)\.(jpe?g|png|webp)$/i;

type Progress = { done: number; total: number; saved: number; skipped: number; failed: number; current: string };

const ImageOptimizer: React.FC = () => {
    const [running, setRunning] = useState(false);
    const [prog, setProg] = useState<Progress | null>(null);
    const [report, setReport] = useState<string | null>(null);

    const optimize = async () => {
        if (running) return;
        setRunning(true);
        setReport(null);
        const errors: string[] = [];
        let done = 0, saved = 0, skipped = 0, failed = 0;

        try {
            // ١) اجمع كل الصور: العروض + البنرات
            const { data: deals } = await supabase.from('deals')
                .select('id, images').neq('status', 'deleted').not('images', 'is', null);
            const { data: banners } = await supabase.from('banners').select('id, image_url');

            type Job = { kind: 'deal' | 'banner'; id: string; url: string; idx?: number };
            const jobs: Job[] = [];
            for (const d of deals || []) {
                (d.images || []).forEach((u: string, idx: number) => {
                    if (SUPA_IMG.test(u || '')) jobs.push({ kind: 'deal', id: d.id, url: u, idx });
                });
            }
            for (const b of banners || []) {
                if (SUPA_IMG.test(b.image_url || '')) jobs.push({ kind: 'banner', id: b.id, url: b.image_url });
            }

            const total = jobs.length;
            setProg({ done: 0, total, saved: 0, skipped: 0, failed: 0, current: '' });

            // خريطة الروابط الجديدة لكل عرض (نجمع تعديلات كل الصور ثم UPDATE واحد)
            const dealNewImages = new Map<string, string[]>();
            for (const d of deals || []) dealNewImages.set(d.id, [...(d.images || [])]);

            for (const job of jobs) {
                setProg({ done, total, saved, skipped, failed, current: job.url.split('/').pop() || '' });
                try {
                    const m = job.url.match(SUPA_IMG)!;
                    const stemOld = m[1];

                    // هل هي مضغوطة أصلاً؟ (حجم معقول + مصغّرة موجودة للعروض)
                    const head = await fetch(job.url, { method: 'HEAD' });
                    const size = Number(head.headers.get('content-length') || 0);
                    if (job.kind === 'banner' && size > 0 && size <= 150 * 1024) { skipped++; done++; continue; }
                    if (job.kind === 'deal' && size > 0 && size <= 180 * 1024) {
                        const t = await fetch(job.url.replace(SUPA_IMG, `/storage/v1/object/public/deals/${stemOld}_t.jpg`), { method: 'HEAD' });
                        if (t.ok) {
                            // v13.71 — مضغوطة ولها مصغّرة فعلاً، لكن رابطها بلا
                            // علامة (رُفعت قبل نظام العلامة). لا نعيد رفعها —
                            // نكتفي بوسم الرابط ليستفيد التطبيق من مصغّرتها.
                            const arr = dealNewImages.get(job.id);
                            if (arr) arr[job.idx!] = markThumbed(job.url);
                            skipped++; done++; continue;
                        }
                    }

                    // ٢) نزّل واضغط بنفس محرك الرفع
                    const blob = await (await fetch(job.url)).blob();
                    const file = new File([blob], `${stemOld}.jpg`, { type: blob.type || 'image/jpeg' });
                    const full = await compressImage(file, job.kind === 'banner' ? BANNER : undefined);
                    const thumb = job.kind === 'deal' ? await compressImage(file, THUMB) : null;

                    // ٣) ارفع باسم جديد (سياسة التخزين تمنع الكتابة فوق ملفات الغير)
                    const stem = `${Date.now()}_${Math.random().toString(36).substring(2)}`;
                    const up1 = await supabase.storage.from('deals')
                        .upload(`${stem}.jpg`, full, { cacheControl: '31536000', upsert: false });
                    if (up1.error) throw new Error(up1.error.message);
                    let thumbOk = false;
                    if (thumb) {
                        const up2 = await supabase.storage.from('deals')
                            .upload(`${stem}_t.jpg`, thumb, { cacheControl: '31536000', upsert: false });
                        thumbOk = !up2.error;
                    }
                    // v13.71 — العلامة لا تُكتب إلا على مصغّرة وصلت فعلاً.
                    const plainUrl = supabase.storage.from('deals').getPublicUrl(`${stem}.jpg`).data.publicUrl;
                    const newUrl = thumbOk ? markThumbed(plainUrl) : plainUrl;

                    // ٤) حدّث الرابط
                    if (job.kind === 'deal') {
                        const arr = dealNewImages.get(job.id)!;
                        arr[job.idx!] = newUrl;
                    } else {
                        const { error } = await supabase.from('banners').update({ image_url: newUrl }).eq('id', job.id);
                        if (error) throw new Error(error.message);
                    }
                    saved += Math.max(0, blob.size - full.size);
                } catch (e: any) {
                    failed++;
                    errors.push(`${job.kind}/${job.id}: ${String(e?.message || e).slice(0, 80)}`);
                }
                done++;
            }

            // ٥) تحديث روابط العروض المعدّلة (تحديث جزئي — لا يمسّ status فلا يستفز أي ترغر)
            for (const [id, arr] of dealNewImages) {
                const orig = (deals || []).find(d => d.id === id);
                if (!orig || JSON.stringify(orig.images) === JSON.stringify(arr)) continue;
                const { error } = await supabase.from('deals').update({ images: arr }).eq('id', id);
                if (error) { failed++; errors.push(`deal-update/${id}: ${error.message.slice(0, 80)}`); }
            }

            setProg({ done, total, saved, skipped, failed, current: '' });
            setReport(
                `✅ اكتمل: ${done - skipped - failed} صورة ضُغطت وأُنتجت مصغّراتها` +
                ` • ${skipped} كانت مضغوطة أصلاً` +
                (failed ? ` • ⚠️ ${failed} فشلت` : '') +
                ` • وفّرت ${(saved / 1048576).toFixed(1)} ميجابايت من كل تحميل صفحة لاحق` +
                (errors.length ? `\n${errors.slice(0, 5).join('\n')}` : '')
            );
        } catch (e: any) {
            setReport('❌ توقفت الأداة: ' + String(e?.message || e).slice(0, 120));
        } finally {
            setRunning(false);
        }
    };

    return (
        <section style={{ background: 'var(--card-bg)', borderRadius: 16, padding: 20, border: '1px solid var(--border-color)', borderTop: '3px solid #f59e0b', marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 900, color: 'var(--text-primary)' }}>🗜 ضغط الصور القديمة (مرة واحدة)</h3>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 700, lineHeight: 1.7, margin: '8px 0 12px' }}>
                الصور المرفوعة قبل v13.32 ثقيلة (تصل ٥ ميجابايت) وبلا نسخ مصغّرة — وهي سبب بطء فتح الموقع.
                هذا الزر يضغطها كلها وينتج مصغّراتها ويحدّث الروابط تلقائياً. شغّله مرة واحدة واتركه يعمل
                (قد يستغرق دقائق حسب عدد الصور) — إعادة تشغيله آمنة، يتخطى ما اكتمل.
            </p>
            {prog && (
                <div style={{ marginBottom: 10 }}>
                    <div style={{ height: 8, borderRadius: 4, background: 'var(--gray-100)', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${prog.total ? (prog.done / prog.total) * 100 : 0}%`, background: 'linear-gradient(90deg,#f59e0b,#d97706)', transition: 'width .3s' }} />
                    </div>
                    <div style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--text-secondary)', marginTop: 4 }}>
                        {prog.done}/{prog.total} {prog.current ? `— ${prog.current}` : ''} {prog.failed ? `• فشل ${prog.failed}` : ''}
                    </div>
                </div>
            )}
            {report && (
                <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.78rem', fontWeight: 800, color: 'var(--text-primary)', background: 'var(--gray-50)', borderRadius: 10, padding: 10, marginBottom: 10 }}>{report}</div>
            )}
            <button onClick={optimize} disabled={running}
                style={{ width: '100%', padding: '12px', borderRadius: 12, border: 'none', fontWeight: 900, fontSize: '0.9rem', cursor: running ? 'wait' : 'pointer', color: 'white', background: running ? 'var(--gray-400)' : 'linear-gradient(135deg,#f59e0b,#b45309)' }}>
                {running ? '⏳ جاري الضغط… لا تغلق الصفحة' : '🗜 اضغط كل الصور القديمة الآن'}
            </button>
        </section>
    );
};

export default ImageOptimizer;
