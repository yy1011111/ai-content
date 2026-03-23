import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export const xiaohongshuSortOptions = [
  'general',
  'time_descending',
  'popularity_descending',
  'comment_descending',
  'collect_descending',
] as const;

export const xiaohongshuTimeRangeOptions = ['all', '1d', '7d', '30d'] as const;

export type XiaohongshuSortType = (typeof xiaohongshuSortOptions)[number];
export type XiaohongshuTimeRangeType = (typeof xiaohongshuTimeRangeOptions)[number];

export class XiaohongshuKeywordCollectDto {
  @ApiProperty({ description: '小红书搜索关键词', example: '早春穿搭' })
  @IsString()
  keyword!: string;

  @ApiPropertyOptional({ description: '抓取数量上限，建议 5-20', default: 12 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number = 12;

  @ApiPropertyOptional({
    description: '排序方式',
    enum: xiaohongshuSortOptions,
    default: 'general',
  })
  @IsOptional()
  @IsIn(xiaohongshuSortOptions)
  sort?: XiaohongshuSortType = 'general';

  @ApiPropertyOptional({
    description: '发布时间范围',
    enum: xiaohongshuTimeRangeOptions,
    default: '7d',
  })
  @IsOptional()
  @IsIn(xiaohongshuTimeRangeOptions)
  timeRange?: XiaohongshuTimeRangeType = '7d';
}
