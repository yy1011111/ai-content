import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { MaterialsService } from './materials.service';
import { QueryMaterialDto } from './dto/query-material.dto';
import { BatchDeleteDto } from './dto/batch-delete.dto';
import { CollectDto } from './dto/collect.dto';
import { XiaohongshuKeywordCollectDto } from './dto/xiaohongshu-keyword-collect.dto';

@ApiTags('素材管理')
@Controller('materials')
export class MaterialsController {
  constructor(private readonly service: MaterialsService) {}

  @Get()
  @ApiOperation({ summary: '获取素材列表（分页、筛选、排序）' })
  findAll(@Query() query: QueryMaterialDto) {
    return this.service.findAll(query);
  }

  @Get('stats')
  @ApiOperation({ summary: '获取素材统计' })
  getStats() {
    return this.service.getStats();
  }

  @Get(':id')
  @ApiOperation({ summary: '获取单个素材详情' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post('collect')
  @ApiOperation({ summary: '触发素材采集任务' })
  collect(@Body() dto: CollectDto) {
    return this.service.triggerCollect(dto.sourceIds);
  }

  @Post('xiaohongshu/login')
  @ApiOperation({ summary: '打开小红书登录授权窗口' })
  loginXiaohongshu() {
    return this.service.openXiaohongshuLogin();
  }

  @Post('xiaohongshu/keyword-collect')
  @ApiOperation({ summary: '按关键词采集小红书热门笔记参考素材' })
  collectXiaohongshuByKeyword(@Body() dto: XiaohongshuKeywordCollectDto) {
    return this.service.collectXiaohongshuByKeyword(dto.keyword, dto.limit, dto.sort, dto.timeRange);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除素材' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Post('batch-delete')
  @ApiOperation({ summary: '批量删除素材' })
  batchRemove(@Body() dto: BatchDeleteDto) {
    return this.service.batchRemove(dto.ids);
  }
}
