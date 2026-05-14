import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UploadDocumentDto {
  @ApiProperty({ description: 'The UUID of the target Knowledge Base' })
  @IsUUID()
  @IsNotEmpty()
  kbId!: string;

  @ApiProperty({ description: 'The original name of the document' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name!: string;
}

export class ListDocumentsQueryDto {
  @ApiProperty({ description: 'The UUID of the target Knowledge Base' })
  @IsUUID()
  @IsNotEmpty()
  kbId!: string;
}
