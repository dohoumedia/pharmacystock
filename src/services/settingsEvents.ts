// Invalidation only. Settings values stay in their existing server tables/read-model cache.
const listeners = new Set<(organizationId: string) => void>();
export function settingsChanged(organizationId: string) { for (const listener of listeners) listener(organizationId); }
export function observeSettings(listener: (organizationId: string) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
