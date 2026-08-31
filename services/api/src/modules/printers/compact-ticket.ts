export interface CompactTicketInput {
  orderNumber: string;
  orderType: string;
  items: readonly { quantity: number; name: string; note?: string | null }[];
  createdAt: Date;
}

export function renderCompactKitchenTicket(input: CompactTicketInput): string {
  const lines = [
    `#${input.orderNumber}  ${input.orderType}`,
    input.createdAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
    '------------------------------',
  ];

  for (const item of input.items) {
    lines.push(`${item.quantity}x ${item.name}`);
    if (item.note?.trim()) lines.push(`  NOTE: ${item.note.trim()}`);
  }

  lines.push('------------------------------');
  return `${lines.join('\n')}\n`;
}
