import { describe, expect, it } from 'vitest';
import { signInActionState } from './authPresentation';

describe('signInActionState', () => {
  it('keeps submit disabled until both credentials are present', () => {
    expect(signInActionState('', '', false)).toEqual({ disabled: true, loading: false });
    expect(signInActionState('staff@example.test', '', false)).toEqual({ disabled: true, loading: false });
    expect(signInActionState(' staff@example.test ', 'secret', false)).toEqual({ disabled: false, loading: false });
  });

  it('keeps submit disabled while an existing sign-in request is pending', () => {
    expect(signInActionState('staff@example.test', 'secret', true)).toEqual({ disabled: true, loading: true });
  });
});
