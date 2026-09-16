import { Controller, Get, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.service.js';
import { MenuService } from './menu.service.js';

@Controller('menu')
@UseGuards(AuthGuard)
export class MenuController {
  constructor(private readonly menuService: MenuService) {}

  @Get()
  async listActiveMenu(@Req() request: AuthenticatedRequest) {
    if (!request.authContext) throw new UnauthorizedException('Authentication context missing');

    const categories = await this.menuService.listActiveMenu(request.authContext);
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
