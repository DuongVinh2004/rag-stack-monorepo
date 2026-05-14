import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';


export class ChatFiltersDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  documentIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  languages?: string[];
}

export class AskQuestionDto {
  @ApiPropertyOptional({ description: 'Knowledge base scope. Required when conversationId is absent.' })
  @IsOptional()
  @IsUUID('4')
  kbId?: string;

  @ApiPropertyOptional({ description: 'Existing conversation to continue.' })
  @IsOptional()
  @IsUUID('4')
  conversationId?: string;

  @ApiProperty({ description: 'Grounded question to ask against the selected KB.' })
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MaxLength(2000)
  question!: string;

  @ApiPropertyOptional({ type: ChatFiltersDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ChatFiltersDto)
  filters?: ChatFiltersDto;
}

export class ListConversationsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  kbId?: string;
}

export class ConversationMessagesQueryDto {
  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}
