import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ChatService } from './chat.service';
import {
  AskQuestionDto,
  ConversationMessagesQueryDto,
  ListConversationsQueryDto,
} from './dto/chat.dto';

@ApiTags('chat')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @ApiOperation({ summary: 'Ask a grounded question against a knowledge base' })
  @Post('chat/ask')
  async ask(@Request() req: any, @Body() dto: AskQuestionDto) {
    return this.chatService.ask(req.user, dto, req.correlationId);
  }

  @ApiOperation({ summary: 'List conversations visible to the current user' })
  @Get('conversations')
  async listConversations(
    @Request() req: any,
    @Query() query: ListConversationsQueryDto,
  ) {
    return this.chatService.listConversations(req.user, query.kbId);
  }

  @ApiOperation({ summary: 'Get a conversation and recent messages' })
  @Get('conversations/:id')
  async getConversation(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.chatService.getConversation(req.user, id);
  }

  @ApiOperation({ summary: 'List messages for a conversation' })
  @Get('conversations/:id/messages')
  async getConversationMessages(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ConversationMessagesQueryDto,
  ) {
    return this.chatService.getConversationMessages(req.user, id, query.limit);
  }
}
