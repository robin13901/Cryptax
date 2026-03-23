export interface ExchangeConnection {
  id: number;
  exchange: string;
  label: string;
  lastSyncAt: string | null;
  createdAt: string;
}

export interface ExchangeCredentials {
  apiKey: string;
  secret: string;
  password: string;
}

export interface SyncResult {
  connectionId: number;
  exchange: string;
  spotTrades: { imported: number; duplicates: number; errors: number };
  futuresTrades: { imported: number; duplicates: number; errors: number };
  totalImported: number;
  totalDuplicates: number;
  syncedAt: string;
  warnings: string[];
}

export interface ConnectionTestResult {
  success: boolean;
  error?: string;
}
