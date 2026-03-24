import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import path from 'path';
import { chromium, type BrowserContext, type Page } from 'playwright';
import type { XiaohongshuSortType, XiaohongshuTimeRangeType } from '../dto/xiaohongshu-keyword-collect.dto';
import { CrawlResult } from './rss.crawler';

type XiaohongshuCard = {
  title: string;
  summary: string;
  content: string;
  sourceUrl: string;
  author: string;
  imageUrl: string | null;
  likeCount: string | null;
  collectCount: string | null;
  commentCount: string | null;
};

type XiaohongshuSearchNoteItem = {
  id?: string;
  xsec_token?: string;
  model_type?: string;
  note_card?: {
    display_title?: string;
    user?: {
      nick_name?: string;
      nickname?: string;
      user_id?: string;
    };
    interact_info?: {
      liked_count?: string;
      collected_count?: string;
      comment_count?: string;
      shared_count?: string;
    };
    cover?: {
      url_default?: string;
      url_pre?: string;
    };
    corner_tag_info?: Array<{ type?: string; text?: string }>;
  };
};

@Injectable()
export class XiaohongshuKeywordCrawlerService {
  private readonly logger = new Logger(XiaohongshuKeywordCrawlerService.name);
  private readonly profileDir = path.join(process.cwd(), '.runtime', 'xiaohongshu-profile');
  private readonly defaultUserAgent =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
  private loginBrowserProcess: ReturnType<typeof spawn> | null = null;

  async startLogin(): Promise<{ success: boolean; message: string }> {
    try {
      if (this.loginBrowserProcess && !this.loginBrowserProcess.killed) {
        return {
          success: false,
          message:
            '登录窗口已经打开，请在弹出的 Edge 窗口中扫码登录。登录完成后请先关闭该窗口，再回来执行关键词采集。',
        };
      }

      this.loginBrowserProcess = this.openLoginWindow();
      return {
        success: false,
        message:
          '已打开小红书登录窗口，请在弹出的 Edge 窗口中扫码登录。登录完成后请先关闭该窗口，再回到系统点击“关键词采集”。',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      this.logger.error(`打开小红书登录窗口失败: ${message}`);
      throw error;
    }
  }

  async collectByKeyword(
    keyword: string,
    limit: number = 12,
    sort: XiaohongshuSortType = 'general',
    timeRange: XiaohongshuTimeRangeType = '7d',
  ): Promise<CrawlResult[]> {
    const normalizedKeyword = keyword.trim();
    const cappedLimit = Math.max(1, Math.min(limit, 20));
    const candidatePoolSize = this.getCandidatePoolSize(cappedLimit, sort, timeRange);

    if (!normalizedKeyword) {
      throw new Error('关键词不能为空');
    }

    const context = await this.launchContext(true);

    try {
      const page = await this.preparePage(context);
      const searchItemsPromise = this.collectSearchNotes(page, candidatePoolSize);

      await page.goto(this.buildSearchUrl(normalizedKeyword), {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      });
      await page.waitForTimeout(3000);

      if (await this.isLoginRequired(page)) {
        throw new Error('小红书未登录或登录态已失效，请先点击“登录小红书”完成授权。');
      }

      await this.scrollSearchResults(page, candidatePoolSize);

      const searchItems = await searchItemsPromise.catch(() => []);
      const filteredItems = this.filterSearchItemsByTimeRange(searchItems, timeRange);
      const rankedItems = this.rankSearchItems(filteredItems, normalizedKeyword, sort);
      const cards =
        searchItems.length > 0
          ? this.mapSearchItemsToCards(rankedItems, cappedLimit)
          : await this.extractCards(page, cappedLimit);

      if (cards.length === 0) {
        throw new Error('当前时间范围内没有抓到可用笔记，请尝试放宽时间范围或更换关键词。');
      }

      return cards.map((card) => ({
        title: card.title,
        content: card.content || card.summary || card.title,
        summary: card.summary || card.title,
        sourceUrl: card.sourceUrl,
        author: card.author || '小红书作者',
        publishDate: null,
        platform: 'Xiaohongshu',
        keywords: [normalizedKeyword],
        hasImage: Boolean(card.imageUrl),
        imageUrl: card.imageUrl,
        originalImageUrl: card.imageUrl,
        metadata: {
          materialCategory: 'xiaohongshu_reference',
          referenceKeyword: normalizedKeyword,
          sourceKind: 'keyword_search',
          sortType: sort,
          sortLabel: this.getSortLabel(sort),
          timeRange,
          timeRangeLabel: this.getTimeRangeLabel(timeRange),
          platform: 'Xiaohongshu',
          signal: {
            likeCount: card.likeCount,
            collectCount: card.collectCount,
            commentCount: card.commentCount,
          },
        },
      }));
    } finally {
      await context.close().catch(() => null);
    }
  }

  private async launchContext(headless: boolean): Promise<BrowserContext> {
    try {
      return await chromium.launchPersistentContext(this.profileDir, {
        channel: 'msedge',
        headless,
        viewport: { width: 1440, height: 960 },
        userAgent: this.defaultUserAgent,
        locale: 'zh-CN',
        timezoneId: 'Asia/Shanghai',
        args: ['--disable-blink-features=AutomationControlled'],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      this.logger.error(`启动小红书浏览器上下文失败: ${message}`);
      if (message.includes('Target page, context or browser has been closed') || message.includes('user-data-dir')) {
        throw new Error('小红书登录窗口仍在运行，请先关闭该 Edge 登录窗口后再重试。');
      }
      throw new Error('未能启动 Edge 浏览器，请确认系统已安装 Microsoft Edge。');
    }
  }

  private openLoginWindow() {
    const args = [
      `--user-data-dir=${this.profileDir}`,
      '--disable-blink-features=AutomationControlled',
      this.buildSearchUrl('穿搭'),
    ];

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

  private async preparePage(context: BrowserContext): Promise<Page> {
    const page = context.pages()[0] || (await context.newPage());
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });
    });
    return page;
  }

  private buildSearchUrl(keyword: string) {
    return `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(keyword)}`;
  }

  private async isLoginRequired(page: Page): Promise<boolean> {
    const text = await page.locator('body').innerText().catch(() => '');
    return /登录后查看搜索结果/.test(text) || /手机号登录/.test(text) || (/扫码/.test(text) && /登录/.test(text));
  }

  private async extractCards(page: Page, limit: number): Promise<XiaohongshuCard[]> {
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => null);
    await page.waitForTimeout(2500);

    return page.evaluate((max) => {
      const seen = new Set<string>();
      const cards: XiaohongshuCard[] = [];
      const anchors = Array.from(
        document.querySelectorAll<HTMLAnchorElement>('a[href*="/explore/"], a[href*="/discovery/item/"]'),
      );

      const normalizeText = (value?: string | null) => (value || '').replace(/\s+/g, ' ').trim();

      const pickLikelyTitle = (root: Element | null, fallbackText: string) => {
        const candidates = [
          root?.querySelector('h1,h2,h3,h4')?.textContent,
          root?.querySelector('img')?.getAttribute('alt'),
          root?.querySelector('[class*="title"]')?.textContent,
          root?.querySelector('[class*="desc"]')?.textContent,
          fallbackText,
        ]
          .map((item) => normalizeText(item))
          .filter(Boolean);

        return candidates.find((item) => item.length >= 4 && item.length <= 80) || candidates[0] || '小红书笔记';
      };

      const pickAuthor = (root: Element | null) => {
        const candidates = Array.from(root?.querySelectorAll('span,div,a') || [])
          .map((element) => normalizeText(element.textContent))
          .filter(Boolean);

        return (
          candidates.find(
            (item) =>
              item.length >= 2 &&
              item.length <= 20 &&
              !item.includes('赞') &&
              !item.includes('收藏') &&
              !item.includes('评论') &&
              !item.includes('关注') &&
              !item.includes('分享'),
          ) || '小红书作者'
        );
      };

      const pickMetric = (text: string, keywords: string[]) => {
        const segments = text.split(' ');
        for (let index = 0; index < segments.length; index += 1) {
          if (keywords.some((keyword) => segments[index].includes(keyword))) {
            return segments[index - 1] || segments[index + 1] || null;
          }
        }
        return null;
      };

      for (const anchor of anchors) {
        const rawHref = anchor.getAttribute('href') || '';
        if (!rawHref) continue;

        const href = new URL(rawHref, window.location.origin).toString();
        if (seen.has(href)) continue;

        const root =
          anchor.closest('section') ||
          anchor.closest('article') ||
          anchor.closest('[class*="note"]') ||
          anchor.parentElement;
        const rawText = normalizeText(root?.textContent || anchor.textContent || '');
        const title = pickLikelyTitle(root, rawText);

        if (!title || title.length < 2) continue;

        seen.add(href);

        const imageUrl = root?.querySelector('img')?.getAttribute('src') || null;
        const content = rawText || title;
        const summary = content.length > 180 ? `${content.slice(0, 180)}...` : content;

        cards.push({
          title,
          summary,
          content,
          sourceUrl: href,
          author: pickAuthor(root),
          imageUrl,
          likeCount: pickMetric(content, ['赞', '点赞']),
          collectCount: pickMetric(content, ['收藏']),
          commentCount: pickMetric(content, ['评论']),
        });

        if (cards.length >= max) {
          break;
        }
      }

      return cards;
    }, limit);
  }

  private collectSearchNotes(page: Page, limit: number): Promise<XiaohongshuSearchNoteItem[]> {
    return new Promise((resolve) => {
      const collected = new Map<string, XiaohongshuSearchNoteItem>();
      const timeoutMs = Math.min(30000, Math.max(12000, Math.ceil(limit / 20) * 4000));
      const timer = setTimeout(() => {
        page.off('response', onResponse);
        resolve([...collected.values()]);
      }, timeoutMs);

      const onResponse = async (response: { url(): string; json(): Promise<any> }) => {
        try {
          if (!response.url().includes('/api/sns/web/v1/search/notes')) {
            return;
          }

          const json = await response.json();
          const items = Array.isArray(json?.data?.items) ? json.data.items : [];
          const notes = items.filter((item: XiaohongshuSearchNoteItem) => item?.model_type === 'note');

          for (const note of notes) {
            if (note?.id) {
              collected.set(note.id, note);
            }
          }

          const hasMore = Boolean(json?.data?.has_more);
          if (!hasMore || collected.size >= limit) {
            clearTimeout(timer);
            page.off('response', onResponse);
            resolve([...collected.values()]);
          }
        } catch {
          // ignore malformed responses
        }
      };

      page.on('response', onResponse);
    });
  }

  private rankSearchItems(
    items: XiaohongshuSearchNoteItem[],
    keyword: string,
    sort: XiaohongshuSortType,
  ) {
    const normalizedKeyword = keyword.trim().toLowerCase();
    const exactMatches: XiaohongshuSearchNoteItem[] = [];
    const partialMatches: XiaohongshuSearchNoteItem[] = [];
    const weakMatches: XiaohongshuSearchNoteItem[] = [];

    for (const item of items) {
      const relevance = this.getKeywordRelevanceScore(item, normalizedKeyword);

      if (relevance >= 1000) {
        exactMatches.push(item);
      } else if (relevance > 0) {
        partialMatches.push(item);
      } else {
        weakMatches.push(item);
      }
    }

    const baseSort = (left: XiaohongshuSearchNoteItem, right: XiaohongshuSearchNoteItem) => {
      const leftRelevance = this.getKeywordRelevanceScore(left, normalizedKeyword);
      const rightRelevance = this.getKeywordRelevanceScore(right, normalizedKeyword);
      if (leftRelevance !== rightRelevance) {
        return rightRelevance - leftRelevance;
      }

      const leftInteract = left.note_card?.interact_info || {};
      const rightInteract = right.note_card?.interact_info || {};

      if (sort === 'popularity_descending') {
        return this.parseMetricNumber(rightInteract.liked_count) - this.parseMetricNumber(leftInteract.liked_count);
      }
      if (sort === 'collect_descending') {
        return this.parseMetricNumber(rightInteract.collected_count) - this.parseMetricNumber(leftInteract.collected_count);
      }
      if (sort === 'comment_descending') {
        return this.parseMetricNumber(rightInteract.comment_count) - this.parseMetricNumber(leftInteract.comment_count);
      }
      if (sort === 'time_descending') {
        return this.extractDateScore(right) - this.extractDateScore(left);
      }

      const leftScore = this.getEngagementScore(left);
      const rightScore = this.getEngagementScore(right);
      if (leftScore !== rightScore) {
        return rightScore - leftScore;
      }

      return this.extractDateScore(right) - this.extractDateScore(left);
    };

    exactMatches.sort(baseSort);
    partialMatches.sort(baseSort);
    weakMatches.sort(baseSort);

    const strongMatches = [...exactMatches, ...partialMatches];
    const minimumStrongCount = Math.max(4, Math.ceil(items.length * 0.3));

    if (strongMatches.length >= minimumStrongCount) {
      return strongMatches;
    }

    return [...exactMatches, ...partialMatches, ...weakMatches];
  }

  private getKeywordRelevanceScore(item: XiaohongshuSearchNoteItem, normalizedKeyword: string) {
    if (!normalizedKeyword) {
      return 0;
    }

    const title = (item.note_card?.display_title || '').trim().toLowerCase();
    const author = (item.note_card?.user?.nick_name || item.note_card?.user?.nickname || '').trim().toLowerCase();

    if (title.includes(normalizedKeyword)) {
      return 1000;
    }

    const keywordParts = normalizedKeyword
      .split(/[\s/|,，、]+/)
      .map((part) => part.trim())
      .filter((part) => part.length >= 2);

    let score = 0;
    for (const part of keywordParts) {
      if (title.includes(part)) {
        score += 200;
      } else if (author.includes(part)) {
        score += 20;
      }
    }

    return score;
  }

  private getEngagementScore(item: XiaohongshuSearchNoteItem) {
    const interact = item.note_card?.interact_info || {};
    return (
      this.parseMetricNumber(interact.liked_count) * 2 +
      this.parseMetricNumber(interact.collected_count) * 4 +
      this.parseMetricNumber(interact.comment_count) * 3
    );
  }

  private async scrollSearchResults(page: Page, targetCount: number) {
    const scrollRounds = Math.max(4, Math.min(20, Math.ceil(targetCount / 12)));

    for (let index = 0; index < scrollRounds; index += 1) {
      await page
        .evaluate(() => {
          window.scrollBy(0, window.innerHeight * 1.4);
        })
        .catch(() => null);
      await page.waitForTimeout(1200);
    }
  }

  private mapSearchItemsToCards(items: XiaohongshuSearchNoteItem[], limit: number): XiaohongshuCard[] {
    return items
      .map((item) => {
        const noteCard = item.note_card || {};
        const title = (noteCard.display_title || '').trim();
        if (!item.id || !title) {
          return null;
        }

        const author = noteCard.user?.nick_name || noteCard.user?.nickname || '小红书作者';
        const interact = noteCard.interact_info || {};
        const publishLabel = this.extractPublishLabel(item);
        const summaryParts = [
          title,
          author ? `作者：${author}` : '',
          publishLabel ? `发布时间：${publishLabel}` : '',
          interact.liked_count ? `点赞：${interact.liked_count}` : '',
          interact.collected_count ? `收藏：${interact.collected_count}` : '',
          interact.comment_count ? `评论：${interact.comment_count}` : '',
        ].filter(Boolean);

        return {
          title,
          summary: summaryParts.join(' | '),
          content: summaryParts.join('\n'),
          sourceUrl: this.buildNoteUrl(item.id, item.xsec_token),
          author,
          imageUrl: noteCard.cover?.url_default || noteCard.cover?.url_pre || null,
          likeCount: interact.liked_count || null,
          collectCount: interact.collected_count || null,
          commentCount: interact.comment_count || null,
        } satisfies XiaohongshuCard;
      })
      .filter((item): item is XiaohongshuCard => Boolean(item))
      .slice(0, limit);
  }

  private parseMetricNumber(value?: string) {
    if (!value) return 0;

    const normalized = value.replace(/[,+]/g, '').trim().toLowerCase();
    if (!normalized) return 0;

    if (normalized.endsWith('w') || normalized.endsWith('万')) {
      return Number.parseFloat(normalized.slice(0, -1)) * 10000 || 0;
    }
    if (normalized.endsWith('k') || normalized.endsWith('千')) {
      return Number.parseFloat(normalized.slice(0, -1)) * 1000 || 0;
    }

    return Number.parseFloat(normalized) || 0;
  }

  private extractPublishLabel(item: XiaohongshuSearchNoteItem) {
    return (
      item.note_card?.corner_tag_info?.find((entry) => entry?.type === 'publish_time')?.text ||
      item.note_card?.corner_tag_info?.[0]?.text ||
      ''
    );
  }

  private extractDateScore(item: XiaohongshuSearchNoteItem) {
    const text = this.extractPublishLabel(item);
    if (!text) {
      return 0;
    }

    const now = new Date();

    const minutesAgo = text.match(/^(\d+)\s*分钟前$/);
    if (minutesAgo) {
      return now.getTime() - (Number.parseInt(minutesAgo[1], 10) || 0) * 60 * 1000;
    }

    const hoursAgo = text.match(/^(\d+)\s*小时前$/);
    if (hoursAgo) {
      return now.getTime() - (Number.parseInt(hoursAgo[1], 10) || 0) * 60 * 60 * 1000;
    }

    const daysAgo = text.match(/^(\d+)\s*天前$/);
    if (daysAgo) {
      return now.getTime() - (Number.parseInt(daysAgo[1], 10) || 0) * 24 * 60 * 60 * 1000;
    }

    if (text === '昨天') {
      return now.getTime() - 24 * 60 * 60 * 1000;
    }

    if (text === '前天') {
      return now.getTime() - 2 * 24 * 60 * 60 * 1000;
    }

    const monthDay = text.match(/^(\d{1,2})-(\d{1,2})$/);
    if (monthDay) {
      const month = Number.parseInt(monthDay[1], 10) - 1;
      const day = Number.parseInt(monthDay[2], 10);
      let year = now.getFullYear();
      const candidate = new Date(year, month, day).getTime();

      if (candidate > now.getTime()) {
        year -= 1;
      }

      return new Date(year, month, day).getTime();
    }

    const fullDate = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (fullDate) {
      const year = Number.parseInt(fullDate[1], 10);
      const month = Number.parseInt(fullDate[2], 10) - 1;
      const day = Number.parseInt(fullDate[3], 10);
      return new Date(year, month, day).getTime();
    }

    return 0;
  }

  private filterSearchItemsByTimeRange(items: XiaohongshuSearchNoteItem[], timeRange: XiaohongshuTimeRangeType) {
    if (timeRange === 'all') {
      return items;
    }

    const now = Date.now();
    const rangeMap: Record<Exclude<XiaohongshuTimeRangeType, 'all'>, number> = {
      '1d': 1,
      '7d': 7,
      '30d': 30,
    };
    const maxAge = rangeMap[timeRange] * 24 * 60 * 60 * 1000;

    return items.filter((item) => {
      const publishAt = this.extractDateScore(item);
      if (!publishAt) {
        return false;
      }
      return now - publishAt <= maxAge;
    });
  }

  private getCandidatePoolSize(
    limit: number,
    sort: XiaohongshuSortType,
    timeRange: XiaohongshuTimeRangeType,
  ) {
    const base = sort === 'general' ? Math.max(60, limit * 6) : Math.max(80, limit * 8);

    if (timeRange === 'all') {
      return Math.min(80, base);
    }

    if (timeRange === '1d') {
      return Math.min(240, base * 3);
    }

    return Math.min(240, base * 3);
  }

  private buildNoteUrl(noteId: string, xsecToken?: string) {
    const base = `https://www.xiaohongshu.com/explore/${noteId}`;
    if (!xsecToken) {
      return base;
    }
    return `${base}?xsec_token=${encodeURIComponent(xsecToken)}&xsec_source=pc_search`;
  }

  private getSortLabel(sort: XiaohongshuSortType) {
    switch (sort) {
      case 'popularity_descending':
        return '最多点赞';
      case 'collect_descending':
        return '最多收藏';
      case 'comment_descending':
        return '最多评论';
      case 'time_descending':
        return '最新';
      default:
        return '综合推荐';
    }
  }

  private getTimeRangeLabel(timeRange: XiaohongshuTimeRangeType) {
    switch (timeRange) {
      case '1d':
        return '1天内';
      case '7d':
        return '7天内';
      case '30d':
        return '30天内';
      default:
        return '不限时间';
    }
  }
}
