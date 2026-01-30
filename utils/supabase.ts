import { createClient } from '@supabase/supabase-js';

// Hier halen we de gegevens veilig op uit je .env bestand
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Supabase omgevingsvariabelen ontbreken!");
}

export const supabase = createClient(supabaseUrl, supabaseKey);