const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabasePublishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl) {
  throw new Error('Missing required environment variable: EXPO_PUBLIC_SUPABASE_URL');
}

if (!supabasePublishableKey) {
  throw new Error('Missing required environment variable: EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
}

export const env = {
  supabaseUrl,
  supabasePublishableKey,
} as const;
