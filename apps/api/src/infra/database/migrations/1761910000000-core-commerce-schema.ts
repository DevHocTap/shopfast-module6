import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 1 schema: users & auth, catalog, inventory, cart, orders, payments.
 * Integrity rules live in the database, not only in code:
 *   - inventories.quantity CHECK >= 0           last line of defence against overselling
 *   - orders UNIQUE (user_id, idempotency_key)   a double-clicked "Place order" creates one order
 *   - payments UNIQUE (order_id)                 an order is paid at most once
 *   - money is BIGINT in VND (no floating point)
 */
export class CoreCommerceSchema1761910000000 implements MigrationInterface {
  name = 'CoreCommerceSchema1761910000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TYPE user_role AS ENUM ('CUSTOMER', 'SUPPORT', 'WAREHOUSE', 'ADMIN')`);
    await q.query(`
      CREATE TABLE users (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email         citext NOT NULL UNIQUE,
        password_hash text NOT NULL,
        full_name     text NOT NULL,
        role          user_role NOT NULL DEFAULT 'CUSTOMER',
        created_at    timestamptz NOT NULL DEFAULT now(),
        updated_at    timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`
      CREATE TABLE refresh_tokens (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash  text NOT NULL UNIQUE,
        family_id   uuid NOT NULL,
        expires_at  timestamptz NOT NULL,
        revoked_at  timestamptz,
        created_at  timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id)`);

    await q.query(`
      CREATE TABLE categories (
        id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name text NOT NULL,
        slug text NOT NULL UNIQUE
      )`);
    await q.query(`
      CREATE TABLE brands (
        id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name text NOT NULL,
        slug text NOT NULL UNIQUE
      )`);
    await q.query(`
      CREATE TABLE products (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        sku         text NOT NULL UNIQUE,
        name        text NOT NULL,
        description text NOT NULL DEFAULT '',
        category_id uuid NOT NULL REFERENCES categories(id),
        brand_id    uuid NOT NULL REFERENCES brands(id),
        price       bigint NOT NULL CHECK (price >= 0),
        is_active   boolean NOT NULL DEFAULT true,
        version     integer NOT NULL DEFAULT 1,
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(
      `CREATE INDEX products_category_price_idx ON products (category_id, price) WHERE is_active`,
    );
    await q.query(
      `CREATE INDEX products_brand_price_idx ON products (brand_id, price) WHERE is_active`,
    );
    await q.query(`CREATE INDEX products_price_idx ON products (price) WHERE is_active`);

    await q.query(`
      CREATE TABLE inventories (
        product_id uuid PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
        quantity   integer NOT NULL CHECK (quantity >= 0),
        version    integer NOT NULL DEFAULT 1,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(
      `CREATE TYPE inventory_reason AS ENUM ('ORDER', 'CANCEL', 'ADJUST', 'SYNC', 'SEED')`,
    );
    await q.query(`
      CREATE TABLE inventory_movements (
        id         bigserial PRIMARY KEY,
        product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        delta      integer NOT NULL,
        reason     inventory_reason NOT NULL,
        ref_id     uuid,
        actor_id   uuid REFERENCES users(id),
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(
      `CREATE INDEX inventory_movements_product_idx ON inventory_movements (product_id, created_at DESC)`,
    );

    await q.query(`
      CREATE TABLE cart_items (
        user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        quantity   integer NOT NULL CHECK (quantity > 0),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, product_id)
      )`);

    await q.query(
      `CREATE TYPE order_status AS ENUM ('PENDING_PAYMENT', 'PAID', 'PACKING', 'SHIPPED', 'DELIVERED', 'CANCELLED')`,
    );
    await q.query(`
      CREATE TABLE orders (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code            text NOT NULL UNIQUE,
        user_id         uuid NOT NULL REFERENCES users(id),
        status          order_status NOT NULL DEFAULT 'PENDING_PAYMENT',
        subtotal        bigint NOT NULL CHECK (subtotal >= 0),
        discount        bigint NOT NULL DEFAULT 0 CHECK (discount >= 0),
        total           bigint NOT NULL CHECK (total >= 0),
        idempotency_key text NOT NULL,
        version         integer NOT NULL DEFAULT 1,
        created_at      timestamptz NOT NULL DEFAULT now(),
        updated_at      timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT orders_user_idempotency_key UNIQUE (user_id, idempotency_key)
      )`);
    await q.query(`CREATE INDEX orders_user_created_idx ON orders (user_id, created_at DESC)`);
    await q.query(`CREATE INDEX orders_status_created_idx ON orders (status, created_at)`);
    await q.query(`
      CREATE TABLE order_items (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id     uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        product_id   uuid NOT NULL REFERENCES products(id),
        product_name text NOT NULL,
        sku          text NOT NULL,
        unit_price   bigint NOT NULL CHECK (unit_price >= 0),
        quantity     integer NOT NULL CHECK (quantity > 0)
      )`);
    await q.query(`CREATE INDEX order_items_order_idx ON order_items (order_id)`);
    await q.query(`
      CREATE TABLE order_status_history (
        id          bigserial PRIMARY KEY,
        order_id    uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        from_status order_status,
        to_status   order_status NOT NULL,
        actor_id    uuid REFERENCES users(id),
        created_at  timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(
      `CREATE INDEX order_status_history_order_idx ON order_status_history (order_id, id)`,
    );
    await q.query(`
      CREATE TABLE payments (
        id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id uuid NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
        amount   bigint NOT NULL CHECK (amount >= 0),
        method   text NOT NULL,
        paid_at  timestamptz NOT NULL DEFAULT now()
      )`);
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const table of [
      'payments',
      'order_status_history',
      'order_items',
      'orders',
      'cart_items',
      'inventory_movements',
      'inventories',
      'products',
      'brands',
      'categories',
      'refresh_tokens',
      'users',
    ]) {
      await q.query(`DROP TABLE IF EXISTS ${table}`);
    }
    for (const type of ['order_status', 'inventory_reason', 'user_role']) {
      await q.query(`DROP TYPE IF EXISTS ${type}`);
    }
  }
}
