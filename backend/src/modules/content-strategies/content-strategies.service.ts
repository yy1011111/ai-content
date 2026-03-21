import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface ContentStrategyPayload {
  name: string;
  description?: string;
  industry?: string;
  targetAudience: string;
  commercialGoal: string;
  corePainPoints: string;
  writingAngles: string;
  toneAndStyle?: string;
  sourceIds?: string[];
  isDefault?: boolean;
  enabled?: boolean;
}

@Injectable()
export class ContentStrategiesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    await this.ensureDefaultStrategy();
    return this.prisma.contentStrategy.findMany({
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async findOne(id: string) {
    const strategy = await this.prisma.contentStrategy.findUnique({ where: { id } });
    if (!strategy) {
      throw new NotFoundException(`Content strategy with ID ${id} not found`);
    }
    return strategy;
  }

  async getDefaultStrategy() {
    await this.ensureDefaultStrategy();
    const strategy = await this.prisma.contentStrategy.findFirst({
      where: { isDefault: true, enabled: true },
      orderBy: { updatedAt: 'desc' },
    });

    if (!strategy) {
      throw new BadRequestException('没有可用的默认内容策略，请先在“内容策略”中启用一个默认策略');
    }

    return strategy;
  }

  async create(data: ContentStrategyPayload) {
    await this.ensureDefaultStrategy();
    const sourceIds = await this.normalizeSourceIds(data.sourceIds);

    if (data.isDefault) {
      await this.prisma.contentStrategy.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }

    try {
      return await this.prisma.contentStrategy.create({
        data: {
          ...data,
          industry: data.industry || '通用',
          sourceIds,
          enabled: data.enabled ?? true,
        },
      });
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new BadRequestException('内容策略名称必须唯一');
      }
      throw error;
    }
  }

  async update(id: string, data: Partial<ContentStrategyPayload>) {
    const strategy = await this.findOne(id);
    const sourceIds = data.sourceIds === undefined
      ? undefined
      : await this.normalizeSourceIds(data.sourceIds);

    if (data.isDefault) {
      await this.prisma.contentStrategy.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }

    const nextEnabled = data.enabled ?? strategy.enabled;
    const nextIsDefault = data.isDefault ?? strategy.isDefault;
    if (!nextEnabled && nextIsDefault) {
      throw new BadRequestException('默认内容策略不能被禁用，请先切换默认策略');
    }

    try {
      return await this.prisma.contentStrategy.update({
        where: { id },
        data: {
          ...data,
          ...(sourceIds === undefined ? {} : { sourceIds }),
        },
      });
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new BadRequestException('内容策略名称必须唯一');
      }
      throw error;
    }
  }

  async remove(id: string) {
    const strategy = await this.findOne(id);
    if (strategy.isDefault) {
      throw new BadRequestException('默认内容策略不能删除，请先切换默认策略');
    }

    return this.prisma.contentStrategy.delete({ where: { id } });
  }

  async setDefault(id: string) {
    const strategy = await this.findOne(id);
    if (!strategy.enabled) {
      throw new BadRequestException('请先启用该内容策略，再设为默认');
    }

    return this.prisma.$transaction([
      this.prisma.contentStrategy.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      }),
      this.prisma.contentStrategy.update({
        where: { id },
        data: { isDefault: true },
      }),
    ]);
  }

  private async ensureDefaultStrategy() {
    const total = await this.prisma.contentStrategy.count();
    if (total > 0) {
      return;
    }

    await this.prisma.contentStrategy.create({
      data: {
        name: 'AI 增长内容策略',
        description: '面向 AI 工具、数字化转型和一人业务增长的默认内容策略',
        industry: 'AI / 数字化增长',
        targetAudience: '想用 AI 提升效率、获客或打造一人业务的创业者、运营和小团队负责人',
        commercialGoal: '通过内容吸引目标用户，建立专业认知，并进一步转化为咨询、服务、课程或社群成交',
        corePainPoints: '不会选题、内容太空泛、缺少转化钩子、担心被时代淘汰、想用 AI 提升产出但没有可落地方法',
        writingAngles: '趋势解读、痛点拆解、认知反转、实操方法、案例拆解',
        toneAndStyle: '务实、通俗、带结论、强调对普通人的具体价值，避免过度炫技',
        sourceIds: [],
        isDefault: true,
        enabled: true,
      },
    });
  }

  private async normalizeSourceIds(sourceIds?: string[]) {
    const normalized = Array.from(
      new Set(
        (sourceIds || [])
          .map((item) => (typeof item === 'string' ? item.trim() : ''))
          .filter(Boolean),
      ),
    );

    if (normalized.length === 0) {
      return [];
    }

    const count = await this.prisma.source.count({
      where: { id: { in: normalized } },
    });

    if (count !== normalized.length) {
      throw new BadRequestException('部分采集源不存在，请刷新后重试');
    }

    return normalized;
  }
}
