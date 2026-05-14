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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { EvalsService } from './evals.service';
import {
  CreateEvalRunDto,
  CreateEvalSetDto,
  ListEvalRunsQueryDto,
  ListEvalSetsQueryDto,
} from './dto/eval.dto';

@ApiTags('evals')
@ApiBearerAuth()
@Controller('evals')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(SystemRole.SUPER_ADMIN, SystemRole.OPERATOR)
export class EvalsController {
  constructor(private readonly evals: EvalsService) {}

  @ApiOperation({ summary: 'List eval sets for operators/admins' })
  @Get('sets')
  listSets(@Request() req: any, @Query() query: ListEvalSetsQueryDto) {
    return this.evals.listEvalSets(req.user, query);
  }

  @ApiOperation({ summary: 'Create an eval set with cases' })
  @Post('sets')
  createSet(@Request() req: any, @Body() dto: CreateEvalSetDto) {
    return this.evals.createEvalSet(req.user, dto);
  }

  @ApiOperation({ summary: 'Run an eval set through the real retrieval/chat pipeline' })
  @Post('runs')
  runSet(@Request() req: any, @Body() dto: CreateEvalRunDto) {
    return this.evals.runEvalSet(req.user, dto, req.correlationId);
  }

  @ApiOperation({ summary: 'List eval runs' })
  @Get('runs')
  listRuns(@Request() req: any, @Query() query: ListEvalRunsQueryDto) {
    return this.evals.listEvalRuns(req.user, query);
  }

  @ApiOperation({ summary: 'Get eval run detail with regression comparison' })
  @Get('runs/:id')
  getRun(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.evals.getEvalRun(req.user, id);
  }
}
