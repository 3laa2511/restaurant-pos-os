export interface BranchSequenceStore {
  next(branchId: string): Promise<number>;
}

export function formatOrderNumber(branchCode: string, sequence: number): string {
  if (!branchCode.trim()) throw new Error('Branch code is required');
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error('Order sequence must be a positive integer');
  }
  return `${branchCode}-${String(sequence).padStart(6, '0')}`;
}
