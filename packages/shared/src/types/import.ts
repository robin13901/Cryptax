import type { SourceType } from './transaction.js';

/** Represents a single import batch (one API call, possibly multiple files) */
export interface ImportBatch {
  id: number;
  filename: string;
  sourceType: SourceType;
  totalRows: number;
  importedCount: number;
  duplicatesCount: number;
  errorsCount: number;
  importedAt: string;
}

/** Result of importing a single CSV file */
export interface PerFileResult {
  filename: string;
  sourceType: SourceType;
  totalRows: number;
  imported: number;
  duplicatesSkipped: number;
  errors: ImportFileError[];
  batchId: number;
}

/** Error for a specific row in a CSV file */
export interface ImportFileError {
  row: number;
  field: string;
  message: string;
  rawData?: string;
}

/** Aggregated summary across all files in one import request */
export interface ImportResponse {
  results: PerFileResult[];
  summary: {
    totalFiles: number;
    totalRows: number;
    totalImported: number;
    totalDuplicates: number;
    totalErrors: number;
  };
}
