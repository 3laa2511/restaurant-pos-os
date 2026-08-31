import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';

@Injectable()
export class MenuService {
  constructor(private readonly prisma: PrismaService) {}

  async listActiveMenu() {
    return this.prisma.category.findMany({
      where: { active: true },
      orderBy: { sortOrder: 'asc' },
      include: {
        products: {
          where: { active: true },
          orderBy: { name: 'asc' },
          select: { id: true, sku: true, name: true, nameAr: true, price: true },
        },
      },
    });
  }
}
