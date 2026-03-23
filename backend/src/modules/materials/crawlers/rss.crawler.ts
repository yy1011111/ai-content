import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { JinaReaderService } from './jina-reader.service';
import { ImageFilterService } from '../image-filter.service';
import { QiniuService } from '../../storage/qiniu.service';
import Parser from 'rss-parser';

// RSS 采集结果
export interface CrawlResult {
  title: string;
  content: string;
  summary: string;
  sourceUrl: string;
  author: string;
  publishDate: Date | null;
  platform: string;
  keywords?: string[];
  imageUrl?: string | null;
  originalImageUrl?: string | null;
  hasImage?: boolean;
  metadata?: Record<string, any> | null;
}

@Injectable()
export class RssCrawlerService {
  private readonly logger = new Logger(RssCrawlerService.name);
  private parser: Parser;

  constructor(
    private prisma: PrismaService,
    private jinaReader: JinaReaderService,
    private imageFilter: ImageFilterService,
    private qiniuService: QiniuService,
  ) {
    this.parser = new Parser({
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AiContentBot/1.0)',
      },
    });
  }

  // 采集 RSS 源
  async crawl(url: string, platform: string): Promise<CrawlResult[]> {
    this.logger.log(`开始采集 RSS: ${url}`);

    try {
      const feed = await this.parser.parseURL(url);
      const results: CrawlResult[] = [];

      for (const item of feed.items || []) {
        results.push({
          title: item.title || '无标题',
          content: item['content:encoded'] || item.content || item.contentSnippet || '',
          summary: item.contentSnippet || item.summary || '',
          sourceUrl: item.link || '',
          author: item.creator || item.author || '',
          publishDate: item.pubDate ? new Date(item.pubDate) : null,
          platform,
          metadata: null,
        });
      }

      this.logger.log(`RSS 采集完成: ${url}, 获取 ${results.length} 条`);
      return results;
    } catch (error) {
      this.logger.error(`RSS 采集失败: ${url}`, error);
      throw error;
    }
  }

  // 保存采集结果到数据库（去重）
  async saveResults(results: CrawlResult[]): Promise<{ savedCount: number; createdMaterialIds: string[] }> {
    let savedCount = 0;
    let updatedCount = 0;
    const createdMaterialIds: string[] = [];

    for (const item of results) {
      // 根据 sourceUrl 去重（空 URL 跳过去重，直接写入）
      if (item.sourceUrl) {
        const existing = await this.prisma.material.findFirst({
          where: { sourceUrl: item.sourceUrl },
        });
        if (existing) {
          const mergedMetadata = this.mergeMetadata(existing.metadata, item.metadata);
          const mergedKeywords = Array.from(new Set([...(existing.keywords || []), ...(item.keywords || [])]));
          const shouldUpdateKeywords = mergedKeywords.length !== (existing.keywords || []).length;
          if (mergedMetadata || shouldUpdateKeywords) {
            await this.prisma.material.update({
              where: { id: existing.id },
              data: {
                metadata: mergedMetadata ?? undefined,
                keywords: mergedKeywords,
              },
            });
            updatedCount++;
          }
          continue;
        }
      }

      {
        const created = await this.prisma.material.create({
          data: {
            title: item.title,
            content: item.content,
            summary: item.summary,
            sourceUrl: item.sourceUrl,
            author: item.author,
            publishDate: item.publishDate,
            platform: item.platform,
            status: 'unmined',
            keywords: item.keywords || [],
            imageUrl: item.imageUrl ?? undefined,
            originalImageUrl: item.originalImageUrl ?? item.imageUrl ?? undefined,
            hasImage: item.hasImage ?? Boolean(item.imageUrl || item.originalImageUrl),
            metadata: item.metadata ?? undefined,
          },
        });
        savedCount++;
        createdMaterialIds.push(created.id);
      }
    }

    this.logger.log(`保存 ${savedCount} 条新素材，补写 ${updatedCount} 条已有素材元数据（${results.length - savedCount} 条非新增）`);
    return { savedCount, createdMaterialIds };
  }

  /**
   * 为素材提取并保存配图
   * 从素材源URL提取图片，过滤后上传到七牛云
   */
  async extractAndSaveImage(materialId: string, sourceUrl: string): Promise<string | null> {
    try {
      this.logger.log(`开始为素材 ${materialId} 提取图片: ${sourceUrl}`);

      // 1. 从网页提取图片
      const images = await this.jinaReader.extractImages(sourceUrl);
      if (images.length === 0) {
        this.logger.debug(`素材 ${materialId} 未找到图片`);
        return null;
      }

      // 2. 过滤优质图片
      const qualityImages = await this.imageFilter.filterQualityImages(images, { maxCount: 1 });
      if (qualityImages.length === 0) {
        this.logger.debug(`素材 ${materialId} 无优质图片`);
        return null;
      }

      const originalUrl = qualityImages[0];

      // 3. 上传到七牛云
      const cdnUrl = await this.qiniuService.uploadFromUrl(originalUrl);
      if (!cdnUrl) {
        // 七牛云上传失败，使用原始 URL
        this.logger.warn(`素材 ${materialId} 七牛云上传失败，保留原始URL`);
        await this.prisma.material.update({
          where: { id: materialId },
          data: {
            imageUrl: originalUrl,
            originalImageUrl: originalUrl,
            hasImage: true,
          },
        });
        return originalUrl;
      }

      // 4. 更新素材记录
      await this.prisma.material.update({
        where: { id: materialId },
        data: {
          imageUrl: cdnUrl,
          originalImageUrl: originalUrl,
          hasImage: true,
        },
      });

      this.logger.log(`素材 ${materialId} 配图提取成功: ${cdnUrl}`);
      return cdnUrl;
    } catch (error) {
      this.logger.error(`素材 ${materialId} 图片提取失败`, error);
      return null;
    }
  }

  /**
   * 批量为无图素材提取配图
   * @param limit 处理数量限制
   */
  async batchExtractImages(limit: number = 50): Promise<{ processed: number; success: number }> {
    // 查找无图且有源URL的素材
    const materials = await this.prisma.material.findMany({
      where: {
        hasImage: false,
        sourceUrl: { not: '' },
      },
      take: limit,
      orderBy: { collectDate: 'desc' },
    });

    this.logger.log(`开始批量提取图片，共 ${materials.length} 条素材`);

    let success = 0;
    for (const material of materials) {
      const url = await this.extractAndSaveImage(material.id, material.sourceUrl);
      if (url) success++;
    }

    this.logger.log(`批量图片提取完成: 处理 ${materials.length} 条，成功 ${success} 条`);
    return { processed: materials.length, success };
  }

  /**
   * 为指定素材列表补提图片，用于采集后立即补齐真实图片资产
   */
  async extractImagesForMaterialIds(materialIds: string[]): Promise<{ processed: number; success: number }> {
    if (materialIds.length === 0) {
      return { processed: 0, success: 0 };
    }

    const materials = await this.prisma.material.findMany({
      where: {
        id: { in: materialIds },
        hasImage: false,
        sourceUrl: { not: '' },
      },
      orderBy: { collectDate: 'desc' },
    });

    let success = 0;
    for (const material of materials) {
      const url = await this.extractAndSaveImage(material.id, material.sourceUrl);
      if (url) success++;
    }

    this.logger.log(`指定素材图片补提完成: 处理 ${materials.length} 条，成功 ${success} 条`);
    return { processed: materials.length, success };
  }

  private mergeMetadata(existing: unknown, incoming?: Record<string, any> | null) {
    if (!incoming || Object.keys(incoming).length === 0) {
      return null;
    }

    const base = this.toRecord(existing);
    return {
      ...base,
      ...incoming,
      signal: {
        ...this.toRecord(base.signal),
        ...this.toRecord(incoming.signal),
      },
      retrieval: {
        ...this.toRecord(base.retrieval),
        ...this.toRecord(incoming.retrieval),
      },
    };
  }

  private toRecord(value: unknown): Record<string, any> {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {};
  }
}
