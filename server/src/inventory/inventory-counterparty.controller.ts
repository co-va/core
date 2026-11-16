import { BadRequestException, Body, Controller, Get, Param, Post, Put, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { InventoryCounterpartyService, type SupplierFile } from './inventory-counterparty.service';

type Authorized = Request & { auth?: { tenantId: string } };

@Controller('inventory/counterparties')
@UseGuards(JwtAuthGuard)
export class InventoryCounterpartyController {
  constructor(private readonly companies: InventoryCounterpartyService) {}

  @Get()
  list(@Req() request: Authorized) { return this.companies.list(request.auth!.tenantId); }

  @Post()
  create(@Req() request: Authorized, @Body() body: Record<string, unknown>) {
    return this.companies.create(request.auth!.tenantId, body);
  }

  @Get('template/xlsx')
  async template(@Req() request: Authorized, @Res() response: Response) {
    const buffer = await this.companies.template(request.auth!.tenantId);
    response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    response.setHeader('Content-Disposition', 'attachment; filename="price-list-template.xlsx"');
    response.send(buffer);
  }

  @Put(':id')
  update(@Req() request: Authorized, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.companies.update(request.auth!.tenantId, id, body);
  }

  @Get(':id/catalog')
  catalog(@Req() request: Authorized, @Param('id') id: string,
    @Query('search') search = '', @Query('skip') skip = '0') {
    return this.companies.catalog(request.auth!.tenantId, id, search, Number(skip));
  }

  @Post(':id/pricelists/preview')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024 } }))
  preview(@Req() request: Authorized, @Param('id') id: string, @UploadedFile() file: SupplierFile) {
    if (!file) throw new BadRequestException('Выберите файл Excel или PDF');
    return this.companies.preview(request.auth!.tenantId, id, file);
  }

  @Post(':id/pricelists')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024 } }))
  import(@Req() request: Authorized, @Param('id') id: string, @UploadedFile() file: SupplierFile,
    @Body('confirmedPdf') confirmedPdf?: string) {
    if (!file) throw new BadRequestException('Выберите файл Excel или PDF');
    return this.companies.import(request.auth!.tenantId, id, file, confirmedPdf === 'true');
  }

  @Get(':id/pricelists/:listId/download')
  async download(@Req() request: Authorized, @Param('id') id: string, @Param('listId') listId: string,
    @Res() response: Response) {
    const value = await this.companies.original(request.auth!.tenantId, id, listId);
    response.setHeader('Content-Type', value.mime);
    response.setHeader('Content-Disposition', 'attachment; filename="supplier-price-list.' + (value.mime === 'application/pdf' ? 'pdf' : 'xlsx') + '"');
    response.send(value.buffer);
  }

  @Post(':id/link-item')
  linkCompany(@Req() request: Authorized, @Param('id') id: string,
    @Body() body: { itemId?: string }) {
    if (!body?.itemId) throw new BadRequestException('Выберите рабочую карточку товара');
    return this.companies.linkCompany(request.auth!.tenantId, id, body.itemId);
  }

  @Post(':id/catalog/:rowId/link')
  link(@Req() request: Authorized, @Param('id') id: string, @Param('rowId') rowId: string,
    @Body() body: { itemId?: string }) {
    if (!body?.itemId) throw new BadRequestException('Выберите рабочую карточку товара');
    return this.companies.link(request.auth!.tenantId, id, rowId, body.itemId);
  }
}
