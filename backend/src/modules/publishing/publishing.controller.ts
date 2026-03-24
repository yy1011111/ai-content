import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { PublishingService } from './publishing.service';

@Controller('publishing')
export class PublishingController {
  constructor(private readonly publishingService: PublishingService) {}

  @Get('accounts')
  async getAccounts() {
    return this.publishingService.getAccounts();
  }

  @Post('accounts')
  async createAccount(@Body() dto: any) {
    return this.publishingService.createAccount(dto);
  }

  @Put('accounts/:id')
  async updateAccount(@Param('id') id: string, @Body() dto: any) {
    return this.publishingService.updateAccount(id, dto);
  }

  @Delete('accounts/:id')
  async deleteAccount(@Param('id') id: string) {
    return this.publishingService.deleteAccount(id);
  }

  @Post('accounts/:id/test')
  async testAccountConnection(@Param('id') id: string) {
    return this.publishingService.testAccountConnection(id);
  }

  @Post('accounts/:id/xiaohongshu/login')
  async startXiaohongshuLogin(@Param('id') id: string) {
    return this.publishingService.startXiaohongshuCreatorLogin(id);
  }

  @Get('accounts/:id/xiaohongshu/status')
  async getXiaohongshuStatus(@Param('id') id: string) {
    return this.publishingService.getXiaohongshuCreatorStatus(id);
  }

  @Post('publish')
  async publishArticle(@Body() dto: { articleId: string; accountId: string }) {
    return this.publishingService.publishArticle(dto.articleId, dto.accountId);
  }

  @Get('records/:articleId')
  async getRecords(@Param('articleId') articleId: string) {
    return this.publishingService.getRecordsByArticle(articleId);
  }
}
