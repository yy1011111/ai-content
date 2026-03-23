import { RssCrawlerService } from './rss.crawler';

describe('RssCrawlerService', () => {
  const createService = () => {
    const prisma = {
      material: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
    };
    const service = new RssCrawlerService(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
    );

    return { service, prisma };
  };

  it('保存关键词参考素材时会写入关键词、封面和类别元数据', async () => {
    const { service, prisma } = createService();
    prisma.material.findFirst.mockResolvedValue(null);
    prisma.material.create.mockResolvedValue({ id: 'material-1' });

    const result = await service.saveResults([
      {
        title: '早春穿搭参考',
        content: '这是一条小红书参考笔记',
        summary: '适合通勤和约会的早春穿搭思路',
        sourceUrl: 'https://www.xiaohongshu.com/explore/demo-note',
        author: '穿搭博主',
        publishDate: null,
        platform: 'Xiaohongshu',
        keywords: ['早春穿搭'],
        imageUrl: 'https://img.example.com/cover.jpg',
        originalImageUrl: 'https://img.example.com/cover.jpg',
        hasImage: true,
        metadata: {
          materialCategory: 'xiaohongshu_reference',
          referenceKeyword: '早春穿搭',
        },
      },
    ]);

    expect(prisma.material.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: '早春穿搭参考',
        platform: 'Xiaohongshu',
        keywords: ['早春穿搭'],
        imageUrl: 'https://img.example.com/cover.jpg',
        originalImageUrl: 'https://img.example.com/cover.jpg',
        hasImage: true,
        metadata: {
          materialCategory: 'xiaohongshu_reference',
          referenceKeyword: '早春穿搭',
        },
      }),
    });
    expect(result.savedCount).toBe(1);
    expect(result.createdMaterialIds).toEqual(['material-1']);
  });

  it('遇到重复 sourceUrl 时会合并关键词和元数据', async () => {
    const { service, prisma } = createService();
    prisma.material.findFirst.mockResolvedValue({
      id: 'material-1',
      keywords: ['通勤穿搭'],
      metadata: {
        materialCategory: 'xiaohongshu_reference',
        retrieval: { sourceName: '旧来源' },
      },
    });

    await service.saveResults([
      {
        title: '重复素材',
        content: '重复素材',
        summary: '重复素材',
        sourceUrl: 'https://www.xiaohongshu.com/explore/demo-note',
        author: '穿搭博主',
        publishDate: null,
        platform: 'Xiaohongshu',
        keywords: ['小个子穿搭'],
        metadata: {
          materialCategory: 'xiaohongshu_reference',
          referenceKeyword: '小个子穿搭',
          retrieval: { sourceName: '新来源' },
        },
      },
    ]);

    expect(prisma.material.update).toHaveBeenCalledWith({
      where: { id: 'material-1' },
      data: {
        metadata: {
          materialCategory: 'xiaohongshu_reference',
          referenceKeyword: '小个子穿搭',
          retrieval: { sourceName: '新来源' },
          signal: {},
        },
        keywords: ['通勤穿搭', '小个子穿搭'],
      },
    });
  });
});
