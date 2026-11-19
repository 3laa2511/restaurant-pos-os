DO $$
DECLARE
  tenant_row RECORD;
  initial_id text;
  min_entry timestamp(3);
  max_entry timestamp(3);
  current_start timestamp(3);
  next_start timestamp(3);
  historical_id text;
  current_id text;
  future_id text;
  future_start timestamp(3);
  future_end timestamp(3);
BEGIN
  current_start := date_trunc('year', CURRENT_TIMESTAMP);
  next_start := current_start + interval '1 year';

  FOR tenant_row IN
    SELECT t."id" AS tenant_id
    FROM "Tenant" t
    JOIN "FiscalPeriod" fp ON fp."tenantId" = t."id" AND fp."name" = 'INITIAL'
  LOOP
    SELECT MIN("entryDate"), MAX("entryDate")
      INTO min_entry, max_entry
    FROM "JournalEntry"
    WHERE "tenantId" = tenant_row.tenant_id;

    IF min_entry IS NOT NULL AND min_entry < current_start THEN
      historical_id := 'fp-historical-' || md5(tenant_row.tenant_id);

      INSERT INTO "FiscalPeriod" (
        "id","tenantId","name","periodStart","periodEnd","status","createdAt","updatedAt"
      )
      VALUES (
        historical_id,
        tenant_row.tenant_id,
        'HISTORICAL',
        date_trunc('year', min_entry),
        current_start,
        'CLOSED'::"FiscalPeriodStatus",
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
      ON CONFLICT ("tenantId","name") DO NOTHING;

      SELECT "id" INTO historical_id
      FROM "FiscalPeriod"
      WHERE "tenantId" = tenant_row.tenant_id AND "name" = 'HISTORICAL';

      UPDATE "JournalEntry"
      SET "fiscalPeriodId" = historical_id
      WHERE "tenantId" = tenant_row.tenant_id
        AND "entryDate" < current_start;
    END IF;

    current_id := 'fp-' || to_char(current_start, 'YYYY') || '-' || md5(tenant_row.tenant_id);

    INSERT INTO "FiscalPeriod" (
      "id","tenantId","name","periodStart","periodEnd","status","createdAt","updatedAt"
    )
    VALUES (
      current_id,
      tenant_row.tenant_id,
      to_char(current_start, 'YYYY'),
      current_start,
      next_start,
      'OPEN'::"FiscalPeriodStatus",
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("tenantId","name") DO NOTHING;

    SELECT "id" INTO current_id
    FROM "FiscalPeriod"
    WHERE "tenantId" = tenant_row.tenant_id
      AND "name" = to_char(current_start, 'YYYY');

    UPDATE "JournalEntry"
    SET "fiscalPeriodId" = current_id
    WHERE "tenantId" = tenant_row.tenant_id
      AND "entryDate" >= current_start
      AND "entryDate" < next_start;

    IF max_entry IS NOT NULL AND max_entry >= next_start THEN
      future_start := next_start;
      future_end := date_trunc('year', max_entry) + interval '1 year';
      future_id := 'fp-future-' || to_char(future_start, 'YYYY') || '-' || md5(tenant_row.tenant_id);

      INSERT INTO "FiscalPeriod" (
        "id","tenantId","name","periodStart","periodEnd","status","createdAt","updatedAt"
      )
      VALUES (
        future_id,
        tenant_row.tenant_id,
        'FUTURE_' || to_char(future_start, 'YYYY'),
        future_start,
        future_end,
        'OPEN'::"FiscalPeriodStatus",
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
      ON CONFLICT ("tenantId","name") DO NOTHING;

      SELECT "id" INTO future_id
      FROM "FiscalPeriod"
      WHERE "tenantId" = tenant_row.tenant_id
        AND "name" = 'FUTURE_' || to_char(future_start, 'YYYY');

      UPDATE "JournalEntry"
      SET "fiscalPeriodId" = future_id
      WHERE "tenantId" = tenant_row.tenant_id
        AND "entryDate" >= future_start;
    END IF;

    SELECT "id" INTO initial_id
    FROM "FiscalPeriod"
    WHERE "tenantId" = tenant_row.tenant_id AND "name" = 'INITIAL';

    IF initial_id IS NOT NULL THEN
      DELETE FROM "FiscalPeriod" WHERE "id" = initial_id;
    END IF;
  END LOOP;
END $$;
