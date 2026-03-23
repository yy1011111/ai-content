import { IsOptional, IsString, IsIn } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class QueryMaterialDto extends PaginationDto {
  @ApiPropertyOptional({ description: '搜索关键词' })
  @IsOptional()
  @IsString()
  keyword?: string;

  @ApiPropertyOptional({ description: '状态筛选', enum: ['unmined', 'mined', 'failed'] })
  @IsOptional()
  @IsIn(['unmined', 'mined', 'failed'])
  status?: string;

  @ApiPropertyOptional({ description: '平台筛选', enum: ['36Kr', 'Juejin', 'Zhihu', 'WeChat', 'Other'] })
  @IsOptional()
  @IsString()
  platform?: string;

  @ApiPropertyOptional({ description: '素材类别筛选，如 xiaohongshu_reference' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: '排序字段', default: 'collectDate' })
  @IsOptional()
  @IsString()
  sortBy?: string = 'collectDate';

  @ApiPropertyOptional({ description: '排序方向', enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}
