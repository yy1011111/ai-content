import { marked } from 'marked';
import * as cheerio from 'cheerio';
import juice from 'juice';
import { WECHAT_DEFAULT_CSS, WECHAT_FOOTER_HTML, WECHAT_HEADER_HTML } from './wechat-style';

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

        $('h2, h3, h4').each((_index, heading) => {
            const node = $(heading);
            const text = node.text().replace(/\s+/g, ' ').trim();
            if (!text) {
                node.remove();
            }
        });

        $('p').each((_index, paragraph) => {
            const node = $(paragraph);
            const text = node.text().replace(/\s+/g, ' ').trim();
            if (!text && node.find('img').length === 0) {
                node.remove();
            }
        });

        $('img').each((_index, img) => {
            const image = $(img);
            const currentAlt = image.attr('alt')?.trim();

            if (currentAlt === '正文配图') {
                image.removeAttr('alt');
            }

            if (image.parent().prop('tagName')?.toLowerCase() !== 'figure') {
                image.wrap('<figure class="wechat-figure"></figure>');
            }
        });

        $('figcaption').each((_index, caption) => {
            const node = $(caption);
            const text = node.text().replace(/\s+/g, ' ').trim();
            if (!text) {
                node.remove();
            }
        });

        $('hr').each((_index, hr) => {
            const node = $(hr);
            node.after('<div class="wechat-divider"></div>');
            node.remove();
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
