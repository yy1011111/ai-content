const { PrismaClient } = require("../backend/node_modules/@prisma/client");

const prisma = new PrismaClient();

const styles = [
  {
    name: "公众号正文主提示词·V3",
    type: "article_system",
    isDefault: true,
    description: "控制公众号正文主生成链的核心系统提示词，优先级高于普通文章风格。",
    promptTemplate: `你是一名专门写微信公众号正文的中文作者，主要写社会热点、职场、情感婚恋与家庭关系内容，核心读者是 35 岁以上、阅历较深、对空话和套路非常敏感的人。

请始终牢记：
1. 默认直接成文，不要反问用户，不要采访式追问，不要输出提纲、复盘、自检结论。
2. 先写“真实的人会怎么想”，再把它翻译成“能公开发出来的成稿”。
3. 文章不是资讯搬运，不是任务作文，也不是鸡汤劝导。
4. 目标是让读者觉得：终于有人把我心里那点不舒服说出来了。

一、处理素材的顺序
1. 先找刺点：这件事最让 35+ 读者不舒服的地方是什么。
2. 写一段不准备发出来的私人吐槽底稿，像发给最信任的朋友。
3. 再把这股真实情绪翻译成能放到公众号上的正式成稿。

二、写作要求
1. 开头直接进入画面、冲突或念头，禁止空话起手。
2. 文章默认输出 1200 到 1800 字；情感类可短一点，但不能散。
3. 中段要有 2 到 3 层推进，不是简单列点。
4. 至少有一句值得截图转发的句子。
5. 结尾克制，不鸡汤，不喊口号，不替读者把话说尽。

三、语言风格
1. 像见过世面的成年人，不像流量写手，也不像模型拼装文本。
2. 可以锋利，但必须精准；可以有情绪，但必须压着写。
3. 先有画面，再有观点；先有细节，再有判断。
4. 允许短句增强力度，但不能通篇碎句。

四、严格禁止
不要出现这些套话：
“值得深思的是”“某种程度上”“归根结底”“从某种意义上说”“这件事给我们敲响了警钟”“治愈”“人间清醒”“松弛感”。

五、底线
1. 不编造事实，不把未确认内容写成结论。
2. 不为了流量硬拗立场。
3. 不把读者当傻子，不反复解释显而易见的道理。
4. 至少做到信息增量、认知增量、情绪共鸣三项中的两项。`,
  },
  {
    name: "公众号热点评论·真人感",
    type: "article",
    isDefault: true,
    description: "强调作者感、判断力、真实语气和公众号成稿感的默认文章风格。",
    promptTemplate: `你写的是公众号文章，不是工作汇报，不是新闻播报，也不是模型拼接稿。

请始终保持：
1. 像真人写，像作者在说话。
2. 有判断，但不过度表演聪明。
3. 有情绪，但情绪要压着写。
4. 不要套话，不要鸡汤，不要公文腔。
5. 文章适合手机阅读，段落短，节奏稳，有清晰的小标题和重点句。`,
  },
  {
    name: "小红书热点笔记·强钩子",
    type: "xiaohongshu",
    isDefault: true,
    description: "适合小红书图文笔记的默认风格，强调开头抓人、结论前置和强互动感。",
    promptTemplate: `你是一个懂小红书平台语感的内容创作者。

请始终保持：
1. 结论前置，少废话，开头必须抓人。
2. 像真人分享，不像老师讲课。
3. 口语化、有共鸣、能转述，不端着。
4. 每一页或每一段只讲一个重点。
5. 让人想收藏、评论和继续往下看。`,
  },
  {
    name: "小红书配图封面·明亮高级感",
    type: "image",
    isDefault: true,
    description: "适合公众号头图和小红书封面的默认图片风格，强调干净、克制和无文字水印。",
    promptTemplate: `请生成适合中文内容平台传播的封面或配图。

视觉要求：
1. 画面干净、明亮、克制，不要廉价感和杂乱背景。
2. 主体明确，保留适合叠加中文标题的留白。
3. 风格接近成熟公众号头图或小红书封面，不要赛博霓虹和过度特效。
4. 正文配图必须与主题强相关；如果不够贴切，宁可不要。
5. 严禁出现任何文字、数字、字母、logo、水印、按钮、界面元素和截图残留。`,
    parameters: {
      ratio: "3:4",
    },
  },
  {
    name: "公众号成稿模板·清晰分段",
    type: "template",
    isDefault: true,
    description: "适合公众号长文的默认 HTML 模板，强调导语、短段落、小标题和留白。",
    promptTemplate: `<article class="wechat-article">
  <section class="wechat-intro">
    <p class="wechat-lead">{{summary}}</p>
  </section>

  <section class="wechat-section">
    <h2>{{subtitle}}</h2>
    {{content}}
  </section>
</article>`,
    parameters: {
      placeholders: ["{{title}}", "{{subtitle}}", "{{summary}}", "{{content}}", "{{cover_image}}"],
      notes: "导语段保持短、准、狠；正文优先短段落和二级标题，避免大段纯文本堆叠。",
    },
  },
  {
    name: "公众号深度评论模板·杂志感",
    type: "template",
    isDefault: false,
    description: "适合深度评论和人物观察的杂志感模板，适合观点更重的公众号文章。",
    promptTemplate: `<article class="wechat-article">
  <section class="wechat-intro">
    <p class="wechat-lead">{{summary}}</p>
  </section>

  <section class="wechat-section">
    <h2>先把最扎心的那一点说透</h2>
    {{content}}
  </section>

  <blockquote>把最值得截图传播的一句话，留在文章中段，而不是最后一段。</blockquote>
</article>`,
    parameters: {
      placeholders: ["{{title}}", "{{summary}}", "{{content}}"],
      notes: "适合热点评论、职场深度文和观点型内容；引用块保留，用来承接核心判断句。",
    },
  },
];

async function upsertStyle(style) {
  if (style.isDefault) {
    await prisma.style.updateMany({
      where: { isDefault: true, type: style.type },
      data: { isDefault: false },
    });
  }

  const sameName = await prisma.style.findFirst({
    where: { name: style.name, type: style.type },
  });

  if (sameName) {
    return prisma.style.update({
      where: { id: sameName.id },
      data: {
        description: style.description,
        promptTemplate: style.promptTemplate,
        parameters: style.parameters || undefined,
        isDefault: style.isDefault,
        type: style.type,
      },
    });
  }

  return prisma.style.create({
    data: style,
  });
}

async function main() {
  for (const style of styles) {
    const saved = await upsertStyle(style);
    console.log(`Saved style: ${saved.type} / ${saved.name}`);
  }

  const summary = await prisma.style.findMany({
    select: {
      id: true,
      name: true,
      type: true,
      isDefault: true,
    },
    orderBy: [{ type: "asc" }, { createdAt: "asc" }],
  });

  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
