jest.mock('./wechat-publisher/wechat-publisher.service', () => ({
  WechatPublisherService: class {},
}));

jest.mock('./xiaohongshu-publisher.service', () => ({
  XiaohongshuPublisherService: class {},
}));

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PublishingService } from './publishing.service';
import { PrismaService } from '../../prisma/prisma.service';
import { WechatPublisherService } from './wechat-publisher/wechat-publisher.service';
import { XiaohongshuPublisherService } from './xiaohongshu-publisher.service';

describe('PublishingService', () => {
  let service: PublishingService;
  const prisma = {
    publishAccount: {
      findUnique: jest.fn(),
    },
  };
  const wechatPublisher = {
    testConnection: jest.fn(),
  };
  const xiaohongshuPublisher = {
    getLoginStatus: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PublishingService,
        { provide: PrismaService, useValue: prisma },
        { provide: WechatPublisherService, useValue: wechatPublisher },
        { provide: XiaohongshuPublisherService, useValue: xiaohongshuPublisher },
      ],
    }).compile();

    service = module.get<PublishingService>(PublishingService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('tests wechat connection with app credentials', async () => {
    prisma.publishAccount.findUnique.mockResolvedValue({
      id: 'wechat-1',
      platform: 'wechat',
      appId: 'wx-test',
      apiToken: 'secret',
    });
    wechatPublisher.testConnection.mockResolvedValue({ accessTokenExpiresIn: 7200 });

    await expect(service.testAccountConnection('wechat-1')).resolves.toEqual({
      success: true,
      platform: 'wechat',
      message: '微信公众号凭证可用，可以继续测试草稿箱发布',
      details: { accessTokenExpiresIn: 7200 },
    });

    expect(wechatPublisher.testConnection).toHaveBeenCalledWith({
      authorizerAppid: 'wx-test',
      apiToken: 'secret',
    });
  });

  it('rejects wechat connection test when credentials are missing', async () => {
    prisma.publishAccount.findUnique.mockResolvedValue({
      id: 'wechat-1',
      platform: 'wechat',
      appId: '',
      apiToken: '',
    });

    await expect(service.testAccountConnection('wechat-1')).rejects.toBeInstanceOf(BadRequestException);
  });
});
