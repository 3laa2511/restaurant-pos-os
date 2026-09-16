import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { MenuService } from './menu.service.js';

@Controller('menu')
@UseGuards(AuthGuard)
export class MenuController {
  constructor(private readonly menuService: MenuService) {}

  @Get()
  async listActiveMenu() {
    const categories = await this.menuService.listActiveMenu();
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
        variants: product.variants.map((variant) => ({
          id: variant.id,
          sku: variant.sku,
          name: variant.name,
          nameAr: variant.nameAr,
          price: Number(variant.price),
          sortOrder: variant.sortOrder,
        })),
        modifierGroups: product.modifierGroups.map((assignment) => ({
          id: assignment.group.id,
          name: assignment.group.name,
          nameAr: assignment.group.nameAr,
          required: assignment.required,
          minSelections: assignment.minSelections,
          maxSelections: assignment.maxSelections,
          sortOrder: assignment.sortOrder,
          options: assignment.group.options.map((option) => ({
            id: option.id,
            name: option.name,
            nameAr: option.nameAr,
            priceDelta: Number(option.priceDelta),
            sortOrder: option.sortOrder,
          })),
        })),
      })),
    }));
  }
}
