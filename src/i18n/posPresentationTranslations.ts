export const posPresentationTranslations = {
  en: { pos: {
    noTrustedOfflinePrice: 'No synchronized quote for this cart. Go online before selling it offline.',
    noOfflineStockSnapshot: 'No synchronized stock snapshot. Reconnect before selling offline.',
    offlineStockAvailable: 'Offline available stock: {{count}}',
    offlineQuantityExceeded: 'Quantity exceeds offline available stock ({{count}}).',
    offlineQuoteRequired: 'This sale cannot be queued offline without a synchronized quote.',
    saleSavedPending: 'Sale {{saleNumber}} saved · Pending sync',
    offlineSalesSynchronized: '{{count}} offline sale(s) synchronized.',
    offlineSalesConflict: '{{count}} sale(s) need conflict resolution.',
    offlinePriceQuote: 'Price based on the last server quote synchronized at {{timestamp}}. The server will revalidate the sale.',
  } },
  fr: { pos: {
    noTrustedOfflinePrice: 'Aucun devis synchronisé pour ce panier. Connectez-vous avant de vendre hors ligne.',
    noOfflineStockSnapshot: 'Aucun instantané de stock synchronisé. Reconnectez-vous avant de vendre hors ligne.',
    offlineStockAvailable: 'Stock hors ligne disponible : {{count}}',
    offlineQuantityExceeded: 'Quantité supérieure au stock hors ligne disponible ({{count}}).',
    offlineQuoteRequired: 'Cette vente ne peut pas être mise en attente hors ligne sans devis synchronisé.',
    saleSavedPending: 'Vente {{saleNumber}} enregistrée · Synchronisation en attente',
    offlineSalesSynchronized: '{{count}} vente(s) hors ligne synchronisée(s).',
    offlineSalesConflict: '{{count}} vente(s) nécessitent une résolution de conflit.',
    offlinePriceQuote: 'Prix basé sur le dernier devis serveur synchronisé à {{timestamp}}. Le serveur revalidera la vente.',
  } },
} as const;
