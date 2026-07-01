// Supabase Configuration & Client Initialization
const SUPABASE_URL = 'https://mfzvjejvouqxojhjpiyb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1menZqZWp2b3VxeG9qaGpwaXliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4NzY2MTQsImV4cCI6MjA5ODQ1MjYxNH0.LDSEUuZh1wu-LjOt8iKRNYYBpiZW_ZWQTf_auHuezls';

let supabaseClient = null;

function getSupabase() {
  if (!supabaseClient) {
    if (typeof supabase === 'undefined') {
      console.error('Supabase library not loaded. Please make sure the Supabase CDN script is included.');
      return null;
    }
    supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return supabaseClient;
}

// Export for ES modules, fallback to global window object
const db = getSupabase();
window.supabaseClient = db;
export { db as supabase };
export default db;
