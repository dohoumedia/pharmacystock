import PurchasingScreen from './purchasing';
// Suppliers and orders share the existing purchasing services and workspace.
export default function SuppliersScreen() { return <PurchasingScreen initialTab="suppliers" />; }
