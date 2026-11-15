import { Injectable, NotFoundException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../prisma.service';

const FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
const COLUMN_TITLES = ['Артикул', 'Наименование', 'Количество, шт.'];

type SupplierLine = { article: string; name: string; packages: number };
type SupplierOrder = { orderId: string; createdAt: Date; lines: SupplierLine[] };

function documentNumber(id: string): string {
  return String(id || '').replaceAll('-', '').slice(0, 12).toUpperCase();
}

@Injectable()
export class InventoryOrderExportService {
  constructor(private readonly prisma: PrismaService) {}

  // Read the PERSISTED document, in its original line order, within the
  // authenticated tenant. No suggestions, balances, stock positions or prices.
  async supplierDocument(tenantId: string, orderId: string): Promise<SupplierOrder> {
    const order = await this.prisma.inventoryPurchaseOrder.findFirst({
      where: { tenantId, orderId },
      include: { lines: { orderBy: { position: 'asc' } } },
    });
    if (!order) throw new NotFoundException('Заказ не найден');
    const ids = [...new Set(order.lines.map(line => line.itemId))];
    const items = ids.length ? await this.prisma.inventoryItem.findMany({
      where: { tenantId, itemId: { in: ids } },
      select: { itemId: true, sku: true },
    }) : [];
    const articles = new Map(items.map(item => [item.itemId, String(item.sku || '').trim()]));
    return {
      orderId: order.orderId,
      createdAt: order.createdAt,
      lines: order.lines.map(line => ({
        article: articles.get(line.itemId) || '',
        name: String(line.name || ''),
        packages: Number(line.packages),
      })),
    };
  }

  async excel(order: SupplierOrder): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Заказ');
    sheet.columns = [
      { header: COLUMN_TITLES[0], key: 'article', width: 22 },
      { header: COLUMN_TITLES[1], key: 'name', width: 43 },
      { header: COLUMN_TITLES[2], key: 'packages', width: 20 },
    ];
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = 'A1:C1';
    const header = sheet.getRow(1);
    header.font = { bold: true };
    header.alignment = { vertical: 'middle' };
    header.height = 26;
    for (const line of order.lines) {
      // Empty sku/name = genuinely empty cell, never '—' or inventory ID.
      const row = sheet.addRow({
        article: line.article || null,
        name: line.name || null,
        packages: line.packages,
      });
      row.getCell(3).numFmt = '0';
      row.alignment = { vertical: 'top', wrapText: true };
    }
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  async pdf(order: SupplierOrder): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: 42, info: {
      Title: 'Заказ № ' + documentNumber(order.orderId),
    } });
    const parts: Buffer[] = [];
    const completed = new Promise<Buffer>((resolve, reject) => {
      doc.on('data', (part: Buffer) => parts.push(part));
      doc.on('end', () => resolve(Buffer.concat(parts)));
      doc.on('error', reject);
    });
    doc.font(FONT);
    const left = 42, usable = doc.page.width - 84;
    const colArticle = 127, colQuantity = 82, colName = usable - colArticle - colQuantity;
    const renderHeader = (y: number) => {
      doc.fillColor('#444444').fontSize(10);
      doc.text(COLUMN_TITLES[0], left + 5, y + 6, { width: colArticle - 10 });
      doc.text(COLUMN_TITLES[1], left + colArticle + 5, y + 6, { width: colName - 10 });
      doc.text(COLUMN_TITLES[2], left + colArticle + colName + 5, y + 6, { width: colQuantity - 10, align: 'right' });
      doc.moveTo(left, y + 28).lineTo(left + usable, y + 28).lineWidth(0.8).strokeColor('#888888').stroke();
      return y + 32;
    };
    doc.fillColor('#111111').fontSize(15).text('Заказ № ' + documentNumber(order.orderId), left, 46);
    const total = order.lines.reduce((acc, line) => acc + line.packages, 0);
    doc.fontSize(10).fillColor('#555555').text(
      new Date(order.createdAt).toLocaleDateString('ru-RU')
        + ' · Всего ' + total + ' шт.', left, 76,
    );
    let y = renderHeader(109);
    for (const line of order.lines) {
      doc.fontSize(10);
      const articleHeight = doc.heightOfString(line.article, { width: colArticle - 10 });
      const nameHeight = doc.heightOfString(line.name, { width: colName - 10 });
      const height = Math.max(29, Math.ceil(Math.max(articleHeight, nameHeight)) + 13);
      if (y + height > doc.page.height - 48) {
        doc.addPage();
        doc.font(FONT);
        y = renderHeader(44);
      }
      doc.fillColor('#222222').fontSize(10);
      if (line.article) doc.text(line.article, left + 5, y + 5, { width: colArticle - 10 });
      if (line.name) doc.text(line.name, left + colArticle + 5, y + 5, { width: colName - 10 });
      doc.text(String(line.packages), left + colArticle + colName + 5, y + 5, {
        width: colQuantity - 10, align: 'right',
      });
      y += height;
      doc.moveTo(left, y).lineTo(left + usable, y).lineWidth(0.4).strokeColor('#D1D1D1').stroke();
    }
    doc.end();
    return completed;
  }
}
