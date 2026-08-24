import { describe, expect, it } from 'vitest';
import en from './sprint8.en.json';
import fr from './sprint8.fr.json';

describe('transfer localization', () => {
  it('localizes transfer quantities and receipt validation in English and French', () => {
    const keys = ['requestedQuantity', 'dispatchedQuantity', 'receivedQuantity', 'invalidReceivedQuantity'] as const;

    for (const key of keys) {
      expect(en.sprint8.transfers[key]).toBeTruthy();
      expect(fr.sprint8.transfers[key]).toBeTruthy();
      expect(fr.sprint8.transfers[key]).not.toBe(en.sprint8.transfers[key]);
    }
  });
});
