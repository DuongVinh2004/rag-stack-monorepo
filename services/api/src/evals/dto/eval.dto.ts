import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EvalCaseStatus } from '@prisma/client';

export class CreateEvalCaseDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  question!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  expectedAnswer?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  expectedSourceDocumentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  expectedSourceHint?: string;

  @ApiPropertyOptional({
    default: 'general',
    description:
      'Recommended values: general, single_source_factual, multi_source_synthesis, version_recency_sensitive, ambiguous_keyword_overlap, out_of_scope, insufficient_data, refusal, access_sensitive.',
  })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ default: 'medium' })
  @IsOptional()
  @IsString()
  difficulty?: string;

  @ApiPropertyOptional({ enum: EvalCaseStatus, default: EvalCaseStatus.ACTIVE })
  @IsOptional()
  status?: EvalCaseStatus;
}

export class CreateEvalSetDto {
  @ApiProperty()
  @IsUUID('4')
  kbId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ type: [CreateEvalCaseDto] })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CreateEvalCaseDto)
  cases!: CreateEvalCaseDto[];
}

export class ListEvalSetsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  kbId?: string;
}

export class EvalRetrievalConfigDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  candidateLimit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  groundingLimit?: number;
}

export class CreateEvalRunDto {
  @ApiProperty()
  @IsUUID('4')
  evalSetId!: string;

  @ApiPropertyOptional({ type: EvalRetrievalConfigDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => EvalRetrievalConfigDto)
  retrievalConfig?: EvalRetrievalConfigDto;
}

export class ListEvalRunsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  evalSetId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  kbId?: string;
}
