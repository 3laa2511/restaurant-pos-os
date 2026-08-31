import { KitchenStationType } from './kitchen.types.js';

export interface PrinterJob {
  id: string;
  branchId: string;
  station: KitchenStationType;
  ticketId: string;
  copies: number;
  payload: string;
  createdAt: Date;
}

export function buildCompactKitchenTicket(input: {
  orderNumber: string;
  type: string;
  items: readonly { quantity: number; name: string; modifiers?: readonly string[]; note?: string | null }[];
}): string {
  const lines = [
    `#${input.orderNumber}  ${input.type}`,
    '------------------------------',
    ...input.items.map((item) => {
      const modifiers = item.modifiers?.length ? ` [${item.modifiers.join(', ')}]` : '';
      const note = item.note ? ` * ${item.note}` : '';
      return `${item.quantity}x ${item.name}${modifiers}${note}`;
    }),
    '------------------------------',
  ];
  return lines.join('\n');
}
