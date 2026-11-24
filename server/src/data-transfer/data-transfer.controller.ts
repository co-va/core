import { Body, Controller, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DataTransferService } from './data-transfer.service';
import { ContactImportService } from './contact-import.service';
import type { SourceInput } from './source';
type AuthRequest = Request & { auth?: { tenantId: string; platformAccountId: string } };
@Controller('data-transfer')
@UseGuards(JwtAuthGuard)
export class DataTransferController {
  constructor(private readonly transfer: DataTransferService,
    private readonly contacts: ContactImportService) {}
  @Post('contacts/batches') contactBatches(@Req() req:AuthRequest) {
    return this.contacts.list(req.auth!.tenantId);
  }
  @Post('contacts/start') startContacts(@Req() req:AuthRequest,@Body() body:SourceInput) {
    return this.contacts.create(req.auth!.tenantId,req.auth!.platformAccountId,body);
  }
  @Post('contacts/detail') contactDetail(@Req() req:AuthRequest,@Body() body:{batchId:string}) {
    return this.contacts.detail(req.auth!.tenantId,body.batchId);
  }
  @Post('contacts/advance') advanceContacts(@Req() req:AuthRequest,
    @Body() body:{batchId:string;limit?:number}) {
    return this.contacts.advance(req.auth!.tenantId,body.batchId,body.limit);
  }
  @Post('contacts/decide') decideContacts(@Req() req:AuthRequest,@Body() body:any) {
    return this.contacts.decide(req.auth!.tenantId,body.batchId,body);
  }
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
