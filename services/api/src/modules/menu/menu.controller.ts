import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentAuth } from '../auth/auth.decorators.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { PermissionGuard } from '../auth/permission.guard.js';
import { RequirePermission } from '../auth/permission.decorator.js';
import { PERMISSIONS } from '../auth/rbac.constants.js';
import type { AuthContext } from '../auth/authorization.types.js';
import { MenuService, type BranchProductConfigInput, type CreateModifierGroupInput, type CreateModifierOptionInput } from './menu.service.js';
import { OptionalBranchQueryDto } from '../security/request.dto.js';
import { BranchProductConfigDto, CreateModifierGroupDto, CreateModifierOptionDto } from './menu.dto.js';

@Controller('menu')
@UseGuards(AuthGuard)
export class MenuController {
  constructor(private readonly menuService: MenuService) {}

  @Get()
  async listActiveMenu(@CurrentAuth() context: AuthContext, @Query() query: OptionalBranchQueryDto) {
    const categories = await this.menuService.listActiveMenu(context, query.branchId);
    return categories.map((category) => ({
      id: category.id,
      name: category.name,
      nameAr: category.nameAr,
      sortOrder: category.sortOrder,
      products: category.products.map((product) => ({
        id: product.id,
        sku: product.sku,
        name: product.name,
        nameAr: product.nameAr,
        price: Number(product.price),
        modifierGroups: product.modifierGroups.map((group) => ({
          id: group.id,
          name: group.name,
          nameAr: group.nameAr,
          required: group.required,
          minSelections: group.minSelections,
          maxSelections: group.maxSelections,
          options: group.options.map((option) => ({
            id: option.id,
            name: option.name,
            nameAr: option.nameAr,
            priceDelta: Number(option.priceDelta),
          })),
        })),
      })),
    }));
  }

  @Post('modifier-groups')
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.MENU_MANAGE)
  createModifierGroup(@CurrentAuth() context: AuthContext, @Body() body: CreateModifierGroupDto) {
    return this.menuService.createModifierGroup(context, body as CreateModifierGroupInput);
  }

  @Post('modifier-options')
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.MENU_MANAGE)
  createModifierOption(@CurrentAuth() context: AuthContext, @Body() body: CreateModifierOptionDto) {
    return this.menuService.createModifierOption(context, body as CreateModifierOptionInput);
  }

  @Post('branch-products')
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.MENU_MANAGE)
  setBranchProduct(@CurrentAuth() context: AuthContext, @Body() body: BranchProductConfigDto) {
    return this.menuService.setBranchProduct(context, body as BranchProductConfigInput);
  }
}
