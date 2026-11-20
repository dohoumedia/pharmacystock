import { useState } from 'react';
import { useTranslation } from '../i18n/useTranslation';
import { Alert, Button, Surface } from './ui';
import { MovementDetail, inventoryErrorKey } from './InventoryResultDetails';
import { loadInventoryBatch } from '@/services/inventoryCompletion';
import type { BatchChoice } from '@/services/catalogReadiness';
import type { InventoryMovement } from '@/services/inventory';

export function InventoryMovementInspector({ movement, online }: { movement: InventoryMovement; online: boolean }) {
  const { t } = useTranslation();
  const [batch, setBatch] = useState<BatchChoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const inspect = async () => {
    setOpen(true); setBusy(true); setError(null);
    try { setBatch((await loadInventoryBatch(movement.organization_id, movement.branch_id, movement.batch_id)).batch); }
    catch (cause) { setError(t(inventoryErrorKey(cause))); }
    finally { setBusy(false); }
  };
  return <Surface style={{ gap: 8, width: '100%' }}><Button variant="secondary" disabled={!online || busy} label={t('inventoryReady.inspectMovement', { reference: movement.id })} onPress={() => void inspect()} />{open ? <>{error ? <Alert tone="danger" title={error} /> : null}<MovementDetail movement={movement} batch={batch ?? undefined} /></> : null}</Surface>;
}
