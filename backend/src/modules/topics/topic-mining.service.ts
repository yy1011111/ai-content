import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AiClientService } from '../ai-models/ai-client.service';
import { DefaultModelsService } from '../ai-models/default-models.service';
import { SystemLogsService } from '../system-logs/system-logs.service';
import { ContentStrategiesService } from '../content-strategies/content-strategies.service';
import { CrawlerRegistry } from '../materials/crawlers/crawler.registry';
import { RssCrawlerService, type CrawlResult } from '../materials/crawlers/rss.crawler';

// 选题挖掘管线
// 从近期素材中聚类合并 + 商业导向打分 → 产出高潜力选题
function withTimeout<T>(promise: Promise<T>, ms: number, msg: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(msg)), ms)
    ),
  ]);
}

export interface SeedAnalysis {
  normalizedSeed: string;
  intent: string;
  audience: string;
  keywords: string[];
  searchQueries: string[];
}

export interface DiscoveredTopicCandidate {
  title: string;
  angle: string;
  summary: string;
  score: number;
  dimension_scores?: Record<string, number>;
  reasoning?: string;
  keywords?: string[];
  search_queries?: string[];
  material_ids?: string[];
}

export interface SeedRetrievalSummary {
  scannedSources: number;
  fetchedCount: number;
  candidateCount: number;
  matchedCount: number;
  rejectedCount: number;
  savedCount: number;
}

interface MaterialSignalMeta {
  signalType: string;
  topicCluster: string;
  audience: string;
  intentType: string;
  trustScore: number;
  freshnessScore: number;
  relevanceScore: number;
  qualityScore: number;
  sourceWeight: number;
  standardizedAt: string;
}

interface EvaluatedCrawlCandidate {
  result: CrawlResult;
  signal: MaterialSignalMeta;
}

@Injectable()
export class TopicMiningService {
  private readonly logger = new Logger(TopicMiningService.name);

  // 每批处理时的素材数量，减少以应对大模型单次理解上线并适配并发
  private readonly BATCH_SIZE = 20;
  private readonly DISCOVERY_MATERIAL_LIMIT = 36;
  private readonly DISCOVERY_SOURCE_LIMIT = 4;
  private readonly DISCOVERY_RESULT_LIMIT = 24;
  private readonly DISCOVERY_RESULT_PER_SOURCE = 8;
  private readonly DISCOVERY_MIN_QUALITY_SCORE = 55;

  constructor(
    private prisma: PrismaService,
    private aiClient: AiClientService,
    private defaultModels: DefaultModelsService,
    private systemLogsService: SystemLogsService,
    private contentStrategiesService: ContentStrategiesService,
    private crawlerRegistry: CrawlerRegistry,
    private rssCrawler: RssCrawlerService,
  ) { }

  async discoverTopicsFromSeed(seedInput: string) {
    const seed = seedInput.trim();
    if (seed.length < 2) {
      throw new Error('请输入至少 2 个字的关键词、事件或描述');
    }

    const modelId = await this.getTopicSelectionModelId();
    const strategy = await this.contentStrategiesService.getDefaultStrategy();
    const analysis = await this.analyzeSeed(modelId, seed);
    const retrieval = await this.collectMaterialsForSeed(strategy, seed, analysis);
    const materials = await this.findMaterialsForSeed(strategy, seed, analysis);

    if (materials.length === 0) {
      return {
        created: 0,
        message: retrieval.savedCount > 0
          ? '已尝试主动检索相关信息，但当前仍未找到足够可用的素材，请稍后再试'
          : '当前素材池中没有找到足够相关的信息，请先配置并启用可用信息源后再试',
        topics: [],
        analysis,
        retrieval,
      };
    }

    const candidates = await this.generateTopicsFromSeed(modelId, seed, analysis, materials, strategy);
    const topics = await this.saveDiscoveredTopics(seed, candidates, materials);

    const message = `已围绕「${analysis.normalizedSeed || seed}」挖出 ${topics.length} 个不同切入点的候选选题`;
    await this.systemLogsService.record(message, 'success');

    return {
      created: topics.length,
      message,
      topics,
      analysis,
      retrieval,
    };
  }

  // 一键挖掘：聚合素材 → 分批并发 AI 打分 → 入库
  async mineTopics(hours = 72): Promise<{ created: number; message: string }> {
    const modelId = await this.getTopicSelectionModelId();
    const strategy = await this.contentStrategiesService.getDefaultStrategy();
    const sourceFilter = this.buildMaterialSourceFilter(strategy.sourceIds || []);

    // 查询近 N 小时内的未挖掘素材，且挖掘次数低于 2
    const timeThreshold = new Date(Date.now() - hours * 60 * 60 * 1000);

    const materials = await this.prisma.material.findMany({
      where: {
        status: 'unmined',
        collectDate: { gte: timeThreshold },
        miningCount: { lt: 2 },
        ...sourceFilter,
      },
      orderBy: { collectDate: 'desc' },
      // 移除 take: 50 限制，读取所有符合条件的素材
    });

    if (materials.length === 0) {
      return { created: 0, message: '没有待挖掘的新素材，请先执行采集任务' };
    }

    this.logger.log(
      `开始挖掘选题：${materials.length} 条素材，分批处理（每批 ${this.BATCH_SIZE} 条，并发 5），模型 ${modelId}`,
    );

    let totalCreated = 0;
    const allConsumedMaterialIds = new Set<string>();
    const allProcessedMaterialIds = new Set<string>();

    const CONCURRENCY = 5;
    const batches: any[][] = [];

    // 切分批次
    for (let i = 0; i < materials.length; i += this.BATCH_SIZE) {
      batches.push(materials.slice(i, i + this.BATCH_SIZE));
    }
    const totalBatches = batches.length;

    // 自带重试与收集的并发处理队列
    let currentIndex = 0;
    const processNextBatch = async (): Promise<void> => {
      // 获取当前要处理的批次索引
      let batchIndex: number;
      let batch: any[];

      // 使用原子操作获取并推进索引
      synchronized: {
        if (currentIndex >= batches.length) return;
        batchIndex = currentIndex;
        batch = batches[batchIndex];
        currentIndex++;
      }

      const displayIndex = batchIndex + 1;
      this.logger.log(`处理第 ${displayIndex}/${totalBatches} 批（${batch.length} 条素材）`);

      // 注意：这里不再统一增加挖掘次数，移至 try/catch 内部AI成功响应后再加


      // 构建素材清单（精简字段）
      const materialList = batch.map((m) => ({
        id: m.id,
        platform: m.platform,
        title: m.title,
        summary: (m.summary || '').substring(0, 100),
        signal: this.toRecord(this.toRecord(m.metadata).signal),
      }));

      try {
        const topicsData = await this.callLlmForClustering(modelId, materialList);

        if (!topicsData || topicsData.length === 0) {
          this.logger.warn(`第 ${displayIndex} 批未返回有效选题`);
          // AI 正常返回了空数组或无效数据，说明平台没报错但确实没有好选题，应计入一次挖掘消耗
          await this.prisma.material.updateMany({
            where: { id: { in: batch.map(m => m.id) } },
            data: { miningCount: { increment: 1 } },
          });
          batch.forEach((m) => allProcessedMaterialIds.add(m.id));
          return processNextBatch();
        }

        // AI 正常返回了数据，这批次算成功处理了
        await this.prisma.material.updateMany({
          where: { id: { in: batch.map(m => m.id) } },
          data: { miningCount: { increment: 1 } },
        });
        batch.forEach((m) => allProcessedMaterialIds.add(m.id));

        // 过滤低分话题，入库高分话题
        const { created, consumedIds } = await this.saveTopics(topicsData, batch);

        // 累加数据，避免并发冲突使用临时变量和锁处理
        totalCreated += created;
        consumedIds.forEach((id) => allConsumedMaterialIds.add(id));
      } catch (error) {
        // AI 报错或异常：不增加 miningCount，不加入 allProcessedMaterialIds，当做本次没发生过
        this.logger.error(`第 ${displayIndex} 批未成功处理(API可能报错): ${error}`);
      }

      // 处理队列下一次
      return processNextBatch();
    };

    // 启动初始并发 worker
    const workers: Promise<void>[] = [];
    for (let i = 0; i < Math.min(CONCURRENCY, batches.length); i++) {
      workers.push(processNextBatch());
    }

    // 等待所有批次执行完
    await Promise.all(workers);

    // 批量标记已消费（被 AI 模型选中）的素材为 mined
    if (allConsumedMaterialIds.size > 0) {
      await this.prisma.material.updateMany({
        where: { id: { in: Array.from(allConsumedMaterialIds) } },
        data: { status: 'mined' },
      });
    }

    // 批量补刀机制：把这次挖掘结束、但 miningCount >= 2 且依然是 unmined（这次又没被挑中）的素材弃用
    // 等以后有再次提取队列的话可以跳过这些材料
    const notSelectedIds = Array.from(allProcessedMaterialIds).filter(
      id => !allConsumedMaterialIds.has(id)
    );

    if (notSelectedIds.length > 0) {
      await this.prisma.material.updateMany({
        where: {
          id: { in: notSelectedIds },
          miningCount: { gte: 2 },
          status: 'unmined'
        },
        data: { status: 'failed' } // 抛弃，因为最多分析2次
      });
    }

    const message = `挖掘完成，从 ${materials.length} 条素材中产出 ${totalCreated} 个高潜力选题`;
    this.logger.log(message);
    await this.systemLogsService.record(message, 'success');
    return { created: totalCreated, message };
  }

  private async getTopicSelectionModelId() {
    const defaults = await this.defaultModels.getDefaults();
    const modelId = defaults.topicSelection;

    if (!modelId) {
      throw new Error('请先在「设置 → 默认模型」中为「选题推荐」分配 AI 模型');
    }

    return modelId;
  }

  private async analyzeSeed(modelId: string, seed: string): Promise<SeedAnalysis> {
    const prompt = `你是一名内容选题分析师。用户会给你一个关键词、事件或一段描述，请你提炼这个输入背后的检索意图。

输入内容：
${seed}

请严格返回 JSON：
{
  "normalizedSeed": "归一化后的主题名",
  "intent": "一句话说明用户想解决什么内容需求",
  "audience": "最可能的目标读者",
  "keywords": ["关键词1", "关键词2", "关键词3", "关键词4"],
  "searchQueries": ["可继续检索的问题1", "可继续检索的问题2", "可继续检索的问题3"]
}

要求：
1. keywords 控制在 4-8 个
2. searchQueries 控制在 3-6 个
3. 不要返回 Markdown`;

    const result = await withTimeout(
      this.aiClient.generate(modelId, [{ role: 'user', content: prompt }], {
        temperature: 0.3,
        maxTokens: 1200,
      }),
      2 * 60 * 1000,
      '种子分析超时（超过2分钟）',
    );

    const parsed = this.parseJsonObject(result);
    const fallbackKeywords = this.extractFallbackKeywords(seed);

    return {
      normalizedSeed: parsed.normalizedSeed || seed,
      intent: parsed.intent || `围绕「${seed}」寻找值得写的内容机会`,
      audience: parsed.audience || '泛行业从业者',
      keywords: this.uniqueStrings(parsed.keywords, fallbackKeywords),
      searchQueries: this.uniqueStrings(parsed.searchQueries, fallbackKeywords.map((keyword) => `${keyword} 怎么做`)),
    };
  }

  private async findMaterialsForSeed(
    strategy: { sourceIds?: string[] },
    seed: string,
    analysis: SeedAnalysis,
  ) {
    const recentThreshold = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000);
    const terms = this.uniqueStrings(
      analysis.keywords,
      this.extractFallbackKeywords(seed),
    ).slice(0, 8);
    const sourceFilter = this.buildMaterialSourceFilter(strategy.sourceIds || []);

    const matched = await this.prisma.material.findMany({
      where: {
        collectDate: { gte: recentThreshold },
        status: { in: ['unmined', 'mined'] },
        ...sourceFilter,
        OR: terms.flatMap((term) => [
          { title: { contains: term, mode: 'insensitive' } },
          { summary: { contains: term, mode: 'insensitive' } },
          { content: { contains: term, mode: 'insensitive' } },
          { platform: { contains: term, mode: 'insensitive' } },
        ]),
      },
      orderBy: { collectDate: 'desc' },
      take: this.DISCOVERY_MATERIAL_LIMIT,
    });

    if (matched.length >= 12) {
      return this.rankMaterialsForSeed(matched, analysis).slice(0, this.DISCOVERY_MATERIAL_LIMIT);
    }

    const fallback = await this.prisma.material.findMany({
      where: {
        collectDate: { gte: recentThreshold },
        status: { in: ['unmined', 'mined'] },
        ...sourceFilter,
      },
      orderBy: { collectDate: 'desc' },
      take: this.DISCOVERY_MATERIAL_LIMIT,
    });

    const merged = [...matched];
    const existingIds = new Set(matched.map((item) => item.id));
    for (const material of fallback) {
      if (existingIds.has(material.id)) {
        continue;
      }
      merged.push(material);
      existingIds.add(material.id);
      if (merged.length >= this.DISCOVERY_MATERIAL_LIMIT) {
        break;
      }
    }

    return this.rankMaterialsForSeed(merged, analysis).slice(0, this.DISCOVERY_MATERIAL_LIMIT);
  }

  private async collectMaterialsForSeed(
    strategy: { sourceIds?: string[] },
    seed: string,
    analysis: SeedAnalysis,
  ): Promise<SeedRetrievalSummary> {
    const rawSources = await this.prisma.source.findMany({
      where: {
        enabled: true,
        ...(strategy.sourceIds && strategy.sourceIds.length > 0
          ? { id: { in: strategy.sourceIds } }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }],
    });
    const sources = rawSources
      .sort((left, right) => this.compareSourcesForDiscovery(left, right))
      .slice(0, this.DISCOVERY_SOURCE_LIMIT);

    if (sources.length === 0) {
      return {
        scannedSources: 0,
        fetchedCount: 0,
        candidateCount: 0,
        matchedCount: 0,
        rejectedCount: 0,
        savedCount: 0,
      };
    }

    const relevanceTerms = this.buildSeedRelevanceTerms(seed, analysis);
    const tempPool: EvaluatedCrawlCandidate[] = [];
    let fetchedCount = 0;

    for (const source of sources) {
      const config = this.toRecord(source.config);
      const platform = typeof config.platform === 'string' ? config.platform : source.name;

      try {
        const crawler = this.crawlerRegistry.getCrawler(platform);
        const results = crawler
          ? await crawler.crawl(source.url, config)
          : source.type === 'rss'
            ? await this.rssCrawler.crawl(source.url, platform)
            : [];
        const taggedResults = results.map((result) => ({
          ...result,
          metadata: {
            ...this.toRecord(result.metadata),
            retrieval: {
              ...this.toRecord(this.toRecord(result.metadata).retrieval),
              sourceId: source.id,
              sourceName: source.name,
              sourceType: source.type,
              sourceUrl: source.url,
            },
          },
        }));

        fetchedCount += taggedResults.length;

        const candidates = this.evaluateRetrievedResults(taggedResults, analysis, relevanceTerms, platform).slice(
          0,
          this.DISCOVERY_RESULT_PER_SOURCE * 2,
        );
        tempPool.push(...candidates);
      } catch (error) {
        this.logger.warn(`种子检索时采集渠道「${source.name}」失败: ${error}`);
      }
    }

    const dedupedPool = this.dedupeCandidates(tempPool);
    const acceptedPool = dedupedPool
      .filter((candidate) => candidate.signal.qualityScore >= this.DISCOVERY_MIN_QUALITY_SCORE)
      .slice(0, this.DISCOVERY_RESULT_LIMIT);

    if (acceptedPool.length === 0) {
      return {
        scannedSources: sources.length,
        fetchedCount,
        candidateCount: dedupedPool.length,
        matchedCount: 0,
        rejectedCount: dedupedPool.length,
        savedCount: 0,
      };
    }

    const finalResults = acceptedPool.map(({ result, signal }) => ({
      ...result,
      platform: result.platform,
      metadata: {
        signal,
        retrieval: {
          ...this.toRecord(this.toRecord(result.metadata).retrieval),
          stage: 'seed_discovery',
          seed: seed,
          normalizedSeed: analysis.normalizedSeed,
          keywords: analysis.keywords.slice(0, 6),
        },
      },
    }));
    const { savedCount } = await this.rssCrawler.saveResults(finalResults);

    if (savedCount > 0) {
      await this.systemLogsService.record(
        `🔎 围绕「${analysis.normalizedSeed || seed}」主动检索 ${sources.length} 个渠道，临时池候选 ${dedupedPool.length} 条，过滤后入正式素材池 ${acceptedPool.length} 条，新增入库 ${savedCount} 条`,
        'info',
      );
    }

    return {
      scannedSources: sources.length,
      fetchedCount,
      candidateCount: dedupedPool.length,
      matchedCount: acceptedPool.length,
      rejectedCount: Math.max(dedupedPool.length - acceptedPool.length, 0),
      savedCount,
    };
  }

  private async generateTopicsFromSeed(
    modelId: string,
    seed: string,
    analysis: SeedAnalysis,
    materials: Array<{
      id: string;
      title: string;
      summary: string | null;
      content: string | null;
      platform: string;
      collectDate: Date;
    }>,
    strategy: {
      name: string;
      industry: string;
      targetAudience: string;
      commercialGoal: string;
      corePainPoints: string;
      writingAngles: string;
      toneAndStyle: string | null;
    },
  ) {
    const materialList = materials.map((material) => ({
      id: material.id,
      title: material.title,
      summary: (material.summary || material.content || '').slice(0, 180),
      platform: material.platform,
      collectDate: material.collectDate,
      signal: this.toRecord(this.toRecord((material as any).metadata).signal),
    }));

    const prompt = `你是一名资深内容主编。你的任务是根据当前内容策略、用户给出的内容种子和一批相关素材，挖掘出 3-5 个适合继续创作的候选选题。

当前内容策略：
- 策略名称：${strategy.name}
- 所属行业：${strategy.industry}
- 目标人群：${strategy.targetAudience}
- 商业目标：${strategy.commercialGoal}
- 核心痛点：${strategy.corePainPoints}
- 建议切入角度：${strategy.writingAngles}
- 表达风格：${strategy.toneAndStyle || '务实、清晰、强调结果与执行'}

用户输入：
- 原始种子：${seed}
- 归一化主题：${analysis.normalizedSeed}
- 用户意图：${analysis.intent}
- 目标读者：${analysis.audience}
- 关键词：${analysis.keywords.join('、')}
- 延展搜索问题：${analysis.searchQueries.join('；')}

你必须输出 3-5 个切入点明显不同的选题。切入点要尽量拉开，例如：
- 趋势解读
- 痛点拆解
- 实操方法
- 案例拆解
- 认知反转

可用素材如下：
${JSON.stringify(materialList)}

请严格输出 JSON 数组：
[
  {
    "title": "选题标题",
    "angle": "切入点类型与一句话说明",
    "summary": "这个选题打算怎么写，为什么值得写（120字内）",
    "score": 88,
    "dimension_scores": {
      "audienceFit": 18,
      "emotionalValue": 16,
      "simplificationPotential": 17,
      "networkVolume": 19,
      "contentValue": 18
    },
    "reasoning": "为什么这个切入点成立，以及适合创作文章还是小红书",
    "keywords": ["关键词1", "关键词2", "关键词3"],
    "search_queries": ["后续还值得继续搜索的问题1"],
    "material_ids": ["关联素材ID1", "关联素材ID2"]
  }
]

要求：
1. 不要输出重复角度
2. 优先选择和输入种子真正相关的素材
3. material_ids 必须只引用给定素材里的 id
4. 如果素材自带 signal 信息，要优先参考 signalType、topicCluster、intentType、trustScore
5. 选题必须服务于当前内容策略，而不是写成泛资讯
6. 不要输出 Markdown`;

    const result = await withTimeout(
      this.aiClient.generate(modelId, [{ role: 'user', content: prompt }], {
        temperature: 0.5,
        maxTokens: 3200,
      }),
      4 * 60 * 1000,
      '智能挖题超时（超过4分钟）',
    );

    return this.parseJsonArray(result) as DiscoveredTopicCandidate[];
  }

  private async saveDiscoveredTopics(
    seed: string,
    topicsData: DiscoveredTopicCandidate[],
    materials: Array<{ id: string }>,
  ) {
    const validMaterialIds = new Set(materials.map((material) => material.id));
    const createdIds: string[] = [];

    for (const topic of topicsData.slice(0, 5)) {
      const title = (topic.title || '').trim();
      if (!title) {
        continue;
      }

      const materialIds = (topic.material_ids || []).filter((id) => validMaterialIds.has(id));
      const summary = (topic.summary || '').trim();
      const angle = (topic.angle || '').trim();
      const reasoning = [angle ? `切入点：${angle}` : '', (topic.reasoning || '').trim()]
        .filter(Boolean)
        .join('\n');

      const created = await this.prisma.topic.create({
        data: {
          title,
          description: summary || `围绕「${seed}」自动挖掘出的候选选题`,
          summary,
          sourceType: '智能挖掘',
          keywords: this.uniqueStrings(topic.keywords, this.extractFallbackKeywords(seed)),
          searchQueries: this.uniqueStrings(topic.search_queries),
          aiScore: topic.score || 0,
          scoreDetails: this.normalizeDimensionScores(topic.dimension_scores),
          scoreReason: reasoning,
          reasoning,
          status: 'completed',
          materials: materialIds.length > 0
            ? {
              create: materialIds.map((materialId) => ({
                material: { connect: { id: materialId } },
              })),
            }
            : undefined,
        },
      });

      createdIds.push(created.id);
    }

    const createdTopics = await this.prisma.topic.findMany({
      where: { id: { in: createdIds } },
      orderBy: { createdAt: 'desc' },
      include: {
        materials: {
          include: {
            material: { select: { id: true, title: true, platform: true } },
          },
        },
      },
    });

    return createdTopics.map((topic) => ({
      ...topic,
      materials: topic.materials.map((item) => item.material),
    }));
  }

  // 将 AI 返回的选题数据保存到数据库
  private async saveTopics(
    topicsData: any[],
    batchMaterials: any[],
  ): Promise<{ created: number; consumedIds: string[] }> {
    let created = 0;
    const consumedIds: string[] = [];

    for (const td of topicsData) {
      const score = td.score ?? 0;
      if (score < 50) continue;

      const title = td.title || '未命名话题';

      // 校验 material_ids：只保留本批素材范围内的合法 ID
      const validMaterialIds = (td.material_ids || []).filter((id: string) =>
        batchMaterials.some((m) => m.id === id),
      );

      try {
        await this.prisma.topic.create({
          data: {
            title,
            summary: td.summary || '',
            description: td.summary || '',
            sourceType: 'AI 挖掘',
            keywords: td.keywords || [],
            searchQueries: td.search_queries || [],
            aiScore: score,
            scoreDetails: td.dimension_scores || {},
            scoreReason: td.reasoning || '',
            reasoning: td.reasoning || '',
            status: 'completed',
            materials: validMaterialIds.length > 0
              ? {
                create: validMaterialIds.map((materialId: string) => ({
                  material: { connect: { id: materialId } },
                })),
              }
              : undefined,
          },
        });

        created++;
        validMaterialIds.forEach((id: string) => consumedIds.push(id));
      } catch (error) {
        this.logger.warn(`创建选题「${title}」失败: ${error}`);
      }
    }

    return { created, consumedIds };
  }

  // 调用大模型进行聚类打分
  private async callLlmForClustering(
    modelId: string,
    materialList: Array<{
      id: string;
      platform: string;
      title: string;
      summary: string;
      signal?: Record<string, any>;
    }>,
  ): Promise<any[]> {
    const strategy = await this.contentStrategiesService.getDefaultStrategy();
    const systemPrompt = `你是一名资深内容策略主编。
你的任务是将我给出的一批近期收集的全网原始素材进行聚合（不同平台的同一件事合并为一个话题），并严格按照以下维度给出 1-100 的爆款潜力总分，最后过滤出得分较高的话题。只输出包含较高分数的候选。

当前内容策略：
- 策略名称：${strategy.name}
- 所属行业：${strategy.industry}
- 目标人群：${strategy.targetAudience}
- 商业目标：${strategy.commercialGoal}
- 核心痛点：${strategy.corePainPoints}
- 建议切入角度：${strategy.writingAngles}
- 表达风格：${strategy.toneAndStyle || '务实、清晰、强调可执行性'}

【核心要求】：你必须严格围绕当前内容策略判断选题价值。与行业、目标人群、商业目标明显无关的泛资讯，应尽早剔除。
如果素材里已经提供 signal 信息，请把它当作优先证据，而不是只看标题关键词。

打分维度（每个维度 0-20 分，总分 0-100）：
1. audienceFit（画像贴合度）：是否贴合当前策略定义的目标人群？
2. emotionalValue（情绪价值）：是否能击中目标人群的痛点、焦虑、欲望或机会感？
3. simplificationPotential（降维科普潜力）：是否容易被解释成普通人听得懂、用得上的内容？
4. networkVolume（全网声量）：素材来源如果跨域多个平台则酌情加分。
5. contentValue（内容价值）：是否适合转化成有传播性、有讨论度、能承接商业目标的内容？

输出格式必须是严格的 JSON 数组，无需包裹 Markdown 代码块。对象属性定义如下：
[{"title":"标题","summary":"一句话概括事件，并说明它如何击中目标人群痛点或服务商业目标（200字以内）","score":85,"dimension_scores":{"audienceFit":18,"emotionalValue":17,"simplificationPotential":16,"networkVolume":18,"contentValue":16},"reasoning":"给这个分数的理由，说明最适合的目标人群和切入角度","keywords":["可做搜索长尾词的标签1", "标签2"],"search_queries":["如果要继续写这篇内容，后续还值得补充搜索的问题1"],"material_ids":["素材ID"]}]`;

    const userMessage = `请分析以下 ${materialList.length} 条素材：\n${JSON.stringify(materialList)}`;

    try {
      const result = await withTimeout(
        this.aiClient.generate(modelId, [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ], { temperature: 0.3, maxTokens: 4000 }),
        5 * 60 * 1000,
        'LLM 聚类调用超时（超过5分钟）'
      );

      return this.parseJsonArray(result);
    } catch (error) {
      this.logger.error(`聚类打分模型调用失败: ${error}`);
      throw error;
    }
  }

  private parseJsonObject(content: string): Record<string, any> {
    const cleaned = content.trim().replace(/^```json/, '').replace(/^```/, '').replace(/```$/, '').trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) {
      return {};
    }

    try {
      const parsed = JSON.parse(match[0]);
      return typeof parsed === 'object' && parsed !== null ? parsed : {};
    } catch {
      return {};
    }
  }

  // 从 AI 响应中解析 JSON 数组
  private parseJsonArray(content: string): any[] {
    // 清洗 Markdown 代码块标记
    let cleaned = content.trim();
    if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
    if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
    if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
    cleaned = cleaned.trim();

    // 正则提取 JSON 数组
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (!match) {
      this.logger.warn(`无法从 AI 响应中提取 JSON 数组: ${content.substring(0, 200)}`);
      return [];
    }

    try {
      const parsed = JSON.parse(match[0]);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      this.logger.warn(`JSON 解析失败: ${error}`);
      return [];
    }
  }

  private extractFallbackKeywords(seed: string) {
    return Array.from(
      new Set(
        seed
          .split(/[\s,，。；、\n]+/)
          .map((item) => item.trim())
          .filter((item) => item.length >= 2),
      ),
    ).slice(0, 6);
  }

  private uniqueStrings(primary: unknown, fallback: string[] = []) {
    const merged = [
      ...(Array.isArray(primary) ? primary : []),
      ...fallback,
    ]
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean);

    return Array.from(new Set(merged)).slice(0, 8);
  }

  private normalizeDimensionScores(scores?: Record<string, number>) {
    return {
      audienceFit: scores?.audienceFit || 0,
      emotionalValue: scores?.emotionalValue || 0,
      simplificationPotential: scores?.simplificationPotential || 0,
      networkVolume: scores?.networkVolume || 0,
      contentValue: scores?.contentValue || 0,
    };
  }

  private buildSeedRelevanceTerms(seed: string, analysis: SeedAnalysis) {
    const queryTerms = analysis.searchQueries.flatMap((query) => this.extractFallbackKeywords(query));
    return this.uniqueStrings(
      [
        analysis.normalizedSeed,
        analysis.audience,
        ...analysis.keywords,
        ...queryTerms,
      ],
      this.extractFallbackKeywords(seed),
    );
  }

  private compareSourcesForDiscovery(
    left: { name: string; config: unknown; lastCrawlTime: Date | null },
    right: { name: string; config: unknown; lastCrawlTime: Date | null },
  ) {
    const leftPlatform = this.getPlatformName(left.name, left.config);
    const rightPlatform = this.getPlatformName(right.name, right.config);
    const leftWeight = this.getSourceWeightForPlatform(leftPlatform);
    const rightWeight = this.getSourceWeightForPlatform(rightPlatform);

    if (leftWeight !== rightWeight) {
      return rightWeight - leftWeight;
    }

    return (left.lastCrawlTime?.getTime() || 0) - (right.lastCrawlTime?.getTime() || 0);
  }

  private evaluateRetrievedResults(
    results: CrawlResult[],
    analysis: SeedAnalysis,
    terms: string[],
    platform: string,
  ): EvaluatedCrawlCandidate[] {
    return results
      .map((result) => {
        const normalizedResult = {
          ...result,
          platform: result.platform || platform,
        };
        const sourceWeight = this.getSourceWeightForPlatform(normalizedResult.platform);
        const relevanceScore = this.calculateResultRelevance(normalizedResult, terms);
        const freshnessScore = this.calculateFreshnessScore(normalizedResult.publishDate);
        const contentQualityScore = this.calculateContentQualityScore(normalizedResult);
        const trustScore = Math.min(100, Math.round(sourceWeight * 0.7 + contentQualityScore * 0.3));
        const qualityScore = Math.round(
          relevanceScore * 0.45 +
          freshnessScore * 0.2 +
          sourceWeight * 0.2 +
          contentQualityScore * 0.15,
        );

        return {
          result: normalizedResult,
          signal: {
            signalType: this.inferSignalType(normalizedResult),
            topicCluster: this.inferTopicCluster(normalizedResult, analysis),
            audience: analysis.audience,
            intentType: this.inferIntentType(normalizedResult),
            trustScore,
            freshnessScore,
            relevanceScore,
            qualityScore,
            sourceWeight,
            standardizedAt: new Date().toISOString(),
          },
        };
      })
      .filter((item) => item.signal.relevanceScore > 0)
      .sort((left, right) => right.signal.qualityScore - left.signal.qualityScore);
  }

  private calculateResultRelevance(result: CrawlResult, terms: string[]) {
    const title = (result.title || '').toLowerCase();
    const summary = (result.summary || '').toLowerCase();
    const content = (result.content || '').slice(0, 400).toLowerCase();
    const platform = (result.platform || '').toLowerCase();

    let score = 0;
    for (const rawTerm of terms) {
      const term = rawTerm.toLowerCase().trim();
      if (term.length < 2) {
        continue;
      }

      if (title.includes(term)) score += 6;
      if (summary.includes(term)) score += 4;
      if (content.includes(term)) score += 2;
      if (platform.includes(term)) score += 1;
    }

    return Math.min(100, score * 4);
  }

  private calculateFreshnessScore(publishDate: Date | null) {
    if (!publishDate) {
      return 55;
    }

    const ageHours = (Date.now() - publishDate.getTime()) / (1000 * 60 * 60);
    if (ageHours <= 24) return 96;
    if (ageHours <= 72) return 88;
    if (ageHours <= 7 * 24) return 76;
    if (ageHours <= 14 * 24) return 62;
    return 48;
  }

  private calculateContentQualityScore(result: CrawlResult) {
    const titleLength = (result.title || '').trim().length;
    const summaryLength = (result.summary || '').trim().length;
    const hasSourceUrl = Boolean(result.sourceUrl);

    let score = 35;
    if (titleLength >= 8 && titleLength <= 60) score += 20;
    if (summaryLength >= 30) score += 20;
    if (summaryLength >= 80) score += 10;
    if ((result.content || '').trim().length >= 120) score += 10;
    if (hasSourceUrl) score += 5;

    return Math.min(100, score);
  }

  private dedupeCandidates(candidates: EvaluatedCrawlCandidate[]) {
    const seenKeys = new Set<string>();
    const deduped: EvaluatedCrawlCandidate[] = [];

    for (const item of candidates) {
      const key = item.result.sourceUrl?.trim() || item.result.title.trim().toLowerCase();
      if (!key || seenKeys.has(key)) {
        continue;
      }
      seenKeys.add(key);
      deduped.push(item);
    }

    return deduped;
  }

  private rankMaterialsForSeed(
    materials: Array<{
      id: string;
      title: string;
      summary: string | null;
      content: string | null;
      platform: string;
      collectDate: Date;
      metadata?: unknown;
    }>,
    analysis: SeedAnalysis,
  ) {
    const terms = this.buildSeedRelevanceTerms(analysis.normalizedSeed, analysis);

    return [...materials].sort((left, right) => {
      const leftScore = this.calculateMaterialSelectionScore(left, terms);
      const rightScore = this.calculateMaterialSelectionScore(right, terms);
      return rightScore - leftScore;
    });
  }

  private calculateMaterialSelectionScore(
    material: {
      title: string;
      summary: string | null;
      content: string | null;
      platform: string;
      collectDate: Date;
      metadata?: unknown;
    },
    terms: string[],
  ) {
    const metadata = this.toRecord(material.metadata);
    const signal = this.toRecord(metadata.signal);
    const baseScore = this.calculateResultRelevance(
      {
        title: material.title,
        summary: material.summary || '',
        content: material.content || '',
        sourceUrl: '',
        author: '',
        publishDate: material.collectDate,
        platform: material.platform,
      },
      terms,
    );

    const trustScore = typeof signal.trustScore === 'number' ? signal.trustScore : 55;
    const freshnessScore = typeof signal.freshnessScore === 'number' ? signal.freshnessScore : this.calculateFreshnessScore(material.collectDate);
    const qualityScore = typeof signal.qualityScore === 'number' ? signal.qualityScore : 55;
    const signalType = typeof signal.signalType === 'string' ? signal.signalType : '';
    const signalBonus = ['pain_point', 'case_study', 'how_to', 'trend', 'hotspot', 'controversy'].includes(signalType)
      ? 8
      : 0;

    return baseScore * 0.45 + trustScore * 0.2 + freshnessScore * 0.15 + qualityScore * 0.15 + signalBonus;
  }

  private inferSignalType(result: CrawlResult) {
    const text = `${result.title} ${result.summary} ${result.content}`.toLowerCase();
    if (/(案例|实战|show hn|复盘|营收|增长了|客户|落地|demo)/i.test(text)) return 'case_study';
    if (/(不会|难|卡住|痛点|焦虑|失败|做不起来|困境|问题)/i.test(text)) return 'pain_point';
    if (/(教程|指南|清单|步骤|怎么做|方法|技巧)/i.test(text)) return 'how_to';
    if (/(争议|翻车|吐槽|骂|质疑|封禁)/i.test(text)) return 'controversy';
    if (/(发布|上线|更新|新功能|新模型|新版|排行榜|热搜)/i.test(text)) return 'hotspot';
    return 'trend';
  }

  private inferIntentType(result: CrawlResult) {
    const text = `${result.title} ${result.summary}`.toLowerCase();
    if (/(教程|指南|步骤|怎么做|方法|技巧)/i.test(text)) return 'how_to';
    if (/(对比|比较|vs|哪个好|横评)/i.test(text)) return 'comparison';
    if (/(案例|复盘|实战|show hn)/i.test(text)) return 'case_analysis';
    if (/(观点|判断|趋势|预测)/i.test(text)) return 'insight';
    return 'news_analysis';
  }

  private inferTopicCluster(result: CrawlResult, analysis: SeedAnalysis) {
    const text = `${result.title} ${result.summary}`.toLowerCase();
    const matchedKeyword = analysis.keywords.find((keyword) => text.includes(keyword.toLowerCase()));
    return matchedKeyword || analysis.normalizedSeed;
  }

  private buildMaterialSourceFilter(sourceIds: string[]) {
    if (!sourceIds || sourceIds.length === 0) {
      return {};
    }

    return {
      AND: [
        {
          OR: sourceIds.map((sourceId) => ({
            metadata: {
              path: ['retrieval', 'sourceId'],
              equals: sourceId,
            },
          })),
        },
      ],
    };
  }

  private getSourceWeightForPlatform(platform: string) {
    const weightMap: Record<string, number> = {
      '36Kr': 90,
      HackerNews: 92,
      GitHub: 94,
      Juejin: 82,
      Aibase: 86,
      HubToday: 80,
      Tophub: 72,
      V2EX: 78,
      'X/Twitter': 70,
    };

    return weightMap[platform] || 68;
  }

  private getPlatformName(sourceName: string, config: unknown) {
    const parsed = this.toRecord(config);
    return typeof parsed.platform === 'string' ? parsed.platform : sourceName;
  }

  private toRecord(value: unknown): Record<string, any> {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {};
  }
}
