// ════════════════════════════════════════════════════════════════════════════
// eslint.config.mjs — قواعد **صحّة** لا تجميل (v14.79)
// ════════════════════════════════════════════════════════════════════════════
// 🪤 لماذا ليست «recommended»: قِيس على هذا المستودع فأخرجت الإعدادُ القياسيّ
//    **٩٢٩ ملاحظة** (٨٥٩ خطأ)، منها ٧٢١ من قاعدة `no-explicit-any` وحدها —
//    وهي تجميل. عددٌ كهذا يُدفن فيُتجاهَل، فيصير المدقّق زينةً لا حارساً.
//    القواعد هنا مختارةٌ واحدةً واحدة بمعيارٍ واحد: **هل أوقعت هذه القاعدة
//    عيباً حقيقياً في هذا المشروع من قبل؟**
//
// والدليل أن هذا ليس تنظيراً: أوّل تشغيلٍ لهذا الإعداد كشف عيباً **حيّاً في
// الإنتاج** — `DualCalendarPicker` ينادي ثلاثة خطّافات بعد `return null` مبكّر،
// والمكوّن مركَّبٌ دائماً في لوحة التاجر، فأوّل فتحٍ للتقويم كان يُسقط الشجرة.
// وهو الفخّ المكتوب نصّاً في CLAUDE.md منذ إصدارات، ولم يكن يحرسه شيء.
//
// 🪤 و`reportUnusedDisableDirectives` ليست تفصيلاً: في المستودع تعليقاتُ
//    `eslint-disable` تبدو حرّاساً وهي خاملة (تُسكت قاعدةً لا تُطلق هناك أصلاً).
//    تعليقٌ يكذب أسوأ من لا تعليق.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
    {
        ignores: [
            'dist/**', 'node_modules/**', '.parcel-cache/**',
            'models/**', 'server/node_modules/**',
        ],
    },
    {
        files: ['src/**/*.{ts,tsx}'],
        extends: [js.configs.recommended],
        linterOptions: {
            // تعليقُ تعطيلٍ لا يُعطّل شيئاً = ادّعاءُ حراسةٍ كاذب.
            reportUnusedDisableDirectives: 'error',
        },
        languageOptions: {
            parser: tseslint.parser,
            parserOptions: { ecmaFeatures: { jsx: true } },
            globals: {
                window: 'readonly', document: 'readonly', navigator: 'readonly',
                localStorage: 'readonly', sessionStorage: 'readonly',
                fetch: 'readonly', console: 'readonly', setTimeout: 'readonly',
                clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
                requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly',
                URL: 'readonly', URLSearchParams: 'readonly', Blob: 'readonly',
                File: 'readonly', FileReader: 'readonly', FormData: 'readonly',
                Image: 'readonly', atob: 'readonly', btoa: 'readonly',
                AbortController: 'readonly', Intl: 'readonly', crypto: 'readonly',
                HTMLElement: 'readonly', HTMLInputElement: 'readonly',
                HTMLDivElement: 'readonly', HTMLCanvasElement: 'readonly',
                HTMLImageElement: 'readonly', HTMLTextAreaElement: 'readonly',
                HTMLSelectElement: 'readonly', HTMLAudioElement: 'readonly',
                HTMLVideoElement: 'readonly', HTMLAnchorElement: 'readonly',
                HTMLButtonElement: 'readonly', HTMLFormElement: 'readonly',
                Event: 'readonly', CustomEvent: 'readonly', KeyboardEvent: 'readonly',
                MouseEvent: 'readonly', TouchEvent: 'readonly', PointerEvent: 'readonly',
                MutationObserver: 'readonly', IntersectionObserver: 'readonly',
                ResizeObserver: 'readonly', MediaQueryList: 'readonly',
                ServiceWorkerRegistration: 'readonly', Notification: 'readonly',
                performance: 'readonly', location: 'readonly', history: 'readonly',
                alert: 'readonly', confirm: 'readonly', prompt: 'readonly',
                structuredClone: 'readonly', queueMicrotask: 'readonly',
                TextEncoder: 'readonly', TextDecoder: 'readonly',
                Uint8Array: 'readonly', ArrayBuffer: 'readonly',
                process: 'readonly', RequestInit: 'readonly', ScrollBehavior: 'readonly',
                GeolocationPosition: 'readonly', GeolocationPositionError: 'readonly',
                PositionOptions: 'readonly', MediaStream: 'readonly',
                CanvasRenderingContext2D: 'readonly', DOMRect: 'readonly',
                NodeListOf: 'readonly', Element: 'readonly', Node: 'readonly',
                WebSocket: 'readonly', Worker: 'readonly', caches: 'readonly',
                PushSubscription: 'readonly', ServiceWorker: 'readonly',
                ShareData: 'readonly', BeforeUnloadEvent: 'readonly',
            },
        },
        plugins: { 'react-hooks': reactHooks, '@typescript-eslint': tseslint.plugin },
        rules: {
            // ── ما أوقع عيباً حقيقياً هنا ────────────────────────────────────
            // 🔴 خطّافٌ بعد `return` مبكّر — أسقط الشجرة فعلاً (v14.29 · v14.79).
            'react-hooks/rules-of-hooks': 'error',

            // ── أخطاء منطقية صامتة ───────────────────────────────────────────
            'no-unsafe-optional-chaining': 'error',
            'no-self-compare': 'error',
            'no-self-assign': 'error',
            'no-dupe-keys': 'error',
            'no-dupe-else-if': 'error',
            'no-duplicate-case': 'error',
            'no-unreachable': 'error',
            'no-constant-binary-expression': 'error',
            'no-async-promise-executor': 'error',
            'no-compare-neg-zero': 'error',
            'no-sparse-arrays': 'error',
            'no-template-curly-in-string': 'error',
            'use-isnan': 'error',
            'valid-typeof': 'error',
            'no-fallthrough': 'error',
            'no-cond-assign': ['error', 'always'],
            'array-callback-return': 'error',
            'no-loss-of-precision': 'error',

            // ── قواعدُ جُرّبت فأُسقطت، والسبب مكتوب ──────────────────────────
            // 🪤 `require-atomic-updates`: ٤١ ملاحظة، **كلّها إيجابياتٌ كاذبة** —
            //    `data.vatAmount = …` بعد `await` داخل دالّةٍ متسلسلة بلا تزامن،
            //    و`ref.current = …` وهو نمط الحراسة المعتاد في React.
            // 🪤 `no-promise-executor-return`: ٢٠ ملاحظة، كلّها
            //    `new Promise(r => setTimeout(r, 500))` — السهم يُعيد معرّف
            //    المؤقّت ضمناً، وهو اصطلاحٌ سليم لا عيب.
            // قاعدةٌ تصرخ كذباً تُعلّم تجاهلَ الصراخ، فسقوطها أنفع من بقائها.

            // ── ما يُخفي عيباً بدل أن يكشفه ─────────────────────────────────
            // `catch {}` صامت: قاعدة المشروع أن كل خطأ يُقال أو يُسجَّل.
            'no-empty': ['error', { allowEmptyCatch: true }],

            // ── مؤجَّلة عمداً (تحذير لا خطأ) ─────────────────────────────────
            // ٩١ رابطاً بلا استعمال اليوم؛ رفعُها خطأً يكسر البناء فوراً.
            // تُنظَّف على دفعات ثم تُرفع.
            '@typescript-eslint/no-unused-vars': ['warn', {
                argsIgnorePattern: '^_', varsIgnorePattern: '^_',
                caughtErrors: 'none', ignoreRestSiblings: true,
            }],
            'react-hooks/exhaustive-deps': 'warn',

            // ── مُطفأة: يحكمها TypeScript نفسه أو لا تناسب هذا المستودع ──────
            'no-undef': 'off',          // tsc يفعلها بدقّة أعلى مع الأنواع
            'no-unused-vars': 'off',    // النسخة المعتمدة هي نسخة typescript-eslint
            'no-control-regex': 'off',  // مستعملة عمداً في تنقية النصّ العربي
            'no-useless-escape': 'off',
        },
    },
    {
        // سكربتات البناء والفحص: Node لا متصفّح.
        files: ['scripts/**/*.js', 'api/**/*.js', 'shared/**/*.js'],
        extends: [js.configs.recommended],
        languageOptions: {
            sourceType: 'commonjs',
            globals: {
                require: 'readonly', module: 'writable', process: 'readonly',
                console: 'readonly', __dirname: 'readonly', Buffer: 'readonly',
                URL: 'readonly', fetch: 'readonly', setTimeout: 'readonly',
                clearTimeout: 'readonly', AbortController: 'readonly',
                TextEncoder: 'readonly', TextDecoder: 'readonly', atob: 'readonly',
                btoa: 'readonly', __filename: 'readonly', Uint8Array: 'readonly',
            },
        },
        rules: {
            'no-empty': ['error', { allowEmptyCatch: true }],
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
            'no-control-regex': 'off',
            'no-useless-escape': 'off',
        },
    },
);
