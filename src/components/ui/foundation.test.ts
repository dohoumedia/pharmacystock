import { describe, expect, it } from 'vitest';
import { border, breakpoints, semantic, shape, spacing, touchTarget, typography } from '../../theme/tokens';
import { badgeTone, buttonVisualStyle, pageHeaderLayout, textFieldVisualStyle } from './visualStates';

describe('visual foundation tokens', () => {
  it('provides the approved spacing scale and responsive thresholds', () => {
    expect([spacing[4], spacing[8], spacing[12], spacing[16], spacing[20], spacing[24], spacing[32], spacing[40], spacing[48], spacing[64]]).toEqual([4, 8, 12, 16, 20, 24, 32, 40, 48, 64]);
    expect(breakpoints).toMatchObject({ narrow: 480, tablet: 900, desktop: 1200, wide: 1440 });
    expect([shape.sm, shape.md, shape.lg, shape.xl, shape.pill]).toEqual([8, 12, 16, 24, 999]);
    expect(typography.pageTitle.fontSize).toBeGreaterThan(typography.sectionTitle.fontSize);
  });
  it('gives every semantic status a foreground, background, and border', () => {
    for (const value of Object.values(semantic)) { expect(value.foreground).toMatch(/^#/); expect(value.background).toMatch(/^#/); expect(value.border).toMatch(/^#/); }
  });
});

describe('button and input visual states', () => {
  it('keeps a 44px target and preserves selected fill while focused', () => {
    const primary = buttonVisualStyle('primary', { focused: true });
    expect(primary.minHeight).toBe(touchTarget); expect(primary.backgroundColor).not.toBe('#E6FFFB'); expect(primary.borderColor).toBe(border.focus);
  });
  it('makes disabled/loading-compatible button state visibly unavailable', () => { const disabled = buttonVisualStyle('secondary', { disabled: true }); expect(disabled.opacity).toBeLessThan(1); expect(disabled.minHeight).toBe(touchTarget); });
  it('makes focus and errors independently visible on text fields', () => { expect(textFieldVisualStyle({ focused: true }).borderColor).toBe(border.focus); expect(textFieldVisualStyle({ error: true }).borderColor).toBe(semantic.danger.foreground); });
});

describe('badges and responsive page headers', () => {
  it.each(['success', 'warning', 'danger', 'info', 'offline', 'syncing', 'stale', 'conflict', 'neutral'] as const)('maps %s to a semantic badge tone', (tone) => expect(badgeTone(tone).color).toMatch(/^#/));
  it('stacks a page header action before tablet width', () => { expect(pageHeaderLayout(390)).toBe('stacked'); expect(pageHeaderLayout(1024)).toBe('inline'); });
});
