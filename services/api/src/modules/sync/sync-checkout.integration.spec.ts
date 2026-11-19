import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';

const adminUrl = process.env.RLS_ADMIN_DATABASE_URL;
const appUrl = process.env.RLS_APP_DATABASE_URL ?? process.env.DATABASE_URL;
const describeIfConfigured = adminUrl && appUrl && adminUrl !== appUrl ? describe : describe.skip;

describeIfConfigured('Offline checkout and kitchen ticket PostgreSQL atomicity', () => {
  const admin = new Pool({ connectionString: adminUrl, max: 1 });
  const app = new Pool({ connectionString: appUrl, max: 2 });

  const ids = {
    tenant: randomUUID(),
    branch: randomUUID(),
    user: randomUUID(),
    device: randomUUID(),
    shift: randomUUID(),
    category: randomUUID(),
    foodProduct: randomUUID(),
    drinkProduct: randomUUID(),
    order: randomUUID(),
    foodOrderItem: randomUUID(),
    drinkOrderItem: randomUUID(),
    kitchenTicket: randomUUID(),
    beverageTicket: randomUUID(),
    payment: randomUUID(),
  };

  async function setContext(client: PoolClient) {
    await client.query(
      `SELECT
        set_config('app.tenant_id',$1,true),
        set_config('app.branch_id',$2,true),
        set_config('app.user_id',$3,true),
        set_config('app.session_id',$4,true)`,
      [ids.tenant, ids.branch, ids.user, randomUUID()],
    );
  }

  async function cleanup() {
    await admin.query('DELETE FROM "Payment" WHERE "id" = $1', [ids.payment]);
    await admin.query('DELETE FROM "KitchenTicket" WHERE "id" IN ($1,$2)', [ids.kitchenTicket, ids.beverageTicket]);
    await admin.query('DELETE FROM "Order" WHERE "id" = $1', [ids.order]);
    await admin.query('DELETE FROM "Shift" WHERE "id" = $1', [ids.shift]);
    await admin.query('DELETE FROM "Product" WHERE "id" IN ($1,$2)', [ids.foodProduct, ids.drinkProduct]);
    await admin.query('DELETE FROM "Category" WHERE "id" = $1', [ids.category]);
    await admin.query('DELETE FROM "Device" WHERE "id" = $1', [ids.device]);
    await admin.query('DELETE FROM "User" WHERE "id" = $1', [ids.user]);
    await admin.query('DELETE FROM "Branch" WHERE "id" = $1', [ids.branch]);
    await admin.query('DELETE FROM "Tenant" WHERE "id" = $1', [ids.tenant]);
  }

  beforeAll(async () => {
    await admin.query(
      `INSERT INTO "Tenant" ("id","slug","name","createdAt","updatedAt")
       VALUES ($1,$2,'Checkout Kitchen Atomicity',now(),now())`,
      [ids.tenant, `checkout-kitchen-${ids.tenant}`],
    );
    await admin.query(
      `INSERT INTO "Branch" ("id","code","name","active","tenantId","createdAt","updatedAt")
       VALUES ($1,$2,'Checkout Kitchen Branch',true,$3,now(),now())`,
      [ids.branch, `CK-${ids.branch.slice(0,8)}`, ids.tenant],
    );
    await admin.query(
      `INSERT INTO "User" ("id","username","displayName","passwordHash","status","tenantId","branchId","createdAt","updatedAt")
       VALUES ($1,$2,'Checkout Kitchen User','test-hash','ACTIVE',$3,$4,now(),now())`,
      [ids.user, `checkout-kitchen-${ids.user}`, ids.tenant, ids.branch],
    );
    await admin.query(
      `INSERT INTO "Device" ("id","deviceCode","name","status","branchId","createdAt","updatedAt")
       VALUES ($1,$2,'Checkout Kitchen POS','ACTIVE',$3,now(),now())`,
      [ids.device, `CK-${ids.device.slice(0,8)}`, ids.branch],
    );
    await admin.query(
      `INSERT INTO "Shift" ("id","branchId","userId","deviceId","status","openingCash","openedAt")
       VALUES ($1,$2,$3,$4,'OPEN',100,now())`,
      [ids.shift, ids.branch, ids.user, ids.device],
    );
    await admin.query(
      `INSERT INTO "Category" ("id","tenantId","name","nameAr")
       VALUES ($1,$2,'Checkout Test','اختبار الطلب')`,
      [ids.category, ids.tenant],
    );
    await admin.query(
      `INSERT INTO "Product" ("id","tenantId","sku","name","nameAr","price","active","kitchenStation","categoryId","createdAt","updatedAt")
       VALUES ($1,$3,'CK-FOOD','Kitchen Meal','وجبة',100,true,'KITCHEN',$4,now(),now()),
              ($2,$3,'CK-DRINK','Beverage','مشروب',20,true,'BEVERAGE',$4,now(),now())`,
      [ids.foodProduct, ids.drinkProduct, ids.tenant, ids.category],
    );
  });

  afterAll(async () => {
    await cleanup();
    await Promise.all([app.end(), admin.end()]);
  });

  it('rolls back the order, line items, station tickets and payment together on a late checkout failure', async () => {
    const client = await app.connect();
    try {
      await client.query('BEGIN');
      await setContext(client);

      await client.query(
        `INSERT INTO "Order"
         ("id","orderNumber","source","type","status","version","branchId","createdById","total","createdAt","updatedAt")
         VALUES ($1,$2,'POS','TAKEAWAY','CLOSED',2,$3,$4,120,now(),now())`,
        [ids.order, `CK-${ids.order.slice(0,8)}`, ids.branch, ids.user],
      );
      await client.query(
        `INSERT INTO "OrderItem"
         ("id","orderId","productId","quantity","unitPrice","lineTotal","notes","createdAt","updatedAt")
         VALUES ($1,$3,$4,1,100,100,'no onion',now(),now()),
                ($2,$3,$5,1,20,20,NULL,now(),now())`,
        [ids.foodOrderItem, ids.drinkOrderItem, ids.order, ids.foodProduct, ids.drinkProduct],
      );
      await client.query(
        `INSERT INTO "KitchenTicket"
         ("id","orderId","branchId","station","status","version","sequence","sentAt","createdAt","updatedAt")
         VALUES ($1,$3,$4,'KITCHEN','SENT_TO_KITCHEN',1,1,now(),now(),now()),
                ($2,$3,$4,'BEVERAGE','SENT_TO_KITCHEN',1,1,now(),now(),now())`,
        [ids.kitchenTicket, ids.beverageTicket, ids.order, ids.branch],
      );
      await client.query(
        `INSERT INTO "KitchenTicketItem"
         ("id","ticketId","orderItemId","nameSnapshot","quantity","note","modifiers","createdAt")
         VALUES ($1,$3,$5,'Kitchen Meal',1,'no onion','[]',now()),
                ($2,$4,$6,'Beverage',1,NULL,'[]',now())`,
        [randomUUID(), randomUUID(), ids.kitchenTicket, ids.beverageTicket, ids.foodOrderItem, ids.drinkOrderItem],
      );
      await client.query(
        `INSERT INTO "Payment"
         ("id","orderId","shiftId","amount","method","receivedAmount","changeAmount","status","idempotencyKey","createdAt","updatedAt")
         VALUES ($1,$2,$3,120,'CASH',120,0,'PAID',$4,now(),now())`,
        [ids.payment, ids.order, ids.shift, `checkout-kitchen-${ids.payment}`],
      );

      // Model a late failure after all checkout side effects have been staged.
      await expect(client.query('SELECT 1 / 0')).rejects.toThrow();
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    const check = await admin.query(
      `SELECT
        (SELECT count(*)::int FROM "Order" WHERE "id" = $1) AS orders,
        (SELECT count(*)::int FROM "OrderItem" WHERE "orderId" = $1) AS order_items,
        (SELECT count(*)::int FROM "KitchenTicket" WHERE "id" IN ($2,$3)) AS kitchen_tickets,
        (SELECT count(*)::int FROM "KitchenTicketItem" WHERE "ticketId" IN ($2,$3)) AS kitchen_ticket_items,
        (SELECT count(*)::int FROM "Payment" WHERE "id" = $4) AS payments`,
      [ids.order, ids.kitchenTicket, ids.beverageTicket, ids.payment],
    );

    expect(check.rows[0]).toEqual({
      orders: 0,
      order_items: 0,
      kitchen_tickets: 0,
      kitchen_ticket_items: 0,
      payments: 0,
    });
  });
});
