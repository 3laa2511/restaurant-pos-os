import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service.js';
import { assertBranchAccess, assertTenantScope } from '../auth/authorization.types.js';
import type { AuthContext } from '../auth/authorization.types.js';

export interface BranchProductConfigInput {
  branchId: string;
  productId: string;
  priceOverride?: number | null;
  enabled?: boolean;
  available?: boolean;
}

@Injectable()
export class MenuService {
  constructor(private readonly prisma: PrismaService) {}

  async listActiveMenu(context: AuthContext, requestedBranchId?: string) {
    const tenantId = assertTenantScope(context);
    const branchId = await this.resolveBranchId(context, tenantId, requestedBranchId);

    const [categories, overrides] = await Promise.all([
      this.prisma.category.findMany({
        where: { tenantId, active: true },
        orderBy: { sortOrder: 'asc' },
        include: {
          products: {
            where: { tenantId, active: true },
            orderBy: { name: 'asc' },
            select: { id: true, sku: true, name: true, nameAr: true, price: true },
          },
        },
      }),
      this.prisma.branchProduct.findMany({
        where: { tenantId, branchId },
        select: { productId: true, priceOverride: true, enabled: true, available: true },
      }),
    ]);

    const byProductId = new Map(overrides.map((item) => [item.productId, item]));

    return categories
      .map((category) => ({
        ...category,
        products: category.products
          .map((product) => {
            const override = byProductId.get(product.id);
            if (override && (!override.enabled || !override.available)) return null;
            return {
              ...product,
              price: override?.priceOverride ?? product.price,
            };
          })
          .filter((product): product is NonNullable<typeof product> => product !== null),
      }))
      .filter((category) => category.products.length > 0);
  }

  async setBranchProduct(context: AuthContext, input: BranchProductConfigInput) {
    const tenantId = assertTenantScope(context);
    const branchId = await this.resolveBranchId(context, tenantId, input.branchId);

    const product = await this.prisma.product.findFirst({
      where: { id: input.productId, tenantId },
      select: { id: true, active: true, price: true },
    });
    if (!product) throw new Error('Product not found in the current tenant');

    if (input.priceOverride !== undefined && input.priceOverride !== null) {
      if (!Number.isFinite(input.priceOverride) || input.priceOverride < 0) {
        throw new Error('Price override must be a non-negative number');
      }
    }

    return this.prisma.branchProduct.upsert({
      where: { branchId_productId: { branchId, productId: product.id } },
      update: {
        ...(input.priceOverride === undefined ? {} : { priceOverride: input.priceOverride === null ? null : input.priceOverride.toFixed(2) }),
        enabled: input.enabled ?? true,
        available: input.available ?? true,
      },
      create: {
        id: randomUUID(),
        tenantId,
        branchId,
        productId: product.id,
        priceOverride: input.priceOverride === undefined || input.priceOverride === null ? null : input.priceOverride.toFixed(2),
        enabled: input.enabled ?? true,
        available: input.available ?? true,
      },
    });
  }

  private async resolveBranchId(context: AuthContext, tenantId: string, requestedBranchId?: string): Promise<string> {
    const branchId = context.branchId ?? requestedBranchId;
    if (!branchId) throw new Error('Branch selection is required for this menu operation');

    assertBranchAccess(context, branchId);

    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, tenantId, active: true },
      select: { id: true },
    });
    if (!branch) throw new Error('Branch not found in the current tenant');
    return branch.id;
  }
}
