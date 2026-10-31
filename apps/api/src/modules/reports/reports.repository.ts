import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export interface DailyRevenue {
  date: string;
  orderCount: number;
  revenue: number;
}

export const REPORT_TIME_ZONE = 'Asia/Ho_Chi_Minh';

/** "Yesterday" as seen in Vietnam, whatever the server's time zone (EC2 runs in UTC). */
export function previousBusinessDay(now: Date = new Date()): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: REPORT_TIME_ZONE }).format(now);
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

@Injectable()
export class ReportsRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** Computes the day (Vietnam time) and upserts it: re-running the job never duplicates the row. */
  async computeAndStore(date: string): Promise<DailyRevenue> {
    const [row]: { order_count: number; revenue: string }[] = await this.dataSource.query(
      `INSERT INTO daily_revenue_reports (report_date, order_count, revenue)
       SELECT $1::date, count(*)::int, COALESCE(sum(total), 0)
         FROM orders
        WHERE status <> 'CANCELLED'
          AND created_at >= ($1::date)::timestamp AT TIME ZONE $2
          AND created_at <  ($1::date + 1)::timestamp AT TIME ZONE $2
       ON CONFLICT (report_date) DO UPDATE
         SET order_count = EXCLUDED.order_count, revenue = EXCLUDED.revenue, updated_at = now()
       RETURNING order_count, revenue`,
      [date, REPORT_TIME_ZONE],
    );
    return { date, orderCount: row.order_count, revenue: Number(row.revenue) };
  }

  async recent(limit: number): Promise<DailyRevenue[]> {
    const rows: { report_date: string; order_count: number; revenue: string }[] =
      await this.dataSource.query(
        `SELECT to_char(report_date, 'YYYY-MM-DD') AS report_date, order_count, revenue
           FROM daily_revenue_reports ORDER BY report_date DESC LIMIT $1`,
        [limit],
      );
    return rows.map((row) => ({
      date: row.report_date,
      orderCount: row.order_count,
      revenue: Number(row.revenue),
    }));
  }
}
