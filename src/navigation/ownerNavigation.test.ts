import { describe, expect, it } from 'vitest';
import { mobileItems, visibleNavigation } from './items';
describe('owner navigation completeness', () => {
  it('exposes Staff, Branches, Suppliers, Products and Purchasing in ordinary navigation', () => {
    const hrefs = visibleNavigation(() => true).map((item) => item.href);
    expect(hrefs).toEqual(expect.arrayContaining(['/staff', '/branches', '/suppliers', '/products', '/purchasing']));
  });
  it('provides a phone More destination containing Purchasing and administration', () => {
    expect(visibleNavigation(() => true, mobileItems).map((item) => item.href)).toContain('/more');
    expect(visibleNavigation(() => true).filter((item) => ['/staff', '/branches', '/purchasing'].includes(item.href))).toHaveLength(3);
  });
  it('continues filtering navigation by existing capabilities', () => {
    const hrefs = visibleNavigation(() => false).map((item) => item.href);
    expect(hrefs).not.toContain('/staff'); expect(hrefs).not.toContain('/purchasing');
    expect(hrefs).toContain('/branches');
  });
});
