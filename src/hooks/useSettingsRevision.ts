import { useEffect, useState } from 'react';
import { observeSettings } from '../services/settingsEvents';
export function useSettingsRevision(organizationId?: string) {
  const [revision, setRevision] = useState(0);
  useEffect(() => observeSettings(id => { if (id === organizationId) setRevision(value => value + 1); }), [organizationId]);
  return revision;
}
