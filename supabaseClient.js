// Supabase Configuration
const supabaseUrl = 'https://viqqmphewqrwmvyosfep.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZpcXFtcGhld3Fyd212eW9zZmVwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5MDk0MTIsImV4cCI6MjA5NDQ4NTQxMn0.F6mPKM88MRBsze8NRkPz2Xi4neB-OlSMOkEhHEqj6dc';

// The local supabase.js UMD build exposes a global `supabase` variable (NOT window.supabase).
// We pick it up here and create the client.
const { createClient } = supabase;
const supabaseClient = createClient(supabaseUrl, supabaseAnonKey);
