const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env' });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function fixTreeImage() {
    console.log("Fixing Washingtonia tree image...");
    const { data, error } = await supabase
        .from('deals')
        .update({ images: ['https://images.unsplash.com/photo-1444491741275-3747c53c99b4?w=800'] })
        .eq('id', '99');
    
    if (error) {
        console.error("Error updating image:", error);
    } else {
        console.log("✅ Successfully updated Washingtonia tree image in Supabase.");
    }
}

fixTreeImage();
