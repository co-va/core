import { Body, Controller, Get, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DepositExcelService } from './deposit-excel.service';

type AuthenticatedRequest = Request & { auth?: { tenantId:string; platformAccountId:string; role:string } };
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
function send(response:Response,buffer:Buffer,filename:string) {
  response.setHeader('Content-Type',XLSX);
  response.setHeader('Content-Disposition','attachment; filename="'+filename+'"');
  response.send(buffer);
}
@Controller('loyalty/deposits/excel')
@UseGuards(JwtAuthGuard)
export class DepositExcelController {
  constructor(private readonly excel:DepositExcelService) {}
  @Get('template')
  async template(@Res() response:Response) {
    send(response,await this.excel.template(),'deposits-template.xlsx');
  }
  @Get('export')
  async export(@Req() request:AuthenticatedRequest,@Query('from') from='',
    @Query('to') to='',@Res() response:Response) {
    send(response,await this.excel.export(request.auth!.tenantId,from,to),'deposits.xlsx');
  }
  @Post('preview')
  preview(@Req() request:AuthenticatedRequest,@Body() body:unknown){
    return this.excel.preview(request.auth!.tenantId,body);
  }
  @Post('apply')
  apply(@Req() request:AuthenticatedRequest,@Body() body:unknown){
    return this.excel.apply(request.auth!.tenantId,body);
  }
}
