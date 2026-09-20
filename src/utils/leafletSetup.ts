/**
 * leafletSetup — تهيئةٌ واحدة لكل خرائط تاكي (v14.63)
 * ═══════════════════════════════════════════════════════════════════════════
 * يُستورد **بدل** `leaflet/dist/leaflet.css` في كل ملفٍ يرسم خريطة.
 *
 * ١) تنسيق ليفلت يُحزَّم داخل الموقع بدل جلبه من `unpkg.com` على كل صفحة.
 *    🔴 ولماذا هذا مهمّ لا تجميلاً: لو فشل ذلك الطلب الخارجي مرّة واحدة
 *    (شبكة جوال متقطّعة، حجب، شبكة فندق) فقدت كل الطبقات `position:absolute`
 *    و`overflow:hidden`، فتتدفّق البلاطات في مجرى المستند العادي: خريطةٌ
 *    ارتفاعها ٢٨٤ بكسل تصير ٩٣١ بكسل تفيض على بقيّة النموذج. وهذا بالضبط
 *    وصفُ ناصر: «الخريطة معلّقة، وفيه جزء مختفي». لا رسالة خطأ ولا أثر.
 *
 * ٢) 🪤 **وفخّ يقتل الدبّوس**: ليفلت يستنتج مسار صور الدبّوس من وسم
 *    `<link href$="leaflet.css">` أو من قاعدة `leaflet-default-icon-path`.
 *    وحين يُحزَّم التنسيق يصير اسم الصورة مبصوماً (`marker-icon.3f7d3721.png`)
 *    فيفشل النمط `^(.*)marker-icon\.png$`، ووسمُ الرابط غير موجود أصلاً ⇒
 *    المسار يصير فارغاً فتُطلب الصورة من مسار الصفحة (`/seller/marker-icon…`)
 *    فتعود ٤٠٤ و**يختفي الدبّوس من خريطة إضافة المنتج ومن كل دبابيس «حولي»**.
 *    الحلّ: نستورد الصور الثلاث صراحةً فيُبصمها Parcel ويعرفها ليفلت يقيناً.
 */
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

L.Icon.Default.mergeOptions({
    iconUrl: markerIcon,
    iconRetinaUrl: markerIcon2x,
    shadowUrl: markerShadow,
});

/**
 * بلاطات الخريطة — مصدرٌ واحد لكل الخرائط السبع (كانت مكرّرة حرفياً سبع مرّات).
 * Esri World Street Map هو المعتمد في المشروع: أسماء الشوارع السعودية فيه
 * أوضح، و`{z}/{y}/{x}` ترتيبُه هو الصحيح لهذه الخدمة (لا `{z}/{x}/{y}`).
 *
 * 🪤 و`detectRetina` أُزيلت عمداً: العنوان بلا `{r}`/`@2x`، فليفلت يعوّض
 * بمضاعفة درجة التكبير وتصغير البلاطة إلى النصف — أي **ضعف عدد الطلبات**
 * لنفس المساحة. على شبكة جوال بطيئة هذا وحده يُقرأ «الخريطة معلّقة».
 */
export const TAKI_TILE_URL =
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}';
/**
 * نصّ الإسناد كما تطلبه رخصة الخدمة. وكانت كل الخرائط تُعطّل شريط الإسناد
 * (`attributionControl={false}`) فلا يظهر إسنادٌ لأي مزوّد — أُعيد تشغيله.
 */
export const TAKI_TILE_ATTRIBUTION =
    '&copy; <a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a> — Esri, HERE, Garmin, USGS, NGA';
export const TAKI_TILE_MAX_ZOOM = 19;

export default L;
