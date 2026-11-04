import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { assertTenantScope } from '../auth/authorization.types.js';
import type { AuthContext } from '../auth/authorization.types.js';

@Injectable()
export class MenuService {
  constructor(private readonly prisma: PrismaService) {}

  async listActiveMenu(context: AuthContext) {
    const tenantId = assertTenantScope(context);

    return this.prisma.category.findMany({
      where: { tenantId, active: true },
      orderBy: { sortOrder: 'asc' },
      include: {
        products: {
          where: { tenantId, active: true },
          orderBy: { name: 'asc' },
          select: { id: true, sku: true, name: true, nameAr: true, price: true },
        },
      },
    });
  }
}
