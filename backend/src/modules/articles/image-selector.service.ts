import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AiClientService } from '../ai-models/ai-client.service';
import { DefaultModelsService } from '../ai-models/default-models.service';

@Injectable()
export class ImageSelectorService {
  private readonly logger = new Logger(ImageSelectorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiClient: AiClientService,
    private readonly defaultModels: DefaultModelsService,
  ) {}

  async selectImage(
    type: 'real' | 'ai',
    prompt: string,
    materials: { id: string; imageUrl?: string | null; originalImageUrl?: string | null; hasImage?: boolean; title?: string; content?: string | null }[],
    imageStyle?: string,
    imageParams?: { ratio?: string; resolution?: string },
  ): Promise<string | null> {
    if (type === 'real') {
      const realImage = await this.findRelevantImage(prompt, materials);
      if (realImage) {
        this.logger.log(`使用真实图片: ${realImage}`);
        return realImage;
      }

      this.logger.log('未找到合适的真实图片，降级使用 AI 生成');
    }

    return this.generateAiImage(prompt, imageStyle, imageParams);
  }

  async generateCoverImage(
    prompt: string,
    imageStyle?: string,
    imageParams?: { ratio?: string; resolution?: string },
  ): Promise<string | null> {
    return this.generateAiImage(prompt, imageStyle, imageParams);
  }

  private async findRelevantImage(
    prompt: string,
    materials: { id: string; imageUrl?: string | null; originalImageUrl?: string | null; hasImage?: boolean; title?: string; content?: string | null }[],
  ): Promise<string | null> {
    const materialsWithImages = materials
      .filter((material) => material.hasImage && (material.imageUrl || material.originalImageUrl))
      .map((material) => ({
        ...material,
        resolvedImageUrl: material.imageUrl || material.originalImageUrl || null,
      }));

    if (materialsWithImages.length === 0) {
      return null;
    }

    const promptKeywords = this.extractKeywords(prompt.toLowerCase());

    const scored = materialsWithImages.map((material) => {
      const titleKeywords = this.extractKeywords((material.title || '').toLowerCase());
      const contentKeywords = this.extractKeywords((material.content || '').toLowerCase().slice(0, 500));
      const titleScore = this.calculateOverlap(promptKeywords, titleKeywords);
      const contentScore = this.calculateOverlap(promptKeywords, contentKeywords) * 0.5;

      return {
        imageUrl: material.resolvedImageUrl!,
        score: titleScore + contentScore,
      };
    });

    scored.sort((a, b) => b.score - a.score);

    if (scored[0] && scored[0].score > 0) {
      return scored[0].imageUrl;
    }

    const randomIndex = Math.floor(Math.random() * materialsWithImages.length);
    return materialsWithImages[randomIndex].resolvedImageUrl || null;
  }

  private extractKeywords(text: string): string[] {
    const stopWords = new Set([
      '的', '是', '在', '和', '了', '有', '我', '你', '他', '她', '这', '那',
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare',
      'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as',
      'and', 'or', 'but', 'if', 'then', 'else', 'when', 'where', 'which',
    ]);

    const words = text
      .replace(/[^\w\u4e00-\u9fa5]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 1 && !stopWords.has(word));

    return [...new Set(words)];
  }

  private calculateOverlap(set1: string[], set2: string[]): number {
    if (set1.length === 0 || set2.length === 0) {
      return 0;
    }

    const set2Map = new Set(set2);
    const overlap = set1.filter((word) => set2Map.has(word)).length;
    return overlap / Math.sqrt(set1.length * set2.length);
  }

  private async generateAiImage(
    prompt: string,
    imageStyle?: string,
    imageParams?: { ratio?: string; resolution?: string },
  ): Promise<string | null> {
    const config = await this.defaultModels.getDefaults();
    if (!config.imageCreation) {
      this.logger.warn('未配置图片创作模型，无法生成图片');
      throw new Error('未配置图片创作模型');
    }

    const hardRules = [
      '只生成纯视觉画面，不要出现任何文字、中文、英文、数字或标题排版。',
      '严禁出现 logo、品牌名、水印、角标、二维码、按钮、界面元素、截图元素、海报文案。',
      '不要做成带标题的封面海报，不要做成小红书截图感、贴纸文案感或宣传海报感。',
      '如果是人物或场景图，优先自然、真实、克制、干净，适合内容配图，不要夸张特效。',
    ].join('');

    let finalPrompt = `${prompt}。${hardRules}`;
    if (imageStyle) {
      finalPrompt = `${imageStyle}。画面主体要求：${prompt}。${hardRules}`;
    }

    try {
      const url = await this.aiClient.generateImage(config.imageCreation, finalPrompt, {
        size: imageParams?.ratio ? undefined : '1024x1024',
        ratio: imageParams?.ratio,
        resolution: imageParams?.resolution,
      });

      if (!url) {
        throw new Error('图片模型未返回可用图片地址');
      }

      this.logger.log(`AI 图片生成成功: ${url}`);
      return url;
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      this.logger.error(`AI 图片生成失败: ${message}`);
      throw new Error(message);
    }
  }

  async getAvailableImages(topicId: string): Promise<string[]> {
    const topic = await this.prisma.topic.findUnique({
      where: { id: topicId },
      include: {
        materials: {
          include: {
            material: {
              select: {
                id: true,
                imageUrl: true,
                originalImageUrl: true,
                hasImage: true,
                title: true,
              },
            },
          },
        },
      },
    });

    if (!topic) {
      return [];
    }

    return topic.materials
      .filter((item) => item.material.hasImage && (item.material.imageUrl || item.material.originalImageUrl))
      .map((item) => item.material.imageUrl || item.material.originalImageUrl!)
      .filter(Boolean);
  }
}
