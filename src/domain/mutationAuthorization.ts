export function hasFreshMutationAuthorization(isOnline: boolean, usingCachedData: boolean) {
  return isOnline && !usingCachedData;
}
