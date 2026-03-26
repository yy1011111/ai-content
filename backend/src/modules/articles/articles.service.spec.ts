import { ArticlesService } from './articles.service';
import { WechatCompiler } from '../publishing/wechat-publisher/wechat-compiler';

describe('ArticlesService', () => {
  const createService = (options?: {
    generateImpl?: jest.Mock;
    selectImageImpl?: jest.Mock;
    generateCoverImageImpl?: jest.Mock;
    uploadBufferImpl?: jest.Mock;
    prisma?: Record<string, any>;
    defaultModels?: Record<string, any>;
    materialsService?: Record<string, any>;
  }) => {
    const generateImpl = options?.generateImpl ?? jest.fn();
    const selectImageImpl = options?.selectImageImpl ?? jest.fn();
    const generateCoverImageImpl = options?.generateCoverImageImpl ?? jest.fn();
    const uploadBufferImpl = options?.uploadBufferImpl ?? jest.fn().mockResolvedValue(null);
    const prisma = options?.prisma ?? {};
    const aiClient = { generate: generateImpl };
    const defaultModels = options?.defaultModels ?? {};
    const systemLogsService = { record: jest.fn().mockResolvedValue(undefined) };
    const imageSelector = {
      selectImage: selectImageImpl,
      generateCoverImage: generateCoverImageImpl,
    };
    const materialsService = options?.materialsService ?? {};
    const qiniuService = {
      uploadBuffer: uploadBufferImpl,
    };
    const service = new ArticlesService(
      prisma as any,
      aiClient as any,
      defaultModels as any,
      systemLogsService as any,
      imageSelector as any,
      materialsService as any,
      qiniuService as any,
    );

    return { service, prisma, aiClient, defaultModels, systemLogsService, imageSelector, materialsService, qiniuService };
  };

  it('在 HTML 首次截断时会复用同一轮上下文续写补全', async () => {
    const generate = jest
      .fn()
      .mockResolvedValueOnce(`TITLE_START
OpenClaw 龙虾爆火
TITLE_END
HTML_START
<section><h1>OpenClaw 龙虾爆火</h1><p>它已经不只是玩具，而是进入真实业务流程的
HTML_END`)
      .mockResolvedValueOnce(`HTML_CONTINUATION_START
信用卡风控排查场景。</p></section>
HTML_CONTINUATION_END`);

    const { service, aiClient } = createService({ generateImpl: generate });

    const result = await (service as any).generateArticlePayload({
      modelId: 'model-1',
      systemPrompt: 'system',
      userPrompt: 'user',
      fallbackTitle: 'fallback',
      contentFormat: 'html',
      templateHtml: '<section><h1>模板</h1><p>正文</p></section>',
    });

    expect(result.title).toBe('OpenClaw 龙虾爆火');
    expect(result.content).toContain('它已经不只是玩具');
    expect(result.content).toContain('信用卡风控排查场景');
    expect(result.content.trim().endsWith('</section>')).toBe(true);
    expect(aiClient.generate).toHaveBeenCalledTimes(2);
    expect(aiClient.generate.mock.calls[1][1][2]).toEqual({
      role: 'assistant',
      content: expect.stringContaining('HTML_START'),
    });
  });

  it('续写补全失败后会回退到下一轮整篇重生成', async () => {
    const generate = jest
      .fn()
      .mockResolvedValueOnce(`TITLE_START
OpenClaw 龙虾爆火
TITLE_END
HTML_START
<section><h1>OpenClaw 龙虾爆火</h1><p>第一段还没写完
HTML_END`)
      .mockResolvedValueOnce(`HTML_CONTINUATION_START
但这里依然没有闭合
HTML_CONTINUATION_END`)
      .mockResolvedValueOnce(`TITLE_START
OpenClaw 龙虾爆火
TITLE_END
HTML_START
<section><h1>OpenClaw 龙虾爆火</h1><p>第一段已经完整。</p></section>
HTML_END`);

    const { service, aiClient } = createService({ generateImpl: generate });

    const result = await (service as any).generateArticlePayload({
      modelId: 'model-1',
      systemPrompt: 'system',
      userPrompt: 'user',
      fallbackTitle: 'fallback',
      contentFormat: 'html',
      templateHtml: '<section><h1>模板</h1><p>正文</p></section>',
    });

    expect(result.content).toBe('<section><h1>OpenClaw 龙虾爆火</h1><p>第一段已经完整。</p></section>');
    expect(aiClient.generate).toHaveBeenCalledTimes(3);
    expect(aiClient.generate.mock.calls[2][1]).toEqual([
      { role: 'system', content: 'system' },
      { role: 'user', content: 'user\n\n【重试要求】：HTML 结尾缺少闭合标签，疑似被截断\n请重新完整输出整篇文章。' },
    ]);
  });

  it('公众号正文主链会收敛成初稿加一次统稿', async () => {
    const generate = jest
      .fn()
      .mockResolvedValueOnce(JSON.stringify({
        title: '初稿标题',
        content: '第一段先把事情讲出来。\n\n第二段继续往下讲。',
      }))
      .mockResolvedValueOnce(JSON.stringify({
        title: '定稿标题',
        content: '第一段先把事情讲出来。\n\n第二段接着往下走，不再像答题。',
      }));

    const { service, aiClient } = createService({ generateImpl: generate });
    const renderImages = jest
      .spyOn(service as any, 'renderImages')
      .mockResolvedValue({ content: '第一段先把事情讲出来。\n\n第二段接着往下走，不再像答题。', coverImage: null });
    const compileSpy = jest
      .spyOn(WechatCompiler, 'compile')
      .mockResolvedValue('<p>编译后的正文</p>');

    const result = await (service as any).generateWechatArticlePayload({
      modelId: 'model-1',
      topicTitle: '旧手机回收',
      topicSummary: '回收价格低，但真正卡住人的不是钱。',
      keywords: ['旧手机', '回收'],
      materialContents: '素材一：报价很低。\n\n素材二：真正让人犹豫的是数据和记忆。',
      stylePrompt: '像真人在说话。',
      articleSystemPrompt: '先找爆点，再写成完整成稿。',
      materialInfos: [],
      imageStylePrompt: undefined,
      imageStyleParams: undefined,
      imageCreationEnabled: false,
    });

    expect(aiClient.generate).toHaveBeenCalledTimes(2);
    expect(aiClient.generate.mock.calls[1][1][1].content).toContain('最后一遍统稿重写');
    expect(aiClient.generate.mock.calls[1][1][1].content).toContain('当前初稿');
    expect(renderImages).toHaveBeenCalledTimes(1);
    expect(compileSpy).toHaveBeenCalledWith('第一段先把事情讲出来。\n\n第二段接着往下走，不再像答题。');
    expect(result.title).toBe('定稿标题');
    expect(result.content).toBe('<p>编译后的正文</p>');

    renderImages.mockRestore();
    compileSpy.mockRestore();
  });

  it('正文配图成功后不再把首图写入封面字段', async () => {
    const selectImage = jest.fn().mockResolvedValue('https://cdn.example.com/body-image.png');
    const { service } = createService({ selectImageImpl: selectImage });

    const result = await (service as any).renderImages({
      content: '<section><img src="[ai-image-龙虾机器人]" /></section>',
      contentFormat: 'html',
      materialInfos: [],
      imageStylePrompt: '风格提示',
      imageStyleParams: undefined,
      imageCreationEnabled: true,
      topicTitle: 'OpenClaw 龙虾爆火',
    });

    expect(result.content).toContain('https://cdn.example.com/body-image.png');
    expect(result.coverImage).toBeNull();
  });

  it('会使用独立封面提示词调用 AI 生成封面', async () => {
    const generateCoverImage = jest.fn().mockResolvedValue('https://cdn.example.com/cover-image.png');
    const { service, imageSelector } = createService({ generateCoverImageImpl: generateCoverImage });

    const result = await (service as any).generateCoverImage({
      topicTitle: 'OpenClaw 龙虾爆火',
      topicSummary: '有人用它排查信用卡盗刷，AI 私人助理感开始落地。',
      keywords: ['OpenClaw', '信用卡盗刷', 'AI 助手'],
      imageStylePrompt: '电影感、纪实质感',
      imageStyleParams: { ratio: '16:9' },
      imageCreationEnabled: true,
    });

    expect(result).toBe('https://cdn.example.com/cover-image.png');
    expect(imageSelector.generateCoverImage).toHaveBeenCalledWith(
      expect.stringContaining('这不是正文插图'),
      '电影感、纪实质感',
      { ratio: '16:9' },
    );
    expect(imageSelector.generateCoverImage.mock.calls[0][0]).toContain('封面图');
    expect(imageSelector.generateCoverImage.mock.calls[0][0]).toContain('不要做成正文配图拼贴');
  });

  it('会在有真实素材图时优先复用真实图做封面', async () => {
    const selectImage = jest.fn().mockResolvedValue('https://cdn.example.com/real-cover.png');
    const generateCoverImage = jest.fn();
    const { service, imageSelector } = createService({
      selectImageImpl: selectImage,
      generateCoverImageImpl: generateCoverImage,
    });

    const result = await (service as any).generateCoverImage({
      topicTitle: '旧手机回收',
      topicSummary: '抽屉里那台旧手机，到底该怎么处理',
      keywords: ['旧手机', '回收'],
      materialInfos: [
        {
          id: 'm-1',
          title: '旧手机回收',
          content: '这里有一张真实图片',
          imageUrl: 'https://cdn.example.com/real-cover.png',
          originalImageUrl: null,
          hasImage: true,
        },
      ],
      imageStylePrompt: '纪实摄影',
      imageStyleParams: { ratio: '16:9' },
      imageCreationEnabled: true,
    });

    expect(result).toBe('https://cdn.example.com/real-cover.png');
    expect(imageSelector.selectImage).toHaveBeenCalled();
    expect(imageSelector.generateCoverImage).not.toHaveBeenCalled();
  });

  it('会清理公众号 markdown 初稿中的重复段落和 AI 占位符', () => {
    const { service } = createService();

    const cleaned = (service as any).prepareWechatDraftMarkdown(`第一段：抽屉里的旧手机，像一块你不敢碰的记忆硬盘。

[ai-image-旧手机回收海报]

第二段：你明明知道该处理掉它，但每次拿起来又会犹豫。

第二段：你明明知道该处理掉它，但每次拿起来又会犹豫。

[real-image-旧手机抽屉特写]`);

    expect(cleaned).toContain('第一段：抽屉里的旧手机');
    expect(cleaned).toContain('第二段：你明明知道该处理掉它');
    expect(cleaned).not.toContain('[ai-image-');
    expect(cleaned).not.toContain('[real-image-');
    expect(cleaned.match(/第二段：你明明知道该处理掉它/g)).toHaveLength(1);
  });

  it('会在公众号定稿阶段只保留第一张真实配图占位符', () => {
    const { service } = createService();

    const cleaned = (service as any).finalizeWechatMarkdown(`第一段内容。

[real-image-旧手机抽屉特写]

第二段内容。

[ai-image-带文字的封面]

[real-image-回收柜台]`);

    expect(cleaned).toContain('[real-image-旧手机抽屉特写]');
    expect(cleaned).not.toContain('[ai-image-带文字的封面]');
    expect(cleaned).not.toContain('[real-image-回收柜台]');
  });

  it('会在公众号定稿阶段砍掉整篇重复一次的正文', () => {
    const { service } = createService();

    const paragraphOne = '抽屉里的旧手机，很多时候不是忘了卖，而是不敢碰。';
    const paragraphTwo = '你以为自己舍不得的是价格，后来才发现舍不得的是里面那堆没整理完的生活。';
    const paragraphThree = '真正让人犹豫的，从来不是三十块钱，而是你根本不确定那些数据会流到哪去。';

    const cleaned = (service as any).finalizeWechatMarkdown(`${paragraphOne}

${paragraphTwo}

${paragraphThree}

${paragraphOne}

${paragraphTwo}

${paragraphThree}`);

    expect(cleaned.match(/抽屉里的旧手机/g)).toHaveLength(1);
    expect(cleaned.match(/你以为自己舍不得的是价格/g)).toHaveLength(1);
    expect(cleaned.match(/真正让人犹豫的/g)).toHaveLength(1);
  });

  it('会清理中文段落首部空白和内联特效前后的误空格', () => {
    const { service } = createService();

    const cleaned = (service as any).cleanupHtml(`<p style="margin-bottom: 24px; font-size: 14px; line-height: 1.9; text-align: justify; color: #374151;">
      你仔细看看这个 ai-hedge-fund 到底干了啥。
      <span style="background: linear-gradient(120deg, rgba(167,139,250,0.2) 0%, transparent 100%); padding: 1px 5px; border-radius: 3px; font-weight: 700; color: #4C1D95;">它就像你免费雇了10个清华北大的实习生。</span>
    </p>`);

    expect(cleaned.startsWith('<p style="margin-bottom: 24px; font-size: 14px; line-height: 1.9; text-align: justify; color: #374151;">你仔细看看这个 ai-hedge-fund 到底干了啥。')).toBe(true);
    expect(cleaned).toContain('干了啥。<span');
    expect(cleaned).not.toContain('干了啥。\n      <span');
  });

  it('会为小红书笔记生成独立的 platform prompt', () => {
    const { service } = createService();

    const prompt = (service as any).buildSystemPrompt(
      'xiaohongshu',
      '真实口语感，先给结论再展开',
      'markdown',
      '',
      '',
    );

    expect(prompt).toContain('小红书内容策划与爆款笔记写手');
    expect(prompt).toContain('文字排版优先、图片辅助');
    expect(prompt).toContain('默认适配 3:4 竖版成品卡图');
    expect(prompt).toContain('cover-poster');
    expect(prompt).toContain('"slides"');
  });

  it('会解析新版小红书模板化卡片 payload', () => {
    const { service } = createService();

    const result = (service as any).parseXiaohongshuPayload(
      JSON.stringify({
        title: 'AI 创业者一定要试试这套工作流',
        caption: '我最近把选题、配图、发布拆成了三段式，效率真的高很多。',
        hashtags: ['AI创业', '#内容运营'],
        slides: [
          { role: 'cover', template: 'cover-poster', title: '别再一口气写长文', body: '先把卡片主题列出来，转成固定模板更稳', bullets: [], highlight: '适合内容团队', imagePrompt: '办公室里规划卡片分镜', imageType: 'ai' },
          { role: 'hook', template: 'insight-card', title: '封面先打利益点', body: '让读者一眼知道能得到什么，点击率才会起来', bullets: [], highlight: '先结果后解释', imagePrompt: '', imageType: 'none' },
          { role: 'problem', template: 'bullet-list', title: '每张图只讲一个点', body: '不要一页塞满三层信息', bullets: ['一个页面只讲一个动作', '标题替你做筛选', '配色固定降低犹豫'], highlight: '信息密度刚刚好', imagePrompt: '', imageType: 'none' },
          { role: 'method', template: 'checklist-card', title: '固定模板最省心', body: '照着模板填字就能出稿', bullets: ['封面写利益点', '中间页拆要点', '结尾页给行动'], highlight: '流程可复用', imagePrompt: '', imageType: 'none' },
          { role: 'summary', template: 'summary-card', title: '最后再补一句结论', body: '小红书不是拼命堆图，而是让文字更容易被读完', bullets: [], highlight: '文字才是核心', imagePrompt: '', imageType: 'none' },
        ],
      }),
      'fallback',
    );

    expect(result.title).toBe('AI 创业者一定要试试这套工作流');
    expect(result.hashtags).toEqual(['AI创业', '#内容运营']);
    expect(result.slides).toHaveLength(5);
    expect(result.slides[0].template).toBe('cover-poster');
    expect(result.slides[2].bullets).toHaveLength(3);
    expect(result.slides[1].imageType).toBe('none');
  });

  it('会兼容旧版小红书卡片结构并补齐模板字段', () => {
    const { service } = createService();

    const result = (service as any).parseXiaohongshuPayload(
      JSON.stringify({
        title: '旧版兼容测试',
        caption: '沿用 coverText/bodyText 也能正常转成新版结构。',
        hashtags: ['兼容', '#升级'],
        slides: [
          { coverText: '封面先说结果', bodyText: '旧数据也会被强制映射到封面模板', imagePrompt: '极简封面背景', imageType: 'ai' },
          { coverText: '第二页讲问题', bodyText: '不用重跑历史数据', imagePrompt: '', imageType: 'none' },
          { coverText: '第三页拆重点', bodyText: '重点继续可以显示', imagePrompt: '', imageType: 'none' },
          { coverText: '第四页给方法', bodyText: '照着模板继续展示', imagePrompt: '', imageType: 'none' },
          { coverText: '最后一页总结', bodyText: '历史数据也能继续被下载', imagePrompt: '', imageType: 'none' },
        ],
      }),
      'fallback',
    );

    expect(result.slides[0].role).toBe('cover');
    expect(result.slides[0].template).toBe('cover-poster');
    expect(result.slides[1].title).toBe('第二页讲问题');
  });

  it('会生成可直接预览的小红书 PNG 成品卡图 data url', async () => {
    const generate = jest.fn().mockResolvedValue(
      JSON.stringify({
        title: '模板化小红书更稳',
        caption: '先定模板，再填文字，小红书风格会稳定很多。',
        hashtags: ['模板化', '#小红书'],
        slides: [
          { role: 'cover', template: 'cover-poster', title: '模板先定死', body: '封面做成大字报，其他页就不会跑偏', bullets: [], highlight: '稳定出风格', imagePrompt: '柔和办公桌面背景', imageType: 'ai' },
          { role: 'hook', template: 'insight-card', title: '别交给图片模型决定排版', body: '排版交给系统，图片只负责气氛和辅助', bullets: [], highlight: '文字优先', imagePrompt: '', imageType: 'none' },
          { role: 'problem', template: 'bullet-list', title: '为什么以前容易飘', body: '因为每页都在临场发挥', bullets: ['标题样式不固定', '图和字互相抢戏', '重点层级不稳定'], highlight: '核心是失控', imagePrompt: '', imageType: 'none' },
          { role: 'method', template: 'checklist-card', title: '新方案怎么做', body: '先脚本再成图', bullets: ['先出页面角色', '再选固定模板', '最后生成成品卡图'], highlight: '流程清晰', imagePrompt: '', imageType: 'none' },
          { role: 'summary', template: 'summary-card', title: '效果会更像真人账号', body: '读者会先看字，再看图，信息吸收更顺畅', bullets: [], highlight: '更像真实运营产物', imagePrompt: '', imageType: 'none' },
        ],
      }),
    );
    const { service } = createService({ generateImpl: generate });

    const result = await (service as any).generateXiaohongshuNote({
      modelId: 'model-1',
      stylePrompt: '真实口语感',
      topicTitle: '模板化小红书',
      topicSummary: '测试',
      keywords: ['模板', '小红书'],
      materialContents: '素材内容',
      materialInfos: [],
      imageStylePrompt: '柔和明亮',
      imageStyleParams: { ratio: '3:4' },
      imageCreationEnabled: false,
    });

    expect(result.slides).toHaveLength(5);
    expect(result.slides[0].cardImageUrl.startsWith('data:image/png;base64')).toBe(true);
    expect(result.slides[0].coverText).toBe('模板先定死');
    expect(result.slides[2].bullets[0]).toBe('标题样式不固定');
  });

  it('七牛上传成功时会优先使用上传后的 PNG URL', async () => {
    const generate = jest.fn().mockResolvedValue(
      JSON.stringify({
        title: '上传版小红书',
        caption: '测试上传后的卡图地址是否被使用。',
        hashtags: ['上传', '#PNG'],
        slides: [
          { role: 'cover', template: 'cover-poster', title: '先上传再返回', body: '这样前端拿到的就是稳定地址', bullets: [], highlight: 'PNG URL', imagePrompt: '', imageType: 'none' },
          { role: 'hook', template: 'insight-card', title: '第二页', body: '继续用模板渲染', bullets: [], highlight: '', imagePrompt: '', imageType: 'none' },
          { role: 'problem', template: 'bullet-list', title: '第三页', body: '拆成要点', bullets: ['第一点', '第二点', '第三点'], highlight: '', imagePrompt: '', imageType: 'none' },
          { role: 'method', template: 'checklist-card', title: '第四页', body: '按清单排版', bullets: ['动作一', '动作二', '动作三'], highlight: '', imagePrompt: '', imageType: 'none' },
          { role: 'summary', template: 'summary-card', title: '第五页', body: '结束总结', bullets: [], highlight: '收尾', imagePrompt: '', imageType: 'none' },
        ],
      }),
    );
    const uploadBuffer = jest.fn().mockResolvedValue('https://cdn.example.com/xhs-card-01.png');
    const { service, qiniuService } = createService({ generateImpl: generate, uploadBufferImpl: uploadBuffer });

    const result = await (service as any).generateXiaohongshuNote({
      modelId: 'model-1',
      stylePrompt: '真实口语感',
      topicTitle: '上传版小红书',
      topicSummary: '测试',
      keywords: ['上传'],
      materialContents: '素材内容',
      materialInfos: [],
      imageStylePrompt: '',
      imageStyleParams: { ratio: '3:4' },
      imageCreationEnabled: false,
    });

    expect(qiniuService.uploadBuffer).toHaveBeenCalled();
    expect(result.slides[0].cardImageUrl).toBe('https://cdn.example.com/xhs-card-01.png');
  });

  it('批量生成草稿时会按指定内容类型调用生成流程', async () => {
    const prisma = {
      topic: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'topic-1', title: '第一条', aiScore: 92 },
          { id: 'topic-2', title: '第二条', aiScore: 88 },
        ]),
      },
    };
    const { service } = createService({ prisma });
    const generateFromTopic = jest
      .spyOn(service, 'generateFromTopic')
      .mockResolvedValue({ id: 'article-1' } as any);

    const result = await service.batchGenerateDrafts(2, 85, 'xiaohongshu');

    expect(prisma.topic.findMany).toHaveBeenCalledWith({
      where: {
        status: 'completed',
        isPublished: false,
        aiScore: { gte: 85 },
      },
      orderBy: {
        aiScore: 'desc',
      },
      take: 2,
    });
    expect(generateFromTopic).toHaveBeenNthCalledWith(1, 'topic-1', false, 'xiaohongshu');
    expect(generateFromTopic).toHaveBeenNthCalledWith(2, 'topic-2', false, 'xiaohongshu');
    expect(result.successCount).toBe(2);
    expect(result.generatedArticleIds).toEqual(['article-1', 'article-1']);
  });
  it('runs a final polish pass for wechat markdown payloads', async () => {
    const generate = jest.fn().mockResolvedValue(
      JSON.stringify({
        title: '更顺的版本',
        content: '第一段更自然。\n\n第二段接着往下讲。',
      }),
    );
    const { service, aiClient } = createService({ generateImpl: generate });

    const result = await (service as any).polishWechatArticlePayload({
      modelId: 'model-1',
      topicTitle: '旧手机回收',
      rewrittenTitle: '旧标题',
      rewrittenContent: '第一段。\n\n第二段。',
    });

    expect(result.title).toBe('更顺的版本');
    expect(result.content).toContain('第一段更自然');
    expect(aiClient.generate).toHaveBeenCalledTimes(1);
    expect(aiClient.generate.mock.calls[0][1][0].content).toContain('最后一遍“整篇统稿”');
  });

  it('falls back to rewritten payload when the final polish pass fails', async () => {
    const generate = jest.fn().mockRejectedValue(new Error('network'));
    const { service } = createService({ generateImpl: generate });

    const result = await (service as any).polishWechatArticlePayload({
      modelId: 'model-1',
      topicTitle: '旧手机回收',
      rewrittenTitle: '旧标题',
      rewrittenContent: '第一段。\n\n第二段。',
    });

    expect(result).toEqual({
      title: '旧标题',
      content: '第一段。\n\n第二段。',
      contentFormat: 'markdown',
    });
  });
});
