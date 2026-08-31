export type PrinterConnection = 'USB' | 'NETWORK' | 'WINDOWS_SPOOLER';
export type PrinterJobStatus = 'QUEUED' | 'PRINTING' | 'PRINTED' | 'FAILED' | 'CANCELLED';

export interface PrinterProfile {
  id: string;
  branchId: string;
  name: string;
  station: 'KITCHEN' | 'BEVERAGE' | 'PACKING' | 'RECEIPT';
  connection: PrinterConnection;
  address: string;
  enabled: boolean;
}

export interface PrinterJob {
  id: string;
  printerId: string;
  documentType: 'KITCHEN_TICKET' | 'CUSTOMER_RECEIPT';
  documentId: string;
  payload: string;
  attempts: number;
  status: PrinterJobStatus;
  createdAt: Date;
}

export function validatePrinterProfile(printer: PrinterProfile): void {
  if (!printer.id.trim() || !printer.branchId.trim() || !printer.name.trim()) {
    throw new Error('Printer identity is required');
  }
  if (!printer.address.trim()) throw new Error('Printer address is required');
}
