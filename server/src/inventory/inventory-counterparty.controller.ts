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

  // Global import first resolves the supplier, then saves its catalog in one transaction.
  // It never silently assigns a supplier's products to an unrelated account.
  @Post('import/preview')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024 } }))
  previewGlobal(@Req() request: Authorized, @UploadedFile() file: SupplierFile) {
    if (!file) throw new BadRequestException('Выберите Excel или PDF.');
    return this.companies.previewGlobal(request.auth!.tenantId, file);
  }

  @Post('import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024 } }))
  importGlobal(@Req() request: Authorized, @UploadedFile() file: SupplierFile,
    @Body('counterpartyId') counterpartyId?: string, @Body('name') name?: string,
    @Body('confirmedPdf') confirmedPdf?: string) {
    if (!file) throw new BadRequestException('Выберите Excel или PDF.');
    return this.companies.importGlobal(request.auth!.tenantId, file,
      { counterpartyId, name, confirmedPdf: confirmedPdf === 'true' });
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
    @Query('search') search = '', @Query('skip') skip = '0',
    @Query('excluded') excluded = 'false', @Query('take') take = '100') {
    return this.companies.catalog(request.auth!.tenantId, id, search, Number(skip), excluded === 'true', Number(take));
  }

  @Get(':id/catalog/link-status')
  linkStatuses(@Req() request: Authorized, @Param('id') id: string) {
    return this.companies.linkStatuses(request.auth!.tenantId, id);
  }

  @Put(':id/catalog/:rowId')
  editCatalogRow(@Req() request: Authorized, @Param('id') id: string,
    @Param('rowId') rowId: string, @Body() body: Record<string, unknown>) {
    return this.companies.editCatalogRow(request.auth!.tenantId, id, rowId, body);
  }

  @Post(':id/catalog/prices')
  changeCatalogPrices(@Req() request: Authorized, @Param('id') id: string,
    @Body() body: { rowIds?: string[]; mode?: string; value?: number }) {
    return this.companies.changeCatalogPrices(request.auth!.tenantId, id, body);
  }

  @Post(':id/catalog/selection')
  selectCatalogRows(@Req() request: Authorized, @Param('id') id: string,
    @Body() body: { rowIds?: string[]; excluded?: boolean }) {
    return this.companies.setExcluded(request.auth!.tenantId, id, body);
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
    @Body() body: { itemId?: string; unitsPerOffer?: number }) {
    if (!body?.itemId) throw new BadRequestException('Выберите рабочую карточку товара');
    return this.companies.link(request.auth!.tenantId, id, rowId, body.itemId, body.unitsPerOffer);
  }
}
