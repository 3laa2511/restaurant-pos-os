import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service.js';
import { withRlsContext } from '../../database/rls-context.js';
import { assertBranchAccess, assertTenantScope } from '../auth/authorization.types.js';
import type { AuthContext } from '../auth/authorization.types.js';

export interface CreateModifierGroupInput {
  productId: string;
  name: string;
  nameAr?: string;
  required?: boolean;
  minSelections?: number;
  maxSelections?: number;
  sortOrder?: number;
}

export interface CreateModifierOptionInput {
  groupId: string;
  name: string;
  nameAr?: string;
  priceDelta?: number;
  sortOrder?: number;
}

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

    return withRlsContext(this.prisma, context, async (tx) => {
      const branchId = await this.resolveBranchId(tx, context, tenantId, requestedBranchId);

      const [categories, overrides] = await Promise.all([
        tx.category.findMany({
          where: { tenantId, active: true },
          orderBy: { sortOrder: 'asc' },
          include: {
            products: {
              where: { tenantId, active: true },
              orderBy: { name: 'asc' },
              select: { id: true, sku: true, name: true, nameAr: true, price: true, modifierGroups: { where: { tenantId, active: true }, orderBy: { sortOrder: 'asc' }, include: { options: { where: { tenantId, active: true }, orderBy: { sortOrder: 'asc' }, select: { id: true, name: true, nameAr: true, priceDelta: true, sortOrder: true } } } } },
            },
          },
        }),
        tx.branchProduct.findMany({
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
              return { ...product, price: override?.priceOverride ?? product.price };
            })
            .filter((product): product is NonNullable<typeof product> => product !== null),
        }))
        .filter((category) => category.products.length > 0);
    });
  }

  async createModifierGroup(context: AuthContext, input: CreateModifierGroupInput) {
    const tenantId = assertTenantScope(context);
    return withRlsContext(this.prisma, context, async (tx) => {
      const product = await tx.product.findFirst({
        where: { id: input.productId, tenantId, active: true },
        select: { id: true },
      });
      if (!product) throw new Error('Product not found in the current tenant');
      const minSelections = input.minSelections ?? (input.required ? 1 : 0);
      const maxSelections = input.maxSelections ?? 1;
      if (minSelections > maxSelections) throw new Error('Minimum selections cannot exceed maximum selections');
      return tx.productModifierGroup.create({
        data: {
          id: randomUUID(),
          tenantId,
          productId: product.id,
          name: input.name.trim(),
          nameAr: input.nameAr?.trim() || null,
          required: input.required ?? false,
          minSelections,
          maxSelections,
          sortOrder: input.sortOrder ?? 0,
        },
      });
    });
  }

  async createModifierOption(context: AuthContext, input: CreateModifierOptionInput) {
    const tenantId = assertTenantScope(context);
    return withRlsContext(this.prisma, context, async (tx) => {
      const group = await tx.productModifierGroup.findFirst({
        where: { id: input.groupId, tenantId, active: true },
        select: { id: true },
      });
      if (!group) throw new Error('Modifier group not found in the current tenant');
      const priceDelta = input.priceDelta ?? 0;
      if (!Number.isFinite(priceDelta) || Math.abs(priceDelta * 100 - Math.round(priceDelta * 100)) > Number.EPSILON) {
        throw new Error('Modifier price must have at most 2 decimal places');
      }
      return tx.productModifierOption.create({
        data: {
          id: randomUUID(),
          tenantId,
          groupId: group.id,
          name: input.name.trim(),
          nameAr: input.nameAr?.trim() || null,
          priceDelta: priceDelta.toFixed(2),
          sortOrder: input.sortOrder ?? 0,
        },
      });
    });
  }

  async setBranchProduct(context: AuthContext, input: BranchProductConfigInput) {
    const tenantId = assertTenantScope(context);

    return withRlsContext(this.prisma, context, async (tx) => {
      const branchId = await this.resolveBranchId(tx, context, tenantId, input.branchId);

      const product = await tx.product.findFirst({
        where: { id: input.productId, tenantId },
        select: { id: true, active: true, price: true },
      });
      if (!product) throw new Error('Product not found in the current tenant');

      if (input.priceOverride !== undefined && input.priceOverride !== null) {
        if (!Number.isFinite(input.priceOverride) || input.priceOverride < 0) {
          throw new Error('Price override must be a non-negative number');
        }
      }

      return tx.branchProduct.upsert({
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
    });
  }

  private async resolveBranchId(
    tx: Parameters<Parameters<typeof withRlsContext>[2]>[0],
    context: AuthContext,
    tenantId: string,
    requestedBranchId?: string,
  ): Promise<string> {
    const branchId = context.branchId ?? requestedBranchId;
    if (!branchId) throw new Error('Branch selection is required for this menu operation');

    assertBranchAccess(context, branchId);

    const branch = await tx.branch.findFirst({
      where: { id: branchId, tenantId, active: true },
      select: { id: true },
    });
    if (!branch) throw new Error('Branch not found in the current tenant');
    return branch.id;
  }
}
