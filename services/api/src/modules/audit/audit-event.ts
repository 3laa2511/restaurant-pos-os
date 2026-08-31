export interface AuditEvent {
  id: string;
  branchId: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  reason?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  occurredAt: Date;
}

export function createAuditEvent(input: Omit<AuditEvent, 'occurredAt'>): AuditEvent {
  if (!input.actorId.trim() || !input.action.trim() || !input.entityId.trim()) {
    throw new Error('Audit actor, action and entity are required');
  }
  return { ...input, occurredAt: new Date() };
}
