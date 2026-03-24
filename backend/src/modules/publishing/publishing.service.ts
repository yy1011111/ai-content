import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { WechatPublisherService } from './wechat-publisher/wechat-publisher.service';
import { XiaohongshuPublisherService } from './xiaohongshu-publisher.service';

type PublishResult = {
  articleId: string;
  publishUrl?: string;
  deliveryStatus: 'draft' | 'published';
  message?: string;
};

type ConnectionTestResult = {
  success: boolean;
  platform: string;
  message: string;
  details?: Record<string, unknown>;
};

@Injectable()
export class PublishingService {
  private readonly logger = new Logger(PublishingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wechatPublisher: WechatPublisherService,
    private readonly xiaohongshuPublisher: XiaohongshuPublisherService,
  ) {}

  async getAccounts() {
    return this.prisma.publishAccount.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async createAccount(data: { platform: string; name: string; appId?: string; apiToken?: string; config?: any }) {
    return this.prisma.publishAccount.create({ data });
  }

  async updateAccount(id: string, data: any) {
    return this.prisma.publishAccount.update({ where: { id }, data });
  }

  async deleteAccount(id: string) {
    return this.prisma.publishAccount.delete({ where: { id } });
  }

  async testAccountConnection(accountId: string): Promise<ConnectionTestResult> {
    const account = await this.prisma.publishAccount.findUnique({ where: { id: accountId } });
    if (!account) {
      throw new NotFoundException('发布账号不存在');
    }

    if (account.platform === 'wechat') {
      if (!account.appId || !account.apiToken) {
        throw new BadRequestException('微信公众号测试连接需要先配置 AppID 和 AppSecret');
      }

      const result = await this.wechatPublisher.testConnection({
        authorizerAppid: account.appId,
        apiToken: account.apiToken,
      });

      return {
        success: true,
        platform: account.platform,
        message: '微信公众号凭证可用，可以继续测试草稿箱发布',
        details: result,
      };
    }

    if (account.platform === 'xiaohongshu') {
      const status = await this.xiaohongshuPublisher.getLoginStatus();
      return {
        success: status.loggedIn,
        platform: account.platform,
        message: status.loggedIn
          ? '小红书创作后台已登录，可以继续辅助发布'
          : '小红书创作后台未登录，请先完成一次登录授权',
        details: status,
      };
    }

    throw new BadRequestException(`暂不支持 ${account.platform} 平台的测试连接`);
  }

  async startXiaohongshuCreatorLogin(accountId: string) {
    const account = await this.prisma.publishAccount.findUnique({ where: { id: accountId } });
    if (!account) {
      throw new NotFoundException('发布账号不存在');
    }
    if (account.platform !== 'xiaohongshu') {
      throw new BadRequestException('当前账号不是小红书账号');
    }

    return this.xiaohongshuPublisher.startLogin();
  }

  async getXiaohongshuCreatorStatus(accountId: string) {
    const account = await this.prisma.publishAccount.findUnique({ where: { id: accountId } });
    if (!account) {
      throw new NotFoundException('发布账号不存在');
    }
    if (account.platform !== 'xiaohongshu') {
      throw new BadRequestException('当前账号不是小红书账号');
    }

    return this.xiaohongshuPublisher.getLoginStatus();
  }

  async publishArticle(articleId: string, accountId: string) {
    const article = await this.prisma.article.findUnique({ where: { id: articleId } });
    if (!article) {
      throw new NotFoundException('文章不存在');
    }

    const account = await this.prisma.publishAccount.findUnique({ where: { id: accountId } });
    if (!account) {
      throw new NotFoundException('发布账号不存在');
    }

    const record = await this.prisma.publishRecord.create({
      data: {
        articleId: article.id,
        accountId: account.id,
        platform: account.platform,
        status: 'pending',
      },
    });

    try {
      let result: PublishResult;

      if (account.platform === 'wechat') {
        if (!account.apiToken || !account.appId) {
          throw new BadRequestException('微信公众号发布需要配置 AppID 和 AppSecret');
        }

        const config = (account.config as Record<string, any>) || {};
        result = await this.wechatPublisher.publish({
          apiToken: account.apiToken,
          authorizerAppid: account.appId,
          title: article.title,
          markdownContent: article.contentFormat === 'markdown' ? article.content : undefined,
          htmlContent: article.finalHtml || (article.contentFormat === 'html' ? article.content : undefined),
          coverUrl: article.coverImage || undefined,
          needOpenComment: config.openComment !== undefined ? Number(config.openComment) : 1,
          onlyFansCanComment: config.onlyFansCanComment !== undefined ? Number(config.onlyFansCanComment) : 0,
        });
      } else if (account.platform === 'xiaohongshu') {
        if (article.contentType !== 'xiaohongshu' || !article.xiaohongshuData) {
          throw new BadRequestException('当前内容不是可发布的小红书笔记');
        }

        const noteData = article.xiaohongshuData as {
          title?: string;
          caption?: string;
          hashtags?: string[];
          slides?: Array<{ title?: string; cardImageUrl?: string | null; imageUrl?: string | null }>;
        };

        result = await this.xiaohongshuPublisher.publishDraft({
          articleId: article.id,
          title: noteData.title || article.title,
          caption: noteData.caption || article.content,
          hashtags: Array.isArray(noteData.hashtags) ? noteData.hashtags : [],
          slides: Array.isArray(noteData.slides) ? noteData.slides : [],
        });
      } else {
        throw new BadRequestException(`暂不支持 ${account.platform} 平台发布`);
      }

      const updates: Array<Promise<unknown>> = [
        this.prisma.publishRecord.update({
          where: { id: record.id },
          data: {
            status: 'success',
            publishUrl: result.publishUrl || result.articleId,
          },
        }),
      ];

      if (result.deliveryStatus === 'published') {
        updates.push(
          this.prisma.article.update({
            where: { id: article.id },
            data: { status: 'published' },
          }),
        );
      }

      await this.prisma.$transaction(updates as any);

      return {
        success: true,
        articleId: result.articleId,
        publishUrl: result.publishUrl,
        deliveryStatus: result.deliveryStatus,
        message: result.message || '发布完成',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      this.logger.error(`发布失败 [articleId: ${articleId}, accountId: ${accountId}]: ${message}`);

      await this.prisma.publishRecord.update({
        where: { id: record.id },
        data: {
          status: 'failed',
          errorMessage: message,
        },
      });

      throw new BadRequestException(`发布失败: ${message}`);
    }
  }

  async getRecordsByArticle(articleId: string) {
    return this.prisma.publishRecord.findMany({
      where: { articleId },
      include: { account: true },
      orderBy: { createdAt: 'desc' },
    });
  }
}
