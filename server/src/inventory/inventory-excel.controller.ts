import { Body, Controller, Get, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { InventoryExcelService } from './inventory-excel-final.service';

type AuthenticatedRequest = Request & {
  auth?: { platformAccountId: string; tenantId: string; role: string };
};

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function sendWorkbook(response: Response, buffer: Buffer, filename: string) {
  response.setHeader('Content-Type', XLSX_TYPE);
  response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  response.send(buffer);
}

@Controller('inventory/excel')
@UseGuards(JwtAuthGuard)
export class InventoryExcelController {
  constructor(private readonly excel: InventoryExcelService) {}

  @Get('items/export')
  async itemExport(@Req() request: AuthenticatedRequest, @Res() response: Response) {
    sendWorkbook(response, await this.excel.stockExport(request.auth!.tenantId), 'ostatki.xlsx');
  }

  @Get('movements/export')
  async movementExport(
    @Req() request: AuthenticatedRequest,
    @Query('from') from: string,
    @Query('to') to: string,
    @Res() response: Response,
  ) {
    const suffix = [from, to].filter(Boolean).join('_');
    sendWorkbook(
      response,
      await this.excel.movementExport(request.auth!.tenantId, from, to),
      `dvizheniya${suffix ? `_${suffix}` : ''}.xlsx`,
    );
  }

  @Post('orders/export')
  async orderExport(
    @Req() request: AuthenticatedRequest,
    @Body() body: { selections?: unknown[] },
    @Res() response: Response,
  ) {
    sendWorkbook(response, await this.excel.orderExport(request.auth!.tenantId, body?.selections), 'zakaz.xlsx');
  }
}
