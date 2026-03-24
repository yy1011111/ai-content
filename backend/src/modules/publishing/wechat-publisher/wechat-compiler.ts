import { marked } from 'marked';
import * as cheerio from 'cheerio';
import juice from 'juice';
import { WECHAT_DEFAULT_CSS, WECHAT_HEADER_HTML, WECHAT_FOOTER_HTML } from './wechat-style';

export class WechatCompiler {
    static async compile(markdown: string): Promise<string> {
        const rawHtml = await marked.parse(markdown);
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

        const paragraphs = $('.wechat-article > p, .wechat-article section > p').toArray();
        if (paragraphs.length > 0) {
            $(paragraphs[0]).addClass('wechat-lead');
        }

        $('img').each((_index, img) => {
            const image = $(img);
            if (!image.attr('alt')) {
                image.attr('alt', '正文配图');
            }

            if (image.parent().prop('tagName')?.toLowerCase() !== 'figure') {
                image.wrap('<figure class="wechat-figure"></figure>');
            }

            const figure = image.closest('figure');
            if (figure.find('figcaption').length === 0) {
                const alt = image.attr('alt')?.trim();
                if (alt) {
                    figure.append(`<figcaption>${alt}</figcaption>`);
                }
            }
        });

        $('section, article').each((_index, section) => {
            const node = $(section);
            const hasVisibleText = node.text().replace(/\s+/g, '').length > 0;
            const hasMedia = node.find('img, figure, ul, ol, blockquote').length > 0;
            if (!hasVisibleText && !hasMedia) {
                node.remove();
            }
        });

        const normalizedHtml = $('.wechat-article').toString();

        return juice.inlineContent(normalizedHtml, WECHAT_DEFAULT_CSS, {
            inlinePseudoElements: true,
            preserveImportant: true,
            insertPreservedExtraCss: false,
        });
    }
}
