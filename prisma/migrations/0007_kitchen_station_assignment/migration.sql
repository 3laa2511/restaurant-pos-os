ALTER TABLE "User" ADD COLUMN "kitchenStation" "KitchenStation";
CREATE INDEX "User_kitchenStation_idx" ON "User"("kitchenStation");