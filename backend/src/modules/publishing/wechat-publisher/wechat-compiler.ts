import { marked } from 'marked';
import * as cheerio from 'cheerio';
import juice from 'juice';
import { WECHAT_DEFAULT_CSS, WECHAT_FOOTER_HTML, WECHAT_HEADER_HTML } from './wechat-style';

const GENERIC_CAPTIONS = new Set([
    '正文配图',
    '配图',
    '图片来源',
    '图源',
    '示意图',
    '封面图',
    '点击查看',
    '图片仅供参考',
]);

type LoadedCheerio = ReturnType<typeof cheerio.load>;

export class WechatCompiler {
    static async compile(markdown: string): Promise<string> {
        const rawHtml = await marked.parse(markdown, {
            gfm: true,
            breaks: true,
        });
        return this.normalizeHtml(rawHtml);
    }

    static normalizeHtml(html: string): string {
        const $ = cheerio.load(`<article class="wechat-article">${html}</article>`, {
            decodeEntities: false,
        });

        $('script, style').remove();

        if (WECHAT_HEADER_HTML) {
            $('.wechat-article').prepend(WECHAT_HEADER_HTML);
        }

        if (WECHAT_FOOTER_HTML) {
            $('.wechat-article').append(WECHAT_FOOTER_HTML);
        }

        $('div').each((_index, elem) => {
            if (elem.type === 'tag') {
                elem.tagName = 'section';
            }
        });

        this.removeEmptyHeadings($);
        this.removeEmptyParagraphs($);
        this.promoteLeadParagraph($);
        this.normalizeImages($);
        this.normalizeBlockquotes($);
        this.normalizeDividers($);
        this.dedupeAdjacentTextBlocks($);
        this.pruneEmptyContainers($);

        const normalizedHtml = $('.wechat-article').toString();

        return juice.inlineContent(normalizedHtml, WECHAT_DEFAULT_CSS, {
            inlinePseudoElements: true,
            preserveImportant: true,
            insertPreservedExtraCss: false,
        });
    }

    private static removeEmptyHeadings($: LoadedCheerio): void {
        $('h2, h3, h4').each((_index, heading) => {
            const node = $(heading);
            const text = node.text().replace(/\s+/g, ' ').trim();
            if (!text) {
                node.remove();
            }
        });
    }

    private static removeEmptyParagraphs($: LoadedCheerio): void {
        $('p').each((_index, paragraph) => {
            const node = $(paragraph);
            const text = node.text().replace(/\s+/g, ' ').trim();
            if (!text && node.find('img').length === 0) {
                node.remove();
            }
        });
    }

    private static promoteLeadParagraph($: LoadedCheerio): void {
        const article = $('.wechat-article');
        const lead = article.children('p').first();
        if (!lead.length) {
            return;
        }

        lead.addClass('wechat-lead');
        lead.wrap('<section class="wechat-intro"></section>');
    }

    private static normalizeImages($: LoadedCheerio): void {
        $('img').each((_index, img) => {
            const image = $(img);
            const alt = image.attr('alt')?.replace(/\s+/g, ' ').trim() || '';

            if (!alt || GENERIC_CAPTIONS.has(alt) || alt.includes('姝ｆ枃')) {
                image.removeAttr('alt');
            }

            if (image.parent().prop('tagName')?.toLowerCase() !== 'figure') {
                image.wrap('<figure class="wechat-figure"></figure>');
            }
        });

        $('figcaption').each((_index, caption) => {
            const node = $(caption);
            const text = node.text().replace(/\s+/g, ' ').trim();
            if (!text || GENERIC_CAPTIONS.has(text) || text.includes('姝ｆ枃')) {
                node.remove();
            }
        });
    }

    private static normalizeBlockquotes($: LoadedCheerio): void {
        $('blockquote').each((_index, blockquote) => {
            const node = $(blockquote);
            const text = node.text().replace(/\s+/g, ' ').trim();
            if (!text) {
                node.remove();
                return;
            }

            if (text.length <= 56) {
                node.addClass('wechat-punchline');
            }
        });
    }

    private static normalizeDividers($: LoadedCheerio): void {
        $('hr').each((_index, hr) => {
            const node = $(hr);
            node.after('<div class="wechat-divider"></div>');
            node.remove();
        });
    }

    private static dedupeAdjacentTextBlocks($: LoadedCheerio): void {
        const seen = new Set<string>();

        $('.wechat-article')
            .children('p, h2, h3, h4, blockquote, section')
            .each((_index, element) => {
                const node = $(element);
                const normalizedText = node
                    .text()
                    .replace(/\s+/g, ' ')
                    .replace(/[◆▌•]/g, '')
                    .trim();

                if (!normalizedText) {
                    return;
                }

                const tagName = element.type === 'tag' ? element.tagName : 'node';
                const signature = `${tagName}:${normalizedText}`;
                if (seen.has(signature)) {
                    node.remove();
                    return;
                }

                seen.add(signature);
            });
    }

    private static pruneEmptyContainers($: LoadedCheerio): void {
        $('section, article').each((_index, section) => {
            const node = $(section);
            const hasVisibleText = node.text().replace(/\s+/g, '').length > 0;
            const hasMedia = node.find('img, figure, ul, ol, blockquote').length > 0;
            if (!hasVisibleText && !hasMedia) {
                node.remove();
            }
        });
    }
}
