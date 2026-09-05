export function signInActionState(email: string, password: string, busy: boolean) {
  return { disabled: busy || !email.trim() || !password, loading: busy };
}
