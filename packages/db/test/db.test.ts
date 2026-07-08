import { describe, expect, it } from 'vitest';
import { migrationTableName } from '../src/index.js';

describe('db package', () => {
  it('uses an explicit migrations table name', () => {
    expect(migrationTableName).toBe('schema_migrations');
  });
});
