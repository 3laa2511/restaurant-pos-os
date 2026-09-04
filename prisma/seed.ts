import { PrismaClient, RoleCode } from '@prisma/client';

const prisma = new PrismaClient();

const permissions = [
  ['order.create', 'Create orders'],
  ['order.view', 'View orders'],
  ['order.confirm', 'Confirm orders'],
  ['order.send_to_kitchen', 'Send orders to kitchen'],
  ['order.modify_issued', 'Modify issued orders'],
  ['order.cancel', 'Cancel orders'],
  ['order.void_item', 'Void order items'],
  ['payment.create', 'Create payments'],
  ['payment.refund', 'Refund payments'],
  ['shift.open', 'Open shifts'],
  ['shift.close', 'Close shifts'],
  ['cash_drawer.view', 'View cash drawer'],
  ['cash_drawer.manage', 'Manage cash drawer movements'],
  ['report.view_operational', 'View operational reports'],
  ['report.view_financial', 'View financial reports'],
  ['user.manage', 'Manage users'],
  ['menu.manage', 'Manage menu'],
  ['inventory.manage', 'Manage inventory'],
  ['driver.assign', 'Assign delivery drivers'],
  ['audit.view', 'View audit logs'],
] as const;

async function main() {
  for (const [code, name] of permissions) {
    await prisma.permission.upsert({ where: { code }, update: { name }, create: { code, name } });
  }

  const roleNames: Record<RoleCode, string> = {
    CASHIER: 'Cashier',
    CALL_CENTER_OPERATOR: 'Call Center Operator',
    CALL_CENTER_SUPERVISOR: 'Call Center Supervisor',
    KITCHEN: 'Kitchen',
    DISPATCHER: 'Dispatcher',
    BRANCH_MANAGER: 'Branch Manager',
    CENTRAL_ADMIN: 'Central Admin',
    OWNER: 'Owner',
  };

  for (const code of Object.values(RoleCode)) {
    await prisma.role.upsert({ where: { code }, update: { name: roleNames[code] }, create: { code, name: roleNames[code] } });
  }

  const fullAccess = permissions.map(([code]) => code);
  const cashier = ['order.create', 'order.view', 'order.confirm', 'order.send_to_kitchen', 'payment.create', 'shift.open', 'shift.close', 'cash_drawer.view', 'report.view_operational', 'driver.assign'];
  const callCenter = ['order.create', 'order.view', 'order.confirm', 'order.send_to_kitchen'];
  const supervisor = [...callCenter, 'order.modify_issued', 'order.cancel', 'order.void_item', 'payment.refund', 'report.view_operational', 'report.view_financial', 'driver.assign', 'audit.view', 'cash_drawer.view'];
  const kitchen = ['order.view'];
  const dispatcher = ['order.view', 'driver.assign'];
  const manager = [...cashier, 'order.modify_issued', 'order.cancel', 'order.void_item', 'payment.refund', 'report.view_financial', 'inventory.manage', 'audit.view', 'cash_drawer.manage'];
  const matrix: Record<RoleCode, readonly string[]> = { CASHIER: cashier, CALL_CENTER_OPERATOR: callCenter, CALL_CENTER_SUPERVISOR: supervisor, KITCHEN: kitchen, DISPATCHER: dispatcher, BRANCH_MANAGER: manager, CENTRAL_ADMIN: fullAccess, OWNER: fullAccess };

  for (const [roleCode, permissionCodes] of Object.entries(matrix) as [RoleCode, readonly string[]][]) {
    const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    const rows = await prisma.permission.findMany({ where: { code: { in: permissionCodes } }, select: { id: true } });
    await prisma.rolePermission.createMany({ data: rows.map(({ id }) => ({ roleId: role.id, permissionId: id })) });
  }
}

main().finally(() => prisma.$disconnect());
