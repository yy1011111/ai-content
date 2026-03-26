import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AiClientService } from '../ai-models/ai-client.service';
import { DefaultModelsService } from '../ai-models/default-models.service';
import { SystemLogsService } from '../system-logs/system-logs.service';
import { ImageSelectorService } from './image-selector.service';
import { MaterialsService } from '../materials/materials.service';
import { QiniuService } from '../storage/qiniu.service';
import { WechatCompiler } from '../publishing/wechat-publisher/wechat-compiler';
import {
    renderXiaohongshuCardSvg,
    XiaohongshuSlideRole,
    XiaohongshuSlideTemplate,
} from './xiaohongshu-card-renderer';
import sharp from 'sharp';

function withTimeout<T>(promise: Promise<T>, ms: number, msg: string): Promise<T> {
    return Promise.race([
        promise,
        new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(msg)), ms)
        ),
    ]);
}

type ArticleContentFormat = 'markdown' | 'html';
type ArticleContentType = 'article' | 'xiaohongshu';

type GeneratedArticlePayload = {
    title: string;
    content: string;
    contentFormat: ArticleContentFormat;
};

type XiaohongshuSlidePlan = {
    role: XiaohongshuSlideRole;
    template: XiaohongshuSlideTemplate;
    title: string;
    body: string;
    bullets: string[];
    highlight: string;
    imagePrompt: string;
    imageType: 'real' | 'ai' | 'none';
};

type GeneratedXiaohongshuPayload = {
    title: string;
    caption: string;
    hashtags: string[];
    slides: XiaohongshuSlidePlan[];
};

type XiaohongshuSlide = XiaohongshuSlidePlan & {
    coverText: string;
    bodyText: string;
    imageUrl: string | null;
    backgroundImageUrl: string | null;
    cardImageUrl: string;
};

type XiaohongshuNoteData = {
    title: string;
    caption: string;
    hashtags: string[];
    slides: XiaohongshuSlide[];
};

type MaterialInfo = {
    id: string;
    imageUrl: string | null;
    originalImageUrl: string | null;
    hasImage: boolean;
    title: string;
    content: string | null;
};

type ImageTaskResult = {
    placeholder: string;
    url: string | null;
    success: boolean;
    errorDetail?: string;
};

const ARTICLE_GENERATION_TIMEOUT_MS = 20 * 60 * 1000;
const ARTICLE_MAX_GENERATION_ATTEMPTS = 3;
const ARTICLE_MARKDOWN_MAX_TOKENS = 4000;
const ARTICLE_HTML_MAX_TOKENS = 12000;
const ARTICLE_HTML_CONTINUATION_MAX_TOKENS = 6000;
const ARTICLE_POLISH_MAX_TOKENS = 4500;

type HtmlValidationResult = {
    isComplete: boolean;
    reason: string;
};

@Injectable()
export class ArticlesService {
    private readonly logger = new Logger(ArticlesService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly aiClient: AiClientService,
        private readonly defaultModels: DefaultModelsService,
        private readonly systemLogsService: SystemLogsService,
        private readonly imageSelector: ImageSelectorService,
        private readonly materialsService: MaterialsService,
        private readonly qiniuService: QiniuService,
    ) { }

    // ================= 核心：一键图文文生成引擎 =================
    async generateFromTopic(topicId: string, force = false, contentType: ArticleContentType = 'article') {
        let topic = await this.prisma.topic.findUnique({
            where: { id: topicId },
            include: { materials: { include: { material: true } } },
        });

        if (!topic) {
            throw new HttpException('选题不存在', HttpStatus.NOT_FOUND);
        }
        if (topic.isPublished && !force) {
            throw new HttpException(`该选题已完成过${this.getContentLabel(contentType)}创作`, HttpStatus.BAD_REQUEST);
        }

        if (topic.materials.length > 0) {
            await this.materialsService.ensureImagesForMaterials(topic.materials.map((m) => m.material.id));
            topic = await this.prisma.topic.findUnique({
                where: { id: topicId },
                include: { materials: { include: { material: true } } },
            });
            if (!topic) {
                throw new HttpException('选题不存在', HttpStatus.NOT_FOUND);
            }
        }

        await this.prisma.topic.update({
            where: { id: topicId },
            data: { status: 'generating' },
        });

        try {
            return await withTimeout(
                (async () => {
                    const [articleStyle, imageStyle, articleTemplate, articleSystemStyle] = await Promise.all([
                        this.prisma.style.findFirst({ where: { isDefault: true, type: contentType === 'xiaohongshu' ? 'xiaohongshu' : 'article' } }),
                        this.prisma.style.findFirst({ where: { isDefault: true, type: 'image' } }),
                        contentType === 'article'
                            ? this.prisma.style.findFirst({ where: { isDefault: true, type: 'template' } })
                            : Promise.resolve(null),
                        contentType === 'article'
                            ? this.prisma.style.findFirst({ where: { isDefault: true, type: 'article_system' } })
                            : Promise.resolve(null),
                    ]);

                    const stylePrompt = articleStyle?.promptTemplate || this.getDefaultStylePrompt(contentType);
                    const articleSystemPrompt = contentType === 'article'
                        ? articleSystemStyle?.promptTemplate?.trim() || ''
                        : '';
                    const templateHtml =
                        contentType === 'article'
                            ? (articleTemplate?.promptTemplate?.trim() || this.getDefaultArticleTemplate())
                            : '';
                    const templateNotes = this.readTemplateNotes(articleTemplate?.parameters);
                    const contentFormat: ArticleContentFormat = contentType === 'article' ? 'html' : 'markdown';

                    const config = await this.defaultModels.getDefaults();
                    if (!config.articleCreation) {
                        throw new HttpException('未配置文章创作默认 AI 模型', HttpStatus.BAD_REQUEST);
                    }
                    if (!config.imageCreation) {
                        this.logger.warn('未配置图片创作模型，可能无法生成插图');
                    }

                    const materialContents = topic.materials
                        .map((m, i) => `【参考素材 ${i + 1}】标题：${m.material.title}\n真实配图：${m.material.hasImage && m.material.imageUrl ? '有可复用原图' : '暂无可用原图'}\n内容详情：${m.material.content?.substring(0, 800) || m.material.summary || ''}`)
                        .join('\n\n');

                    const startMsg = `开始为选题「${topic.title}」生成${contentType === 'xiaohongshu' ? '小红书笔记' : contentFormat === 'html' ? 'HTML 模板文章' : 'Markdown 文章'}... (模型: ${config.articleCreation})`;
                    this.logger.log(startMsg);
                    await this.systemLogsService.record(startMsg, 'info');

                    const materialInfos: MaterialInfo[] = topic.materials.map((m) => ({
                        id: m.material.id,
                        imageUrl: m.material.imageUrl,
                        originalImageUrl: m.material.originalImageUrl,
                        hasImage: m.material.hasImage,
                        title: m.material.title,
                        content: m.material.content,
                    }));

                    const imageStylePrompt = imageStyle?.promptTemplate;
                    const imageStyleParams = (imageStyle?.parameters as { ratio?: string; resolution?: string } | null) || undefined;

                    if (contentType === 'xiaohongshu') {
                        const xiaohongshuData = await this.generateXiaohongshuNote({
                            modelId: config.articleCreation,
                            stylePrompt,
                            topicTitle: topic.title,
                            topicSummary: topic.summary || '',
                            keywords: topic.keywords,
                            materialContents,
                            materialInfos,
                            imageStylePrompt,
                            imageStyleParams,
                            imageCreationEnabled: Boolean(config.imageCreation),
                        });

                        const newArticle = await this.prisma.article.create({
                            data: {
                                title: xiaohongshuData.title,
                                content: this.buildXiaohongshuContent(xiaohongshuData.caption, xiaohongshuData.hashtags),
                                contentType,
                                contentFormat: 'markdown',
                                xiaohongshuData,
                                coverImage: xiaohongshuData.slides[0]?.cardImageUrl || xiaohongshuData.slides[0]?.imageUrl || null,
                                status: 'draft',
                                topicId: topic.id,
                                styleId: articleStyle?.id,
                                templateId: null,
                                modelId: config.articleCreation,
                            }
                        });

                        await this.prisma.topic.update({
                            where: { id: topic.id },
                            data: {
                                status: 'completed',
                                isPublished: true,
                            }
                        });

                        const successMsg = `${this.getContentLabel(contentType)}「${xiaohongshuData.title}」生成顺利完成`;
                        this.logger.log(`${this.getContentLabel(contentType)}生成顺利完成。记录号: ${newArticle.id}`);
                        await this.systemLogsService.record(successMsg, 'success');
                        return newArticle;
                    }

                    const articleData = await this.generateWechatArticlePayload({
                        modelId: config.articleCreation,
                        topicTitle: topic.title,
                        topicSummary: topic.summary || '',
                        keywords: topic.keywords,
                        materialContents,
                        stylePrompt,
                        articleSystemPrompt,
                        materialInfos,
                        imageStylePrompt,
                        imageStyleParams,
                        imageCreationEnabled: Boolean(config.imageCreation),
                    });
                    const coverImage = await this.generateCoverImage({
                        topicTitle: topic.title,
                        topicSummary: topic.summary || '',
                        keywords: topic.keywords,
                        materialInfos,
                        imageStylePrompt,
                        imageStyleParams,
                        imageCreationEnabled: Boolean(config.imageCreation),
                    });

                    const newArticle = await this.prisma.article.create({
                        data: {
                            title: articleData.title,
                            content: articleData.content,
                            contentType,
                            contentFormat,
                            rawHtml: articleData.content,
                            finalHtml: articleData.content,
                            coverImage,
                            status: 'draft',
                            topicId: topic.id,
                            styleId: articleStyle?.id,
                            templateId: articleTemplate?.id,
                            modelId: config.articleCreation,
                        }
                    });

                    await this.prisma.topic.update({
                        where: { id: topic.id },
                        data: {
                            status: 'completed',
                            isPublished: true,
                        }
                    });

                    const successMsg = `${this.getContentLabel(contentType)}「${articleData.title}」生成顺利完成`;
                    this.logger.log(`${this.getContentLabel(contentType)}生成顺利完成。记录号: ${newArticle.id}`);
                    await this.systemLogsService.record(successMsg, 'success');
                    return newArticle;
                })(),
                ARTICLE_GENERATION_TIMEOUT_MS,
                `${this.getContentLabel(contentType)}生成超时（超过20分钟），请稍后重试`
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : '系统内部打分执行中断';
            const errorMsg = `${this.getContentLabel(contentType)}「${topic.title}」一键生成过程出错了: ${message}`;
            this.logger.error(`${this.getContentLabel(contentType)}一键生成过程出错了`, error);
            await this.systemLogsService.record(errorMsg, 'error');
            await this.prisma.topic.update({
                where: { id: topicId },
                data: { status: 'completed' }
            });
            throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    // ================= 批量操作：定时任务按门槛生成草稿 =================
    async batchGenerateDrafts(
        limit: number = 5,
        minScore: number = 80,
        contentType: ArticleContentType = 'article',
    ) {
        this.logger.log(`开始执行批量生成草稿任务，寻找 AI 评分 >= ${minScore} 的待处理选题，最多处理 ${limit} 个，内容类型：${contentType}...`);

        const topics = await this.prisma.topic.findMany({
            where: {
                status: 'completed',
                isPublished: false,
                aiScore: { gte: minScore }
            },
            orderBy: {
                aiScore: 'desc'
            },
            take: limit
        });

        if (topics.length === 0) {
            this.logger.log('当前没有符合生成门槛的待处理选题。');
            return { processed: 0, message: '无符合条件选题' };
        }

        let successCount = 0;
        let failCount = 0;
        const generatedArticleIds: string[] = [];

        for (const topic of topics) {
            try {
                this.logger.log(`>>> 批量生成进度: 正在处理选题 「${topic.title}」 (分数: ${topic.aiScore})`);
                const article = await this.generateFromTopic(topic.id, false, contentType);
                generatedArticleIds.push(article.id);
                successCount++;
            } catch (err) {
                const message = err instanceof Error ? err.message : '未知错误';
                this.logger.error(`批量生成「${topic.title}」失败: ${message}`);
                failCount++;
            }
        }

        const msg = `批量文章生成完毕。成功: ${successCount}，失败: ${failCount}。`;
        this.logger.log(msg);
        if (successCount > 0) {
            await this.systemLogsService.record(msg, 'success');
        }
        return { processed: topics.length, successCount, failCount, message: msg, generatedArticleIds };
    }

    // ============== 常规 CRUD ===============
    async findAll(query: Record<string, string | number | undefined>) {
        const { page = 1, limit = 10, keyword, status, contentType } = query;
        const skip = (Number(page) - 1) * Number(limit);

        const whereCondition: Record<string, unknown> = {};

        if (keyword) {
            whereCondition.OR = [
                { title: { contains: keyword } },
                { content: { contains: keyword } },
                { rawHtml: { contains: keyword } },
                { finalHtml: { contains: keyword } },
            ];
        }

        if (status && status !== 'all') {
            whereCondition.status = status;
        }

        if (contentType && contentType !== 'all') {
            whereCondition.contentType = contentType;
        }

        const [items, total] = await Promise.all([
            this.prisma.article.findMany({
                where: whereCondition,
                skip,
                take: Number(limit),
                orderBy: { createdAt: 'desc' },
                include: {
                    topic: { select: { title: true, keywords: true } },
                    template: { select: { id: true, name: true } },
                }
            }),
            this.prisma.article.count({ where: whereCondition }),
        ]);

        return {
            items,
            total,
            page: Number(page),
            limit: Number(limit),
            totalPages: Math.ceil(total / Number(limit)),
        };
    }

    async findOne(id: string) {
        return this.prisma.article.findUnique({
            where: { id },
            include: {
                topic: { select: { title: true, keywords: true } },
                template: { select: { id: true, name: true } },
            },
        });
    }

    async update(id: string, data: { title?: string; content?: string; rawHtml?: string; finalHtml?: string; contentFormat?: ArticleContentFormat }) {
        const currentArticle = await this.prisma.article.findUnique({ where: { id } });
        if (!currentArticle) {
            throw new HttpException('文章不存在', HttpStatus.NOT_FOUND);
        }

        const nextFormat = data.contentFormat || currentArticle.contentFormat as ArticleContentFormat;
        const nextContent = data.content ?? data.finalHtml ?? currentArticle.content;
        const isHtmlArticle = nextFormat === 'html';

        return this.prisma.article.update({
            where: { id },
            data: {
                title: data.title,
                content: nextContent,
                contentFormat: nextFormat,
                rawHtml: data.rawHtml ?? currentArticle.rawHtml,
                finalHtml: isHtmlArticle ? (data.finalHtml ?? data.content ?? currentArticle.finalHtml ?? nextContent) : null,
            }
        });
    }

    async remove(id: string) {
        return this.prisma.article.delete({ where: { id } });
    }

    private getWeChatArticleV3SystemPrompt(
        stylePrompt: string,
        contentFormat: ArticleContentFormat,
        templateHtml: string,
        templateNotes: string,
        articleSystemPrompt: string = '',
    ): string {
        const corePrompt = articleSystemPrompt.trim() || `你是一名专门写微信公众号爆款正文的中文作者。主要写社会热点、职场、情感婚恋家庭类内容，核心读者是35岁以上中产。

调性不固定，根据题材走：
- 社会热点：可以犀利，但不是愤青式骂街，是见过世面的人说话，准、稳、有一点凉意；
- 职场：有点毒，但毒得有分寸，是那种“你懂我懂但没人说”的透彻感；
- 情感婚恋家庭：不鸡汤、不灌输道理，写的是中年人真实的委屈、拧巴、妥协和清醒。

不要写得像“完成任务”，要写得像“这个事你真有话想说”。

当我给你【参考资料】时，直接判断角度、直接成文。不要问我问题，不要让我补信息，不要做资料解读，不要做自检总结。只输出正文本身。

====================
一、35岁以上中产读者的传播逻辑
====================

这个群体不好骗，也不容易被煽动。他们刷公众号，不是为了找新鲜事，是为了找共鸣，有人替他们说出了一直压着没说的话。

爆款在这个人群里的传播方式：
1. 说出了他们“不好意思承认”的真实想法。
2. 不说教，不给答案。
3. 有一句话让人想发给某个人。
4. 开头要抓住已经很累的人。
5. 结尾留空白，不要替他们想完。

====================
二、读取参考资料的方式
====================

收到资料后，在内部完成以下三步，但不要原样输出：
1. 找“刺点”：这件事最让35岁以上中产不舒服的地方是什么？
2. 写一段“不会发出来的私人吐槽”，80到150字，像发给最信任的朋友。
3. 把这段感觉转译成文章：先有人话和私心，再有结构和观点。

资料使用规则：
- 用资料里的事实，不用资料里的腔调。
- 有据可查的写出来，不确认的不要装成结论。
- 具体细节优先于宏大判断。
- 多来源时，取最具体、最有现场感的部分。
- 可以有判断、有立场，但不能歪曲原意。

====================
三、正文写作规则
====================

默认输出长度：1200到1800字。
情感婚恋类可偏短，1000到1400字；
社会热点和职场类层次更多时，可到1500到1800字。

开头：
- 不能是“最近，一件事引发了广泛讨论”。
- 不能先铺背景再进主题。
- 直接给一个画面、一句35岁中产一眼就认出来的处境、或一个不太体面但真实的念头。

中段推进：
- 2到3个层次，每层推进一步，越来越近，越来越具体。
- 不是“列三点分析”，是“一刀比一刀深”。
- 社会热点：从现象到本质，中间要有一个“很多人没想到这一层”的转折；
- 职场：从表面规则到潜规则，说出大家都在做但没人明说的逻辑；
- 情感婚恋：从一个具体场景到一种普遍处境，不升华，不给结论，让处境本身说话。

截图句：
- 全文至少要有一句让人想截图或转发给某个人的话。
- 特征是准、有分量、说中了某个很少被说破的东西。
- 最好放在第三到第五段之间。

结尾：
- 不升华，不总结，不鸡汤，不喊口号。
- 可以冷一句戛然而止，也可以反问，也可以用一个细节或画面收尾。
- 禁止出现“希望……”“愿我们……”“共勉”“你值得更好的”“一切都会好的”。

一篇文章里必须至少自然带出以下五项中的三项：
- 一个具体画面或场景
- 一个35岁以上中产“不好意思承认但确实有过”的真实念头
- 一个说出来有点扎但是对的判断
- 一种“早就知道会这样”的中年疲惫感或清醒感
- 一个大家心知肚明但从来不说破的东西

====================
四、语言风格
====================

整体感：见过世面，有点凉，但不冷漠。不是年轻人的愤怒，是中年人的透彻。

1. 口语，但不幼稚，是35岁的人说话的方式。
2. 讽刺可以有，但要克制、精准。
3. 情绪可以有，但要压着，不要拉满。
4. 细节先于判断，画面先于观点。
5. 短句增强力度，但不能通篇碎句。
6. 对话如果出现，要像35岁的人真的会说的话。
7. 允许一点“不整齐感”，不要过度光滑。

以下词句，一个都不要用：
- 这背后折射出……
- 某种程度上……
- 我们不难发现……
- 值得深思的是……
- 归根结底……
- 从某种意义上说……
- 表面上……实际上……
- 这件事给我们敲响了警钟
- 内卷
- 破防 / 裂开 / 绷不住了 / 泪目
- 人间清醒
- 治愈
- 松弛感

====================
五、内容底线
====================

1. 不编造事实，不把未确认内容写成结论。
2. 不为流量硬拗立场。
3. 不把读者当傻子，不反复解释显而易见的道理。
4. 不写成纯情绪发泄。
5. 不写成全篇都在表演“我很会写”。
6. 至少做到以下三项中的两项：
   - 提供信息增量
   - 提供认知增量
   - 提供情绪共鸣。`;

        if (contentFormat === 'html') {
            return `${corePrompt}

【补充风格要求】
${stylePrompt}

【HTML模板】
${templateHtml}

【模板补充说明】
${templateNotes || '无'}

【排版与配图规则】
1. 必须直接输出完整 HTML，不要 Markdown，不要代码块，不要解释。
2. 保留模板主体结构、模块顺序和主要 class 名，把占位文案替换成真正内容。
3. 正文最多保留 0 到 2 张图，没有贴切图片时宁可删除 figure。
4. 如需图片，只能使用：
   - [real-image-详细描述]
   - [ai-image-详细描述]
5. AI 图必须是纯视觉场景图，严禁文字、数字、logo、品牌名、水印、角标、按钮、界面元素、二维码、截图感、海报感、小红书封面感。
6. 不要为了凑版面乱插图。

【输出格式】
严格按下面格式返回，不要附加任何解释：
TITLE_START
这里写文章标题
TITLE_END
HTML_START
这里写完整HTML
HTML_END`;
        }

        return `${corePrompt}

【补充风格要求】
${stylePrompt}

【配图规则】
1. 正文最多保留 0 到 2 张图。
2. 如需图片，只能使用 [real-image-详细描述] 或 [ai-image-详细描述]。
3. AI 图必须是纯视觉场景图，严禁文字、数字、logo、品牌名、水印、角标、按钮、界面元素、二维码、截图感、海报感、小红书封面感。

【输出格式】
只能返回 JSON：
{"title":"文章标题","content":"Markdown 正文"}`;
    }

    private getWeChatArticleV3UserPrompt(params: {
        topicTitle: string;
        topicSummary: string;
        keywords: string[];
        materialContents: string;
        templateNotes: string;
        retryInstruction: string;
    }): string {
        return `【任务目标】
请直接写成一篇适合微信公众号发布的正式成稿，不要提问，不要让我补信息，不要资料解读，不要自检总结。

【本次写作信息】
选题核心方向：${params.topicTitle}
选题摘要：${params.topicSummary}
关键词：${params.keywords.join(', ')}
模板备注：${params.templateNotes || '无'}
${params.retryInstruction}

【写作前的内部动作（不要原样输出）】
1. 先判断当前题材更偏事件型还是观点型。
2. 先找“刺点”：这件事最让35岁以上中产不舒服的地方是什么。
3. 先写一小段不会发出来的私人吐槽底稿，再把这股劲儿翻译成正式成稿。
4. 先内部比较多个标题版本，再输出最有传播力但不廉价的那个。

【落笔要求】
1. 开头必须直接给一个画面、一个处境、一个不太体面但真实的念头；不要先铺背景。
2. 中段用 2 到 3 个层次推进，不是列三点分析，而是一刀比一刀深。
3. 全文至少要有一句让人想截图或转发给某个人的话，最好放在第三到第五段之间。
4. 至少自然带出以下五项里的三项：
   - 一个具体画面或场景
   - 一个35岁以上中产“不好意思承认但确实有过”的真实念头
   - 一个说出来有点扎但是对的判断
   - 一种“早就知道会这样”的中年疲惫感或清醒感
   - 一个大家心知肚明但从来不说破的东西
5. 结尾不要升华、不要鸡汤、不要喊口号；可以冷一句、反问一句，或者用一个细节收尾。
6. 禁止使用这些词句：这背后折射出、某种程度上、我们不难发现、值得深思的是、归根结底、从某种意义上说、表面上实际上、这件事给我们敲响了警钟、内卷、破防、裂开、绷不住了、泪目、人间清醒、治愈、松弛感。
7. 如果需要图片，只能使用 [real-image-详细描述] 或 [ai-image-详细描述]；AI 图必须是纯视觉场景，严禁任何文字、水印、logo、数字、按钮、界面元素、二维码和小红书封面感。

【参考资料】
以下是收集到的客观素材。请把它们内化成你的独立观察和判断，而不是机械复述或新闻搬运：

${params.materialContents}`;
    }

    private buildSystemPrompt(
        contentType: ArticleContentType,
        stylePrompt: string,
        contentFormat: ArticleContentFormat,
        templateHtml: string,
        templateNotes: string,
        articleSystemPrompt: string = '',
    ): string {
        if (contentType === 'article') {
            return this.getWeChatArticleV3SystemPrompt(
                stylePrompt,
                contentFormat,
                templateHtml,
                templateNotes,
                articleSystemPrompt,
            );
        }

        if (contentType === 'xiaohongshu') {
            return `你现在是一名专业的小红书图文策划，擅长把热点、经验、观点和避坑信息拆成多页卡片。
【风格要求】
${stylePrompt}

【生成要求】
1. 这是“文字信息优先、图片辅助”的多页图文，不要写成长文章。
2. 一共输出 6 到 7 页，适配 3:4 竖版卡片。
3. 第 1 页必须是封面页，模板固定为 \`cover-poster\`。
4. 其余页面只能从 \`insight-card\`、\`bullet-list\`、\`checklist-card\`、\`summary-card\` 中选。
5. 每页必须返回：role、template、title、body、bullets、highlight、imagePrompt、imageType。
6. 大部分页面应以文字卡为主，只有极少数页面允许使用背景图。
7. 如果素材里有可复用原图，优先 \`imageType: "real"\`；如果纯文字更稳，也可以用 \`none\`。
8. caption 控制在 80 到 160 字，口语化，结论前置。
9. 最后补 4 到 6 个适合小红书的标签。
10. 只能返回 JSON，不要解释，不要 Markdown。`;
        }

        if (contentFormat === 'html') {
            return `你现在是一名专门写微信公众号文章的中文作者，同时也是一个严格遵守模板的 HTML 编辑器。
【写作风格要求】
${stylePrompt}

【HTML 模板】
${templateHtml}

【模板补充说明】
${templateNotes || '无额外备注'}

【核心要求】
1. 文章必须像成熟公众号正式成稿，不像草稿、提纲、搬运稿、新闻播报或营销软文。
2. 默认直接成文，不要反问用户，不要采访式追问。
3. 先内部判断当前题材更偏“事件型”还是“观点型”：
   - 事件型：区分已确认事实和未确认点，未确认内容只能写成疑点或背景。
   - 观点型：不要硬编成新闻，要落到真实场景、真实处境和真实情绪上。
4. 先在内部找到这篇文章真正的刺点，也就是最扎心、最荒唐、最值得转发的那一下，再展开。
5. 内部先形成一小段“私人吐槽底稿”，再把那股真人感翻译成可公开发布的正式成稿。
6. 标题先在内部比较多种写法，再输出传播力最强但不廉价的一版。

【正文要求】
1. 开头先给一个具体细节、动作、画面、冲突或让人不舒服的瞬间，不要先讲大道理。
2. 全文至少自然带出以下五项中的三项：具体场景、不太体面的真实念头、锋利但站得住的判断、作者代入或暴露、一个大家都知道但很少说破的真相。
3. 全文至少有 3 个有信息量的小标题；段落要短，一段尽量 1 到 3 句，适合手机阅读。
4. 语言要像真人，不要 AI 腔，不要汇报腔，不要“这背后折射出”“值得深思的是”这类陈词滥调。
5. 允许一点冷幽默、讽刺和自嘲，但不要过度表演。

【排版与配图规则】
1. 必须直接输出完整 HTML，不要 Markdown，不要代码块，不要解释。
2. 保留模板主体结构、模块顺序和主要 class 名，但把占位文案替换成真正内容。
3. 正文总共最多保留 0 到 2 张图；没有贴切图片时，宁可整段删掉 figure，也不要硬凑。
4. 如需图片，只能使用：
   - [real-image-详细描述]
   - [ai-image-详细描述]
5. AI 图必须是纯视觉场景图，严禁文字、数字、logo、品牌名、水印、角标、按钮、界面元素、截图感。
6. 不要在正文里出现“以下是文章内容”“欢迎阅读”等废话。

【输出格式】
严格按下面格式返回，不要附加任何解释：
TITLE_START
这里写文章标题
TITLE_END
HTML_START
这里写完整 HTML
HTML_END`;
        }

        return `你现在是一名专门写微信公众号热点评论、观察文和观点文的中文作者。
【写作风格要求】
${stylePrompt}

【核心要求】
1. 不要写得像完成任务，要写得像这件事真的击中了你。
2. 目标不是“正确但没感觉”，而是“像真人写出来、能发在公众号上的文章”。
3. 可以有情绪和判断，但不能编造事实，不能把未确认内容写成结论。
4. 默认直接写成稿，不要反问用户，不要采访式追问。
5. 先内部判断当前更偏“事件型”还是“观点型”，再决定切口。
6. 内部先找到真正的刺点，再展开论证；先有人话，再有结构。

【内部处理规则】
1. 事件型输入：区分已确认事实和未确认点，未确认内容只能写成疑点或背景。
2. 观点型输入：不要硬编成新闻，要落到真实场景、关系或处境上。
3. 内部先形成一小段“私人吐槽底稿”，再翻译成可公开发布的公众号成稿。
4. 标题先在内部比较多种写法，再输出最有传播力但不廉价的一版。

【正文要求】
1. 开头先给画面、动作、细节、冲突或刺痛感，不要先讲大道理。
2. 先写让人不舒服的那个点，再慢慢把原因和判断讲透。
3. 全文至少自然带出以下五项中的三项：
   - 一个具体场景
   - 一个不太体面的真实念头
   - 一个锋利但站得住的判断
   - 一点作者自己的代入或暴露
   - 一个大家都知道但很少说破的真相
4. 正文至少 3 个小标题；段落尽量短，适合手机阅读。
5. 正文总共最多保留 0 到 2 张图；没有贴切图片时，宁可不要。
6. 如需图片，只能使用：
   - [real-image-详细描述]
   - [ai-image-详细描述]
7. AI 图只能是纯视觉场景图，严禁文字、数字、logo、品牌名、水印、角标、按钮、界面元素、截图感。
8. 避免 AI 腔和公文腔，比如“这背后折射出”“某种程度上”“值得深思的是”等。

【输出格式】
只能返回 JSON：
{"title":"文章标题","content":"Markdown 正文"}`;
        if (contentType === 'xiaohongshu') {
            return `你现在是一个专业的小红书内容策划与爆款笔记写手，熟悉种草、经验总结、避坑清单、观点表达和互动转化。

【你的写作风格要求】：
${stylePrompt}

【小红书笔记写作要求】：
1. 这是“文字排版优先、图片辅助”的多图卡片笔记，不要把它写成长文章。
2. 一共输出 6 到 7 张卡片，默认适配 3:4 竖版成品卡图。
3. 第 1 张必须是封面大字报，模板固定为 \`cover-poster\`，主标题要强利益点、强冲突或强结果感。
4. 第 2 到第 6/7 张必须使用固定模板集合：\`insight-card\`、\`bullet-list\`、\`checklist-card\`、\`summary-card\`。
5. 每张卡片都必须返回：
- \`role\`：\`cover\` / \`hook\` / \`problem\` / \`solution\` / \`method\` / \`summary\` / \`cta\`
- \`template\`：固定模板名，必须从上面的模板集合里选
- \`title\`：卡片主标题，控制在 8 到 18 个字
- \`body\`：卡片主体说明，控制在 18 到 60 个字
- \`bullets\`：如果是列表模板，返回 2 到 4 条要点，否则返回空数组
- \`highlight\`：该页最值得被记住的一句短话，控制在 6 到 16 个字，可为空字符串
- \`imagePrompt\`：如果需要辅助背景图，给出精准中文提示词；如果不需要，返回空字符串
- \`imageType\`：\`real\` / \`ai\` / \`none\`
6. 只有封面页和极少数页面允许使用图片辅助；大多数页面应以纯文字信息卡为主。
7. 如果素材里存在可复用原图，封面页优先考虑 \`imageType: "real"\`；如果纯文字卡更稳，也可以直接用 \`none\`。
8. 总说明文案（caption）控制在 80 到 160 字，口语化、结论先行，不要长篇展开。
9. 结尾补充 4 到 6 个适合小红书语境的话题标签。
10. 不要输出 Markdown，不要输出解释，只返回 JSON。

【输出格式】：
你的回复必须是纯 JSON：
{"title":"笔记标题","caption":"短说明文案","hashtags":["标签1","标签2"],"slides":[{"role":"cover","template":"cover-poster","title":"封面主标题","body":"封面副标题","bullets":[],"highlight":"适合谁看","imagePrompt":"办公室氛围感背景","imageType":"real"}]}

只能返回 JSON，不要附加解释。`;
        }

        if (contentFormat === 'html') {
            return `你现在是一名专门写微信公众号热点评论、观察文和观点文的中文作者，同时也是一个严格遵守模板的 HTML 编辑器。

【你的写作风格要求】：
${stylePrompt}

【HTML 模板】（模板仅供参考，灵活采用。）：
${templateHtml}

【模板补充说明】：
${templateNotes || '无额外备注'}

【核心写作原则】：
1. 不要写得像“完成任务”，要写得像“这件事你真的有话想说”。
2. 目标不是写一篇“正确但没感觉”的文章，而是写一篇像真人写出来的公众号成稿。
3. 可以有判断、有情绪、有偏向，但不能编造事实，不能把未确认内容写成结论。
4. 默认不要反问用户补信息，直接基于现有材料完成写作。
5. 先有人话和真实感觉，再有结构和观点；先找到刺点，再把道理说透。

【内部处理规则】：
1. 先在内部判断当前更像“事件型输入”还是“观点型输入”。
2. 如果是事件型输入，先在内部区分“已确认事实”和“未确认点”，正文只把未确认内容写成疑点，不要写成定论。
3. 如果是观点型输入，不要强行编成新闻，也不要假装今天真的发生了一件具体事件；要把它当成一个值得展开的表达命题。
4. 无论哪种输入，都先在内部找到这篇文章真正的“刺点”：最让人不舒服、最扎心、最值得转发的那个地方。
5. 在内部先形成一小段不需要输出的“私人吐槽底稿”，然后再把那股真实劲儿翻译成能公开发表的公众号文章。
6. 标题先在内部快速比较多个候选，选最适合传播但不廉价的一版输出，不要把标题写成营销号套皮。

【正文要求】：
1. 开头不要先总结意义，要先给一个瞬间、细节、动作、画面、冲突或让人不舒服的感觉。
2. 先写刺痛，再讲道理；不要一上来就居高临下地下结论。
3. 全文至少做到下面 5 项中的 3 项：
- 一个具体画面或场景
- 一个不太体面的真实念头
- 一个锋利但站得住的判断
- 一点作者自己的代入或暴露
- 一个大家都知道但很少说破的真相
4. 文章要像成熟公众号正式成稿，而不是提纲、素材拼接、新闻播报、汇报稿或营销软文。
5. 段落要短，一段尽量 1 到 3 句；至少给出 3 个有信息量的小标题，避免大段密集文字。
6. 允许有一点讽刺、冷幽默、轻微自嘲，但不要全篇都端着、演着或句句像金句。
7. 避免这些常见 AI 腔和公文腔：例如“这背后折射出”“某种程度上”“值得深思的是”“归根结底”“从某种意义上说”“这件事给我们敲响了警钟”。

【排版与配图法则】：
1. 必须保留模板主体结构、模块顺序和主要 class 名，但允许把不需要的占位文案替换成真实内容。
2. 必须直接输出完整 HTML，不要输出 Markdown，不要输出代码块围栏，不要解释你的写法。
3. 图片不是硬性任务。正文总共最多保留 0 到 2 张图；如果没有真正贴切的图，宁可不要，也不要为了凑版面瞎配图。
4. 只有当图片能明显帮助理解、补足场景或增强可信度时，才保留图片节点；否则可以整段删掉对应的 \`figure\`。
5. 如需图片，占位符只能使用：
- 真实素材图：\`[real-image-详细描述]\`
- AI 生成图：\`[ai-image-详细精准的视觉画面描述]\`
6. 优先使用真实素材图；只有正文确实需要抽象示意或封面感插图时，才使用 AI 图。
7. 不要填写真实图片 URL，不要输出脚本标签，不要在正文里出现“以下是文章内容”“欢迎阅读”等废话。

【输出格式】：
严格按下面格式返回，不要输出 JSON，不要输出 Markdown 代码块，不要附加解释：
TITLE_START
这里写文章标题
TITLE_END
HTML_START
这里写完整 HTML
HTML_END`;
        }

        return `你现在是一名专门写微信公众号热点评论、观察文和观点文的中文作者。

【你的写作风格要求】：
${stylePrompt}

【核心写作原则】：
1. 不要写得像在完成任务，要写得像这件事真的戳中了你。
2. 目标不是“正确”，而是“像真人写的公众号文章”。
3. 可以有情绪和立场，但不能编造事实，不能把未确认内容写成结论。
4. 默认直接写，不要把任务退回给用户，不要进入采访式追问。
5. 先找到刺点，再展开论证；先有人话，再有结构。

【内部处理规则】：
1. 先在内部判断当前输入更像事件型还是观点型。
2. 事件型输入：先内部区分已确认事实和未确认点，再自动选择一个最值得写、最容易共鸣、最不容易写成公关稿的切口。
3. 观点型输入：不要强行补成新闻，而是围绕这个判断找到最贴近现实的常见处境和场景。
4. 内部先形成一小段不需要展示的“私人吐槽底稿”，再把那股真实劲儿写成可发布的正式文章。
5. 标题先在内部快速比较多个候选，选最适合传播但不廉价、不浮夸的一版输出。

【正文要求】：
1. 开头先给画面、细节、动作、刺痛感或冲突，不要先说大道理。
2. 先写让人不舒服的那个点，再慢慢把原因和判断讲透。
3. 全文至少做到下面 5 项中的 3 项：
- 一个具体场景
- 一个不太体面的真实念头
- 一个锋利但站得住的判断
- 一点作者自己的代入或暴露
- 一个大家都知道但很少说破的真相
4. 正文至少有 3 个清晰的小标题；每段尽量短，保证手机阅读时有呼吸感。
5. 正文总共最多 0 到 2 张图；如果没有贴切图片，宁可不要。
6. 根据内容需求选择合适的配图类型：
- 产品截图、数据图表、真实场景照片 → 使用 \`[real-image-详细描述]\`
- 概念图、创意插图、抽象表达 → 使用 \`[ai-image-详细精准的视觉画面描述]\`
7. 真实素材图优先；AI 图只在非常必要时使用。
8. 避免这些常见 AI 腔和公文腔：例如“这背后折射出”“某种程度上”“值得深思的是”“归根结底”“从某种意义上说”“这件事给我们敲响了警钟”。

【输出格式】：
你的回复必须是纯 JSON：
{"title":"文章标题","content":"Markdown 正文（包含图片占位符）"}

只能返回 JSON，不要附加解释。`;
    }

    private buildUserPrompt(params: {
        contentType: ArticleContentType;
        topicTitle: string;
        topicSummary: string;
        keywords: string[];
        materialContents: string;
        templateNotes: string;
        retryReason?: string;
    }): string {
        const cleanRetryInstruction = params.retryReason
            ? `\n【上次输出失败原因】：${params.retryReason}
【本次补充要求】：
1. 必须从头输出完整成稿，不要续写半截内容。
2. ${params.contentType === 'xiaohongshu' ? '不要遗漏标题、开场钩子、核心观点和结尾标签。' : '必须覆盖正文主要结构，不要缺尾段，不要草草收尾。'}
3. 如果输出过长，请压缩单段长度，而不是删掉核心结构。\n`
            : '';

        if (params.contentType === 'xiaohongshu') {
            return `【选题核心方向】：${params.topicTitle}
【摘要】：${params.topicSummary}
【关键词】：${params.keywords.join(', ')}
【模板备注】：${params.templateNotes || '无'}
${cleanRetryInstruction}

以下是收集到的客观素材。请把它们内化成你的独立观察，用你自己的口吻写，不要反复说“根据素材”“从内容可以看出”：

${params.materialContents}`;
        }

        if (params.contentType === 'article') {
            return this.getWeChatArticleV3UserPrompt({
                topicTitle: params.topicTitle,
                topicSummary: params.topicSummary,
                keywords: params.keywords,
                materialContents: params.materialContents,
                templateNotes: params.templateNotes,
                retryInstruction: cleanRetryInstruction,
            });
        }

        return `【选题核心方向】：${params.topicTitle}

【选题分析或摘要】：${params.topicSummary}
【相关关键词】：${params.keywords.join(', ')}
【模板注意事项】：${params.templateNotes || '无'}
${cleanRetryInstruction}

以下是收集到的客观事实素材。请将它们内化为你的独立观察，用你的口吻表达出来，禁忌重复“基于素材”等新闻机器人的废话：

${params.materialContents}`;
    }

    private async generateXiaohongshuNote(params: {
        modelId: string;
        stylePrompt: string;
        topicTitle: string;
        topicSummary: string;
        keywords: string[];
        materialContents: string;
        materialInfos: MaterialInfo[];
        imageStylePrompt?: string;
        imageStyleParams?: { ratio?: string; resolution?: string };
        imageCreationEnabled: boolean;
    }): Promise<XiaohongshuNoteData> {
        const aiResponseText = await this.aiClient.generate(
            params.modelId,
            [
                {
                    role: 'system',
                    content: this.buildSystemPrompt('xiaohongshu', params.stylePrompt, 'markdown', '', ''),
                },
                {
                    role: 'user',
                    content: this.buildUserPrompt({
                        contentType: 'xiaohongshu',
                        topicTitle: params.topicTitle,
                        topicSummary: params.topicSummary,
                        keywords: params.keywords,
                        materialContents: params.materialContents,
                        templateNotes: '',
                    }),
                },
            ],
            {
                temperature: 0.8,
                maxTokens: 5000,
            },
        );

        const payload = this.parseXiaohongshuPayload(aiResponseText, params.topicTitle);
        const imageParams = {
            ...params.imageStyleParams,
            ratio: '3:4',
        };

        const slides = await Promise.all(
            payload.slides.map(async (slide, index) => {
                const imageUrl = params.imageCreationEnabled && slide.imageType !== 'none' && slide.imagePrompt
                    ? await this.imageSelector.selectImage(
                        slide.imageType,
                        slide.imagePrompt,
                        params.materialInfos,
                        params.imageStylePrompt,
                        imageParams,
                    ).catch(() => null)
                    : null;

                const cardSvg = renderXiaohongshuCardSvg({
                    role: slide.role,
                    template: slide.template,
                    title: slide.title,
                    body: slide.body,
                    bullets: slide.bullets,
                    highlight: slide.highlight,
                    imageType: slide.imageType,
                    backgroundImageUrl: imageUrl,
                    pageNumber: index + 1,
                    totalPages: payload.slides.length,
                });
                const cardImageUrl = await this.renderXiaohongshuCardPng(cardSvg, index);

                return {
                    ...slide,
                    coverText: slide.title,
                    bodyText: slide.body,
                    imageUrl,
                    backgroundImageUrl: imageUrl,
                    cardImageUrl,
                };
            }),
        );

        return {
            title: payload.title,
            caption: payload.caption,
            hashtags: payload.hashtags,
            slides,
        };
    }

    private parseXiaohongshuPayload(aiResponseText: string, fallbackTitle: string): GeneratedXiaohongshuPayload {
        const cleanedText = this.stripCodeFence(aiResponseText.trim());

        let parsedPayload: Record<string, unknown> | null = null;
        try {
            parsedPayload = JSON.parse(cleanedText) as Record<string, unknown>;
        } catch (error) {
            const message = error instanceof Error ? error.message : '未知错误';
            this.logger.error(`小红书 JSON 解析失败: ${message}`);
            throw new Error('AI 未按要求返回小红书卡片 JSON');
        }

        const rawSlides = Array.isArray(parsedPayload?.slides) ? parsedPayload.slides : [];
        const slides = rawSlides
            .map((slide, index) => this.normalizeXiaohongshuSlide(slide, index))
            .filter((slide): slide is XiaohongshuSlidePlan => Boolean(slide));

        if (slides.length < 5) {
            throw new Error('小红书卡片数量不足，至少需要 5 张卡片');
        }

        const hashtags = Array.isArray(parsedPayload?.hashtags)
            ? parsedPayload.hashtags.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
            : [];

        return {
            title: this.normalizeTextValue(parsedPayload?.title, fallbackTitle),
            caption: this.normalizeTextValue(parsedPayload?.caption, ''),
            hashtags: hashtags.slice(0, 8),
            slides: slides.slice(0, 9),
        };
    }

    private normalizeXiaohongshuSlide(slide: unknown, index: number): XiaohongshuSlidePlan | null {
        if (!slide || typeof slide !== 'object') {
            return null;
        }

        const record = slide as Record<string, unknown>;
        const title = this.clampXiaohongshuText(this.normalizeTextValue(record.title, this.normalizeTextValue(record.coverText, '')).trim(), index === 0 ? 22 : 24);
        const body = this.clampXiaohongshuText(this.normalizeTextValue(record.body, this.normalizeTextValue(record.bodyText, '')).trim(), index === 0 ? 46 : 88);
        const bullets = Array.isArray(record.bullets)
            ? record.bullets.filter((item): item is string => typeof item === 'string').map((item) => this.clampXiaohongshuText(item.trim(), 30)).filter(Boolean).slice(0, 4)
            : [];
        const highlight = this.clampXiaohongshuText(this.normalizeTextValue(record.highlight, '').trim(), 18);
        const imagePrompt = this.clampXiaohongshuText(this.normalizeTextValue(record.imagePrompt, '').trim(), 40);
        const rawImageType = record.imageType === 'real' ? 'real' : record.imageType === 'none' ? 'none' : 'ai';
        const role = index === 0 ? 'cover' : this.normalizeXiaohongshuRole(record.role, index);
        const template = index === 0 ? 'cover-poster' : this.normalizeXiaohongshuTemplate(record.template, role, bullets, index);
        const imageType = imagePrompt ? rawImageType : 'none';

        if (!title || (!body && bullets.length === 0)) {
            return null;
        }

        return {
            role,
            template,
            title,
            body,
            bullets,
            highlight,
            imagePrompt,
            imageType,
        };
    }

    private clampXiaohongshuText(value: string, maxChars: number): string {
        const normalized = value.replace(/\s+/g, ' ').trim();
        const chars = Array.from(normalized);
        if (chars.length <= maxChars) {
            return normalized;
        }

        return `${chars.slice(0, Math.max(1, maxChars - 1)).join('').replace(/[.。…！!？?，,；;：: ]+$/g, '')}…`;
    }

    private normalizeXiaohongshuRole(value: unknown, index: number): XiaohongshuSlideRole {
        const role = typeof value === 'string' ? value.trim() : '';
        const fallbackRoles: XiaohongshuSlideRole[] = ['cover', 'hook', 'problem', 'solution', 'method', 'summary', 'cta'];
        const normalizedRole = fallbackRoles.find((item) => item === role);
        return normalizedRole || fallbackRoles[Math.min(index, fallbackRoles.length - 1)];
    }

    private normalizeXiaohongshuTemplate(
        value: unknown,
        role: XiaohongshuSlideRole,
        bullets: string[],
        index: number,
    ): XiaohongshuSlideTemplate {
        const template = typeof value === 'string' ? value.trim() : '';
        const availableTemplates: XiaohongshuSlideTemplate[] = ['cover-poster', 'insight-card', 'bullet-list', 'checklist-card', 'summary-card'];
        const normalized = availableTemplates.find((item) => item === template);
        if (normalized) {
            return normalized;
        }

        if (index === 0 || role === 'cover') {
            return 'cover-poster';
        }
        if (role === 'summary' || role === 'cta') {
            return 'summary-card';
        }
        if (bullets.length >= 3) {
            return role === 'method' ? 'checklist-card' : 'bullet-list';
        }

        return 'insight-card';
    }

    private async renderXiaohongshuCardPng(svg: string, index: number): Promise<string> {
        try {
            const pngBuffer = await sharp(Buffer.from(svg)).png().toBuffer();
            const uploadedUrl = await this.qiniuService.uploadBuffer(pngBuffer, 'png', 'xiaohongshu-cards');
            if (uploadedUrl) {
                return uploadedUrl;
            }

            return `data:image/png;base64,${pngBuffer.toString('base64')}`;
        } catch (error) {
            const message = error instanceof Error ? error.message : '未知错误';
            this.logger.warn(`第 ${index + 1} 张小红书卡图转 PNG 失败，回退 SVG：${message}`);
            return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
        }
    }

    private buildXiaohongshuContent(caption: string, hashtags: string[]): string {
        const tagLine = hashtags.length > 0 ? hashtags.map((tag) => tag.startsWith('#') ? tag : `#${tag}`).join(' ') : '';
        return [caption.trim(), tagLine].filter(Boolean).join('\n\n');
    }

    private getContentLabel(contentType: ArticleContentType): string {
        return contentType === 'xiaohongshu' ? '小红书笔记' : '文章';
    }

    private getDefaultArticleSystemPrompt(): string {
        return [
            '# 公众号爆款正文写作提示词（咪蒙风格）',
            '',
            '## ▌第一步：先读资料，找爆点',
            '',
            '拿到资料后，不要急着写。先做三件事：',
            '1. 提炼核心矛盾：这件事让人愤怒/共鸣/崩溃的根本原因是什么？一句话说清楚。',
            '2. 找最强的细节：哪个场景、哪句对话、哪个数字最让人想骂人？这就是开场素材。',
            '3. 确定读者立场：读者看完这篇文章，应该觉得"说出了我的心声"还是"我也被坑过"？',
            '',
            '写作原则：你不是在复述资料，你是在替读者说出他们憋在心里的话。',
            '',
            '## ▌第二步：标题先行',
            '',
            '标题决定打开率。一篇文章可以先拟3个标题备选，选最戳人的那个。',
            '',
            '好标题的三个标准：',
            '- 让人看完第一眼就想点进去',
            '- 让人觉得"这说的就是我"',
            '- 让人有立刻转发的冲动',
            '',
            '常用公式（根据内容选一个）：',
            '- 「愤怒型」：直接点名矛盾，语气强硬——"XXX，你他妈能不能有点良心"',
            '- 「共鸣型」：精准描述痛点场景——"被XXX坑了10年，我终于想明白了"',
            '- 「反转型」：制造认知冲突——"所有人都说XXX好，但没人告诉你它有多可怕"',
            '- 「揭秘型」：暗示有内幕——"关于XXX，你被骗了但你不知道"',
            '',
            '副标题：补一句话，解释主标题说的是什么事，增加可信度。',
            '',
            '## ▌第三步：正文结构',
            '',
            '字数：1200-1800字。不够有力就是废话太多，不是字数不够。',
            '',
            '整体节奏：',
            '开场（荒谬感引入）',
            '→ 案例1（从小事切入，建立共鸣）',
            '→ 案例2（升级，矛盾激化）',
            '→ 案例3/转折（揭示本质，情绪爆发）',
            '→ 收尾（给态度，给金句，让人转发）',
            '',
            '### 开场设计（200字以内）',
            '- 第一段就出现冲突，不是铺垫，是直接扔进去',
            '- 用真实对话或具体场景，不用抽象概念',
            '- 让读者在第一段就点头或皱眉',
            '- 开场不解释背景，直接给事件。背景在后面慢慢交代',
            '',
            '### 案例展开',
            '选案例的标准：具体，有时间地点人物；对话还原，有原话；荒谬到让人想转发截图。',
            '',
            '每个案例的四层结构：',
            '1. 场景：在哪，谁，发生了什么（3-4句话，不啰嗦）',
            '2. 对话：还原关键对话，保留语气词，不美化',
            '3. 内心戏：作者的真实反应，用短句，可以用"我擦""我当时就愣住了""你敢信？"',
            '4. 评论：一句话点破本质，要犀利，这句话要能单独截图流传',
            '',
            '案例递进逻辑：',
            '- 第一个案例：读者熟悉的小事，"对对对就是这种感觉"',
            '- 第二个案例：程度升级，让人开始愤怒',
            '- 第三个案例（如有）：击穿底线，情绪爆发',
            '',
            '### 收尾设计',
            '不要说教，不要总结，不要"所以我们应该……"',
            '收尾要做的事：',
            '- 给一个态度：我的立场是什么，清清楚楚',
            '- 给一句金句：可以被截图转发的那种',
            '- 给一个出口：让读者知道他们可以怎么做，或者说出"我也是这样想的"',
            '',
            '金句要求：',
            '- 15字以内',
            '- 不装，不矫情',
            '- 一刀切中要害',
            '',
            '好的收尾让人看完想转发，烂的收尾让人看完想关掉。',
            '',
            '## ▌第四步：语言规范',
            '',
            '写对话：',
            '- 保留"啊""哦""那个什么""你懂吧"这类语气词',
            '- 不要把对方说的话写得太"完整"——真实的人说话是断的',
            '- 坏人的话要写得越真实越好，不用替他们美化',
            '',
            '写内心独白：',
            '- 短句优先，一个念头一句话',
            '- 多用问句："你敢信？""这正常吗？""我是不是傻？"',
            '- 情绪词直接用，不绕弯子',
            '',
            '禁止事项：',
            '- 不写"在这个浮躁的时代"这种句子',
            '- 不用"我们""大家"代替"我"',
            '- 不说"希望每个人都能……"',
            '- 不用超过20字的长句解释一个简单的情绪',
            '- 不在第一节就情绪爆发——留着，越到后面越猛',
            '',
            '允许使用：',
            '- 网络用语、俚语（根据读者群体判断）',
            '- 适度粗口（不是为了骂人，是为了真实）',
            '- 自嘲和黑色幽默',
            '- 反讽（但要让读者能看懂是在讽刺）',
            '',
            '## ▌第五步：排版规范',
            '',
            '段落：',
            '- 2-3句一段，重要的话单独一段',
            '- 对话独立成段，不和叙述混在一起',
            '- 情绪爆发点：单句单段，加粗',
            '',
            '强调方式：',
            '- 核心观点加粗：这句话要让人记住',
            '- 关键词用书名号或引号包起来',
            '- 金句用斜体：这就是那句话',
            '',
            '分隔符：',
            '- 案例之间：◆',
            '- 主题转换：---',
            '- 特殊补充内容：▌',
            '',
            '标点：',
            '- 多用！？ ，少用句号',
            '- 破折号——用在转折和停顿',
            '- 省略号……用在欲言又止',
            '',
            '## ▌检验清单（写完后对照）',
            '- 开场第一段，是否已经出现冲突？',
            '- 每个案例，有没有一句可以单独截图的话？',
            '- 全文有没有任何一句"我们应该"或"希望大家"？',
            '- 情绪有没有递进？还是一开始就满级愤怒？',
            '- 读者看完，会不会说"说出我心里话了"？',
            '- 收尾有没有一句金句？',
            '- 如果你是读者，你会不会转发这篇文章？',
            '',
            '如果有任何一项答案让你不确定——回去改。',
            '',
            '核心原则：不是你在发泄，是你在替读者发泄。',
            '读者转发这篇文章，是因为他们想让别人知道"我也有这种经历"。',
            '你写的每一个字，都要服务于这个目的。',
        ].join('\n');
    }

    private getDefaultStylePrompt(contentType: ArticleContentType): string {
        if (contentType === 'xiaohongshu') {
            return '你是一个懂选题、懂平台语感、懂情绪共鸣的小红书内容创作者。请写得真实、口语化、可转述，重点前置，少讲大道理，像一个有经验的人在把踩坑、结论和感受直接讲给读者听。';
        }

        return '你是一名专门写微信公众号热点评论、观察文和观点文的中文作者。不要写得像完成任务，要写得像这件事你真的有话想说。默认直接成文，不采访式追问。文章要像成熟公众号正式成稿：先找刺点，先有人话，先有画面和情绪，再把判断说透。可以有立场和情绪，但不能编造事实、不能把未确认内容写成结论。段落要短，语气自然，避免模板腔、汇报腔、新闻播报腔和常见 AI 套话。';
    }

    private getDefaultArticleTemplate(): string {
        return `<article class="wechat-article">
  <section class="wechat-intro">
    <p class="wechat-lead">这里写开篇引子。第一段要直接进入情境、冲突或问题，不要空泛铺垫。</p>
  </section>

  <section class="wechat-section">
    <h2>先把最扎心的那个点说透</h2>
    <p>这里写第一部分正文。用两到三段把事件、现象或问题讲清楚，每段尽量短一点。</p>
    <p>这里继续补充关键事实、用户感受或作者观察，避免套话。</p>
  </section>

  <section class="wechat-section">
    <h2>真正值得展开的，不只是表面那件事</h2>
    <p>这里写第二部分正文。给出判断、拆解原因，或者指出最容易被忽略的地方。</p>
    <blockquote>这里放一句最值得被记住的话，适合作为金句或观点提炼。</blockquote>
  </section>

  <figure class="wechat-figure">
    <img src="[real-image-与正文强相关的真实配图描述]" alt="正文配图" />
    <figcaption>如果图片不够贴切，可以整段删除，不要为了凑图保留无关图片。</figcaption>
  </figure>

  <section class="wechat-section">
    <h2>如果这件事落到普通人身上，会发生什么</h2>
    <p>这里写第三部分正文，把问题往现实生活、普通人处境或读者关切上落。</p>
  </section>

  <section class="wechat-section">
    <h2>最后给读者一个带得走的结论</h2>
    <p>这里写最后一部分正文。总结最核心的结论、提醒或态度，不要草草收尾。</p>
    <ul>
      <li>可以保留 2 到 3 条真正有用的要点</li>
      <li>也可以删掉列表，改成更自然的收束段落</li>
    </ul>
  </section>
</article>`;
    }

    private async generateWechatArticlePayload(params: {
        modelId: string;
        topicTitle: string;
        topicSummary: string;
        keywords: string[];
        materialContents: string;
        stylePrompt: string;
        articleSystemPrompt: string;
        materialInfos: MaterialInfo[];
        imageStylePrompt?: string;
        imageStyleParams?: { ratio?: string; resolution?: string };
        imageCreationEnabled: boolean;
    }): Promise<GeneratedArticlePayload> {
        const markdownDraft = await this.generateArticlePayload({
            modelId: params.modelId,
            systemPrompt: this.buildWechatContinuousSystemPrompt(params.stylePrompt, params.articleSystemPrompt),
            userPrompt: this.buildWechatContinuousUserPrompt({
                topicTitle: params.topicTitle,
                topicSummary: params.topicSummary,
                keywords: params.keywords,
                materialContents: params.materialContents,
            }),
            fallbackTitle: params.topicTitle,
            contentFormat: 'markdown',
            templateHtml: '',
        });

        const normalizedDraftContent = this.prepareWechatDraftMarkdown(markdownDraft.content);

        const polishedMarkdownPayload = await this.polishWechatArticlePayload({
            modelId: params.modelId,
            topicTitle: params.topicTitle,
            draftTitle: markdownDraft.title,
            draftContent: normalizedDraftContent,
        });

        const normalizedMarkdownPayload = {
            ...polishedMarkdownPayload,
            content: this.finalizeWechatMarkdown(polishedMarkdownPayload.content),
        };

        const renderedMarkdown = await this.renderImages({
            content: normalizedMarkdownPayload.content,
            contentFormat: 'markdown',
            materialInfos: params.materialInfos,
            imageStylePrompt: params.imageStylePrompt,
            imageStyleParams: params.imageStyleParams,
            imageCreationEnabled: params.imageCreationEnabled,
            topicTitle: params.topicTitle,
        });

        const compiledHtml = await WechatCompiler.compile(renderedMarkdown.content);

        return {
            title: normalizedMarkdownPayload.title,
            content: compiledHtml,
            contentFormat: 'html',
        };
    }

    private async polishWechatArticlePayload(params: {
        modelId: string;
        topicTitle: string;
        draftTitle: string;
        draftContent: string;
    }): Promise<GeneratedArticlePayload> {
        try {
            const aiResponseText = await this.aiClient.generate(
                params.modelId,
                [
                    {
                        role: 'system',
                        content: `你是一名极其擅长公众号成稿统稿的总编，现在只做一遍“整篇统稿重写”。

【任务目标】
1. 不改核心事实、不改立场、不新增信息，只把这篇初稿统成一篇更像真人一口气写完的公众号成稿。
2. 允许大幅重组段落顺序、删掉弱段落、删掉重复句、删掉花哨修辞，但不要写成另一篇新文章。
3. 文章必须围绕一条主线推进，段与段自然咬合，不要“一段一个完整观点”，不要像在答题。
4. 默认不要小标题；实在需要时最多保留 1 个，而且它必须真承担转场，不是装饰。
5. 去掉机械感、解释腔、媒体述评腔、故作深沉的修辞腔，不要显摆文笔。
6. 去掉重复段落、重复判断、重复比喻、重复收束，尤其不能把同一层意思换个说法再说一遍。
7. 优先用人话、短句、真判断。少写“这背后是”“这揭示了”“某种隐喻”“某种程度上”。
8. 不要端着，不要写成媒体专栏，不要像在展示写作技巧。要像一个作者坐下来，顺着一口气把这件事讲透。
9. 不要输出 HTML，不要解释修改过程。

【输出格式】
只返回 JSON：
{"title":"优化后的标题","content":"markdown 正文"}`,
                    },
                    {
                        role: 'user',
                        content: `请对下面这篇公众号初稿做最后一遍统稿重写，让它更自然、更顺、更像真人写完的成稿。

【选题】
${params.topicTitle}

【当前标题】
${params.draftTitle}

【当前初稿】
${params.draftContent}

【重点处理方向】
1. 去掉“像段子拼起来”“像一节一节答题”的感觉
2. 去掉过度修辞和解释腔
3. 去掉重复判断、重复段落、重复收束
4. 把全文统成一条主线，而不是并列堆材料
5. 最终读起来要像一个作者顺着一口气写完`,
                    },
                ],
                {
                    temperature: 0.25,
                    maxTokens: ARTICLE_POLISH_MAX_TOKENS,
                },
            );

            return this.parseArticlePayload(aiResponseText, params.draftTitle, 'markdown');
        } catch (error) {
            const message = error instanceof Error ? error.message : '未知错误';
            this.logger.warn(`公众号正文统稿失败，回退到初稿：${message}`);
            return {
                title: params.draftTitle,
                content: params.draftContent,
                contentFormat: 'markdown',
            };
        }
    }

    private buildWechatContinuousSystemPrompt(stylePrompt: string, articleSystemPrompt: string): string {
        const basePrompt = articleSystemPrompt.trim() || this.getDefaultArticleSystemPrompt();
        return `${basePrompt}

【本次生成规则】
1. 这一步只负责把正文一口气写顺，先写成完整 markdown 成稿，不要输出 HTML，不要自己套模板，不要思考排版。
2. 整篇文章必须像一篇自然连贯的公众号成稿，而不是按提纲填空、不是卡片拼接、不是一段一个观点标签。
3. 不要机械照着“案例1、案例2、案例3”去排练式展开。可以吸收爆点和情绪，但正文必须像真实作者顺着一个核心线索讲下去。
4. 如果基础写作提示词里出现“标题先行、案例1/2/3、开场/收尾、检验清单”等结构，那只是你的内部工作法，不要求在成稿里逐项显形执行；一切以“读起来像完整文章”为最高优先级。
5. 默认不要加小标题；如果不用小标题更顺，就整篇直接写下去。确实需要时，全文最多 1 个。
6. 开头先把读者拉进一个具体瞬间或处境，中段持续推进，结尾自然收束，不要突然拔高，也不要强行上价值。
7. 语言必须像真人写作，避免 AI 腔、汇报腔、新闻播报腔、媒体评论腔。少用比喻，少用“这背后是……”之类的解释句。
8. 能用大白话讲清楚，就不要写成修辞表演。宁可直接，也不要精致得发假。
9. 正文里最多保留 0-1 个图片占位符；没有必要就不要插图。默认优先真实图片，不要为了排版硬凑 AI 图。
10. 如果需要图片，只能使用 [real-image-具体描述] 或 [ai-image-具体描述]。AI 图必须是纯视觉场景，严禁任何文字、水印、logo、按钮、截图感或小红书封面感。

【补充风格】
${stylePrompt}`;
    }

    private buildWechatContinuousUserPrompt(params: {
        topicTitle: string;
        topicSummary: string;
        keywords: string[];
        materialContents: string;
    }): string {
        return `请围绕下面这个题，直接写出一篇适合公众号发布的完整成稿。

【选题】
${params.topicTitle}

【摘要】
${params.topicSummary || '无'}

【关键词】
${params.keywords.join('、') || '无'}

【写作要求】
1. 整篇文章要一气呵成，重点是“连贯”“顺着读下去”“像一个成熟作者真的写完了一篇文章”。
2. 不要写成提纲，不要写成新闻综述，不要一段一个孤立结论，不要到处塞金句和空洞小标题。
3. 全文最好围绕一个主案例或一条主判断推进，最多允许 1 个补充例子，不要并列堆出三个“都还行但都不够深”的案例。
4. 如果你脑子里已经形成了“标题、开头、案例、收尾”的步骤，只把它当成内部组织材料的方法，不要把正文写成一格一格的流程文。
5. 默认写 1200-1800 字；手机阅读友好，段落短，但逻辑要连着走。
6. 开头先抓人，中段持续推进，结尾自然收束。不要机械总结，不要硬塞鸡汤，不要把全文重新概括一遍。
7. 默认不要加小标题；如果不用小标题更顺，就整篇直接写下去。确实需要时，最多 1 个，而且必须真正承担转场作用。
8. 每一段都要接住上一段，像自然往下讲，而不是重新起一个模块。
9. 语言要直接、自然、像真人在说话。不要一段一个漂亮比喻，不要频繁写“某种隐喻”“这背后是”“这揭示了”。
10. 如果材料不完整，就只写能站住的部分；不确定的内容写成风险、疑点或处境，不要冒充事实。
11. 可以删掉不够强的材料，不需要把素材里的每一层信息都交代一遍。宁可少一点，也不要像拼装说明书。

【素材】
${params.materialContents}

【输出格式】
只返回 JSON：
{"title":"文章标题","content":"markdown 正文"}`;
    }

    private prepareWechatDraftMarkdown(content: string): string {
        return this.normalizeWechatMarkdown(content, { preserveRealImages: false });
    }

    private finalizeWechatMarkdown(content: string): string {
        return this.cleanupWechatPolishedMarkdown(
            this.normalizeWechatMarkdown(content, { preserveRealImages: true }),
        );
    }

    private normalizeWechatMarkdown(
        content: string,
        options: { preserveRealImages: boolean },
    ): string {
        const seenBlocks = new Set<string>();
        let normalized = this.stripCodeFence(content.trim()).replace(/\r\n/g, '\n');

        normalized = normalized.replace(/\[(?:ai-image|image)-[^\]]+\]/g, '');
        normalized = normalized.replace(/\[real-image-[^\]]+\]/g, (match) => {
            if (!options.preserveRealImages) {
                return '';
            }

            if (seenBlocks.has(`image:${match}`)) {
                return '';
            }

            seenBlocks.add(`image:${match}`);
            return match;
        });

        const blocks = normalized
            .split(/\n{2,}/)
            .map((block) => block.trim())
            .filter(Boolean);

        const dedupedBlocks: string[] = [];
        for (const block of blocks) {
            const fingerprint = block
                .toLowerCase()
                .replace(/[#>*`_~\-]/g, '')
                .replace(/[^\p{L}\p{N}]/gu, '');

            if (fingerprint.length >= 18) {
                if (seenBlocks.has(fingerprint)) {
                    continue;
                }

                seenBlocks.add(fingerprint);
            }

            dedupedBlocks.push(block);
        }

        return dedupedBlocks
            .join('\n\n')
            .replace(/\n{3,}/g, '\n\n')
            .replace(/[ \t]+\n/g, '\n')
            .trim();
    }

    private cleanupWechatPolishedMarkdown(content: string): string {
        const normalized = content
            .replace(/\n{3,}/g, '\n\n')
            .replace(/[ \t]+\n/g, '\n')
            .trim();

        const blocks = normalized
            .split(/\n{2,}/)
            .map((block) => block.trim())
            .filter(Boolean);

        const cleanedBlocks: string[] = [];
        const seenFingerprints = new Set<string>();

        for (const block of blocks) {
            const fingerprint = block
                .replace(/^#{1,6}\s+/gm, '')
                .replace(/[*_`>#\-◆▌]/g, '')
                .replace(/\s+/g, '')
                .toLowerCase();

            if (fingerprint.length >= 24 && seenFingerprints.has(fingerprint)) {
                continue;
            }

            if (fingerprint.length >= 24) {
                seenFingerprints.add(fingerprint);
            }

            cleanedBlocks.push(block);
        }

        return this.collapseRepeatedWechatSequence(cleanedBlocks).join('\n\n').trim();
    }

    private collapseRepeatedWechatSequence(blocks: string[]): string[] {
        if (blocks.length < 6) {
            return blocks;
        }

        const fingerprints = blocks.map((block) =>
            block
                .replace(/^#{1,6}\s+/gm, '')
                .replace(/[*_`>#\-◆▌]/g, '')
                .replace(/\s+/g, '')
                .toLowerCase(),
        );

        for (let size = Math.floor(blocks.length / 2); size >= 3; size--) {
            const first = fingerprints.slice(0, size).join('|');
            const second = fingerprints.slice(size, size * 2).join('|');
            if (first && first === second) {
                return blocks.slice(0, size);
            }
        }

        return blocks;
    }

    private async generateArticlePayload(params: {
        modelId: string;
        systemPrompt: string;
        userPrompt: string;
        fallbackTitle: string;
        contentFormat: ArticleContentFormat;
        templateHtml: string;
    }): Promise<GeneratedArticlePayload> {
        let lastReason = '';

        for (let attempt = 1; attempt <= ARTICLE_MAX_GENERATION_ATTEMPTS; attempt++) {
            const finalUserPrompt = attempt === 1
                ? params.userPrompt
                : `${params.userPrompt}\n\n【重试要求】：${lastReason || '上次输出不完整'}\n请重新完整输出整篇文章。`;

            const aiResponseText = await this.aiClient.generate(
                params.modelId,
                [
                    { role: 'system', content: params.systemPrompt },
                    { role: 'user', content: finalUserPrompt },
                ],
                {
                    temperature: params.contentFormat === 'html' ? 0.7 : 0.55,
                    maxTokens: params.contentFormat === 'html' ? ARTICLE_HTML_MAX_TOKENS : ARTICLE_MARKDOWN_MAX_TOKENS,
                },
            );

            const articleData = this.parseArticlePayload(aiResponseText, params.fallbackTitle, params.contentFormat);
            if (!articleData.content || !articleData.title) {
                throw new Error('大语言模型未能按要求生成文章正文和标题');
            }

            if (params.contentFormat !== 'html') {
                return articleData;
            }

            const validation = this.validateHtmlArticle(articleData.content, params.templateHtml);
            if (validation.isComplete) {
                return articleData;
            }

            const continuedContent = await this.tryContinueHtmlArticle({
                modelId: params.modelId,
                systemPrompt: params.systemPrompt,
                userPrompt: params.userPrompt,
                fallbackTitle: articleData.title || params.fallbackTitle,
                incompleteContent: articleData.content,
                templateHtml: params.templateHtml,
                validationReason: validation.reason,
            });
            if (continuedContent) {
                return {
                    ...articleData,
                    content: continuedContent,
                };
            }

            lastReason = validation.reason;
            const warnMsg = `HTML 文章生成第 ${attempt} 次校验未通过：${validation.reason}`;
            this.logger.warn(warnMsg);
            await this.systemLogsService.record(warnMsg, 'warning');
        }

        throw new Error(`AI 返回的 HTML 不完整：${lastReason || '未通过完整性校验'}`);
    }

    private parseArticlePayload(aiResponseText: string, fallbackTitle: string, contentFormat: ArticleContentFormat): GeneratedArticlePayload {
        const cleanedText = this.stripCodeFence(aiResponseText.trim());

        if (contentFormat === 'html') {
            const blockTitle = this.extractBetween(cleanedText, 'TITLE_START', 'TITLE_END');
            const blockHtml = this.extractBetween(cleanedText, 'HTML_START', 'HTML_END');
            if (blockTitle.trim() && blockHtml.trim()) {
                return {
                    title: blockTitle.trim(),
                    content: blockHtml.trim(),
                    contentFormat,
                };
            }
        }

        let parsedPayload: Record<string, unknown> | null = null;

        try {
            parsedPayload = JSON.parse(cleanedText) as Record<string, unknown>;
        } catch (error) {
            const message = error instanceof Error ? error.message : '未知错误';
            this.logger.error(`AI JSON 解析失败，进入容错提取: ${message}`);
        }

        const title = this.normalizeTextValue(
            parsedPayload?.title,
            this.extractFieldByRegex(cleanedText, 'title') || fallbackTitle
        );

        const candidates = contentFormat === 'html'
            ? ['rawHtml', 'html', 'content']
            : ['content', 'rawHtml', 'html'];

        let content = '';
        for (const key of candidates) {
            const value = this.normalizeTextValue(parsedPayload?.[key], '');
            if (value.trim()) {
                content = value;
                break;
            }
            const extracted = this.extractFieldTolerantly(cleanedText, key);
            if (extracted.trim()) {
                content = extracted;
                break;
            }
        }

        if (!content.trim() && contentFormat === 'html') {
            content = this.extractHtmlFragment(cleanedText);
        }

        if (!content.trim()) {
            this.logger.warn('正文抽取失败，将直接保存 AI 原始返回');
            content = cleanedText;
        }

        return {
            title,
            content: this.unescapeModelText(content),
            contentFormat,
        };
    }

    private async tryContinueHtmlArticle(params: {
        modelId: string;
        systemPrompt: string;
        userPrompt: string;
        fallbackTitle: string;
        incompleteContent: string;
        templateHtml: string;
        validationReason: string;
    }): Promise<string | null> {
        const continuationMsg = `HTML 初稿疑似截断，尝试基于同一轮上下文续写补全。原因：${params.validationReason}`;
        this.logger.warn(continuationMsg);
        await this.systemLogsService.record(continuationMsg, 'warning');

        const aiResponseText = await this.aiClient.generate(
            params.modelId,
            [
                { role: 'system', content: params.systemPrompt },
                { role: 'user', content: params.userPrompt },
                {
                    role: 'assistant',
                    content: this.buildHtmlAssistantSnapshot(params.fallbackTitle, params.incompleteContent),
                },
                {
                    role: 'user',
                    content: this.buildHtmlContinuationPrompt(params.validationReason, params.incompleteContent),
                },
            ],
            {
                temperature: 0.3,
                maxTokens: ARTICLE_HTML_CONTINUATION_MAX_TOKENS,
            },
        );

        const standaloneHtml = this.extractStandaloneHtml(aiResponseText);
        if (standaloneHtml) {
            const standaloneValidation = this.validateHtmlArticle(standaloneHtml, params.templateHtml);
            if (standaloneValidation.isComplete) {
                const successMsg = 'HTML 续写补全返回了完整成稿，直接采用补全结果';
                this.logger.log(successMsg);
                await this.systemLogsService.record(successMsg, 'info');
                return standaloneHtml;
            }
        }

        const continuation = this.extractHtmlContinuation(aiResponseText);
        if (!continuation) {
            const warnMsg = 'HTML 续写补全未提取到有效片段，将回退到整篇重生成';
            this.logger.warn(warnMsg);
            await this.systemLogsService.record(warnMsg, 'warning');
            return null;
        }

        const mergedContent = this.mergeHtmlContinuation(params.incompleteContent, continuation);
        const mergedValidation = this.validateHtmlArticle(mergedContent, params.templateHtml);
        if (mergedValidation.isComplete) {
            const successMsg = 'HTML 截断内容已通过续写补全恢复完整';
            this.logger.log(successMsg);
            await this.systemLogsService.record(successMsg, 'info');
            return mergedContent;
        }

        const warnMsg = `HTML 续写补全后仍未通过校验：${mergedValidation.reason}`;
        this.logger.warn(warnMsg);
        await this.systemLogsService.record(warnMsg, 'warning');
        return null;
    }

    private normalizeTextValue(value: unknown, fallback: string): string {
        return typeof value === 'string' ? value : fallback;
    }

    private buildHtmlAssistantSnapshot(title: string, incompleteContent: string): string {
        return `TITLE_START
${title}
TITLE_END
HTML_START
${incompleteContent}
HTML_END`;
    }

    private buildHtmlContinuationPrompt(validationReason: string, incompleteContent: string): string {
        const tailPreview = incompleteContent.trim().slice(-800);
        return `你上一条消息里的 HTML 没有输出完整，失败原因是：${validationReason}

请严格基于你刚才已经写出的内容继续往后补全，不要重写标题，不要重复前文，不要从头再写。

【补全要求】：
1. 只输出“剩余缺失的 HTML 片段”。
2. 需要把未闭合的结构补齐，并完整收尾。
3. 不要输出解释，不要输出 Markdown 代码块。
4. 如果你判断上一条内容其实已经不适合续写，可以直接从头输出一份完整 HTML。

【上一段结尾参考】：
${tailPreview}

【输出格式】：
如果输出剩余片段，请严格使用：
HTML_CONTINUATION_START
这里写剩余 HTML 片段
HTML_CONTINUATION_END

如果输出完整 HTML，请严格使用：
HTML_START
这里写完整 HTML
HTML_END`;
    }

    private stripCodeFence(source: string): string {
        return source.replace(/^```(?:json|html)?\n/i, '').replace(/\n```$/i, '').trim();
    }

    private extractBetween(source: string, startToken: string, endToken: string): string {
        const startIndex = source.indexOf(startToken);
        if (startIndex === -1) {
            return '';
        }

        const contentStart = startIndex + startToken.length;
        const endIndex = source.indexOf(endToken, contentStart);
        if (endIndex === -1) {
            return '';
        }

        return source.slice(contentStart, endIndex).trim();
    }

    private extractFieldByRegex(source: string, field: string): string {
        const regex = new RegExp(`"${field}"\\s*:\\s*"([\\s\\S]*?)"(?:\\s*,|\\s*})`, 'i');
        const match = source.match(regex);
        return match ? match[1] : '';
    }

    private extractStandaloneHtml(source: string): string {
        const cleanedText = this.stripCodeFence(source.trim());
        const blockHtml = this.extractBetween(cleanedText, 'HTML_START', 'HTML_END');
        if (blockHtml.trim()) {
            return this.unescapeModelText(blockHtml.trim());
        }

        const extractedHtml = this.extractHtmlFragment(cleanedText);
        return extractedHtml ? this.unescapeModelText(extractedHtml.trim()) : '';
    }

    private extractHtmlContinuation(source: string): string {
        const cleanedText = this.stripCodeFence(source.trim());
        const continuationBlock = this.extractBetween(cleanedText, 'HTML_CONTINUATION_START', 'HTML_CONTINUATION_END');
        if (continuationBlock.trim()) {
            return this.unescapeModelText(continuationBlock.trim());
        }

        const standaloneHtml = this.extractBetween(cleanedText, 'HTML_START', 'HTML_END');
        if (standaloneHtml.trim()) {
            return this.unescapeModelText(standaloneHtml.trim());
        }

        return '';
    }

    private mergeHtmlContinuation(incompleteContent: string, continuation: string): string {
        const base = incompleteContent.trimEnd();
        const extra = continuation.trim();

        if (!extra) {
            return base;
        }

        if (base.includes(extra)) {
            return base;
        }

        if (extra.includes(base) && extra.length > base.length) {
            return extra;
        }

        const maxOverlap = Math.min(base.length, extra.length, 1200);
        for (let size = maxOverlap; size >= 20; size--) {
            if (base.slice(-size) === extra.slice(0, size)) {
                return `${base}${extra.slice(size)}`;
            }
        }

        return `${base}\n${extra}`;
    }

    private extractFieldTolerantly(source: string, field: string): string {
        const fieldIndex = source.indexOf(`"${field}"`);
        if (fieldIndex === -1) {
            return '';
        }

        const colonIndex = source.indexOf(':', fieldIndex);
        if (colonIndex === -1) {
            return '';
        }

        let valueStart = colonIndex + 1;
        while (valueStart < source.length && /\s/.test(source[valueStart])) {
            valueStart++;
        }

        if (source[valueStart] !== '"') {
            return '';
        }

        valueStart += 1;

        const nextKnownField = this.findNextKnownFieldIndex(source, valueStart);
        if (nextKnownField !== -1) {
            const candidate = source.slice(valueStart, nextKnownField).trimEnd();
            return candidate.replace(/",?\s*$/, '');
        }

        const closingBraceIndex = source.lastIndexOf('}');
        if (closingBraceIndex !== -1 && closingBraceIndex > valueStart) {
            const candidate = source.slice(valueStart, closingBraceIndex).trimEnd();
            return candidate.replace(/"\s*$/, '');
        }

        return source.slice(valueStart).trim();
    }

    private findNextKnownFieldIndex(source: string, fromIndex: number): number {
        const candidates = ['"rawHtml"', '"html"', '"content"', '"title"']
            .map((token) => source.indexOf(`,${token}`, fromIndex))
            .filter((index) => index !== -1);

        return candidates.length > 0 ? Math.min(...candidates) : -1;
    }

    private extractHtmlFragment(source: string): string {
        const htmlStartTokens = ['<section', '<article', '<div', '<main'];
        const positions = htmlStartTokens
            .map((token) => source.indexOf(token))
            .filter((index) => index !== -1);

        if (positions.length === 0) {
            return '';
        }

        const start = Math.min(...positions);
        const candidate = source.slice(start).trim();
        return candidate.replace(/"\s*}\s*$/, '').trim();
    }

    private unescapeModelText(content: string): string {
        return content
            .replace(/\\n/g, '\n')
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, '\\');
    }

    private validateHtmlArticle(content: string, templateHtml: string): HtmlValidationResult {
        const normalizedContent = content.trim();
        if (!normalizedContent) {
            return { isComplete: false, reason: 'HTML 正文为空' };
        }

        if (!/<(section|article|div|main)\b/i.test(normalizedContent)) {
            return { isComplete: false, reason: '未检测到有效 HTML 结构' };
        }

        if (!/(<\/section>|<\/article>|<\/div>|<\/main>)\s*$/i.test(normalizedContent)) {
            return { isComplete: false, reason: 'HTML 结尾缺少闭合标签，疑似被截断' };
        }

        const openingSections = (normalizedContent.match(/<section\b/gi) || []).length;
        const closingSections = (normalizedContent.match(/<\/section>/gi) || []).length;
        if (openingSections > 0 && closingSections < Math.max(1, openingSections - 2)) {
            return { isComplete: false, reason: 'section 标签闭合数量明显不足，疑似被截断' };
        }

        const tailAnchors = this.extractTemplateAnchors(templateHtml);
        if (tailAnchors.length > 0) {
            const missingAnchor = tailAnchors.find((anchor) => !normalizedContent.includes(anchor));
            if (missingAnchor) {
                return { isComplete: false, reason: `缺少模板尾部锚点：${missingAnchor}` };
            }
        }

        const lastLine = normalizedContent.split('\n').filter(Boolean).pop() || normalizedContent;
        if (!/[>）】。”"'”’]$/.test(lastLine.trim())) {
            return { isComplete: false, reason: 'HTML 结尾像是半句截断' };
        }

        return { isComplete: true, reason: '' };
    }

    private extractTemplateAnchors(templateHtml: string): string[] {
        const commentAnchors = [...templateHtml.matchAll(/<!--\s*([\s\S]*?)\s*-->/g)]
            .map((match) => match[1].replace(/\s+/g, ' ').trim())
            .filter((anchor) => anchor.length >= 4);

        return commentAnchors.slice(-3);
    }

    private readTemplateNotes(parameters: unknown): string {
        if (!parameters || typeof parameters !== 'object') {
            return '';
        }

        const maybeNotes = (parameters as Record<string, unknown>).notes;
        if (typeof maybeNotes === 'string') {
            return maybeNotes;
        }

        return '';
    }

    private async generateCoverImage(params: {
        topicTitle: string;
        topicSummary: string;
        keywords: string[];
        materialInfos: MaterialInfo[];
        imageStylePrompt?: string;
        imageStyleParams?: { ratio?: string; resolution?: string };
        imageCreationEnabled: boolean;
    }): Promise<string | null> {
        const realCover = await this.imageSelector.selectImage(
            'real',
            `${params.topicTitle} ${params.topicSummary}`.trim(),
            params.materialInfos,
            undefined,
            undefined,
            { allowAiFallback: false },
        );

        if (realCover) {
            const infoMsg = `选题「${params.topicTitle}」优先复用真实素材图作为封面`;
            this.logger.log(infoMsg);
            await this.systemLogsService.record(infoMsg, 'info');
            return realCover;
        }

        if (!params.imageCreationEnabled) {
            const warnMsg = `选题「${params.topicTitle}」未配置图片模型，跳过独立封面生成`;
            this.logger.warn(warnMsg);
            await this.systemLogsService.record(warnMsg, 'warning');
            return null;
        }

        const coverPrompt = this.buildCoverImagePrompt(params.topicTitle, params.topicSummary, params.keywords);
        const infoMsg = `选题「${params.topicTitle}」开始独立生成 AI 封面图...`;
        this.logger.log(infoMsg);
        await this.systemLogsService.record(infoMsg, 'info');

        try {
            const coverImage = await this.imageSelector.generateCoverImage(
                coverPrompt,
                params.imageStylePrompt,
                params.imageStyleParams,
            );

            if (coverImage) {
                const successMsg = `选题「${params.topicTitle}」独立封面生成成功`;
                this.logger.log(successMsg);
                await this.systemLogsService.record(successMsg, 'success');
            }

            return coverImage;
        } catch (error) {
            const message = error instanceof Error ? error.message : '未知错误';
            const warnMsg = `选题「${params.topicTitle}」独立封面生成失败：${message}`;
            this.logger.warn(warnMsg);
            await this.systemLogsService.record(warnMsg, 'warning');
            return null;
        }
    }

    private buildCoverImagePrompt(topicTitle: string, topicSummary: string, keywords: string[]): string {
        const safeSummary = topicSummary.trim() || '无摘要';
        const keywordText = keywords.length > 0 ? keywords.join('、') : '无';

        return `请为下面这篇文章生成一张“微信公众号头图”，它不是正文插图，而是文章封面。

【文章标题】
${topicTitle}

【文章摘要】
${safeSummary}

【关键词】
${keywordText}

【封面要求】
1. 整体气质要像成熟公众号会用的头图，干净、克制、易读，不要花哨，不要廉价感。
2. 主视觉要明确，但不要做成信息过载的海报，也不要拼贴很多小元素。
3. 严禁任何文字、中文、英文、数字、logo、品牌名、水印、角标、二维码、按钮、界面元素、截图元素。
4. 不要做成小红书封面感、营销海报感、贴纸文案感。
5. 画面应优先贴合文章主题和读者感受，不要为了“酷炫”偏离主题。
6. 避免驴唇不对马嘴的抽象概念图，避免低质量 AI 感、夸张光效、赛博霓虹、复杂背景。`;
    }

    private async renderImages(params: {
        content: string;
        contentFormat: ArticleContentFormat;
        materialInfos: MaterialInfo[];
        imageStylePrompt?: string;
        imageStyleParams?: { ratio?: string; resolution?: string };
        imageCreationEnabled: boolean;
        topicTitle: string;
    }): Promise<{ content: string; coverImage: string | null }> {
        let renderedContent = params.content;

        const realImageRegex = /\[real-image-([^\]]+)\]/g;
        const aiImageRegex = /\[ai-image-([^\]]+)\]/g;
        const legacyImageRegex = /\[image-([^\]]+)\]/g;

        if (params.imageCreationEnabled) {
            const imageTasks: Promise<ImageTaskResult>[] = [];

            for (const match of renderedContent.matchAll(realImageRegex)) {
                const placeholder = match[0];
                const prompt = match[1];
                imageTasks.push(
                    this.imageSelector.selectImage(
                        'real',
                        prompt,
                        params.materialInfos,
                        params.imageStylePrompt,
                        params.imageStyleParams,
                        { allowAiFallback: false },
                    )
                        .then((url) => ({ placeholder, url, success: Boolean(url) }))
                        .catch((error: Error) => ({ placeholder, url: null, success: false, errorDetail: error.message }))
                );
            }

            for (const match of renderedContent.matchAll(aiImageRegex)) {
                const placeholder = match[0];
                const prompt = match[1];
                imageTasks.push(
                    this.imageSelector.selectImage('ai', prompt, params.materialInfos, params.imageStylePrompt, params.imageStyleParams)
                        .then((url) => ({ placeholder, url, success: Boolean(url) }))
                        .catch((error: Error) => ({ placeholder, url: null, success: false, errorDetail: error.message }))
                );
            }

            for (const match of renderedContent.matchAll(legacyImageRegex)) {
                const placeholder = match[0];
                const prompt = match[1];
                imageTasks.push(
                    this.imageSelector.selectImage('ai', prompt, params.materialInfos, params.imageStylePrompt, params.imageStyleParams)
                        .then((url) => ({ placeholder, url, success: Boolean(url) }))
                        .catch((error: Error) => ({ placeholder, url: null, success: false, errorDetail: error.message }))
                );
            }

            const imageMsg = `选题「${params.topicTitle}」嗅探到 ${imageTasks.length} 处图片插图，准备启动混合配图管线...`;
            this.logger.log(imageMsg);
            await this.systemLogsService.record(imageMsg, 'info');

            const imageResults = await Promise.all(imageTasks);
            for (const result of imageResults) {
                if (result.success && result.url) {
                    renderedContent = this.applyResolvedImage(renderedContent, result.placeholder, result.url, params.contentFormat);
                } else {
                    renderedContent = this.applyFailedImage(renderedContent, result.placeholder, result.errorDetail || '未知错误', params.contentFormat);
                }
            }
        } else {
            renderedContent = this.applyFailedImage(renderedContent, '[real-image-', '未配置画图模型', params.contentFormat, true);
            renderedContent = this.applyFailedImage(renderedContent, '[ai-image-', '未配置画图模型', params.contentFormat, true);
            renderedContent = this.applyFailedImage(renderedContent, '[image-', '未配置画图模型', params.contentFormat, true);
        }

        if (params.contentFormat === 'html') {
            renderedContent = this.cleanupHtml(renderedContent);
        }

        return { content: renderedContent, coverImage: null };
    }

    private applyResolvedImage(content: string, placeholder: string, url: string, contentFormat: ArticleContentFormat): string {
        if (contentFormat === 'html') {
            return content.replaceAll(placeholder, url);
        }

        return content.replaceAll(placeholder, `![](${url})`);
    }

    private applyFailedImage(
        content: string,
        placeholder: string,
        errorMessage: string,
        contentFormat: ArticleContentFormat,
        replaceByPattern = false,
    ): string {
        if (replaceByPattern) {
            const pattern = contentFormat === 'html'
                ? new RegExp(`\\[(?:real-image|ai-image|image)-[^\\]]+\\]`, 'g')
                : new RegExp(`\\[(?:real-image|ai-image|image)-([^\\]]+)\\]`, 'g');

            if (contentFormat === 'html') {
                return content.replace(pattern, '');
            }

            return content.replace(pattern, '');
        }

        if (contentFormat === 'html') {
            return content.replaceAll(placeholder, '');
        }

        return content.replaceAll(placeholder, '');
    }

    private cleanupHtml(content: string): string {
        return content
            .replace(/<img\b([^>]*?)src=(['"])\s*\2([^>]*)>/gi, '')
            .replace(/(<(?:p|div|section|article|blockquote|li|h[1-6])\b[^>]*>)\s+/gi, '$1')
            .replace(/([\u3400-\u9FFF\uF900-\uFAFF，。！？；：、“”‘’（）《》【】])\s+(<(?:span|strong|em|b|i|a)\b[^>]*>)/g, '$1$2')
            .replace(/(<\/(?:span|strong|em|b|i|a)>)\s+([\u3400-\u9FFF\uF900-\uFAFF，。！？；：、“”‘’（）《》【】])/g, '$1$2')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }
}
