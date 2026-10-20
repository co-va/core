export type JsonObject = Record<string, any>;
export type Domain = 'workplace' | 'person' | 'schedule' | 'procedure' | 'procedure-history' | 'record' | 'finance' | 'inventory' | 'inventory-movement';
export type Status = 'ready' | 'error' | 'duplicate';

export type SourceRow = {
  domain: Domain;
  sheet: string;
  row: number;
  values: JsonObject;
  importKey: string;
};

export type AnalysedRow = SourceRow & {
  status: Status;
  reason?: string;
};

export type SourceBundle = {
  fileName: string;
  rows: SourceRow[];
  ignoredSheets: string[];
};
