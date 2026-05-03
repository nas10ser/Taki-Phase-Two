
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

// Load env
dotenv.config({ path: path.join(__dirname, '.env') });

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.REACT_APP_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing Supabase config');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testInsert() {
    const testId = 'test_' + Date.now();
    console.log('🚀 Testing insert with ID:', testId);
    
    // 1. Check if we can select from deals
    const { data: deals, error: fetchError } = await supabase.from('deals').select('*').limit(1);
    if (fetchError) {
        console.error('❌ Fetch error:', fetchError);
    } else {
        console.log('✅ Fetch successful, found:', deals.length, 'deals');
    }

    // 2. Try insert
    const testDeal = {
        id: testId,
        store_id: 'manual', // In schema, this references users(id). If 'manual' isn't there, it might fail.
        shop_name: 'Test Shop',
        item_name: 'Test Item',
        category: 'Food',
        original_price: 100,
        discounted_price: 50,
        created_at: Date.now()
    };

    const { error: insertError } = await supabase.from('deals').insert(testDeal);
    if (insertError) {
        console.error('❌ Insert error:', insertError);
    } else {
        console.log('✅ Insert successful!');
    }

    // 3. Cleanup
    await supabase.from('deals').delete().eq('id', testId);
}

testInsert();
