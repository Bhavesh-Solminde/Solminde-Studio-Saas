import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { toCsv } from '@salon/shared';
import { RequiresFeature, RequiresPermission } from '../access/guards.js';
import { ReportsService } from './reports.service.js';

/** from/to query with a default window of the current calendar month. */
function range(from?: string, to?: string): { from: Date; to: Date } {
  const now = new Date();
  return {
    from: from ? new Date(from) : new Date(now.getFullYear(), now.getMonth(), 1),
    to: to ? new Date(to) : new Date(now.getTime() + 24 * 60 * 60 * 1000),
  };
}

/**
 * Read-only reporting. Money reports require `reports.financial`; the rest need
 * `reports.view`. Every report can be pulled as CSV with `?format=csv`, which is
 * what "CSV export on everything" means — the same rows, serialised with the
 * shared writer that quotes correctly.
 */
@Controller('reports')
@RequiresFeature('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('revenue-by-stylist')
  @RequiresPermission('reports.financial')
  async revenueByStylist(
    @Res({ passthrough: true }) res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('format') format?: string,
  ) {
    const { from: f, to: t } = range(from, to);
    const rows = await this.reports.revenueByStylist(f, t);
    if (format === 'csv') {
      return csv(res, rows, ['displayName', 'services', 'retail', 'total'], 'revenue-by-stylist');
    }
    return { from: f.toISOString(), to: t.toISOString(), rows };
  }

  @Get('gst')
  @RequiresPermission('reports.financial')
  async gst(
    @Res({ passthrough: true }) res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('format') format?: string,
  ) {
    const { from: f, to: t } = range(from, to);
    const summary = await this.reports.gstSummary(f, t);
    if (format === 'csv') {
      return csv(res, summary.byRate, ['rate', 'taxable', 'cgst', 'sgst', 'igst', 'total'], 'gst');
    }
    return { from: f.toISOString(), to: t.toISOString(), ...summary };
  }

  @Get('retention')
  @RequiresPermission('reports.view')
  async retention(@Query('days') days?: string) {
    return this.reports.retention(days ? Number(days) : 60);
  }

  @Get('chair-utilisation')
  @RequiresPermission('reports.view')
  async chairUtilisation(@Query('from') from?: string, @Query('to') to?: string) {
    const { from: f, to: t } = range(from, to);
    return { rows: await this.reports.chairUtilisation(f, t) };
  }

  @Get('retail-attachment')
  @RequiresPermission('reports.view')
  async retailAttachment(@Query('from') from?: string, @Query('to') to?: string) {
    const { from: f, to: t } = range(from, to);
    return this.reports.retailAttachment(f, t);
  }
}

function csv(
  res: Response,
  rows: readonly object[],
  columns: readonly string[],
  name: string,
): string {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`);
  return toCsv(rows as readonly Record<string, unknown>[], columns);
}
