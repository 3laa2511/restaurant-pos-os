import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentAuth } from '../auth/auth.decorators.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { PermissionGuard } from '../auth/permission.guard.js';
import { RequirePermission } from '../auth/permission.decorator.js';
import { PERMISSIONS } from '../auth/rbac.constants.js';
import type { AuthContext } from '../auth/authorization.types.js';
import { InventoryService } from './inventory.service.js';

@Controller('inventory')
@UseGuards(AuthGuard, PermissionGuard)
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get('ingredients')
  @RequirePermission(PERMISSIONS.INVENTORY_VIEW)
  ingredients(@CurrentAuth() context: AuthContext) { return this.inventory.listIngredients(context); }

  @Post('ingredients')
  @RequirePermission(PERMISSIONS.INVENTORY_PURCHASE)
  createIngredient(@CurrentAuth() context: AuthContext, @Body() input: Parameters<InventoryService['createIngredient']>[1]) { return this.inventory.createIngredient(context, input); }

  @Get('stock')
  @RequirePermission(PERMISSIONS.INVENTORY_VIEW)
  stock(@CurrentAuth() context: AuthContext, @Query('branchId') branchId?: string) { return this.inventory.listStock(context, branchId); }

  @Post('receipts')
  @RequirePermission(PERMISSIONS.INVENTORY_PURCHASE)
  receive(@CurrentAuth() context: AuthContext, @Body() input: Parameters<InventoryService['receive']>[1]) { return this.inventory.receive(context, input); }

  @Post('adjust')
  @RequirePermission(PERMISSIONS.INVENTORY_ADJUST)
  adjust(@CurrentAuth() context: AuthContext, @Body() input: Parameters<InventoryService['adjust']>[1]) { return this.inventory.adjust(context, input); }

  @Get('warehouses')
  @RequirePermission(PERMISSIONS.INVENTORY_VIEW)
  warehouses(@CurrentAuth() context: AuthContext) { return this.inventory.listWarehouses(context); }

  @Get('transfers')
  @RequirePermission(PERMISSIONS.INVENTORY_VIEW)
  transfers(@CurrentAuth() context: AuthContext, @Query('status') status?: string) { return this.inventory.listTransfers(context, status); }

  @Post('transfers')
  @RequirePermission(PERMISSIONS.INVENTORY_MANAGE)
  createTransfer(@CurrentAuth() context: AuthContext, @Body() input: Parameters<InventoryService['createTransfer']>[1]) { return this.inventory.createTransfer(context, input); }

  @Post('transfers/:transferId/approve')
  @RequirePermission(PERMISSIONS.INVENTORY_MANAGE)
  approveTransfer(@CurrentAuth() context: AuthContext, @Param('transferId') transferId: string) { return this.inventory.approveTransfer(context, transferId); }

  @Post('transfers/:transferId/dispatch')
  @RequirePermission(PERMISSIONS.INVENTORY_MANAGE)
  dispatchTransfer(@CurrentAuth() context: AuthContext, @Param('transferId') transferId: string) { return this.inventory.dispatchTransfer(context, transferId); }

  @Post('transfers/:transferId/receive')
  @RequirePermission(PERMISSIONS.INVENTORY_MANAGE)
  receiveTransfer(@CurrentAuth() context: AuthContext, @Param('transferId') transferId: string) { return this.inventory.receiveTransfer(context, transferId); }

  @Post('recipes/:productId')
  @RequirePermission(PERMISSIONS.RECIPE_MANAGE)
  setRecipe(@CurrentAuth() context: AuthContext, @Param('productId') productId: string, @Body() input: Parameters<InventoryService['setRecipe']>[2]) { return this.inventory.setRecipe(context, productId, input); }
}
