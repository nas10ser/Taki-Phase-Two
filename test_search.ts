import { dealService } from './src/services/dealService';

const tests = [
    { query: 'خيال', text: 'برجر خيال اكل' },
    { query: 'مكتبة', text: 'دفتر جرير مكتبات' },
    { query: 'مكتبة جرير', text: 'دفتر جرير مكتبة جرير' },
    { query: 'خييال', text: 'برجر مطعم خيال' },
];

tests.forEach(t => {
    console.log(`Query: ${t.query} | Text: ${t.text} =>`, dealService.advancedSearchMatch(t.query, t.text));
});
