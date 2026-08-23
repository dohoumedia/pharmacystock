import { describe, expect, it, vi } from 'vitest';
import { refreshSessionForReplay } from './offlinePos';
import { ReplayPreparationError } from './sync';

describe('replay session refresh', () => {
  it('does not regenerate or refresh anything when the session remains valid', async () => {
    const refreshSession = vi.fn();
    await refreshSessionForReplay(
      new Date('2026-08-23T18:00:00.000Z'),
      60,
      {
        getSession: async () => ({ data: { session: { expires_at: 1_787_511_700 } }, error: null }),
        refreshSession,
      },
    );

    expect(refreshSession).not.toHaveBeenCalled();
  });

  it('refreshes an expired session before replay', async () => {
    const events: string[] = [];
    await refreshSessionForReplay(
      new Date('2026-08-23T18:00:00.000Z'),
      60,
      {
        getSession: async () => {
          events.push('get-session');
          return { data: { session: { expires_at: 1 } }, error: null };
        },
        refreshSession: async () => {
          events.push('refresh-session');
          return { data: { session: { expires_at: 1_787_511_700 } }, error: null };
        },
      },
    );

    expect(events).toEqual(['get-session', 'refresh-session']);
  });

  it('classifies a rejected refresh as deterministic for conflict handling', async () => {
    await expect(refreshSessionForReplay(
      new Date('2026-08-23T18:00:00.000Z'),
      60,
      {
        getSession: async () => ({ data: { session: { expires_at: 1 } }, error: null }),
        refreshSession: async () => ({ data: { session: null }, error: { status: 401 } }),
      },
    )).rejects.toEqual(expect.objectContaining<Partial<ReplayPreparationError>>({
      code: 'AUTH_SESSION_REFRESH_FAILED',
      retryable: false,
    }));
  });
});
