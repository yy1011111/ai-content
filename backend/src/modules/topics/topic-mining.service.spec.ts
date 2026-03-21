import { TopicMiningService } from './topic-mining.service';

describe('TopicMiningService', () => {
  const createService = () => {
    const prisma = {
      source: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      material: {
        findMany: jest.fn(),
      },
      topic: {
        create: jest.fn(),
        findMany: jest.fn(),
      },
    };
    const aiClient = {
      generate: jest.fn(),
    };
    const defaultModels = {
      getDefaults: jest.fn().mockResolvedValue({
        topicSelection: 'model-topic',
      }),
    };
    const systemLogsService = {
      record: jest.fn().mockResolvedValue(undefined),
    };
    const contentStrategiesService = {
      getDefaultStrategy: jest.fn().mockResolvedValue({
        name: 'AI 增长内容策略',
        industry: 'AI / 数字化增长',
        targetAudience: '想用 AI 提升效率、获客或打造一人业务的创业者、运营和小团队负责人',
        commercialGoal: '通过内容吸引目标用户，建立专业认知，并进一步转化为咨询、服务、课程或社群成交',
        corePainPoints: '不会选题、内容太空泛、缺少转化钩子',
        writingAngles: '趋势解读、痛点拆解、认知反转、实操方法、案例拆解',
        toneAndStyle: '务实、通俗、带结论',
      }),
    };
    const crawlerRegistry = {
      getCrawler: jest.fn().mockReturnValue(null),
    };
    const rssCrawler = {
      crawl: jest.fn(),
      saveResults: jest.fn(),
    };

    const service = new TopicMiningService(
      prisma as any,
      aiClient as any,
      defaultModels as any,
      systemLogsService as any,
      contentStrategiesService as any,
      crawlerRegistry as any,
      rssCrawler as any,
    );

    return { service, prisma, aiClient, defaultModels, systemLogsService, contentStrategiesService, crawlerRegistry, rssCrawler };
  };

  it('会基于用户输入生成 3-5 个不同切入点的候选选题并入库', async () => {
    const { service, prisma, aiClient, systemLogsService, contentStrategiesService } = createService();

    aiClient.generate
      .mockResolvedValueOnce(
        JSON.stringify({
          normalizedSeed: '私域运营',
          intent: '围绕私域运营挖掘可直接创作的内容方向',
          audience: '门店经营者',
          keywords: ['私域运营', '复购', '用户留存'],
          searchQueries: ['私域运营怎么提升复购', '门店私域怎么做'],
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify([
          {
            title: '门店私域做不起来，问题往往不在加好友',
            angle: '认知反转',
            summary: '拆解私域运营常见误区，解释为什么承接设计比拉新更关键。',
            score: 89,
            dimension_scores: {
              audienceFit: 18,
              emotionalValue: 17,
              simplificationPotential: 18,
              networkVolume: 17,
              contentValue: 19,
            },
            reasoning: '适合先做长文，再延展成小红书拆解卡片。',
            keywords: ['私域运营', '门店复购'],
            search_queries: ['私域运营误区有哪些'],
            material_ids: ['m-1', 'm-2'],
          },
          {
            title: '餐饮门店提升复购，可以先从这 3 个私域动作下手',
            angle: '实操方法',
            summary: '给出三个低成本动作，帮助用户理解如何把私域真正落地。',
            score: 86,
            dimension_scores: {
              audienceFit: 17,
              emotionalValue: 16,
              simplificationPotential: 18,
              networkVolume: 16,
              contentValue: 19,
            },
            reasoning: '适合做成操作型文章或图文清单。',
            keywords: ['餐饮私域', '复购'],
            search_queries: ['餐饮私域怎么做'],
            material_ids: ['m-2'],
          },
        ]),
      );

    prisma.material.findMany
      .mockResolvedValueOnce([
        {
          id: 'm-1',
          title: '某品牌开始用会员社群提升复购',
          summary: '通过社群承接和优惠券联动提升老客复购。',
          content: null,
          platform: '36Kr',
          collectDate: new Date('2026-03-17T00:00:00.000Z'),
        },
        {
          id: 'm-2',
          title: '餐饮私域讨论升温',
          summary: '越来越多门店在讨论如何做私域留存。',
          content: null,
          platform: '小红书',
          collectDate: new Date('2026-03-16T00:00:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([]);

    prisma.topic.create
      .mockResolvedValueOnce({ id: 'topic-1' })
      .mockResolvedValueOnce({ id: 'topic-2' });
    prisma.topic.findMany.mockResolvedValue([
      {
        id: 'topic-2',
        title: '餐饮门店提升复购，可以先从这 3 个私域动作下手',
        sourceType: '智能挖掘',
        summary: '给出三个低成本动作，帮助用户理解如何把私域真正落地。',
        reasoning: '切入点：实操方法\n适合做成操作型文章或图文清单。',
        keywords: ['餐饮私域', '复购'],
        searchQueries: ['餐饮私域怎么做'],
        aiScore: 86,
        scoreDetails: {},
        status: 'completed',
        isPublished: false,
        createdAt: new Date('2026-03-17T00:00:00.000Z'),
        updatedAt: new Date('2026-03-17T00:00:00.000Z'),
        materials: [
          { material: { id: 'm-2', title: '餐饮私域讨论升温', platform: '小红书' } },
        ],
      },
      {
        id: 'topic-1',
        title: '门店私域做不起来，问题往往不在加好友',
        sourceType: '智能挖掘',
        summary: '拆解私域运营常见误区，解释为什么承接设计比拉新更关键。',
        reasoning: '切入点：认知反转\n适合先做长文，再延展成小红书拆解卡片。',
        keywords: ['私域运营', '门店复购'],
        searchQueries: ['私域运营误区有哪些'],
        aiScore: 89,
        scoreDetails: {},
        status: 'completed',
        isPublished: false,
        createdAt: new Date('2026-03-17T00:00:00.000Z'),
        updatedAt: new Date('2026-03-17T00:00:00.000Z'),
        materials: [
          { material: { id: 'm-1', title: '某品牌开始用会员社群提升复购', platform: '36Kr' } },
          { material: { id: 'm-2', title: '餐饮私域讨论升温', platform: '小红书' } },
        ],
      },
    ]);

    const result = await service.discoverTopicsFromSeed('想写私域运营，尤其是门店复购方向');

    expect(aiClient.generate).toHaveBeenCalledTimes(2);
    expect(prisma.topic.create).toHaveBeenCalledTimes(2);
    expect(prisma.topic.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceType: '智能挖掘',
          title: '门店私域做不起来，问题往往不在加好友',
        }),
      }),
    );
    expect(result.created).toBe(2);
    expect(result.analysis.normalizedSeed).toBe('私域运营');
    expect(result.retrieval).toEqual({
      scannedSources: 0,
      fetchedCount: 0,
      candidateCount: 0,
      matchedCount: 0,
      rejectedCount: 0,
      savedCount: 0,
    });
    expect(result.topics[0].sourceType).toBe('智能挖掘');
    expect(contentStrategiesService.getDefaultStrategy).toHaveBeenCalled();
    expect(systemLogsService.record).toHaveBeenCalled();
  });

  it('only queries materials from bound sources when the strategy has sourceIds', async () => {
    const { service, prisma, contentStrategiesService } = createService();

    contentStrategiesService.getDefaultStrategy.mockResolvedValue({
      name: '公众号热点深度策略',
      industry: '公众号内容创作',
      targetAudience: '公众号读者',
      commercialGoal: '提升阅读量',
      corePainPoints: '不会筛热点',
      writingAngles: '热点解读',
      toneAndStyle: '清晰有观点',
      sourceIds: ['source-wechat', 'source-zhihu'],
    });

    prisma.material.findMany.mockResolvedValue([]);

    const result = await service.mineTopics();

    expect(result.created).toBe(0);
    expect(prisma.material.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: [
            {
              OR: [
                {
                  metadata: {
                    path: ['retrieval', 'sourceId'],
                    equals: 'source-wechat',
                  },
                },
                {
                  metadata: {
                    path: ['retrieval', 'sourceId'],
                    equals: 'source-zhihu',
                  },
                },
              ],
            },
          ],
        }),
      }),
    );
  });
});
