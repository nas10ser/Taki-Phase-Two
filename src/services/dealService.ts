import { Rating } from '../data/mock';

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

        const normalizeArabic = (str: string) => {
            return str
                .replace(/[أإآا]/g, 'ا')
                .replace(/[يى]/g, 'ي')
                .replace(/[ةه]/g, 'ه')
                .replace(/ـ/g, '')
                .replace(/[ًٌٍَُِّْ]/g, ''); // Diacritics
        };

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
            'تاكي': ['taki', 'تكي', 'application', 'site', 'موقع', 'تطبيق'],
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
    }
};
