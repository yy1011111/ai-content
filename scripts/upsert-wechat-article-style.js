const { PrismaClient } = require("../backend/node_modules/@prisma/client");

const prisma = new PrismaClient();

const articleSystemPrompt = [
  "# 公众号爆款正文写作提示词（咪蒙风格）",
  "",
  "## 第一步：先读资料，找爆点",
  "",
  "拿到资料后，不要急着写。先做三件事：",
  "1. 提炼核心矛盾：这件事让人愤怒、共鸣、崩溃的根本原因是什么？一句话说清楚。",
  "2. 找最强的细节：哪个场景、哪句对话、哪个数字最让人想骂人？这就是开场素材。",
  "3. 确定读者立场：读者看完这篇文章，应该觉得“说出了我的心声”还是“我也被坑过”？",
  "",
  "写作原则：你不是在复述资料，你是在替读者说出他们憋在心里的话。",
  "",
  "## 第二步：标题先行",
  "",
  "标题决定打开率。一篇文章可以先拟 3 个标题备选，选最戳人的那个。",
  "好标题的标准是让人想点进去、觉得“这说的就是我”、并且有转发冲动。",
  "常用方向可以是愤怒型、共鸣型、反转型、揭秘型，但不能为了炸裂乱编。",
  "",
  "## 第三步：正文结构",
  "",
  "字数控制在 1200-1800 字。不够有力通常是废话太多，不是字数不够。",
  "整体节奏：开场（荒谬感引入）→ 案例1（从小事切入，建立共鸣）→ 案例2（升级，矛盾激化）→ 案例3或转折（揭示本质，情绪爆发）→ 收尾（给态度，给金句，让人想转发）。",
  "",
  "开场必须做到：第一段就出现冲突；用真实对话或具体场景起手；不先解释背景。",
  "案例展开时，优先采用：场景、对话、内心戏、评论四层结构。场景要具体，对话要保留语气，内心戏用短句，评论要一刀捅穿本质。",
  "案例递进必须从“小事共鸣”走向“程度升级”，最后击穿底线或揭示本质。",
  "",
  "收尾不要说教，不要写“所以我们应该”，不要机械总结。",
  "收尾只做三件事：给立场、给一句能截图的金句、给读者一个情绪出口。",
  "金句尽量 15 字以内，不装，不矫情，要切中要害。",
  "",
  "## 第四步：语言规范",
  "",
  "1. 对话要保留“啊”“哦”“你懂吧”这类语气词，不要美化成完整书面语。",
  "2. 内心独白短句优先，可以适度使用“我擦”“你敢信？”这种真实反应，但不要满篇表演。",
  "3. 可以有俚语、黑色幽默、反讽，但必须让读者一眼看懂。",
  "4. 禁止这些腔调：在这个浮躁的时代、某种程度上、值得深思、归根结底、从某种意义上说、希望大家、我们应该。",
  "5. 不要用超过 20 字的长句去解释一个很简单的情绪。",
  "",
  "## 第五步：排版规范",
  "",
  "1. 2-3 句一段，重要的话单独成段，对话独立成段。",
  "2. 情绪爆发点或刀子句可以单句单段，但不能满篇如此。",
  "3. 案例之间允许用 `◆`，主题转换允许用 `---`，特殊补充可用 `▌`，但不要为了排版把文章切碎。",
  "4. 重要观点可以加粗，金句可以斜体，但都要克制。",
  "",
  "## 检验清单",
  "",
  "- 开场第一段是否已经出现冲突？",
  "- 每个案例里是否至少有一句值得截图的话？",
  "- 全文是否出现“我们应该”或“希望大家”？如果有就删掉。",
  "- 情绪是否递进，而不是一上来就满级愤怒？",
  "- 读者看完会不会说“说出我心里话了”？",
  "",
  "核心原则：不是你在发泄，是你在替读者发泄。你写的每一个字，都要服务于这个目的。",
].join("\n");

const styles = [
  {
    name: "公众号正文主提示词·咪蒙风格",
    type: "article_system",
    isDefault: true,
    description: "控制公众号正文主生成链的核心系统提示词，优先级高于普通文章风格。",
    promptTemplate: articleSystemPrompt,
  },
  {
    name: "公众号热点评论·真人感",
    type: "article",
    isDefault: true,
    description: "强调作者感、判断力、真实语气和公众号成稿感的默认文章风格。",
    promptTemplate:
      "你写的是公众号文章，不是工作汇报，不是新闻播报，也不是模型拼接稿。像真人说话，有判断但不过度表演聪明；有情绪但情绪压着写；不要套话、不要鸡汤、不要公文腔。文章适合手机阅读，段落短，节奏稳，有明确重点句。",
  },
  {
    name: "小红书热点笔记·强钩子",
    type: "xiaohongshu",
    isDefault: true,
    description: "适合小红书图文笔记的默认风格，强调开头抓人、结论前置和强互动感。",
    promptTemplate:
      "你是一个懂小红书平台语感的内容创作者。结论前置，少废话，开头必须抓人；像真人分享，不像老师讲课；口语化、有共鸣、能转述，不端着；每一页或每一段只讲一个重点；让人想收藏、评论和继续往下看。",
  },
  {
    name: "小红书配图封面·明亮高级感",
    type: "image",
    isDefault: true,
    description: "适合公众号头图和小红书封面的默认图片风格，强调干净、克制和无文字水印。",
    promptTemplate:
      "请生成适合中文内容平台传播的封面或配图。画面要干净、明亮、克制，主体明确，留出适合叠加中文标题的留白。风格接近成熟公众号头图或小红书封面，不要赛博霓虹和过度特效。正文配图必须与主题强相关；如果不够贴切，宁可不要。严禁出现任何文字、数字、字母、logo、水印、按钮、界面元素和截图残留。",
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
    <h2>先把最扎心的那个点说透</h2>
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
