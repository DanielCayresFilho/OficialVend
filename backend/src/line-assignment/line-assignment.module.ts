import { Module, forwardRef } from '@nestjs/common';
import { LineAssignmentService } from './line-assignment.service';
import { PrismaService } from '../prisma.service';
import { LinesModule } from '../lines/lines.module';
import { ControlPanelModule } from '../control-panel/control-panel.module';
import { LoggerModule } from '../logger/logger.module';

@Module({
  imports: [
    forwardRef(() => LinesModule),
    ControlPanelModule,
    LoggerModule,
  ],
  providers: [LineAssignmentService, PrismaService],
  exports: [LineAssignmentService],
})
export class LineAssignmentModule {}

