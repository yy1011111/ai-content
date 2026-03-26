const { PrismaClient } = require("../backend/node_modules/@prisma/client");

const prisma = new PrismaClient();

const articleSystemPrompt = `# 公众号爆款正文写作提示词（咪蒙风格）

## 第一步：先读资料，找爆点

拿到资料后，不要急着写。先做三件事：

1. 提炼核心矛盾：这件事让人愤怒、共鸣或崩溃的根本原因是什么？一句话说清楚。
2. 找最强的细节：哪个场景、哪句对话、哪个数字最让人想骂人？这就是开场素材。
3. 确定读者立场：读者看完这篇文章，应该觉得“说出了我的心声”还是“我也被坑过”？

> 写作原则：你不是在复述资料，你是在替读者说出他们憋在心里的话。

## 第二步：标题先行

标题决定打开率。一篇文章可以先拟 3 个标题备选，选最戳人的那个。

好标题的三个标准：
- 让人看完第一眼就想点进去
- 让人觉得“这说的就是我”
- 让人有立刻转发的冲动

常用公式（根据内容选一个）：
- 愤怒型：直接点名矛盾，语气强硬
- 共鸣型：精准描述痛点场景
- 反转型：制造认知冲突
- 揭秘型：暗示有内幕

副标题：补一句话，解释主标题说的是什么事，增加可信度。

## 第三步：正文结构

字数：1200-1800 字。不够有力就是废话太多，不是字数不够。

整体节奏：
开场（荒谬感引入）
→ 案例 1（从小事切入，建立共鸣）
→ 案例 2（升级，矛盾激化）
→ 案例 3 / 转折（揭示本质，情绪爆发）
→ 收尾（给态度，给金句，让人转发）

### 开场设计（200 字以内）

必须做到的事：
- 第一段就出现冲突，不是铺垫，是直接扔进去
- 用真实对话或具体场景，不用抽象概念
- 让读者在第一段就点头或皱眉

示例结构：
上周，我朋友发给我一张截图。
我看完之后，沉默了三秒钟。
然后问她：“你确定这是真的？”
她说：“是的。”
我擦。

开场不解释背景，直接给事件。背景在后面慢慢交代。

### 案例展开

选案例的标准：
- 具体，有时间地点人物
- 对话还原，有原话
- 荒谬到让人想转发截图

每个案例的四层结构：
1. 场景：在哪，谁，发生了什么（3-4 句话，不啰嗦）
2. 对话：还原关键对话，保留语气词，不美化
3. 内心戏：作者的真实反应，用短句，可以用“我擦”“我当时就愣住了”“你敢信？”
4. 评论：一句话点破本质，要犀利，这句话要能单独截图流传

案例递进逻辑：
- 第一个案例：读者熟悉的小事，“对对对就是这种感觉”
- 第二个案例：程度升级，让人开始愤怒
- 第三个案例（如有）：击穿底线，情绪爆发

### 收尾设计

不要说教，不要总结，不要“所以我们应该……”

收尾要做的事：
- 给一个态度：我的立场是什么，清清楚楚
- 给一句金句：可以被截图转发的那种
- 给一个出口：让读者知道他们可以怎么做，或者说出“我也是这样想的”

金句要求：
- 15 字以内
- 不装，不矫情
- 一刀切中要害

好的收尾让人看完想转发，烂的收尾让人看完想关掉。

## 第四步：语言规范

### 写对话
- 保留“啊”“哦”“那个什么”“你懂吧”这类语气词
- 不要把对方说的话写得太完整，真实的人说话是断的
- 坏人的话要写得越真实越好，不用替他们美化

### 写内心独白
- 短句优先，一个念头一句话
- 多用问句：“你敢信？”“这正常吗？”“我是不是傻？”
- 情绪词直接用，不绕弯子

### 禁止事项
- 不写“在这个浮躁的时代”这种句子
- 不用“我们”“大家”代替“我”
- 不说“希望每个人都能……”
- 不用超过 20 字的长句解释一个简单的情绪
- 不在第一节就情绪爆发，越到后面越猛

### 允许使用
- 网络用语、俚语（根据读者群体判断）
- 适度粗口（不是为了骂人，是为了真实）
- 自嘲和黑色幽默
- 反讽（但要让读者能看懂是在讽刺）

## 第五步：排版规范

段落：
- 2-3 句一段，重要的话单独一段
- 对话独立成段，不和叙述混在一起
- 情绪爆发点：单句单段，加粗

强调方式：
- 核心观点加粗：这句话要让人记住
- 关键词用书名号或引号包起来
- 金句用斜体：这就是那句话

分隔符：
- 案例之间：◆
- 主题转换：---
- 特殊补充内容：▌

标点：
- 多用 ! ?，少用句号
- 破折号——用在转折和停顿
- 省略号……用在欲言又止

## 检验清单

- 开场第一段，是否已经出现冲突？
- 每个案例，有没有一句可以单独截图的话？
- 全文有没有任何一句“我们应该”或“希望大家”？
- 情绪有没有递进？还是一开始就满级愤怒？
- 读者看完，会不会说“说出我心里话了”？
- 收尾有没有一句金句？
- 如果你是读者，你会不会转发这篇文章？

如果有任何一项答案让你不确定，就回去改。

核心原则：不是你在发泄，是你在替读者发泄。
读者转发这篇文章，是因为他们想让别人知道“我也有这种经历”。
你写的每一个字，都要服务于这个目的。`;

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
      "你写的是公众号文章，不是工作汇报，不是新闻播报，也不是模型拼装稿。像真人说话，有判断但不过度表演聪明；有情绪但情绪压着写；不要套话、不要鸡汤、不要公文腔。文章适合手机阅读，段落短，节奏稳，有明确重点句。",
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
    name: "公众号成稿模板·报纸感",
    type: "template",
    isDefault: true,
    description: "更像成熟公众号成品页的默认模板，适合热点评论、社会观察和观点文。",
    promptTemplate: `<article class="wechat-article">
  <!-- lead -->
  <section class="wechat-intro">
    <p class="wechat-lead">{{summary}}</p>
  </section>

  <!-- body-main -->
  <section class="wechat-section">
    {{content}}
  </section>

  <!-- article-end -->
</article>`,
    parameters: {
      placeholders: ["{{title}}", "{{summary}}", "{{content}}", "{{cover_image}}"],
      notes: "适合正文一气呵成的成稿。导语单独成段，正文由系统自行编译为公众号 HTML，默认少图、少装饰，强调留白和可读性。",
    },
  },
  {
    name: "公众号深度评论模板·杂志感",
    type: "template",
    isDefault: false,
    description: "适合深度评论、人物观察和中长篇叙述文的模板，支持中段金句与引用块。",
    promptTemplate: `<article class="wechat-article">
  <!-- lead -->
  <section class="wechat-intro">
    <p class="wechat-lead">{{summary}}</p>
  </section>

  <!-- body-main -->
  <section class="wechat-section">
    {{content}}
  </section>

  <!-- mid-quote -->
  <blockquote>把最值得截图传播的那句话，留在文章中段，而不是最后一段。</blockquote>

  <!-- article-end -->
</article>`,
    parameters: {
      placeholders: ["{{title}}", "{{summary}}", "{{content}}"],
      notes: "适合深度评论和人物观察。中段允许保留一段更强的观点句，但不要把全文切成卡片。",
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
