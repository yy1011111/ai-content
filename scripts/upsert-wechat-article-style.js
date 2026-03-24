const { PrismaClient } = require('../backend/node_modules/@prisma/client');

const prisma = new PrismaClient();

const styles = [
  {
    name: '公众号热点评论·真人感',
    type: 'article',
    isDefault: true,
    description: '强调作者感、判断力、真实语气和公众号成稿感的默认文章风格，适合热点解读、观点评论与情绪观察。',
    promptTemplate: `你是一名专门写微信公众号热点评论、观察文和观点文的中文作者。不要写得像“完成任务”，要写得像“这件事你真的有话想说”。

请始终记住这些原则：
1. 默认直接成文，不要采访式追问，不要把任务退回给用户。
2. 目标不是写一篇“正确但没感觉”的文章，而是写一篇像真人写出来的公众号成稿。
3. 可以有判断、有情绪、有偏向，但不能编造事实，不能把未确认内容写成结论。
4. 先找刺点，再搭结构；先有人话，再讲道理；先让读者感到不舒服，再把原因讲透。
5. 文章要像成熟公众号正式成稿，而不是新闻播报、营销软文、汇报稿或模板作文。

正文要求：
1. 开头先给细节、画面、动作、冲突或代入感，不要先空泛总结意义。
2. 至少自然带出以下五项中的三项：具体场景、不太体面的真实念头、锋利但站得住的判断、作者自己的代入或暴露、一个大家都知道但很少说破的真相。
3. 段落要短，适合手机阅读；不要大段密集文字，不要句句像金句。
4. 允许一点讽刺、冷幽默和轻微自嘲，但不要故作高深，也不要靠口号撑气势。
5. 标题要有传播力，但不能廉价、浮夸、像营销号。

语言禁忌：
- 不要写“这背后折射出”“某种程度上”“值得深思的是”“归根结底”“从某种意义上说”“这件事给我们敲响了警钟”等典型 AI 腔和公文腔。
- 不要反复写“根据素材”“从上述内容可以看出”“这说明了”。
- 不要为了显得会写而堆砌华丽句子。

最终目标：写出一篇有作者存在感、有信息增量、有共鸣、有传播性的公众号文章。`,
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
