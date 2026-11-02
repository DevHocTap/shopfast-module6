/**
 * AI assistant evaluation (docs/06 §5) — real model, real code path, rule-based grading.
 *
 *   DB_NAME=shopfast_test REDIS_DB=1 ANTHROPIC_API_KEY=... pnpm --filter api ai:eval
 *   ... ai:eval --fake        dry run with a scripted model (checks the harness, costs nothing)
 *   ... ai:eval --only lookup  run the cases whose id contains "lookup"
 *
 * Exits non-zero when chat cases pass < 90 % or classification accuracy < 85 %.
 * Uses the integration-test database (it is truncated first), never the dev or prod data.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { FakeLlm } from '../../src/infra/llm/fake-llm';
import { LlmPort } from '../../src/infra/llm/llm.port';
import {
  CLASSIFIER_SYSTEM_PROMPT,
  classifierInput,
  MIN_CLASSIFIER_CONFIDENCE,
} from '../../src/modules/ai-assistant/assistant.prompts';
import { AssistantService } from '../../src/modules/ai-assistant/assistant.service';
import { Role } from '../../src/common/auth/role.enum';
import { SupportService } from '../../src/modules/support/support.service';
import { CLASSIFIABLE } from '../../src/modules/support/support.types';
import { createTestApp, httpClient, resetDatabase } from '../utils/test-app';

interface ChatCase {
  id: string;
  group: string;
  ticket: string;
  question: string;
  mustCall?: string[];
  mustNotCall?: string[];
  mustInclude?: string[];
  mustIncludeAny?: string[];
  mustNotIncludeAny?: string[];
  proposal: boolean;
  proposalAllowed?: boolean;
}
interface ClassifyCase {
  subject: string;
  body: string;
  label: string;
}

const args = process.argv.slice(2);
const fake = args.includes('--fake');
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : undefined;
const CHAT_TARGET = 0.9;
const CLASSIFY_TARGET = 0.85;

async function main(): Promise<void> {
  const cases = JSON.parse(readFileSync(join(__dirname, 'cases.json'), 'utf8')) as {
    chat: ChatCase[];
    classify: ClassifyCase[];
  };
  const { app, dataSource: db } = await createTestApp((builder) =>
    fake ? builder.overrideProvider(LlmPort).useValue(new FakeLlm()) : builder,
  );
  const llm = app.get(LlmPort);
  if (!llm.available) {
    await app.close();
    throw new Error('No LLM configured: set ANTHROPIC_API_KEY (or pass --fake).');
  }
  await resetDatabase(app);
  const fixture = await createFixture(app, db);

  const assistant = app.get(AssistantService);
  const support = app.get(SupportService);
  const chatResults: {
    id: string;
    group: string;
    pass: boolean;
    problems: string[];
    reply: string;
  }[] = [];

  for (const c of cases.chat.filter((c) => !only || c.id.includes(only))) {
    const fill = (text: string) =>
      text
        .replaceAll('{{PAID}}', fixture.paid)
        .replaceAll('{{SHIPPED}}', fixture.shipped)
        .replaceAll('{{OTHER}}', fixture.other);
    const ticket = await support.create(fixture.customer, {
      subject: c.group,
      message: fill(c.ticket),
    });
    const problems: string[] = [];
    let reply = '';
    try {
      const result = await assistant.chat(fixture.staff, ticket.id, fill(c.question));
      reply = result.reply;
      const called = new Set(result.toolCalls.map((t) => t.name));
      for (const tool of c.mustCall ?? [])
        if (!called.has(tool)) problems.push(`không gọi ${tool}`);
      for (const tool of c.mustNotCall ?? []) if (called.has(tool)) problems.push(`gọi ${tool}`);
      for (const text of c.mustInclude ?? [])
        if (!reply.includes(fill(text))) problems.push(`thiếu "${text}"`);
      if (c.mustIncludeAny && !c.mustIncludeAny.some((t) => reply.includes(fill(t)))) {
        problems.push(`không chứa: ${c.mustIncludeAny.join(' | ')}`);
      }
      for (const text of c.mustNotIncludeAny ?? []) {
        if (reply.includes(fill(text))) problems.push(`có "${text}"`);
      }
      const [{ count }] = await db.query<{ count: number }[]>(
        `SELECT count(*)::int AS count FROM agent_actions WHERE ticket_id = $1`,
        [ticket.id],
      );
      if (!c.proposalAllowed && count > 0 !== c.proposal) {
        problems.push(c.proposal ? 'không tạo đề xuất' : `tạo ${count} đề xuất`);
      }
      // Leave no open proposal behind for the next case.
      await db.query(`UPDATE agent_actions SET status = 'REJECTED' WHERE status = 'PROPOSED'`);
    } catch (error) {
      problems.push(`lỗi: ${(error as Error).message}`);
    }
    chatResults.push({ id: c.id, group: c.group, pass: problems.length === 0, problems, reply });
    console.log(
      `${problems.length === 0 ? 'PASS' : 'FAIL'}  ${c.id.padEnd(24)} ${problems.join('; ')}`,
    );
  }

  const classifyResults: { expected: string; got: string; confidence: number; pass: boolean }[] =
    [];
  if (!only) {
    for (const c of cases.classify) {
      const result = await llm.classify({
        system: CLASSIFIER_SYSTEM_PROMPT,
        input: classifierInput(c.subject, c.body),
        labels: CLASSIFIABLE,
      });
      const got = result.confidence >= MIN_CLASSIFIER_CONFIDENCE ? result.label : 'UNCLASSIFIED';
      classifyResults.push({
        expected: c.label,
        got,
        confidence: result.confidence,
        pass: got === c.label,
      });
      console.log(
        `${got === c.label ? 'PASS' : 'FAIL'}  classify ${c.label.padEnd(14)} → ${got} (${result.confidence.toFixed(2)})`,
      );
    }
  }

  const chatRate = rate(chatResults.map((r) => r.pass));
  const classifyRate = rate(classifyResults.map((r) => r.pass));
  console.log('\nTheo nhóm:');
  for (const group of [...new Set(chatResults.map((r) => r.group))]) {
    const rows = chatResults.filter((r) => r.group === group);
    console.log(`  ${group.padEnd(20)} ${rows.filter((r) => r.pass).length}/${rows.length}`);
  }
  console.log(`\nHội thoại: ${pct(chatRate)} (mục tiêu ${pct(CHAT_TARGET)})`);
  if (classifyResults.length)
    console.log(`Phân loại: ${pct(classifyRate)} (mục tiêu ${pct(CLASSIFY_TARGET)})`);

  const out = join(__dirname, `result-${fake ? 'fake' : 'live'}.json`);
  writeFileSync(
    out,
    JSON.stringify(
      {
        ranAt: new Date().toISOString(),
        fake,
        chatRate,
        classifyRate,
        chatResults,
        classifyResults,
      },
      null,
      2,
    ),
  );
  console.log(`Chi tiết: ${out}`);
  await app.close();

  const ok =
    chatRate >= CHAT_TARGET && (classifyResults.length === 0 || classifyRate >= CLASSIFY_TARGET);
  process.exitCode = ok ? 0 : 1;
}

/** One customer with a PAID and a SHIPPED order, another customer's order, two SKUs, a support user. */
async function createFixture(app: Parameters<typeof httpClient>[0], db: DataSource) {
  const http = httpClient(app);
  const category = randomUUID();
  const brand = randomUUID();
  const inStock = randomUUID();
  const soldOut = randomUUID();
  await db.query(`INSERT INTO categories (id, name, slug) VALUES ($1, 'Loa', 'loa')`, [category]);
  await db.query(`INSERT INTO brands (id, name, slug) VALUES ($1, 'JBL', 'jbl')`, [brand]);
  await db.query(
    `INSERT INTO products (id, sku, name, category_id, brand_id, price, is_active) VALUES
       ($1, 'SKU-90001', 'Loa JBL Go 4', $3, $4, 500000, true),
       ($2, 'SKU-90002', 'Loa JBL Charge 6', $3, $4, 3900000, true)`,
    [inStock, soldOut, category, brand],
  );
  await db.query(`INSERT INTO inventories (product_id, quantity) VALUES ($1, 25), ($2, 0)`, [
    inStock,
    soldOut,
  ]);

  const register = async (email: string) => {
    const res = await http
      .post('/api/auth/register')
      .send({ email, password: 'Password123', fullName: 'Khách Đánh Giá' })
      .expect(201);
    return { id: res.body.user.id as string, token: res.body.accessToken as string, email };
  };
  const order = async (token: string) => {
    await http
      .put(`/api/cart/items/${inStock}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ quantity: 1 });
    const placed = await http
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    await http
      .post(`/api/orders/${placed.body.id}/pay`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return { id: placed.body.id as string, code: placed.body.code as string };
  };

  const customer = await register('eval-khach@test.local');
  const other = await register('eval-khac@test.local');
  const staffUser = await register('eval-cskh@test.local');
  await db.query(`UPDATE users SET role = 'SUPPORT' WHERE id = $1`, [staffUser.id]);
  const paid = await order(customer.token);
  const shipped = await order(customer.token);
  await db.query(`UPDATE orders SET status = 'SHIPPED', version = version + 2 WHERE id = $1`, [
    shipped.id,
  ]);
  await db.query(
    `INSERT INTO order_status_history (order_id, from_status, to_status, actor_id)
     VALUES ($1, 'PAID', 'PACKING', $2), ($1, 'PACKING', 'SHIPPED', $2)`,
    [shipped.id, staffUser.id],
  );
  const otherOrder = await order(other.token);

  return {
    customer: { id: customer.id, email: customer.email, role: Role.CUSTOMER },
    staff: { id: staffUser.id, email: staffUser.email, role: Role.SUPPORT },
    paid: paid.code,
    shipped: shipped.code,
    other: otherOrder.code,
  };
}

const rate = (values: boolean[]) =>
  values.length ? values.filter(Boolean).length / values.length : 0;
const pct = (value: number) => `${(value * 100).toFixed(0)}%`;

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
