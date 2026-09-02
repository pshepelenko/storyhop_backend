import axios from 'axios';
import { OpenRouterService } from './openrouter.service';

jest.mock('axios');

describe('OpenRouterService image generation', () => {
  const mockedAxios = axios as jest.Mocked<typeof axios>;
  const logger = {
    logOpenRouterError: jest.fn(),
  };
  const prompts = {};
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      OPEN_ROUTER_API_KEY: 'test-key',
      OPENROUTER_IMAGE_MODEL: 'openai/gpt-image-2',
      OPENROUTER_IMAGE_ASPECT_RATIO: '3:2',
      OPENROUTER_IMAGE_QUALITY: 'low',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('uses the OpenRouter Image API and decodes its image payload', async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        data: [{ b64_json: Buffer.from('image-bytes').toString('base64'), media_type: 'image/png' }],
      },
      headers: { 'x-request-id': 'request-123' },
    } as any);
    const service = new OpenRouterService(logger as any, prompts as any);

    await expect(service.generateImage('A safe storybook scene')).resolves.toEqual({
      body: Buffer.from('image-bytes'),
      contentType: 'image/png',
      requestId: 'request-123',
    });
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/images',
      expect.objectContaining({
        model: 'openai/gpt-image-2',
        prompt: 'A safe storybook scene',
        aspect_ratio: '3:2',
        quality: 'low',
        background: 'opaque',
        n: 1,
      }),
      expect.objectContaining({ timeout: 180000 }),
    );
  });

  it('rejects an image response without a decodable payload', async () => {
    mockedAxios.post.mockResolvedValue({ data: { data: [{}] }, headers: {} } as any);
    const service = new OpenRouterService(logger as any, prompts as any);

    await expect(service.generateImage('A safe storybook scene')).rejects.toThrow('b64_json');
    expect(logger.logOpenRouterError).toHaveBeenCalled();
  });

  it('checks image-model availability without creating an image', async () => {
    mockedAxios.get.mockResolvedValue({ data: { data: [] } } as any);
    mockedAxios.post.mockResolvedValue({ data: { choices: [{ message: { content: 'pong' } }] } } as any);
    const service = new OpenRouterService(logger as any, prompts as any);

    await expect(service.checkModelsHealth()).resolves.toEqual(
      expect.arrayContaining([{ model: 'openai/gpt-image-2', available: true }]),
    );
    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/models/openai%2Fgpt-image-2/endpoints',
      expect.objectContaining({ timeout: 15000 }),
    );
  });
});
