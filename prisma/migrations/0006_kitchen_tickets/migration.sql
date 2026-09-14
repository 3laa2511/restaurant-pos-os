CREATE TYPE "KitchenStation" AS ENUM ('KITCHEN', 'BEVERAGE', 'PACKING');
CREATE TYPE "KitchenTicketStatus" AS ENUM ('SENT_TO_KITCHEN', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED');

ALTER TABLE "Product"
  ADD COLUMN "kitchenStation" "KitchenStation" NOT NULL DEFAULT 'KITCHEN';

CREATE TABLE "KitchenTicket" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "station" "KitchenStation" NOT NULL,
  "status" "KitchenTicketStatus" NOT NULL DEFAULT 'SENT_TO_KITCHEN',
  "version" INTEGER NOT NULL DEFAULT 1,
  "sequence" INTEGER NOT NULL DEFAULT 1,
  "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "preparingAt" TIMESTAMP(3),
  "readyAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "cancellationReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KitchenTicket_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KitchenTicketItem" (
  "id" TEXT NOT NULL,
  "ticketId" TEXT NOT NULL,
  "orderItemId" TEXT NOT NULL,
  "nameSnapshot" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "note" TEXT,
  "modifiers" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KitchenTicketItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "KitchenTicket_orderId_station_sequence_key"
  ON "KitchenTicket"("orderId", "station", "sequence");
CREATE INDEX "KitchenTicket_branchId_status_updatedAt_idx"
  ON "KitchenTicket"("branchId", "status", "updatedAt");
CREATE INDEX "KitchenTicket_orderId_status_idx"
  ON "KitchenTicket"("orderId", "status");
CREATE UNIQUE INDEX "KitchenTicketItem_ticketId_orderItemId_key"
  ON "KitchenTicketItem"("ticketId", "orderItemId");
CREATE INDEX "KitchenTicketItem_orderItemId_idx"
  ON "KitchenTicketItem"("orderItemId");

ALTER TABLE "KitchenTicket"
  ADD CONSTRAINT "KitchenTicket_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KitchenTicket"
  ADD CONSTRAINT "KitchenTicket_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KitchenTicketItem"
  ADD CONSTRAINT "KitchenTicketItem_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "KitchenTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
