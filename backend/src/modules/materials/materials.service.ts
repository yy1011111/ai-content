import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemLogsService } from '../system-logs/system-logs.service';
import { QueryMaterialDto } from './dto/query-material.dto';
import { RssCrawlerService } from './crawlers/rss.crawler';
import { XiaohongshuKeywordCrawlerService } from './crawlers/xiaohongshu-keyword-crawler.service';
import {
  XiaohongshuSortType,
  XiaohongshuTimeRangeType,
} from './dto/xiaohongshu-keyword-collect.dto';

@Injectable()
export class MaterialsService {
  private readonly logger = new Logger(MaterialsService.name);

  constructor(
    private prisma: PrismaService,
    private systemLogsService: SystemLogsService,
    @InjectQueue('crawl-queue') private crawlQueue: Queue,
    private rssCrawler: RssCrawlerService,
    private xiaohongshuKeywordCrawler: XiaohongshuKeywordCrawlerService,
  ) {}

  async findAll(query: QueryMaterialDto) {
    const {
      page = 1,
      limit = 20,
      keyword,
      status,
      platform,
      sortBy = 'collectDate',
      sortOrder = 'desc',
    } = query;

    const where: Prisma.MaterialWhereInput = {};

    if (keyword) {
      where.title = { contains: keyword, mode: 'insensitive' };
    }
    if (status) {
      where.status = status;
    }
    if (platform) {
      where.platform = platform;
    }
    if (query.category) {
      const andFilters = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [];
      where.AND = [
        ...andFilters,
        {
          metadata: {
            path: ['materialCategory'],
            equals: query.category,
          },
        } as any,
      ];
    }

    const sortFieldMap: Record<string, string> = {
      collectDate: 'collectDate',
      publishDate: 'publishDate',
      title: 'title',
      platform: 'platform',
    };
    const orderField = sortFieldMap[sortBy] || 'collectDate';

    const [items, total] = await Promise.all([
      this.prisma.material.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { [orderField]: sortOrder },
      }),
      this.prisma.material.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string) {
    const material = await this.prisma.material.findUnique({ where: { id } });
    if (!material) {
      throw new NotFoundException('素材不存在');
    }
    return material;
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.material.delete({ where: { id } });
  }

  async batchRemove(ids: string[]) {
    const result = await this.prisma.material.deleteMany({
      where: { id: { in: ids } },
    });
    return { deleted: result.count };
  }

  async triggerCollect(sourceIds?: string[]) {
    const where: Prisma.SourceWhereInput = { enabled: true };
    if (sourceIds && sourceIds.length > 0) {
      where.id = { in: sourceIds };
    }

    const sources = await this.prisma.source.findMany({ where });

    if (sources.length === 0) {
      return { jobCount: 0, message: '没有已启用的信息源，请先在设置中添加或启用信息源' };
    }

    for (const source of sources) {
      await this.crawlQueue.add('crawl', {
        sourceId: source.id,
        sourceName: source.name,
        sourceUrl: source.url,
        sourceType: source.type,
        platform: (source.config as any)?.platform || source.name,
        config: source.config,
      });

      await this.prisma.source.update({
        where: { id: source.id },
        data: { lastCrawlTime: new Date() },
      });
    }

    this.logger.log(`已添加 ${sources.length} 个采集任务到队列`);
    await this.systemLogsService.record(`启动了基于 ${sources.length} 个平台的爬虫采集任务`, 'info');
    return { jobCount: sources.length, message: '采集任务已启动' };
  }

  async openXiaohongshuLogin() {
    const result = await this.xiaohongshuKeywordCrawler.startLogin();
    await this.systemLogsService.record(
      result.success ? '小红书登录授权成功，可开始关键词采集' : `小红书登录授权未完成：${result.message}`,
      result.success ? 'success' : 'warning',
    );
    return result;
  }

  async collectXiaohongshuByKeyword(
    keyword: string,
    limit: number = 12,
    sort: XiaohongshuSortType = 'general',
    timeRange: XiaohongshuTimeRangeType = '7d',
  ) {
    const results = await this.xiaohongshuKeywordCrawler.collectByKeyword(keyword, limit, sort, timeRange);
    const { savedCount, createdMaterialIds } = await this.rssCrawler.saveResults(results);

    await this.systemLogsService.record(
      `小红书关键词「${keyword}」采集完成：排序 ${sort}，时间范围 ${timeRange}，抓取 ${results.length} 条，入库 ${savedCount} 条`,
      'success',
    );

    return {
      keyword,
      sort,
      timeRange,
      total: results.length,
      saved: savedCount,
      createdMaterialIds,
      message: `关键词「${keyword}」采集完成（排序：${sort}，时间范围：${timeRange}），抓取 ${results.length} 条，入库 ${savedCount} 条`,
    };
  }

  async getStats() {
    const [total, unmined, mined, failed] = await Promise.all([
      this.prisma.material.count(),
      this.prisma.material.count({ where: { status: 'unmined' } }),
      this.prisma.material.count({ where: { status: 'mined' } }),
      this.prisma.material.count({ where: { status: 'failed' } }),
    ]);

    const byPlatform = await this.prisma.material.groupBy({
      by: ['platform'],
      _count: { id: true },
    });

    return {
      total,
      unmined,
      mined,
      failed,
      byPlatform: byPlatform.map((platform) => ({
        platform: platform.platform,
        count: platform._count.id,
      })),
    };
  }

  async ensureImagesForMaterials(materialIds: string[]) {
    return this.rssCrawler.extractImagesForMaterialIds(materialIds);
  }
}
