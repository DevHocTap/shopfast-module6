import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { createTestApp } from '../utils/test-app';

describe('Health (integration: real PostgreSQL + Redis)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health/live returns ok', async () => {
    const res = await request(app.getHttpServer()).get('/api/health/live').expect(200);

    expect(res.body).toMatchObject({ status: 'ok' });
  });

  it('GET /api/health/ready reports database and redis up', async () => {
    const res = await request(app.getHttpServer()).get('/api/health/ready').expect(200);

    expect(res.body).toMatchObject({
      status: 'ok',
      checks: { database: { status: 'up' }, redis: { status: 'up' } },
    });
  });

  it('unknown routes return the Vietnamese error contract', async () => {
    const res = await request(app.getHttpServer()).get('/api/does-not-exist').expect(404);

    expect(res.body).toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    expect(typeof res.body.message).toBe('string');
  });
});
