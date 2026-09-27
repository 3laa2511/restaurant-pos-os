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
  @RequirePermission(PERMISSORY.INVENTORY_ADJUST)
  adjust(@CurrentAuth() context: AuthContext, @Body() input: Parameters<InventoryService['adjust']>[1]) { return this.inventory.adjust(context, input); }

  @Post('recipes/:productId')
  @RequirePermission(PERMISSIONS.RECIPE_MANAGE)
  setRecipe(@CurrentAuth() context: AuthContext, @Param('productId') productId: string, @Body() input: Parameters<InventoryService['setRecipe']>[2]) { return this.inventory.setRecipe(context, productId, input); }
}
