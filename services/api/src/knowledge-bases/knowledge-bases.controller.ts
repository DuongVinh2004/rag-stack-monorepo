import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Request, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { KnowledgeBasesService } from './knowledge-bases.service';
import { CreateKnowledgeBaseDto, UpdateKnowledgeBaseDto } from './dto/kb.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AddMemberDto } from './dto/member.dto';

@ApiTags('knowledge-bases')
@ApiBearerAuth()
@Controller('knowledge-bases')
@UseGuards(JwtAuthGuard)
export class KnowledgeBasesController {
  constructor(private readonly kbService: KnowledgeBasesService) {}

  @ApiOperation({ summary: 'Create a new knowledge base' })
  @Post()
  create(@Request() req: any, @Body() dto: CreateKnowledgeBaseDto) {
    return this.kbService.create(req.user, dto);
  }

  @ApiOperation({ summary: 'Find all viewable knowledge bases' })
  @Get()
  findAll(@Request() req: any) {
    return this.kbService.findAll(req.user);
  }

  @ApiOperation({ summary: 'Get details of a specific knowledge base' })
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.kbService.findOne(id, req.user);
  }

  @ApiOperation({ summary: 'Update a knowledge base (Owner/Editor)' })
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Request() req: any, @Body() dto: UpdateKnowledgeBaseDto) {
    return this.kbService.update(id, req.user, dto);
  }

  @ApiOperation({ summary: 'Delete a knowledge base (Owner only)' })
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.kbService.remove(id, req.user);
  }

  @ApiOperation({ summary: 'Get all members of a knowledge base' })
  @Get(':id/members')
  getMembers(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.kbService.getMembers(id, req.user);
  }

  @ApiOperation({ summary: 'Add or update a member in a knowledge base (Owner only)' })
  @Post(':id/members')
  addMember(@Param('id', ParseUUIDPipe) id: string, @Request() req: any, @Body() dto: AddMemberDto) {
    return this.kbService.addMember(id, req.user, dto);
  }

  @ApiOperation({ summary: 'Remove a member from a knowledge base (Owner only)' })
  @Delete(':id/members/:userId')
  removeMember(@Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) targetUserId: string, @Request() req: any) {
    return this.kbService.removeMember(id, req.user, targetUserId);
  }
}
