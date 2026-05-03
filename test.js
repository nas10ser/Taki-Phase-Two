const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/Users/nasser/Desktop/TAKI/.env' });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
async function test() {
  const { data, error } = await supabase.from('bookings').select('*').limit(1);
  console.log('Bookings columns:', Object.keys(data[0] || {}));
  console.log('Error:', error);
}
test();
