// Shared by the static HTML document and the first web React render.
// Browser/device preferences are applied only after hydration.
const configuredLocale = process.env.EXPO_PUBLIC_DEFAULT_LOCALE;
export const webInitialLocale = configuredLocale === 'fr' ? 'fr' : 'en';
