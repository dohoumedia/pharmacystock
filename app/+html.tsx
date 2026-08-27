import type { PropsWithChildren } from 'react';
import { ScrollViewStyleReset } from 'expo-router/html';

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="fr">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <meta name="theme-color" content="#102A5C" />
        <meta name="application-name" content="DohouLabs Pharmacy Stock" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="icon" href="/icons/pharmacy-stock-192.png" type="image/png" sizes="192x192" />
        <link rel="apple-touch-icon" href="/icons/pharmacy-stock-180.png" sizes="180x180" />
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
