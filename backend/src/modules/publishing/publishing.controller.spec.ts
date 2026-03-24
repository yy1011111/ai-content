jest.mock('./publishing.service', () => ({
  PublishingService: class {},
}));

import { Test, TestingModule } from '@nestjs/testing';
import { PublishingController } from './publishing.controller';
import { PublishingService } from './publishing.service';

describe('PublishingController', () => {
  let controller: PublishingController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PublishingController],
      providers: [
        {
          provide: PublishingService,
          useValue: {
            getAccounts: jest.fn(),
            createAccount: jest.fn(),
            updateAccount: jest.fn(),
            deleteAccount: jest.fn(),
            testAccountConnection: jest.fn(),
            startXiaohongshuCreatorLogin: jest.fn(),
            getXiaohongshuCreatorStatus: jest.fn(),
            publishArticle: jest.fn(),
            getRecordsByArticle: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<PublishingController>(PublishingController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
