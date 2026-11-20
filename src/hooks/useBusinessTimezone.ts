import { useContext } from 'react';
import { OrganizationContext } from '../providers/organizationContext';
import { effectiveTimezone } from '../domain/businessSettings';
export function useBusinessTimezone() {
  const context = useContext(OrganizationContext);
  return effectiveTimezone(context?.organization?.timezone, context?.branch?.timezone);
}
