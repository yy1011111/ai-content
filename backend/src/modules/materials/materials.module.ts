import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AiModelsModule } from '../ai-models/ai-models.module';
import { StorageModule } from '../storage/storage.module';
import { MaterialsController } from './materials.controller';
import { MaterialsService } from './materials.service';
import { RssCrawlerService } from './crawlers/rss.crawler';
import { CrawlProcessor } from './processors/crawl.processor';
import { CrawlerRegistry } from './crawlers/crawler.registry';
import { JinaReaderService } from './crawlers/jina-reader.service';
import { ImageFilterService } from './image-filter.service';
import { AibaseCrawler } from './crawlers/aibase.crawler';
import { GithubCrawler } from './crawlers/github.crawler';
import { GrokCrawler } from './crawlers/grok.crawler';
import { HackerNewsCrawler } from './crawlers/hackernews.crawler';
import { HubtodayCrawler } from './crawlers/hubtoday.crawler';
import { JuejinCrawler } from './crawlers/juejin.crawler';
import { Kr36Crawler } from './crawlers/kr36.crawler';
import { TophubCrawler } from './crawlers/tophub.crawler';
import { V2exCrawler } from './crawlers/v2ex.crawler';
import { XiaohongshuKeywordCrawlerService } from './crawlers/xiaohongshu-keyword-crawler.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'crawl-queue' }),
    AiModelsModule, // Grok 采集器需要 AI 相关服务
    StorageModule,  // 图片上传到七牛云
  ],
  controllers: [MaterialsController],
  providers: [
    MaterialsService,
    RssCrawlerService,
    CrawlProcessor,
    CrawlerRegistry,
    JinaReaderService,
    ImageFilterService,
    AibaseCrawler,
    GithubCrawler,
    GrokCrawler,
    HackerNewsCrawler,
    HubtodayCrawler,
    JuejinCrawler,
    Kr36Crawler,
    TophubCrawler,
    V2exCrawler,
    XiaohongshuKeywordCrawlerService,
  ],
  exports: [MaterialsService, JinaReaderService, ImageFilterService, RssCrawlerService, CrawlerRegistry, XiaohongshuKeywordCrawlerService],
})
export class MaterialsModule {}
