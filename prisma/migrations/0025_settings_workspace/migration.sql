-- Persist the dedicated Settings workspace in the PostgreSQL enum used by Session.workspace.
ALTER TYPE "WorkspaceCode" ADD VALUE IF NOT EXISTS 'SETTINGS';
