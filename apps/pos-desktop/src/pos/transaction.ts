import type { Order } from './order.js';
import { createPrintJob, type PrintJob } from './print-job.js';
import { routeOrderToKitchen, type KitchenStation, type RoutedKitchenItem } from './kitchen-routing.js';
import type { LocalStore } from './local-store.js';
import { saveOrderLocal } from './local-store.js';

export interface TransactionResult {
  order: Order;
  kitchenItems: RoutedKitchenItem[];
  printJobs: PrintJob[];
}

export function prepareOrderTransaction(input: {
  store: LocalStore;
  order: Order;
  stationByProduct: Readonly<Record<string, KitchenStation>>;
  kitchenJobId: (station: KitchenStation, index: number) => string;
  customerJobId: string;
}): TransactionResult {
  if (input.order.status !== 'CONFIRMED') throw new Error(`Order must be confirmed: ${input.order.status}`);

  const kitchenItems = routeOrderToKitchen(input.order, input.stationByProduct);
  const stations = [...new Set(kitchenItems.map((item) => item.station))];
  const printJobs = stations.map((station, index) => createPrintJob({
    id: input.kitchenJobId(station, index),
    order: { ...input.order, items: input.order.items.filter((item) => (input.stationByProduct[item.productId] ?? 'KITCHEN') === station) },
    station,
  }));
  printJobs.push(createPrintJob({ id: input.customerJobId, order: input.order, station: 'CUSTOMER' }));

  saveOrderLocal(input.store, input.order);
  return { order: input.order, kitchenItems, printJobs };
}
