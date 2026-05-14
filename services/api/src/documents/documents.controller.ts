import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentsService } from './documents.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ListDocumentsQueryDto, UploadDocumentDto } from './dto/document.dto';
import { getUploadMaxBytes } from '../config/runtime-config';

@ApiTags('documents')
@ApiBearerAuth()
@Controller('documents')
@UseGuards(JwtAuthGuard)
export class DocumentsController {
  constructor(private docsService: DocumentsService) {}

  @ApiOperation({ summary: 'List documents for a specific knowledge base' })
  @Get()
  async findAll(@Request() req: any, @Query() query: ListDocumentsQueryDto) {
    return this.docsService.findAll(query.kbId, req.user);
  }

  @ApiOperation({ summary: 'Upload a document into a knowledge base' })
  @ApiConsumes('multipart/form-data')
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: getUploadMaxBytes(),
      },
    }),
  )
  async upload(
    @Request() req: any,
    @Body() dto: UploadDocumentDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.docsService.uploadDocument(req.user, dto.kbId, dto.name, file, req.correlationId);
  }

  @ApiOperation({ summary: 'Get details and ingestion status of a specific document' })
  @Get(':id')
  async findOne(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.docsService.findOne(id, req.user);
  }

  @ApiOperation({ summary: 'Requeue ingestion for the latest document version' })
  @Post(':id/reindex')
  async reindex(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.docsService.reindexDocument(id, req.user, req.correlationId);
  }
}
