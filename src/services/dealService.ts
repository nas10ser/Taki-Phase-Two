import { Rating } from '../data/mock';

/**
 * Canonical text normalizer shared by every search surface (Home, DealsList,
 * Nearby, store search). Keeping ONE implementation guarantees the query a
 * shopper types is matched identically everywhere.
 *
 * - lowercases (Latin) and trims
 * - folds Arabic alef/yaa/taa-marbuta variants so إ/أ/آ/ا, ي/ى, ة/ه collide
 * - strips tashkeel (diacritics) and tatweel (ـ)
 * - maps Arabic-Indic ٠-٩ and Persian ۰-۹ digits to ASCII 0-9 (so "ن١٥"
 *   and "n15" both reach the store "N15")
 * - removes zero-width / bidi control chars that sneak in from RTL keyboards
 * - turns punctuation into spaces and collapses runs of whitespace
 */
export const normalizeText = (input: string): string => {
    if (!input) return '';
    const arabicIndic = '٠١٢٣٤٥٦٧٨٩';
    const persian = '۰۱۲۳۴۵۶۷۸۹';
    return input
        .toLowerCase()
        .replace(/[٠-٩]/g, d => String(arabicIndic.indexOf(d)))
        .replace(/[۰-۹]/g, d => String(persian.indexOf(d)))
        .replace(/[أإآٱا]/g, 'ا')
        .replace(/[يىئ]/g, 'ي')
        .replace(/[ةه]/g, 'ه')
        .replace(/ؤ/g, 'و')
        .replace(/ـ/g, '')
        .replace(/[ًٌٍَُِّْٰ]/g, '')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
};

/**
 * Relevance score for ranking (higher = better). Used to sort results so the
 * closest match — e.g. an exact store name — always floats to the top instead
 * of being buried behind a loose fuzzy hit. 0 means "no match at all".
 */
const computeScore = (query: string, text: string): number => {
    const q = normalizeText(query);
    const t = normalizeText(text);
    if (!q) return 0;
    if (!t) return 0;
    if (t === q) return 1000;
    const words = t.split(' ');
    if (t.startsWith(q)) return 880;
    if (words.some(w => w === q)) return 820;
    if (words.some(w => w.startsWith(q))) return 720;
    if (t.includes(q)) return 560;
    if (words.some(w => q.startsWith(w) && w.length >= 3)) return 460;
    return dealService.advancedSearchMatch(query, text) ? 300 : 0;
};

export const dealService = {
    /**
     * Calculates the average rating from an array of reviews.
     * @param ratings Array of Rating objects
     * @returns Object containing average score (0-5) and total count
     */
    calculateRating: (ratings: Rating[] = []) => {
        if (!ratings || ratings.length === 0) {
            return { average: 0, count: 0 };
        }
        const total = ratings.reduce((sum, r) => sum + r.score, 0);
        const average = parseFloat((total / ratings.length).toFixed(1));
        return { average, count: ratings.length };
    },

    /**
     * Truncates a comment to a maximum length.
     * @param comment The review text
     * @param maxLength Maximum characters allowed
     */
    truncateComment: (comment: string, maxLength: number = 200) => {
        if (comment.length <= maxLength) return comment;
        return comment.substring(0, maxLength) + '...';
    },

    /**
     * Powerful Google-like search matcher checking English & Arabic synonyms and typoes (Arabizi).
     */
    advancedSearchMatch: (query: string, textToSearch: string) => {
        if (!query || !query.trim()) return true;
        
        const EN_TO_AR_KEYBOARD: Record<string, string> = {
            'q': 'ض', 'w': 'ص', 'e': 'ث', 'r': 'ق', 't': 'ف', 'y': 'غ', 'u': 'ع', 'i': 'ه', 'o': 'خ', 'p': 'ح', '[': 'ج', ']': 'د',
            'a': 'ش', 's': 'س', 'd': 'ي', 'f': 'ب', 'g': 'ل', 'h': 'ا', 'j': 'ت', 'k': 'ن', 'l': 'م', ';': 'ك', '\'': 'ط',
            'z': 'ئ', 'x': 'ء', 'c': 'ؤ', 'v': 'ر', 'b': 'لا', 'n': 'ى', 'm': 'ة', ',': 'و', '.': 'ز', '/': 'ظ', '`': 'ذ'
        };

        const mapArabizi = (str: string) => str.split('').map(char => EN_TO_AR_KEYBOARD[char.toLowerCase()] || char).join('');

        const normalizeArabic = (str: string) => normalizeText(str);

        const stemArabic = (str: string) => {
            let s = normalizeArabic(str);
            if (s.length > 4) {
                if (s.endsWith('ات')) return s.slice(0, -2);
                if (s.endsWith('ون')) return s.slice(0, -2);
                if (s.endsWith('ين')) return s.slice(0, -2);
                if (s.endsWith('ان')) return s.slice(0, -2);
            }
            return s;
        };

        const levenshteinDistance = (a: string, b: string) => {
            if (a.length === 0) return b.length;
            if (b.length === 0) return a.length;
            const matrix = Array(a.length + 1).fill(null).map(() => Array(b.length + 1).fill(null));
            for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
            for (let j = 0; j <= b.length; j++) matrix[0][j] = j;
            for (let i = 1; i <= a.length; i++) {
                for (let j = 1; j <= b.length; j++) {
                    const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
                    matrix[i][j] = Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1, matrix[i - 1][j - 1] + indicator);
                }
            }
            return matrix[a.length][b.length];
        };

        const q = query.toLowerCase().trim();
        const text = textToSearch.toLowerCase();
        const mappedQ = mapArabizi(q);
        
        const normQ = normalizeArabic(q);
        const normMappedQ = normalizeArabic(mappedQ);
        const normText = normalizeArabic(text);

        if (normText.includes(normQ) || normText.includes(normMappedQ)) return true;

        const synonyms: Record<string, string[]> = {
            'تيشيرت': ['tshirt', 't-shirt', 'قميص', 'فنيله', 'فنيلا', 'تي شيرت', 'shirt', 'بلوزة', 'polo'],
            'جزم': ['أحذية', 'جزمة', 'حذاء', 'shoes', 'sneakers', 'بوط', 'كندرة', 'شوز', 'سنيكرز'],
            'عطر': ['عطور', 'perfume', 'fragrance', 'cologne', 'عود', 'مسك', 'parfum'],
            'بنطلون': ['بناطيل', 'سروال', 'pants', 'trousers', 'jeans', 'جينز', 'شورت'],
            'فستان': ['فساتين', 'dress', 'dresses', 'ثوب', 'تنورة'],
            'شماغ': ['غترة', 'shemagh', 'ghutra', 'عقال'],
            'ساعه': ['ساعات', 'ساعة', 'watch', 'watches', 'smartwatch'],
            'مكياج': ['ميك اب', 'makeup', 'make up', 'cosmetics', 'روج', 'مسكرة'],
            'كريم': ['مرطب', 'لوشن', 'cream', 'lotion', 'moisturizer', 'عناية'],
            'نظاره': ['نضارة', 'نظارات', 'glasses', 'sunglasses', 'عدسات'],
            'شنطه': ['حقيبه', 'شنطة', 'حقيبة', 'bag', 'purse', 'backpack', 'شنط', 'محفظة'],
            'قهوه': ['قهوة', 'كوفي', 'coffee', 'cafe', 'اسبريسو', 'لاتيه', 'كابتشينو'],
            'مطعم': ['مطاعم', 'اكل', 'أكل', 'food', 'restaurant', 'وجبة', 'غداء', 'عشاء'],
            'جوال': ['تليفون', 'موبايل', 'هاتف', 'mobile', 'phone', 'smartphone', 'ايفون', 'سامسونج'],
        };

        const words = normQ.split(/\s+/);
        const mappedWords = normMappedQ.split(/\s+/);
        const textWords = normText.split(/\s+/);
        
        return words.every((word, idx) => {
            const mWord = mappedWords[idx];
            
            // Fuzzy match helper
            const fuzzyMatch = (w: string) => {
                if (!w) return false;
                
                // STRICTURE RULE: For 1-2 character queries, don't allow fuzzy or mid-word matching.
                // It must be the START of a word in the text.
                if (w.length <= 2) {
                    return textWords.some(tw => tw.startsWith(w));
                }

                if (normText.includes(w)) return true;
                const stemmedW = stemArabic(w);
                for (const tWord of textWords) {
                    if (tWord.includes(w) || w.includes(tWord)) return true;
                    if (tWord.includes(stemmedW) || stemmedW.includes(tWord)) return true;
                    if (stemArabic(tWord) === stemmedW) return true;
                    // Max distance is 1 for short words, 2 for long words
                    const maxDist = w.length <= 4 ? 1 : 2;
                    if (levenshteinDistance(w, tWord) <= maxDist) return true;
                }
                return false;
            };

            if (fuzzyMatch(word) || fuzzyMatch(mWord)) return true;
            
            // Check synonyms
            for (const key of Object.keys(synonyms)) {
                const normKey = normalizeArabic(key);
                
                // For synonyms, also require 3+ chars or start-of-word match with the key
                const isKeyMatch = word.length > 2 
                    ? (normKey.includes(word) || word.includes(normKey) || normKey.includes(mWord) || mWord.includes(normKey))
                    : (normKey.startsWith(word) || normKey.startsWith(mWord));

                if (isKeyMatch) {
                    // And check if the text contains any of the actual synonym values
                    if (synonyms[key].some(syn => {
                        const nSyn = normalizeArabic(syn);
                        return nSyn.length > 2 ? normText.includes(nSyn) : textWords.some(tw => tw.startsWith(nSyn));
                    })) return true;
                }
            }
            return false;
        });
    },

    /**
     * Numeric relevance of `text` for `query` (0 = no match, bigger = closer).
     * Pages use this to ORDER results so the strongest hit is always first.
     */
    searchScore: (query: string, text: string): number => computeScore(query, text),

    /**
     * Single source of truth for "find a store by name" used by Home,
     * DealsList and Nearby. Scores each store across shop name, owner name,
     * bio and address (name fields weighted heaviest), drops zero-score
     * stores, and returns them ranked best-first.
     *
     * `stores` is the AppContext storeProfiles map (id -> profile); each
     * returned object keeps its `id` so callers can route to /store/:id.
     */
    matchStores: (query: string, stores: Record<string, any>, limit = 20): any[] => {
        const q = normalizeText(query);
        if (!q) return [];
        const scored: { store: any; score: number }[] = [];
        for (const id of Object.keys(stores)) {
            const s = stores[id] || {};
            const shop = s.shop || '';
            const name = s.name || '';
            const bio = s.bio || '';
            const address = s.address || '';
            // Name fields are what a shopper actually types — weight them far
            // above bio/address so "N15" beats a store that merely mentions
            // "n15" somewhere in its description.
            const score = Math.max(
                computeScore(query, shop) * 1.0,
                computeScore(query, name) * 0.95,
                computeScore(query, bio) * 0.4,
                computeScore(query, address) * 0.35,
            );
            if (score > 0) scored.push({ store: { ...s, id: s.id || id }, score });
        }
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, limit).map(x => x.store);
    },
};
