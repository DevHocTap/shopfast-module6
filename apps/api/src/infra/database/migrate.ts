import { createDataSource } from './data-source';

/**
 * Runs pending migrations and exits. Used by deploy.sh before the new version receives traffic:
 * a failure here aborts the deploy while the current version keeps serving.
 */
async function main(): Promise<void> {
  const dataSource = createDataSource();
  await dataSource.initialize();
  try {
    const applied = await dataSource.runMigrations({ transaction: 'each' });
    const names = applied.map((migration) => migration.name).join(', ');
    console.log(applied.length === 0 ? 'No pending migrations.' : `Applied: ${names}`);
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error: unknown) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
