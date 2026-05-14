import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { FailedJobsQueryDto } from './dto/ops.dto';
import { OpsService } from './ops.service';

@ApiTags('ops')
@ApiBearerAuth()
@Controller('ops')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(SystemRole.SUPER_ADMIN, SystemRole.OPERATOR)
export class OpsController {
  constructor(private readonly ops: OpsService) {}

  @ApiOperation({ summary: 'List failed or dead-letter ingest jobs' })
  @Get('jobs/failed')
  getFailedJobs(@Request() req: any, @Query() query: FailedJobsQueryDto) {
    return this.ops.listFailedJobs(req.user, query.limit);
  }

  @ApiOperation({ summary: 'Retry a failed or dead-letter ingest job' })
  @Post('jobs/:id/retry')
  retryJob(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.ops.retryIngestJob(id, req.user, req.correlationId);
  }

  @ApiOperation({ summary: 'Get current operator metrics snapshot' })
  @Get('metrics')
  getMetrics(@Request() req: any) {
    return this.ops.getMetricsSnapshot(req.user);
  }
}
