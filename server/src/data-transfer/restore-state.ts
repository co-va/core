// Technical three-way inverse. Domain owners select the tables and execute it.
import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
type Row = Record<string, any>;
export type TransferState = Record<string, Row[]>;
const encode = (v: any): string => JSON.stringify(v, (_, value) => typeof value === 'bigint' ? value.toString() : value);
const same = (a: any, b: any) => encode(a) === encode(b);
const identifier = (v: string) => { if (!/^[A-Za-z][A-Za-z0-9]*$/.test(v)) throw Error('Invalid state identifier'); return Prisma.raw('"' + v + '"'); };
export async function captureOwnedState(tx: Prisma.TransactionClient, tenantId: string, tables: string[]): Promise<TransferState> {
  const result: TransferState = {};
  for (const table of tables) {
    const rows = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT to_jsonb(t) AS value FROM ${identifier(table)} t WHERE "tenantId"=${tenantId} ORDER BY "id"`);
    result[table] = rows.map(row => row.value);
  }
  return result;
}
function inverse(before: any, after: any, current: any, path: string): any {
  if (same(before, after)) return current;
  if (same(current, after)) return before;
  if (before && after && current && !Array.isArray(before) && typeof before === 'object' && !Array.isArray(after) && !Array.isArray(current)) {
    const result = { ...current };
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (['updatedAt','recordedAt'].includes(key)) continue;
      const value = inverse(before[key], after[key], current[key], path + '.' + key);
      if (value === undefined) delete result[key]; else result[key] = value;
    }
    return result;
  }
  // Collections of canonical entities are restored by stable key, preserving unrelated additions.
  if (Array.isArray(before) && Array.isArray(after) && Array.isArray(current)) {
    const key = (v: any) => v && typeof v === 'object' ? String(v.id || v.key || '') : typeof v === 'string' ? v : '';
    if ([...before, ...after, ...current].every(v => key(v))) {
      const b = new Map(before.map(v => [key(v),v])); const a = new Map(after.map(v => [key(v),v]));
      const c = new Map(current.map(v => [key(v),v]));
      if (b.size !== before.length || a.size !== after.length || c.size !== current.length) throw new ConflictException(`Перенос нельзя отменить: изменены данные ${path}.`);
      for (const id of new Set([...b.keys(),...a.keys()])) {
        const value = inverse(b.get(id),a.get(id),c.get(id),path+'.'+id);
        if (value === undefined) c.delete(id); else c.set(id,value);
      }
      return [...c.values()];
    }
  }
  throw new ConflictException(`Перенос нельзя отменить: после загрузки независимо изменены данные ${path}.`);
}
export function restorePlan(before: TransferState, after: TransferState, current: TransferState) {
  const result: Record<string, Array<{ id: string; value: Row | undefined }>> = {};
  for (const table of Object.keys(after)) {
    const b = new Map((before[table] || []).map(row=>[String(row.id),row]));
    const a = new Map(after[table].map(row=>[String(row.id),row]));
    const c = new Map((current[table] || []).map(row=>[String(row.id),row]));
    result[table] = [];
    for (const id of new Set([...b.keys(),...a.keys()])) if (!same(b.get(id),a.get(id))) {
      const clean = (row: Row | undefined) => row ? Object.fromEntries(Object.entries(row).filter(([k])=>!['updatedAt','recordedAt'].includes(k))) : undefined;
      const value = inverse(clean(b.get(id)),clean(a.get(id)),clean(c.get(id)),table);
      result[table].push({id,value: value ? {...c.get(id),...value} : undefined});
    }
  }
  return result;
}
export async function restoreOwnedState(tx: Prisma.TransactionClient, tenantId: string, tables: string[], before: TransferState, after: TransferState, checkOnly = false) {
  const current = await captureOwnedState(tx,tenantId,tables);
  const select=(state:TransferState)=>Object.fromEntries(tables.map(table=>[table,state[table]||[]]));
  const plan = restorePlan(select(before),select(after),current);
  if (checkOnly) return;
  for (const table of [...tables].reverse()) for (const row of plan[table] || []) if (!row.value)
    await tx.$executeRaw(Prisma.sql`DELETE FROM ${identifier(table)} WHERE "tenantId"=${tenantId} AND "id"=${row.id}`);
  for (const table of tables) for (const row of plan[table] || []) if (row.value) {
    const columns = Object.keys(row.value);
    const value = JSON.stringify(row.value);
    // Rows still exist for modifications; never delete/reinsert a referenced parent.
    await tx.$executeRaw(Prisma.sql`INSERT INTO ${identifier(table)} SELECT * FROM jsonb_populate_record(NULL::${identifier(table)}, ${value}::jsonb)
      ON CONFLICT ("id") DO UPDATE SET ${Prisma.join(columns.filter(k=>k!=='id' && k!=='tenantId').map(k=>Prisma.sql`${identifier(k)}=EXCLUDED.${identifier(k)}`))}`);
  }
}
export function assertNoIndependentReferences(before: TransferState, after: TransferState, current: TransferState) {
  const identifiers=(value:any,result=new Set<string>()):Set<string>=>{
    if(Array.isArray(value))value.forEach(item=>identifiers(item,result));
    else if(value&&typeof value==='object')for(const [key,item]of Object.entries(value)){
      if(['id','key','recordId','operationId','depositId','programId','itemId','movementId','articleId','lotId'].includes(key)&&typeof item==='string')result.add(item);
      else if(typeof item==='object')identifiers(item,result);
    }
    return result;
  };
  const previous=identifiers(before);const created=new Set([...identifiers(after)].filter(id=>!previous.has(id)));
  const hasReference = (value: any): boolean => typeof value === 'string' ? (created.has(value) || value.startsWith('person:')&&created.has(value.slice(7))) : Array.isArray(value) ? value.some(hasReference) : value && typeof value === 'object' ? Object.values(value).some(hasReference) : false;
  for (const table of Object.keys(current)) {
    const a = new Map((after[table]||[]).map(row=>[String(row.id),row]));
    for (const row of current[table]) if (!same(row,a.get(String(row.id))) && hasReference(row)) throw new ConflictException('Перенос нельзя отменить: появились независимые данные или связи. Сначала разрешите конфликт.');
  }
}
