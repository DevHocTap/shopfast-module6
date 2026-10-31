import type { Config } from 'jest';

// Integration tests: require real PostgreSQL + Redis (CI service containers or `pnpm infra:up`).
const config: Config = {
  rootDir: '.',
  roots: ['<rootDir>/test'],
  testRegex: '.*\.int-spec\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: { '^.+\.ts$': 'ts-jest' },
  testEnvironment: 'node',
  testTimeout: 30000,
};

export default config;
