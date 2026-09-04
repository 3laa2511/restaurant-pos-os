-- A cashier and a physical POS device can each have at most one open shift.
-- These database-level invariants close the race between application-level checks.
CREATE UNIQUE INDEX "Shift_open_user_key"
  ON "Shift"("userId")
  WHERE "status" = 'OPEN';

CREATE UNIQUE INDEX "Shift_open_device_key"
  ON "Shift"("deviceId")
  WHERE "status" = 'OPEN';

-- Money stored by the shift lifecycle is never negative.
ALTER TABLE "Shift"
  ADD CONSTRAINT "Shift_openingCash_non_negative_check"
  CHECK ("openingCash" >= 0);

ALTER TABLE "Shift"
  ADD CONSTRAINT "Shift_closingCash_non_negative_check"
  CHECK ("closingCash" IS NULL OR "closingCash" >= 0);
