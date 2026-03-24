import { Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { WechatCompiler } from './wechat-compiler';

type WechatAccessTokenResponse = {
  access_token?: string;
  expires_in?: number;
  errcode?: number;
  errmsg?: string;
};

type WechatUploadImageResponse = {
  url?: string;
  media_id?: string;
  errcode?: number;
  errmsg?: string;
};

type WechatAddDraftResponse = {
  media_id?: string;
  errcode?: number;
  errmsg?: string;
};

type ImageUploadMode = 'cover' | 'content';

export interface WechatPublishParams {
  apiToken: string;
  authorizerAppid: string;
  title: string;
  markdownContent?: string;
  htmlContent?: string;
  coverUrl?: string;
  needOpenComment?: number;
  onlyFansCanComment?: number;
  author?: string;
}

@Injectable()
export class WechatPublisherService {
  private readonly logger = new Logger(WechatPublisherService.name);

  async testConnection(params: Pick<WechatPublishParams, 'authorizerAppid' | 'apiToken'>): Promise<{
    accessTokenExpiresIn?: number;
  }> {
    const token = await this.getAccessToken(params.authorizerAppid, params.apiToken);
    return {
      accessTokenExpiresIn: token.expiresIn,
    };
  }

  async publish(params: WechatPublishParams): Promise<{
    articleId: string;
    publishUrl?: string;
    deliveryStatus: 'draft';
    message: string;
  }> {
    try {
      const rawHtml = params.htmlContent
        ? WechatCompiler.normalizeHtml(params.htmlContent)
        : await WechatCompiler.compile(params.markdownContent || '');

      const accessTokenResult = await this.getAccessToken(params.authorizerAppid, params.apiToken);
      const prepared = await this.prepareArticleHtml(rawHtml, accessTokenResult.accessToken);

      const coverSource = params.coverUrl || prepared.firstImageUrl;
      if (!coverSource) {
        throw new Error('缺少封面图。请先为文章配置封面，或确保正文中至少包含一张图片。');
      }

      const coverUpload = await this.uploadImage(accessTokenResult.accessToken, coverSource, 'cover');
      const digest = this.buildDigest(prepared.plainText);

      const response = await fetch(
        `https://api.weixin.qq.com/cgi-bin/draft/add?access_token=${accessTokenResult.accessToken}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            articles: [
              {
                article_type: 'news',
                title: params.title,
                author: params.author || '',
                digest,
                content: prepared.html,
                content_source_url: '',
                thumb_media_id: coverUpload.mediaId,
                need_open_comment: params.needOpenComment ?? 1,
                only_fans_can_comment: params.onlyFansCanComment ?? 0,
              },
            ],
          }),
        },
      );

      const data = (await response.json()) as WechatAddDraftResponse;

      if (!response.ok || data.errcode) {
        throw new Error(data.errmsg || '微信草稿箱接口调用失败');
      }

      return {
        articleId: String(data.media_id || ''),
        deliveryStatus: 'draft',
        message: '已推送到微信官方草稿箱',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      this.logger.error(`Failed to publish to official WeChat draft box: ${message}`);
      throw new Error(message);
    }
  }

  private async getAccessToken(
    appId: string,
    appSecret: string,
  ): Promise<{ accessToken: string; expiresIn?: number }> {
    const response = await fetch(
      `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(appSecret)}`,
    );
    const data = (await response.json()) as WechatAccessTokenResponse;

    if (!response.ok || data.errcode || !data.access_token) {
      throw new Error(data.errmsg || '获取微信 access_token 失败');
    }

    return {
      accessToken: data.access_token,
      expiresIn: data.expires_in,
    };
  }

  private async prepareArticleHtml(
    htmlContent: string,
    accessToken: string,
  ): Promise<{
    html: string;
    firstImageUrl: string | null;
    plainText: string;
  }> {
    const $ = cheerio.load(htmlContent, { decodeEntities: false });
    let firstImageUrl: string | null = null;

    const images = $('img').toArray();
    for (const image of images) {
      const originalSrc = $(image).attr('src');
      if (!originalSrc) {
        continue;
      }

      if (!firstImageUrl) {
        firstImageUrl = originalSrc;
      }

      const uploaded = await this.uploadImage(accessToken, originalSrc, 'content');
      $(image).attr('src', uploaded.url);
    }

    const plainText = $.root().text().replace(/\s+/g, ' ').trim();

    return {
      html: $.html(),
      firstImageUrl,
      plainText,
    };
  }

  private buildDigest(plainText: string): string {
    if (!plainText) {
      return '来自内容工厂的自动草稿';
    }

    return plainText.slice(0, 120);
  }

  private async uploadImage(
    accessToken: string,
    imageSource: string,
    mode: ImageUploadMode,
  ): Promise<{ url: string; mediaId: string }> {
    const filePayload = await this.fetchImageAsMultipartPayload(imageSource);
    const form = new FormData();
    const binary = new Uint8Array(filePayload.buffer);
    form.append('media', new Blob([binary], { type: filePayload.contentType }), filePayload.filename);

    const endpoint =
      mode === 'cover'
        ? `https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=${accessToken}&type=image`
        : `https://api.weixin.qq.com/cgi-bin/media/uploadimg?access_token=${accessToken}`;

    const response = await fetch(endpoint, {
      method: 'POST',
      body: form,
    });

    const data = (await response.json()) as WechatUploadImageResponse;

    if (!response.ok || data.errcode) {
      throw new Error(data.errmsg || '上传微信图片失败');
    }

    if (mode === 'cover' && !data.media_id) {
      throw new Error('微信封面上传成功，但未返回 media_id');
    }
    if (!data.url) {
      throw new Error('微信图片上传成功，但未返回图片地址');
    }

    return {
      url: data.url,
      mediaId: data.media_id || '',
    };
  }

  private async fetchImageAsMultipartPayload(imageSource: string): Promise<{
    buffer: Buffer;
    filename: string;
    contentType: string;
  }> {
    if (imageSource.startsWith('data:')) {
      const parsed = this.parseDataUrl(imageSource);
      return {
        buffer: parsed.buffer,
        filename: parsed.filename,
        contentType: parsed.contentType,
      };
    }

    const response = await fetch(imageSource);
    if (!response.ok) {
      throw new Error(`下载图片失败: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || 'image/png';
    const filename = this.resolveFilename(imageSource, contentType);

    return {
      buffer: Buffer.from(arrayBuffer),
      filename,
      contentType,
    };
  }

  private parseDataUrl(dataUrl: string): {
    buffer: Buffer;
    filename: string;
    contentType: string;
  } {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      throw new Error('不支持的数据图片格式');
    }

    const contentType = match[1];
    const extension = this.extensionFromContentType(contentType);

    return {
      buffer: Buffer.from(match[2], 'base64'),
      filename: `image.${extension}`,
      contentType,
    };
  }

  private resolveFilename(imageSource: string, contentType: string): string {
    try {
      const url = new URL(imageSource);
      const pathname = url.pathname.split('/').pop() || '';
      if (pathname.includes('.')) {
        return pathname;
      }
    } catch {
      // ignore and fall back
    }

    return `image.${this.extensionFromContentType(contentType)}`;
  }

  private extensionFromContentType(contentType: string): string {
    if (contentType.includes('jpeg')) return 'jpg';
    if (contentType.includes('gif')) return 'gif';
    if (contentType.includes('webp')) return 'webp';
    if (contentType.includes('svg')) return 'svg';
    return 'png';
  }
}
