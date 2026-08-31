import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type { CreateOrderRecord, OrderRepository } from './order-repository.port.js';
import type { OrderStatus } from './order-status.js';

@Injectable()
export class PrismaOrderRepository implements OrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<CreateOrderRecord | null> {
    const order = await this.prisma.order.findUnique({ where: { id } });
    return order ? this.map(order) : null;
  }

  async create(input: Omit<CreateOrderRecord, 'version'>): Promise<CreateOrderRecord> {
    const order = await this.prisma.order.create({
      data: {
        id: input.id,
        orderNumber: input.orderNumber,
        branchId: input.branchId,
        createdById: input.createdById,
        source: input.source as never,
        type: input.type as never,
        status: input.status as never,
        total: input.total,
      },
    });
    return this.map(order);
  }

  async transition(id: string, expectedVersion: number, status: OrderStatus): Promise<CreateOrderRecord> {
    const result = await this.prisma.order.updateMany({
      where: { id, version: expectedVersion },
      data: { status: status as never, version: { increment: 1 } },
    });

    if (result.count !== 1) {
      throw new Error('Order was changed by another operation or does not exist');
    }

    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) throw new Error('Order not found after transition');
    return this.map(order);
  }

  private map(order: { id: string; orderNumber: string; branchId: string; createdById: string; source: unknown; type: unknown; status: unknown; total: { toString(): string }; }): CreateOrderRecord {
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      branchId: order.branchId,
      createdById: order.createdById,
      source: String(order.source),
      type: String(order.type),
      status: String(order.status) as OrderStatus,
      total: order.total.toString(),
      version: 1,
    };
  }
}
