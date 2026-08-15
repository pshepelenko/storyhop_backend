import { NotFoundException } from '@nestjs/common';

export function assertMaintenanceRouteEnabled(): void {
  if (process.env.ALLOW_MAINTENANCE_ROUTES !== 'true') {
    throw new NotFoundException('Not found');
  }
}
