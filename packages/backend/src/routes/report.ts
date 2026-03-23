/**
 * Report API routes — wires ReportGenerator, PDF builder, and CSV builder
 * into Hono endpoints.
 *
 * Routes:
 *   GET /api/report/years          — Returns array of available tax years
 *   GET /api/report/:year/preview  — Returns ReportData JSON
 *   GET /api/report/:year/pdf      — Returns PDF binary download
 *   GET /api/report/:year/csv      — Returns CSV text download
 *
 * Follows the registerXxxRoutes(app: Hono) pattern used by other route modules.
 */

import { eq, sql } from 'drizzle-orm';
import type { Context, Hono } from 'hono';
import { db } from '../db/client.js';
import { taxSummaries } from '../db/schema.js';
import { ReportGenerator } from '../engine/report-generator.js';
import { buildPdf } from '../report/pdf-builder.js';
import { buildCsv } from '../report/csv-builder.js';
import type { ReportData } from '@cryptax/shared';

// ---------------------------------------------------------------------------
// Shared helper — parse year param and generate ReportData
// ---------------------------------------------------------------------------

/**
 * Parse and validate the `:year` route param, then call ReportGenerator.
 *
 * Returns:
 *   { data: ReportData }  on success
 *   { error: Response }   when the param is invalid (400) or no data (404)
 *
 * Callers must check for `error` before using `data`.
 */
async function getReportData(
  c: Context,
  rawYear: string,
): Promise<{ data: ReportData; error?: never } | { data?: never; error: Response }> {
  const taxYear = parseInt(rawYear, 10);
  if (Number.isNaN(taxYear)) {
    return {
      error: c.json({ error: `Invalid year: ${rawYear}` }, 400) as Response,
    };
  }

  const generator = new ReportGenerator();
  const data = generator.generate(taxYear);

  if (data === null) {
    return {
      error: c.json({ error: `Keine Daten fuer das Jahr ${taxYear}` }, 404) as Response,
    };
  }

  return { data };
}

// ---------------------------------------------------------------------------
// registerReportRoutes
// ---------------------------------------------------------------------------

/**
 * Register report routes on the Hono application.
 *
 * Routes:
 *   GET  /api/report/years          — Available tax years
 *   GET  /api/report/:year/preview  — ReportData JSON
 *   GET  /api/report/:year/pdf      — PDF binary download
 *   GET  /api/report/:year/csv      — CSV text download
 */
export function registerReportRoutes(app: Hono) {
  // -------------------------------------------------------------------------
  // GET /api/report/years
  // -------------------------------------------------------------------------
  app.get('/api/report/years', (c) => {
    const rows = db
      .selectDistinct({ year: taxSummaries.taxYear })
      .from(taxSummaries)
      .orderBy(sql`${taxSummaries.taxYear} ASC`)
      .all();

    const years = rows.map((r) => r.year);
    return c.json({ years });
  });

  // -------------------------------------------------------------------------
  // GET /api/report/:year/preview
  // -------------------------------------------------------------------------
  app.get('/api/report/:year/preview', async (c) => {
    const rawYear = c.req.param('year');
    const result = await getReportData(c, rawYear);
    if (result.error) return result.error;
    return c.json(result.data);
  });

  // -------------------------------------------------------------------------
  // GET /api/report/:year/pdf
  // -------------------------------------------------------------------------
  app.get('/api/report/:year/pdf', async (c) => {
    const rawYear = c.req.param('year');
    const result = await getReportData(c, rawYear);
    if (result.error) return result.error;

    const pdfBuffer = await buildPdf(result.data);
    const year = result.data.taxYear;

    c.header('Content-Type', 'application/pdf');
    c.header('Content-Disposition', `attachment; filename="cryptax-steuerreport-${year}.pdf"`);
    // Convert Node.js Buffer to ArrayBuffer — Hono's body() accepts ArrayBuffer
    const arrayBuffer = pdfBuffer.buffer.slice(
      pdfBuffer.byteOffset,
      pdfBuffer.byteOffset + pdfBuffer.byteLength,
    ) as ArrayBuffer;
    return c.body(arrayBuffer);
  });

  // -------------------------------------------------------------------------
  // GET /api/report/:year/csv
  // -------------------------------------------------------------------------
  app.get('/api/report/:year/csv', async (c) => {
    const rawYear = c.req.param('year');
    const result = await getReportData(c, rawYear);
    if (result.error) return result.error;

    const csvString = buildCsv(result.data);
    const year = result.data.taxYear;

    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="cryptax-steuerberater-${year}.csv"`);
    return c.body(csvString);
  });
}
