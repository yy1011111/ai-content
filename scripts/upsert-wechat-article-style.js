const { PrismaClient } = require('../backend/node_modules/@prisma/client');

const prisma = new PrismaClient();

const styles = [
  {
    name: '公众号热点评论·真人感',
    type: 'article',
    isDefault: true,
    description: '强调作者感、判断力和真实语气的公众号文章默认风格，适合热点解读、观点评论和情绪观察。',
    promptTemplate: `你是一名擅长写微信公众号文章的中文作者。

请始终记住这些要求：
1. 文章要像成熟账号发出的正式成稿，而不是提纲、汇报稿、新闻拼盘或营销软文。
2. 开头先给情境、冲突、问题或最扎人的细节，不要空泛铺垫。
3. 正文要有信息、有观察、有判断，不能只复述素材。
4. 语气自然，像真人在说话；允许锋利，但不要故作高深。
5. 段落要短，适合手机阅读，每段尽量 1 到 3 句。
6. 少说正确的废话，多写真正让读者记得住、愿意转发的判断。
7. 不要写“值得深思的是”“某种程度上”等模板腔，不要刻意装专家。

目标是写出一篇有可读性、有作者存在感、适合公众号发布的中文文章。`,
  },
  {
    name: '小红书热点笔记·强钩子',
    type: 'xiaohongshu',
    isDefault: true,
    description: '适合小红书图文笔记的默认写法，强调开头抓人、结论前置和强共鸣表达。',
    promptTemplate: `你是一名懂小红书平台语感的内容策划。

请始终记住这些要求：
1. 结论前置，少讲废话，开头要能抓人。
2. 像真人分享，而不是像老师讲课。
3. 语言口语化、可转述、有共鸣，不装、不虚、不端着。
4. 每一页或每一段只讲一个重点，不要信息过载。
5. 能让人想收藏、评论、继续往下看。

目标是写出适合小红书传播的图文笔记内容。`,
  },
  {
    name: '小红书配图封面·明亮高级感',
    type: 'image',
    isDefault: true,
    description: '适合公众号头图和小红书封面的图片默认风格，强调干净、克制、适合叠字。',
    promptTemplate: `请生成适合中文内容平台传播的封面或配图。

视觉要求：
1. 画面干净、明亮、克制，不要廉价感，不要杂乱背景。
2. 主视觉明确，保留适合叠加中文标题的留白区域。
3. 气质要接近成熟公众号头图或小红书封面，不要赛博霓虹，不要过度特效。
4. 如果是正文配图，必须和主题强相关；如果不够相关，宁可不要。
5. 尽量避免抽象到看不懂的概念图。`,
    parameters: {
      ratio: '3:4',
    },
  },
  {
    name: '公众号成稿模板·清晰分段',
    type: 'template',
    isDefault: true,
    description: '适合公众号长文的默认 HTML 模板，强调短段落、小标题和适度留白。',
    promptTemplate: `<article class="wechat-article">
  <section class="wechat-intro">
    <p class="wechat-lead">这里写开篇引子。第一段要直接进入情境、冲突或问题，不要空泛铺垫。</p>
  </section>

  <section class="wechat-section">
    <h2>先把事情说透</h2>
    <p>这里写第一部分正文。用两到三段把事件、现象或问题讲清楚，每段尽量短一点。</p>
    <p>这里继续补充关键事实、用户感受或作者观察，避免套话。</p>
  </section>

  <section class="wechat-section">
    <h2>真正值得聊的是</h2>
    <p>这里写第二部分正文。给出判断、拆解原因，或者指出最容易被忽略的地方。</p>
    <blockquote>这里放一句最值得被记住的话，适合作为金句或观点提炼。</blockquote>
  </section>

  <figure class="wechat-figure">
    <img src="[real-image-与正文强相关的真实配图描述]" alt="配图说明" />
    <figcaption>如果图片不够贴切，可以整段删除，不要为了凑图保留无关图片。</figcaption>
  </figure>

  <section class="wechat-section">
    <h2>给读者一个带走的结论</h2>
    <p>这里写最后一部分正文。总结最核心的结论、提醒或态度，不要草草收尾。</p>
    <ul>
      <li>可以保留 2 到 3 条真正有用的要点</li>
      <li>也可以删掉列表，改成更自然的收束段落</li>
    </ul>
  </section>
</article>`,
    parameters: {
      notes: '可以根据内容删除不必要的 figure 或列表，但要保留短段落和小标题结构。',
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
    orderBy: [
      { type: 'asc' },
      { createdAt: 'asc' },
    ],
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
