import { index, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';

// ---------------------------------------------------------------------------
// import_batches
// ---------------------------------------------------------------------------
export const importBatches = sqliteTable('import_batches', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  filename: text('filename').notNull(),
  sourceType: text('source_type').notNull(),
  totalRows: integer('total_rows').notNull(),
  importedCount: integer('imported_count').notNull(),
  duplicatesCount: integer('duplicates_count').notNull(),
  errorsCount: integer('errors_count').notNull(),
  importedAt: text('imported_at').notNull(),
});

// ---------------------------------------------------------------------------
// transactions
// ---------------------------------------------------------------------------
export const transactions = sqliteTable(
  'transactions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    orderId: text('order_id'),
    exchange: text('exchange').notNull(),
    sourceType: text('source_type').notNull(),
    canonicalType: text('canonical_type').notNull(),
    symbol: text('symbol').notNull(),
    side: text('side'),
    amount: text('amount').notNull(),
    price: text('price').notNull(),
    fee: text('fee').notNull(),
    totalValue: text('total_value').notNull(),
    tradedAt: text('traded_at').notNull(),
    taxYear: integer('tax_year').notNull(),
    sourceFile: text('source_file'),
    rawRow: text('raw_row'),
    checksum: text('checksum').notNull(),
    importedAt: text('imported_at').notNull(),
    batchId: integer('batch_id').references(() => importBatches.id, { onDelete: 'set null' }),
    eurPrice: text('eur_price'),
    priceSource: text('price_source'),
    priceResolvedAt: text('price_resolved_at'),
    priceFailureReason: text('price_failure_reason'),
  },
  (t) => [
    unique('uq_transaction_order_exchange_checksum').on(t.orderId, t.exchange, t.checksum),
    index('idx_transactions_tax_year').on(t.taxYear),
    index('idx_transactions_symbol').on(t.symbol),
    index('idx_transactions_traded_at').on(t.tradedAt),
    index('idx_transactions_batch_id').on(t.batchId),
  ]
);

// ---------------------------------------------------------------------------
// price_cache
// ---------------------------------------------------------------------------
export const priceCache = sqliteTable(
  'price_cache',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    symbol: text('symbol').notNull(),
    timestamp: text('timestamp').notNull(),
    eurPrice: text('eur_price').notNull(),
    source: text('source').notNull(),
    usdtPrice: text('usdt_price'),
    usdtEurRate: text('usdt_eur_rate'),
    fetchedAt: text('fetched_at').notNull(),
  },
  (t) => [
    unique('uq_price_cache_symbol_timestamp_source').on(t.symbol, t.timestamp, t.source),
    index('idx_price_cache_symbol_timestamp').on(t.symbol, t.timestamp),
  ]
);

// ---------------------------------------------------------------------------
// fifo_lots
// ---------------------------------------------------------------------------
export const fifoLots = sqliteTable(
  'fifo_lots',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    symbol: text('symbol').notNull(),
    originalAmount: text('original_amount').notNull(),
    remainingAmount: text('remaining_amount').notNull(),
    costBasisEur: text('cost_basis_eur').notNull(),
    costPerUnitEur: text('cost_per_unit_eur').notNull(),
    feeEur: text('fee_eur').notNull(),
    acquiredAt: text('acquired_at').notNull(),
    transactionId: integer('transaction_id').references(() => transactions.id),
    taxYear: integer('tax_year').notNull(),
  },
  (t) => [
    index('idx_fifo_lots_symbol_acquired_at').on(t.symbol, t.acquiredAt),
    index('idx_fifo_lots_tax_year').on(t.taxYear),
  ]
);

// ---------------------------------------------------------------------------
// lot_consumptions
// ---------------------------------------------------------------------------
export const lotConsumptions = sqliteTable(
  'lot_consumptions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    lotId: integer('lot_id')
      .notNull()
      .references(() => fifoLots.id),
    sellTransactionId: integer('sell_transaction_id')
      .notNull()
      .references(() => transactions.id),
    amountConsumed: text('amount_consumed').notNull(),
    costBasisEur: text('cost_basis_eur').notNull(),
    proceedsEur: text('proceeds_eur').notNull(),
    gainLossEur: text('gain_loss_eur').notNull(),
    feeEur: text('fee_eur').notNull(),
    heldDays: integer('held_days').notNull(),
    haltefristMet: integer('haltefrist_met', { mode: 'boolean' }).notNull(),
    taxYear: integer('tax_year').notNull(),
  },
  (t) => [
    index('idx_lot_consumptions_tax_year').on(t.taxYear),
    index('idx_lot_consumptions_sell_transaction').on(t.sellTransactionId),
  ]
);

// ---------------------------------------------------------------------------
// futures_positions
// ---------------------------------------------------------------------------
export const futuresPositions = sqliteTable(
  'futures_positions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    symbol: text('symbol').notNull(),
    realizedPnlEur: text('realized_pnl_eur').notNull(),
    feeEur: text('fee_eur').notNull(),
    transactionId: integer('transaction_id').references(() => transactions.id),
    taxYear: integer('tax_year').notNull(),
  },
  (t) => [index('idx_futures_positions_tax_year').on(t.taxYear)]
);

// ---------------------------------------------------------------------------
// earn_income
// ---------------------------------------------------------------------------
export const earnIncome = sqliteTable(
  'earn_income',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    symbol: text('symbol').notNull(),
    amount: text('amount').notNull(),
    eurValueAtReceipt: text('eur_value_at_receipt').notNull(),
    receivedAt: text('received_at').notNull(),
    transactionId: integer('transaction_id').references(() => transactions.id),
    taxYear: integer('tax_year').notNull(),
  },
  (t) => [index('idx_earn_income_tax_year').on(t.taxYear)]
);

// ---------------------------------------------------------------------------
// tax_summaries
// ---------------------------------------------------------------------------
export const taxSummaries = sqliteTable(
  'tax_summaries',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    taxYear: integer('tax_year').notNull(),
    bucket: text('bucket').notNull(),
    totalGainsEur: text('total_gains_eur').notNull(),
    totalLossesEur: text('total_losses_eur').notNull(),
    netEur: text('net_eur').notNull(),
    taxableAmountEur: text('taxable_amount_eur').notNull(),
    estimatedTaxEur: text('estimated_tax_eur').notNull(),
    tradeCount: integer('trade_count').notNull(),
    computedAt: text('computed_at').notNull(),
  },
  (t) => [unique('uq_tax_summaries_year_bucket').on(t.taxYear, t.bucket)]
);

// ---------------------------------------------------------------------------
// exchange_connections
// ---------------------------------------------------------------------------
export const exchangeConnections = sqliteTable('exchange_connections', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  exchange: text('exchange').notNull(),
  label: text('label').notNull(),
  encryptedCredentials: text('encrypted_credentials').notNull(),
  lastSyncAt: text('last_sync_at'),
  createdAt: text('created_at').notNull(),
});

// ---------------------------------------------------------------------------
// app_settings
// ---------------------------------------------------------------------------
export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull(),
});
