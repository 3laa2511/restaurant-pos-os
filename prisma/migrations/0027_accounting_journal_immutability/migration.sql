CREATE OR REPLACE FUNCTION app.prevent_posted_journal_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Posted journal entries are immutable; create a reversal entry instead';
END;
$$;

DROP TRIGGER IF EXISTS journal_entry_immutable ON "JournalEntry";
CREATE TRIGGER journal_entry_immutable
BEFORE UPDATE OR DELETE ON "JournalEntry"
FOR EACH ROW
EXECUTE FUNCTION app.prevent_posted_journal_mutation();

DROP TRIGGER IF EXISTS journal_line_immutable ON "JournalLine";
CREATE TRIGGER journal_line_immutable
BEFORE UPDATE OR DELETE ON "JournalLine"
FOR EACH ROW
EXECUTE FUNCTION app.prevent_posted_journal_mutation();
