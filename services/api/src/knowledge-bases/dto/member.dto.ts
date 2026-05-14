import { IsEnum, IsUUID } from 'class-validator';
import { KbRole } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';

export class AddMemberDto {
  @ApiProperty({ description: 'The UUID of the user to add' })
  @IsUUID()
  userId!: string;

  @ApiProperty({ enum: KbRole, description: 'The role to assign' })
  @IsEnum(KbRole)
  role!: KbRole;
}
