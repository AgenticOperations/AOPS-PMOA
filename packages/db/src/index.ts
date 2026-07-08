export type Migration = {
  readonly id: string;
  readonly description: string;
  readonly sql: string;
};

export const migrationTableName = 'schema_migrations';

export { runMigrations, type RunMigrationsOptions } from './migrate.js';
