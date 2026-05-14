import { Transform } from 'class-transformer';
import { IsString, IsOptional, IsEnum, MaxLength } from 'class-validator';
import { KbVisibility } from '@prisma/client';

export class CreateKnowledgeBaseDto {
  @IsString()
  @MaxLength(120)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name!: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  description?: string;

  @IsEnum(KbVisibility)
  @IsOptional()
  visibility?: KbVisibility;
}

export class UpdateKnowledgeBaseDto {
  @IsString()
  @IsOptional()
  @MaxLength(120)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  description?: string;

  @IsEnum(KbVisibility)
  @IsOptional()
  visibility?: KbVisibility;
}
