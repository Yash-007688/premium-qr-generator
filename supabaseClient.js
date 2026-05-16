// Supabase Configuration
const supabaseUrl = 'https://viqqmphewqrwmvyosfep.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZpcXFtcGhld3Fyd212eW9zZmVwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5MDk0MTIsImV4cCI6MjA5NDQ4NTQxMn0.F6mPKM88MRBsze8NRkPz2Xi4neB-OlSMOkEhHEqj6dc';

// Initialize the Supabase client (requires the Supabase JS CDN to be loaded first)
const supabase = window.supabase.createClient(supabaseUrl, supabaseAnonKey);
