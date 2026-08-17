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

    await controller.proxy('', 'http://169.254.169.254/latest/meta-data', undefined, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(storage.download).not.toHaveBeenCalled();
  });

  it('serves only a key recognized by the configured R2 storage', async () => {
    const storage = {
      extractKeyFromUrl: jest.fn(() => 'images/example.png'),
      download: jest.fn(async () => ({
        body: Buffer.from('image'),
        contentType: 'image/png',
        contentLength: 5,
      })),
    };
    const controller = new StorageProxyController(storage as any);
    const res = response();

    await controller.proxy('', 'https://account.r2.cloudflarestorage.com/storyhop/images/example.png', undefined, res);

    expect(storage.download).toHaveBeenCalledWith('images/example.png', undefined);
    expect(res.send).toHaveBeenCalled();
  });

  it('forwards a valid byte range and returns partial content headers', async () => {
    const storage = {
      download: jest.fn(async () => ({
        body: Buffer.from('audio'),
        contentType: 'audio/mpeg',
        contentLength: 5,
        contentRange: 'bytes 0-4/20',
      })),
    };
    const controller = new StorageProxyController(storage as any);
    const res = response();

    await controller.proxy('audio/example.mp3', '', 'bytes=0-4', res);

    expect(storage.download).toHaveBeenCalledWith('audio/example.mp3', 'bytes=0-4');
    expect(res.setHeader).toHaveBeenCalledWith('Accept-Ranges', 'bytes');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Range', 'bytes 0-4/20');
    expect(res.status).toHaveBeenCalledWith(206);
  });
});
