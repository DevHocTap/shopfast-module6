import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Promotional vouchers (F03: "đặt đơn khuyến mãi" gets a stricter rate limit).
 *   vouchers.remaining_uses CHECK >= 0     claimed with a conditional UPDATE, like stock
 *   voucher_redemptions PK (code, user)    one use per customer, enforced by the database
 * Expand-only: adds tables and a nullable column, so the previous release keeps working.
 */
export class Vouchers1761990000000 implements MigrationInterface {
  name = 'Vouchers1761990000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE vouchers (
        code           text PRIMARY KEY,
        percent_off    integer NOT NULL CHECK (percent_off BETWEEN 1 AND 90),
        remaining_uses integer NOT NULL CHECK (remaining_uses >= 0),
        starts_at      timestamptz NOT NULL DEFAULT now(),
        ends_at        timestamptz NOT NULL,
        is_active      boolean NOT NULL DEFAULT true
      )`);
    await q.query(`
      CREATE TABLE voucher_redemptions (
        voucher_code text NOT NULL REFERENCES vouchers(code),
        user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        order_id     uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        created_at   timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT voucher_redemptions_one_per_user PRIMARY KEY (voucher_code, user_id)
      )`);
    await q.query(`ALTER TABLE orders ADD COLUMN voucher_code text REFERENCES vouchers(code)`);
    // Demo vouchers: a common one and a scarce "flash sale" one to show the promo rate limit.
    await q.query(`
      INSERT INTO vouchers (code, percent_off, remaining_uses, ends_at) VALUES
        ('SALE10', 10, 100000, now() + interval '1 year'),
        ('FLASH50', 50, 50, now() + interval '1 year')`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE orders DROP COLUMN IF EXISTS voucher_code');
    await q.query('DROP TABLE IF EXISTS voucher_redemptions');
    await q.query('DROP TABLE IF EXISTS vouchers');
  }
}
