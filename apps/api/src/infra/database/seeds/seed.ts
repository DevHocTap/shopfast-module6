import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { PasswordHasher } from '../../../modules/auth/password-hasher';
import { generateOrderCode } from '../../../modules/orders/orders.service';
import { validateDbEnv } from '../../config/env.schema';
import { createDataSource } from '../data-source';

/**
 * Loads demo data: 12 categories, 25 brands, 1,000 products with stock, 4 staff + 201 customers,
 * ~3,000 historical orders spread over 60 days. Deterministic (seeded PRNG) and idempotent:
 * it does nothing when products already exist.
 *
 *   local:      pnpm --filter api seed
 *   production: docker exec shopfast-api-<color> node dist/infra/database/seeds/seed.js
 */

const PRODUCT_COUNT = 1000;
const CUSTOMER_COUNT = 200;
const ORDER_COUNT = 3000;
const HISTORY_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

const CATEGORIES = [
  { name: 'Điện thoại', noun: 'Điện thoại', min: 2_000_000, max: 35_000_000 },
  { name: 'Laptop', noun: 'Laptop', min: 9_000_000, max: 55_000_000 },
  { name: 'Máy tính bảng', noun: 'Máy tính bảng', min: 3_000_000, max: 30_000_000 },
  { name: 'Tai nghe', noun: 'Tai nghe', min: 200_000, max: 9_000_000 },
  { name: 'Loa', noun: 'Loa', min: 300_000, max: 12_000_000 },
  { name: 'Đồng hồ thông minh', noun: 'Đồng hồ', min: 800_000, max: 20_000_000 },
  { name: 'Màn hình', noun: 'Màn hình', min: 2_500_000, max: 25_000_000 },
  { name: 'Bàn phím', noun: 'Bàn phím', min: 250_000, max: 5_000_000 },
  { name: 'Chuột', noun: 'Chuột', min: 150_000, max: 3_000_000 },
  { name: 'Sạc & cáp', noun: 'Sạc', min: 90_000, max: 1_500_000 },
  { name: 'Camera', noun: 'Camera', min: 600_000, max: 18_000_000 },
  { name: 'Thiết bị mạng', noun: 'Router', min: 300_000, max: 8_000_000 },
];
const BRANDS = [
  'Apple',
  'Samsung',
  'Xiaomi',
  'OPPO',
  'Sony',
  'LG',
  'Asus',
  'Dell',
  'HP',
  'Lenovo',
  'Logitech',
  'Anker',
  'JBL',
  'Garmin',
  'Huawei',
  'Realme',
  'Acer',
  'MSI',
  'Razer',
  'TP-Link',
  'Canon',
  'Baseus',
  'Marshall',
  'Ugreen',
  'Keychron',
];
const SERIES = ['Pro', 'Air', 'Lite', 'Max', 'Plus', 'Mini', 'Ultra', 'Neo', 'S', 'X'];
const FIRST_NAMES = [
  'An',
  'Bình',
  'Chi',
  'Dũng',
  'Giang',
  'Hà',
  'Hải',
  'Hương',
  'Khánh',
  'Linh',
  'Minh',
  'Nam',
  'Ngọc',
  'Phúc',
  'Quân',
  'Thảo',
  'Trang',
  'Tuấn',
  'Vy',
  'Yến',
];
const LAST_NAMES = [
  'Nguyễn',
  'Trần',
  'Lê',
  'Phạm',
  'Hoàng',
  'Huỳnh',
  'Phan',
  'Vũ',
  'Võ',
  'Đặng',
  'Bùi',
  'Đỗ',
];

/** mulberry32: tiny deterministic PRNG so every run produces the same data. */
function prng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = prng(20261031);
const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
const slugify = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** Multi-row INSERT in chunks (PostgreSQL allows at most 65,535 bind parameters). */
async function insertMany(tx: EntityManager, table: string, columns: string[], rows: unknown[][]) {
  const chunk = Math.floor(60_000 / columns.length);
  for (let start = 0; start < rows.length; start += chunk) {
    const slice = rows.slice(start, start + chunk);
    const params: unknown[] = [];
    const values = slice.map((row) => {
      const placeholders = row.map((value) => {
        params.push(value);
        return `$${params.length}`;
      });
      return `(${placeholders.join(', ')})`;
    });
    await tx.query(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${values.join(', ')}`,
      params,
    );
  }
}

type Status = 'PENDING_PAYMENT' | 'PAID' | 'PACKING' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED';
const HAPPY_PATH: Status[] = ['PENDING_PAYMENT', 'PAID', 'PACKING', 'SHIPPED', 'DELIVERED'];

/** Older orders are mostly delivered; recent ones are still moving through the pipeline. */
function statusForAge(ageDays: number): Status {
  const roll = random();
  if (ageDays > 7) return roll < 0.9 ? 'DELIVERED' : 'CANCELLED';
  if (ageDays > 2)
    return roll < 0.4 ? 'DELIVERED' : roll < 0.7 ? 'SHIPPED' : roll < 0.9 ? 'PACKING' : 'CANCELLED';
  return roll < 0.35
    ? 'PENDING_PAYMENT'
    : roll < 0.7
      ? 'PAID'
      : roll < 0.9
        ? 'PACKING'
        : 'CANCELLED';
}

async function seed(dataSource: DataSource, demoPassword: string): Promise<void> {
  const [{ count }]: { count: string }[] = await dataSource.query('SELECT count(*) FROM products');
  if (Number(count) > 0) {
    console.log(`Seed skipped: ${count} products already exist.`);
    return;
  }

  console.log('Hashing demo password…');
  const passwordHash = await new PasswordHasher().hash(demoPassword);

  await dataSource.transaction(async (tx) => {
    const categories = CATEGORIES.map((c) => ({ ...c, id: randomUUID(), slug: slugify(c.name) }));
    await insertMany(
      tx,
      'categories',
      ['id', 'name', 'slug'],
      categories.map((c) => [c.id, c.name, c.slug]),
    );

    const brands = BRANDS.map((name) => ({ id: randomUUID(), name, slug: slugify(name) }));
    await insertMany(
      tx,
      'brands',
      ['id', 'name', 'slug'],
      brands.map((b) => [b.id, b.name, b.slug]),
    );

    const now = Date.now();
    const products = Array.from({ length: PRODUCT_COUNT }, (_, i) => {
      const category = categories[i % categories.length];
      const brand = pick(brands);
      const price = Math.round(int(category.min, category.max) / 10_000) * 10_000;
      const name = `${category.noun} ${brand.name} ${pick(SERIES)} ${int(100, 999)}`;
      return {
        id: randomUUID(),
        sku: `SKU-${String(i + 1).padStart(5, '0')}`,
        name,
        description: `${name} chính hãng ${brand.name}, bảo hành 12 tháng.`,
        categoryId: category.id,
        brandId: brand.id,
        price,
        createdAt: new Date(now - int(0, 365) * DAY_MS),
      };
    });
    await insertMany(
      tx,
      'products',
      [
        'id',
        'sku',
        'name',
        'description',
        'category_id',
        'brand_id',
        'price',
        'created_at',
        'updated_at',
      ],
      products.map((p) => [
        p.id,
        p.sku,
        p.name,
        p.description,
        p.categoryId,
        p.brandId,
        p.price,
        p.createdAt,
        p.createdAt,
      ]),
    );

    // 10% out of stock, 15% nearly sold out: realistic for demos of OUT_OF_STOCK and overselling.
    const stock = products.map((p) => {
      const roll = random();
      return { productId: p.id, quantity: roll < 0.1 ? 0 : roll < 0.25 ? int(1, 5) : int(10, 200) };
    });
    await insertMany(
      tx,
      'inventories',
      ['product_id', 'quantity'],
      stock.map((s) => [s.productId, s.quantity]),
    );
    await insertMany(
      tx,
      'inventory_movements',
      ['product_id', 'delta', 'reason'],
      stock.filter((s) => s.quantity > 0).map((s) => [s.productId, s.quantity, 'SEED']),
    );

    const staff = [
      { email: 'admin@shopfast.local', fullName: 'Quản trị viên', role: 'ADMIN' },
      { email: 'support@shopfast.local', fullName: 'Nhân viên CSKH', role: 'SUPPORT' },
      { email: 'warehouse@shopfast.local', fullName: 'Nhân viên kho', role: 'WAREHOUSE' },
      { email: 'customer@shopfast.local', fullName: 'Khách hàng Demo', role: 'CUSTOMER' },
    ];
    const customers = Array.from({ length: CUSTOMER_COUNT }, (_, i) => ({
      email: `customer${String(i + 1).padStart(3, '0')}@shopfast.local`,
      fullName: `${pick(LAST_NAMES)} ${pick(FIRST_NAMES)}`,
      role: 'CUSTOMER',
    }));
    const users = [...staff, ...customers].map((u) => ({ ...u, id: randomUUID() }));
    await insertMany(
      tx,
      'users',
      ['id', 'email', 'password_hash', 'full_name', 'role'],
      users.map((u) => [u.id, u.email, passwordHash, u.fullName, u.role]),
    );
    const buyers = users.filter((u) => u.role === 'CUSTOMER');
    const warehouseId = users.find((u) => u.role === 'WAREHOUSE')!.id;

    const orders: unknown[][] = [];
    const items: unknown[][] = [];
    const history: unknown[][] = [];
    const payments: unknown[][] = [];
    for (let n = 0; n < ORDER_COUNT; n++) {
      const buyer = pick(buyers);
      const createdAt = new Date(now - random() * HISTORY_DAYS * DAY_MS);
      const ageDays = (now - createdAt.getTime()) / DAY_MS;
      const status = statusForAge(ageDays);
      const orderId = randomUUID();

      const chosen = new Set<number>();
      const lineCount = int(1, 4);
      while (chosen.size < lineCount) chosen.add(int(0, products.length - 1));
      let subtotal = 0;
      for (const index of chosen) {
        const product = products[index];
        const quantity = int(1, 3);
        subtotal += product.price * quantity;
        items.push([orderId, product.id, product.name, product.sku, product.price, quantity]);
      }

      // History follows the real state machine; cancelled orders were cancelled before packing.
      const reached =
        status === 'CANCELLED'
          ? HAPPY_PATH.slice(0, int(1, 2))
          : HAPPY_PATH.slice(0, HAPPY_PATH.indexOf(status) + 1);
      const path: Status[] = status === 'CANCELLED' ? [...reached, 'CANCELLED'] : reached;
      let at = createdAt.getTime();
      path.forEach((to, step) => {
        if (step > 0) at += int(10, 600) * 60 * 1000;
        history.push([
          orderId,
          step === 0 ? null : path[step - 1],
          to,
          step <= 1 ? buyer.id : warehouseId,
          new Date(at),
        ]);
        if (to === 'PAID') payments.push([orderId, subtotal, 'SIMULATED', new Date(at)]);
      });

      orders.push([
        orderId,
        generateOrderCode(),
        buyer.id,
        status,
        subtotal,
        subtotal,
        `seed-${n}`,
        path.length,
        createdAt,
        new Date(at),
      ]);
    }
    await insertMany(
      tx,
      'orders',
      [
        'id',
        'code',
        'user_id',
        'status',
        'subtotal',
        'total',
        'idempotency_key',
        'version',
        'created_at',
        'updated_at',
      ],
      orders,
    );
    await insertMany(
      tx,
      'order_items',
      ['order_id', 'product_id', 'product_name', 'sku', 'unit_price', 'quantity'],
      items,
    );
    await insertMany(
      tx,
      'order_status_history',
      ['order_id', 'from_status', 'to_status', 'actor_id', 'created_at'],
      history,
    );
    await insertMany(tx, 'payments', ['order_id', 'amount', 'method', 'paid_at'], payments);

    console.log(
      `Seeded ${categories.length} categories, ${brands.length} brands, ${products.length} products, ` +
        `${users.length} users, ${orders.length} orders.`,
    );
  });
}

async function main(): Promise<void> {
  const env = validateDbEnv(process.env);
  if (!env.SEED_DEMO_PASSWORD) {
    throw new Error(
      'SEED_DEMO_PASSWORD is required (password of the demo accounts, 8+ characters).',
    );
  }
  const dataSource = createDataSource();
  await dataSource.initialize();
  try {
    await seed(dataSource, env.SEED_DEMO_PASSWORD);
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error: unknown) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
