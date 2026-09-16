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
          include: {
            variants: {
              where: { active: true },
              orderBy: { sortOrder: 'asc' },
              select: {
                id: true,
                sku: true,
                name: true,
                nameAr: true,
                price: true,
                sortOrder: true,
              },
            },
            modifierGroups: {
              orderBy: { sortOrder: 'asc' },
              select: {
                required: true,
                minSelections: true,
                maxSelections: true,
                sortOrder: true,
                group: {
                  select: {
                    id: true,
                    name: true,
                    nameAr: true,
                    minSelections: true,
                    maxSelections: true,
                    options: {
                      where: { active: true },
                      orderBy: { sortOrder: 'asc' },
                      select: {
                        id: true,
                        name: true,
                        nameAr: true,
                        priceDelta: true,
                        sortOrder: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
  }
}
