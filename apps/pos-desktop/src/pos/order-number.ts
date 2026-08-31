export interface OrderNumberContext { branchCode: string; deviceCode: string; sequence: number; }

export function formatOrderNumber(context: OrderNumberContext): string {
  if (!context.branchCode || !context.deviceCode || !Number.isInteger(context.sequence) || context.sequence < 1) {
    throw new Error('Invalid order number context');
  }
  return `${context.branchCode}-${context.deviceCode}-${String(context.sequence).padStart(5, '0')}`;
}
