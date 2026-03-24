jest.mock('./wechat-compiler', () => ({
  WechatCompiler: {
    compile: jest.fn().mockResolvedValue('<p>mock html</p>'),
  },
}));

import { Test, TestingModule } from '@nestjs/testing';
import { WechatPublisherService } from './wechat-publisher.service';

describe('WechatPublisherService', () => {
  let service: WechatPublisherService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WechatPublisherService],
    }).compile();

    service = module.get<WechatPublisherService>(WechatPublisherService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('tests access token connectivity', async () => {
    const fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'token',
        expires_in: 7200,
      }),
    } as Response);

    await expect(
      service.testConnection({
        authorizerAppid: 'wx-test',
        apiToken: 'secret',
      }),
    ).resolves.toEqual({
      accessTokenExpiresIn: 7200,
    });

    fetchMock.mockRestore();
  });
});
