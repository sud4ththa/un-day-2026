import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const configError = !url || !anonKey
  ? 'This portal is not connected to Supabase yet. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then reload.'
  : ''

export const supabase = configError
  ? null
  : createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    })
