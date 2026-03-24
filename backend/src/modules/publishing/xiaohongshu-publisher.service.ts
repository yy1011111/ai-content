import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { chromium } from 'playwright';

export interface XiaohongshuPublishSlide {
  title?: string;
  cardImageUrl?: string | null;
  imageUrl?: string | null;
}

export interface XiaohongshuPublishParams {
  articleId: string;
  title: string;
  caption: string;
  hashtags: string[];
  slides: XiaohongshuPublishSlide[];
}

@Injectable()
export class XiaohongshuPublisherService {
  private readonly logger = new Logger(XiaohongshuPublisherService.name);
  private readonly profileDir = path.join(process.cwd(), '.runtime', 'xiaohongshu-creator-profile');
  private readonly publishPageUrl = 'https://creator.xiaohongshu.com/publish/publish';
  private loginBrowserProcess: ReturnType<typeof spawn> | null = null;

  async startLogin(): Promise<{ success: boolean; message: string }> {
    if (this.loginBrowserProcess && !this.loginBrowserProcess.killed) {
      return {
        success: false,
        message: '小红书创作后台登录窗口已经打开，请先在弹出的 Edge 窗口中完成登录。',
      };
    }

    this.loginBrowserProcess = this.openCreatorWindow(this.publishPageUrl);
    return {
      success: false,
      message: '已打开小红书创作后台登录窗口，请先完成一次登录授权。登录完成后关闭该窗口，再回到系统继续发布。',
    };
  }

  async getLoginStatus(): Promise<{ loggedIn: boolean; currentUrl?: string }> {
    const context = await chromium.launchPersistentContext(this.profileDir, {
      channel: 'msedge',
      headless: true,
      viewport: { width: 1440, height: 960 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      args: ['--disable-blink-features=AutomationControlled'],
    });

    try {
      const page = context.pages()[0] || (await context.newPage());
      await page.goto(this.publishPageUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await page.waitForTimeout(2500);
      const currentUrl = page.url();
      return {
        loggedIn: !currentUrl.includes('/login'),
        currentUrl,
      };
    } finally {
      await context.close().catch(() => null);
    }
  }

  async publishDraft(params: XiaohongshuPublishParams): Promise<{
    articleId: string;
    publishUrl: string;
    deliveryStatus: 'draft';
    message: string;
  }> {
    const status = await this.getLoginStatus();
    if (!status.loggedIn) {
      throw new Error('小红书创作后台未登录，请先到平台账号页点击“登录创作后台”。');
    }

    const packageDir = await this.preparePublishPackage(params);
    this.openExplorer(packageDir);
    this.openCreatorWindow(this.publishPageUrl);

    return {
      articleId: params.articleId,
      publishUrl: this.publishPageUrl,
      deliveryStatus: 'draft',
      message: `已打开小红书创作后台，并准备好素材包：${packageDir}。请在浏览器中完成最后发布。`,
    };
  }

  private async preparePublishPackage(params: XiaohongshuPublishParams) {
    const safeTitle = this.sanitizeFilename(params.title);
    const packageDir = path.join(
      this.profileDir,
      'publish-packages',
      `${Date.now()}-${params.articleId.slice(-6)}-${safeTitle}`,
    );

    await fs.mkdir(packageDir, { recursive: true });

    const noteText = [
      params.title,
      '',
      params.caption,
      '',
      params.hashtags.map((tag) => (tag.startsWith('#') ? tag : `#${tag}`)).join(' '),
    ].join('\n');

    await fs.writeFile(path.join(packageDir, 'note.txt'), noteText, 'utf8');
    await fs.writeFile(
      path.join(packageDir, 'meta.json'),
      JSON.stringify(
        {
          articleId: params.articleId,
          title: params.title,
          caption: params.caption,
          hashtags: params.hashtags,
          createdAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      'utf8',
    );

    let imageIndex = 1;
    for (const slide of params.slides) {
      const sourceUrl = slide.cardImageUrl || slide.imageUrl;
      if (!sourceUrl) {
        continue;
      }

      const extension = this.getExtension(sourceUrl);
      const slideTitle = this.sanitizeFilename(slide.title || `slide-${imageIndex}`);
      const fileName = `${String(imageIndex).padStart(2, '0')}-${slideTitle}.${extension}`;
      const filePath = path.join(packageDir, fileName);

      try {
        await this.downloadAsset(sourceUrl, filePath);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown error';
        this.logger.warn(`Failed to download Xiaohongshu slide asset: ${message}`);
      }

      imageIndex += 1;
    }

    return packageDir;
  }

  private async downloadAsset(url: string, filePath: string) {
    if (url.startsWith('data:')) {
      const commaIndex = url.indexOf(',');
      const base64Payload = url.slice(commaIndex + 1);
      const buffer = Buffer.from(base64Payload, 'base64');
      await fs.writeFile(filePath, buffer);
      return;
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    await fs.writeFile(filePath, Buffer.from(arrayBuffer));
  }

  private openCreatorWindow(url: string) {
    const args = [`--user-data-dir=${this.profileDir}`, '--disable-blink-features=AutomationControlled', url];
    const child = spawn('cmd', ['/c', 'start', '', 'msedge', ...args], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });

    child.unref();
    child.on('exit', () => {
      this.loginBrowserProcess = null;
    });
    child.on('error', () => {
      this.loginBrowserProcess = null;
    });

    return child;
  }

  private openExplorer(targetPath: string) {
    const child = spawn('cmd', ['/c', 'start', '', 'explorer', targetPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();
  }

  private getExtension(url: string) {
    if (url.startsWith('data:image/png')) return 'png';
    if (url.startsWith('data:image/jpeg')) return 'jpg';
    if (url.startsWith('data:image/webp')) return 'webp';
    const matched = url.match(/\.([a-zA-Z0-9]+)(?:[?#]|$)/);
    return matched?.[1]?.toLowerCase() || 'png';
  }

  private sanitizeFilename(value: string) {
    return value.replace(/[\\/:*?"<>|]/g, '-').trim().slice(0, 50) || 'note';
  }
}
