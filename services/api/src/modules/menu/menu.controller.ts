import { Controller, Get } from '@nestjs/common';
import { MenuService } from './menu.service.js';

@Controller('menu')
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
      })),
    }));
  }
}
