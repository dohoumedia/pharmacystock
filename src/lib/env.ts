function requirePublicEnv(name: 'EXPO_PUBLIC_SUPABASE_URL' | 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY') {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  supabaseUrl: requirePublicEnv('EXPO_PUBLIC_SUPABASE_URL'),
  supabasePublishableKey: requirePublicEnv('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
} as const;
