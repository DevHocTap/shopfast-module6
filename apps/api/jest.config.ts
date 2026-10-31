import type { Config } from 'jest';

// Unit tests: no network, no database. Coverage gate applies to the business layer only.
const config: Config = {
  rootDir: '.',
  roots: ['<rootDir>/src'],
  testRegex: '.*\.spec\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: { '^.+\.ts$': 'ts-jest' },
  testEnvironment: 'node',
  collectCoverageFrom: [
    'src/modules/**/*.service.ts',
    'src/modules/**/*.processor.ts',
    'src/modules/**/*-state-machine.ts',
    'src/infra/cache/**/*.ts',
    'src/common/**/*.ts',
    '!src/**/*.module.ts',
    '!src/**/index.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text-summary', 'lcov', 'json-summary'],
  coverageThreshold: {
    global: { lines: 60, branches: 60, functions: 60, statements: 60 },
  },
};

export default config;
