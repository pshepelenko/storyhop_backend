import { StorageProxyController } from './storage-proxy.controller';

describe('StorageProxyController', () => {
  const response = () => {
    const res: any = {
      setHeader: jest.fn(),
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn(),
    };
    res.status.mockReturnValue(res);
    return res;
  };

  it('rejects arbitrary remote URLs instead of acting as an SSRF proxy', async () => {
    const storage = { extractKeyFromUrl: jest.fn(() => null), download: jest.fn() };
    const controller = new StorageProxyController(storage as any);
    const res = response();

    await controller.proxy('', 'http://169.254.169.254/latest/meta-data', res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(storage.download).not.toHaveBeenCalled();
  });

  it('serves only a key recognized by the configured R2 storage', async () => {
    const storage = {
      extractKeyFromUrl: jest.fn(() => 'images/example.png'),
      download: jest.fn(async () => ({ body: Buffer.from('image'), contentType: 'image/png' })),
    };
    const controller = new StorageProxyController(storage as any);
    const res = response();

    await controller.proxy('', 'https://account.r2.cloudflarestorage.com/storyhop/images/example.png', res);

    expect(storage.download).toHaveBeenCalledWith('images/example.png');
    expect(res.send).toHaveBeenCalled();
  });
});
