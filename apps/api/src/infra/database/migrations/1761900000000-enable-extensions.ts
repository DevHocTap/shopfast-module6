import { MigrationInterface, QueryRunner } from 'typeorm';

/** citext: case-insensitive emails. pgcrypto: gen_random_uuid(). Both are trusted extensions. */
export class EnableExtensions1761900000000 implements MigrationInterface {
  name = 'EnableExtensions1761900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS citext');
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP EXTENSION IF EXISTS pgcrypto');
    await queryRunner.query('DROP EXTENSION IF EXISTS citext');
  }
}
