import { Module } from '@nestjs/common';
import { PublishingService } from './publishing.service';
import { PublishingController } from './publishing.controller';
import { WechatPublisherService } from './wechat-publisher/wechat-publisher.service';
import { XiaohongshuPublisherService } from './xiaohongshu-publisher.service';

@Module({
  providers: [PublishingService, WechatPublisherService, XiaohongshuPublisherService],
  controllers: [PublishingController],
  exports: [PublishingService],
})
export class PublishingModule {}
