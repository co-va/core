import { Body, Controller, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DataTransferService } from './data-transfer.service';
import type { SourceInput } from './source';
type AuthRequest = Request & { auth?: { tenantId: string; platformAccountId: string } };
@Controller('data-transfer')
@UseGuards(JwtAuthGuard)
export class DataTransferController {
  constructor(private readonly transfer: DataTransferService) {}
  @Post('sessions') sessions(@Req() req:AuthRequest){return this.transfer.sessions(req.auth!.tenantId);}
  @Post('cancel') cancel(@Req() req:AuthRequest,@Body() body:{sessionId:string}){return this.transfer.cancel(req.auth!.tenantId,body.sessionId);}
  @Post('inspect') inspect(@Body() body: SourceInput) { return this.transfer.inspect(body); }
  @Post('check') check(@Req() req: AuthRequest, @Body() body: SourceInput) { return this.transfer.run(req.auth!.tenantId, req.auth!.platformAccountId, body, true); }
  @Post('commit') commit(@Req() req: AuthRequest, @Body() body: SourceInput) { return this.transfer.run(req.auth!.tenantId, req.auth!.platformAccountId, body, false); }
  @Post('table') async table(@Body() body: unknown, @Res() response: Response) {
    response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    response.setHeader('Content-Disposition', 'attachment; filename="co-va-data.xlsx"');
    response.send(await this.transfer.workbook(body));
  }
}
