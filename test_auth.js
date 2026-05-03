require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function test() {
    console.log('Testing connection to Supabase...');
    const { data: users, error } = await supabase.from('users').select('*').limit(2);
    console.log('Users Data:', users);
    console.log('Users Error:', error);
}
test();
