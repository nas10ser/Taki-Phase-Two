const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env' });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
async function test() {
    const { data, error } = await supabase.from('users').select('id, email').limit(1);
    console.log("Users table select result:", { data, error });
}
test();
