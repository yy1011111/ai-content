import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { CronJob } from 'cron';
import { MaterialsService } from '../materials/materials.service';
import { TopicsService } from '../topics/topics.service';
import { TopicMiningService } from '../topics/topic-mining.service';
import { ArticlesService } from '../articles/articles.service';
import { PublishingService } from '../publishing/publishing.service';

export interface UpdateScheduleDto {
    cronExpr: string;
    enabled: boolean;
    config?: any;
}

type CreateContentScheduleConfig = {
    limit?: number;
    minScore?: number;
    contentType?: 'article' | 'xiaohongshu';
    autoPublish?: boolean;
    publishAccountId?: string;
};

@Injectable()
export class SchedulesService implements OnModuleInit {
    private readonly logger = new Logger(SchedulesService.name);

    // 支持的三种任务类型
    private readonly supportedTaskTypes = [
        'collect_materials',
        'mine_materials',
        'create_articles',
    ];

    constructor(
        private readonly prisma: PrismaService,
        private readonly schedulerRegistry: SchedulerRegistry,
        private readonly materialsService: MaterialsService,
        private readonly topicsService: TopicsService,
        private readonly topicMiningService: TopicMiningService,
        private readonly articlesService: ArticlesService,
        private readonly publishingService: PublishingService,
    ) { }

    async onModuleInit() {
        await this.initDefaultConfigs();
        await this.loadAllSchedules();
    }

    // 初始化数据库中不存在的默认配置
    private async initDefaultConfigs() {
        const defaultConfigs = [
            { taskType: 'collect_materials', cronExpr: '0 * * * *', enabled: false }, // 每小时
            { taskType: 'mine_materials', cronExpr: '30 * * * *', enabled: false }, // 每小时的30分
            { taskType: 'create_articles', cronExpr: '0 0 * * *', enabled: false }, // 每天0点
        ];

        for (const conf of defaultConfigs) {
            const exists = await this.prisma.scheduleConfig.findUnique({
                where: { taskType: conf.taskType },
            });
            if (!exists) {
                await this.prisma.scheduleConfig.create({
                    data: {
                        taskType: conf.taskType,
                        cronExpr: conf.cronExpr,
                        enabled: conf.enabled,
                    },
                });
                this.logger.log(`Initialize default schedule config for ${conf.taskType}`);
            }
        }
    }

    // 加载所有启用的任务到内存
    async loadAllSchedules() {
        const configs = await this.prisma.scheduleConfig.findMany({
            where: { enabled: true },
        });

        for (const config of configs) {
            this.addCronJob(config.taskType, config.cronExpr);
        }
    }

    // 获取所有任务配置
    async getAllSchedules() {
        return this.prisma.scheduleConfig.findMany({
            orderBy: { taskType: 'asc' },
        });
    }

    // 更新配置并可能重启任务
    async updateSchedule(taskType: string, dto: UpdateScheduleDto) {
        if (!this.supportedTaskTypes.includes(taskType)) {
            throw new Error(`Unsupported task type: ${taskType}`);
        }

        const updated = await this.prisma.scheduleConfig.update({
            where: { taskType },
            data: {
                cronExpr: dto.cronExpr,
                enabled: dto.enabled,
                config: dto.config,
            },
        });

        // 无论启用与否，先尝试停止/删除旧的 CronJob
        this.removeCronJob(taskType);

        // 如果启用，则注册新的 CronJob
        if (updated.enabled) {
            this.addCronJob(taskType, updated.cronExpr);
        }

        return updated;
    }

    // 添加并启动 CronJob
    private addCronJob(taskType: string, cronExpr: string) {
        try {
            const job = new CronJob(cronExpr, async () => {
                this.logger.log(`CronJob executed for ${taskType}`);
                await this.executeTask(taskType);
            });

            this.schedulerRegistry.addCronJob(taskType, job);
            job.start();
            this.logger.log(`CronJob for ${taskType} added and started with expression ${cronExpr}`);
        } catch (e) {
            this.logger.error(`Failed to add CronJob for ${taskType}: ${e.message}`);
            // 可以在此处修改数据库状态为禁用或记录到错误日志
        }
    }

    // 移除 CronJob
    private removeCronJob(taskType: string) {
        try {
            if (this.schedulerRegistry.doesExist('cron', taskType)) {
                this.schedulerRegistry.deleteCronJob(taskType);
                this.logger.log(`CronJob for ${taskType} stopped and removed`);
            }
        } catch (e) {
            this.logger.warn(`Error removing CronJob ${taskType}: ${e.message}`);
        }
    }

    // 执行对应的任务逻辑
    private async executeTask(taskType: string) {
        try {
            // 获取最新配置可能包含如阀值、批量限制等
            const sc = await this.prisma.scheduleConfig.findUnique({ where: { taskType } });
            const userConfig = (sc?.config as any) || {};

            switch (taskType) {
                case 'collect_materials':
                    this.logger.log('Executing automated material collection...');
                    await this.materialsService.triggerCollect();
                    break;
                case 'mine_materials':
                    this.logger.log('Executing automated material mining cluster pipeline...');
                    // 执行一小时内的积累素材的最新挖掘（内部自带并发与安全限制）
                    await this.topicMiningService.mineTopics(userConfig.hours || 72);
                    break;
                case 'create_articles':
                    this.logger.log('Executing automated article generation batch...');
                    // 从最新生成的符合最低分的高分话题中捞取指定篇数
                    const createConfig = userConfig as CreateContentScheduleConfig;
                    const targetContentType = createConfig.contentType === 'xiaohongshu' ? 'xiaohongshu' : 'article';
                    const generationResult = await this.articlesService.batchGenerateDrafts(
                        createConfig.limit || 5,
                        createConfig.minScore || 80,
                        targetContentType,
                    );
                    if (createConfig.autoPublish) {
                        if (targetContentType !== 'article') {
                            this.logger.warn('自动生成任务当前仅支持公众号文章自动发布，小红书内容将保留为草稿。');
                            await this.prisma.systemLog.create({
                                data: {
                                    level: 'warning',
                                    content: '自动生成任务当前仅支持公众号文章自动发布，小红书内容将保留为草稿。',
                                },
                            });
                            break;
                        }

                        if (!createConfig.publishAccountId) {
                            this.logger.warn('自动生成文章任务已开启自动发布，但未选择发布账号，已跳过自动发布。');
                            await this.prisma.systemLog.create({
                                data: {
                                    level: 'warning',
                                    content: '自动生成文章任务已开启自动发布，但未选择发布账号，已跳过自动发布。',
                                },
                            });
                            break;
                        }

                        for (const articleId of generationResult.generatedArticleIds || []) {
                            try {
                                await this.publishingService.publishArticle(articleId, createConfig.publishAccountId);
                            } catch (publishError) {
                                const message = publishError instanceof Error ? publishError.message : '未知发布错误';
                                this.logger.error(`自动发布文章失败 [articleId: ${articleId}]: ${message}`);
                                await this.prisma.systemLog.create({
                                    data: {
                                        level: 'error',
                                        content: `自动发布文章失败 [articleId: ${articleId}]: ${message}`,
                                    },
                                });
                            }
                        }
                    }
                    break;
            }

            // 更新最后运行时间
            await this.prisma.scheduleConfig.update({
                where: { taskType },
                data: { lastRunTime: new Date() },
            });

        } catch (err) {
            this.logger.error(`Error executing scheduled task '${taskType}': ${err.message}`);
            await this.prisma.systemLog.create({
                data: {
                    level: 'error',
                    content: `Failed to execute scheduled task ${taskType}: ${err.message}`,
                },
            });
        }
    }
}
