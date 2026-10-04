import { Module } from '@nestjs/common';
import { HealthModule } from './modules/health/health.module.js';
import { DatabaseModule } from './database/database.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { OrderModule } from './modules/orders/order.module.js';
import { PaymentModule } from './modules/payments/payment.module.js';
import { ShiftModule } from './modules/shifts/shift.module.js';
import { CashDrawerModule } from './modules/cash-drawer/cash-drawer.module.js';
import { SyncModule } from './modules/sync/sync.module.js';
import { MenuModule } from './modules/menu/menu.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { KitchenModule } from './modules/kitchen/kitchen.module.js';
import { HrModule } from './modules/hr/hr.module.js';
import { InventoryModule } from './modules/inventory/inventory.module.js';
import { AccountingModule } from './modules/accounting/accounting.module.js';
import { SecurityModule } from './modules/security/security.module.js';
import { OperationsModule } from './modules/operations/operations.module.js';

@Module({
  imports: [DatabaseModule, AuthModule, HealthModule, OrderModule, PaymentModule, ShiftModule, CashDrawerModule, SyncModule, MenuModule, AuditModule, KitchenModule, HrModule, InventoryModule, AccountingModule, SecurityModule, OperationsModule],
})
export class AppModule {}
