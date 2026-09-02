import type { PrintRepository } from './print-repository.js';

export interface PrintReliabilitySnapshot {
  pending: number;
  printing: number;
  printed: number;
  failed: number;
}

export interface PrintReliabilityRepository extends PrintRepository {
  getSnapshot(): Promise<PrintReliabilitySnapshot>;
  recoverExpired(): Promise<number>;
}

export async function recoverAndSnapshot(repository: PrintReliabilityRepository): Promise<PrintReliabilitySnapshot> {
  await repository.recoverExpired();
  return repository.getSnapshot();
}
