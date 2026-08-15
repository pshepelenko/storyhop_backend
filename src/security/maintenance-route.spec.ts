import { assertMaintenanceRouteEnabled } from './maintenance-route';

describe('maintenance route policy', () => {
  afterEach(() => delete process.env.ALLOW_MAINTENANCE_ROUTES);

  it('is hidden by default', () => {
    expect(() => assertMaintenanceRouteEnabled()).toThrow(expect.objectContaining({ status: 404 }));
  });

  it('can be enabled explicitly for controlled maintenance', () => {
    process.env.ALLOW_MAINTENANCE_ROUTES = 'true';
    expect(() => assertMaintenanceRouteEnabled()).not.toThrow();
  });
});
