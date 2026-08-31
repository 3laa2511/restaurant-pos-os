import { DeviceStatus } from './device-status.js';

export interface DeviceIdentity {
  deviceId: string;
  branchId: string;
  status: DeviceStatus;
}

export function assertDeviceUsable(device: DeviceIdentity): void {
  if (device.status !== DeviceStatus.ACTIVE) {
    throw new Error('Device is not active');
  }
}

export function assertDeviceBelongsToBranch(device: DeviceIdentity, branchId: string): void {
  if (device.branchId !== branchId) {
    throw new Error('Device is not registered to this branch');
  }
}
