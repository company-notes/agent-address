#!/usr/bin/env node
// Read-only safety gate before migrating or deploying the new Agent/Session schema.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export class D1CutoverGuard {
  static CORE_TABLES = [
    'accounts',
    'admin_audit',
    'agents',
    'organizations',
    'session_runtime_leases',
    'sessions',
  ];

  static OFFICE_TABLES = ['agent_registration_requests'];

  static SQLITE_QUERY =
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name";

  static getMode(args) {
    const remote = args.includes('--remote');
    const local = args.includes('--local');

    if (remote === local) {
      throw new Error('Specify exactly one of --local or --remote.');
    }

    return remote ? '--remote' : '--local';
  }

  static getPersistTo(args) {
    const flag = args.find((item) => item.startsWith('--persist-to='));

    return flag ? ['--persist-to', flag.slice('--persist-to='.length)] : [];
  }

  static readTables(mode, extraArgs) {
    const output = execFileSync('npx', [
      '--no-install',
      'wrangler',
      'd1',
      'execute',
      'DB',
      mode,
      '--config',
      '.wrangler.deploy.jsonc',
      '--command',
      this.SQLITE_QUERY,
      '--json',
      ...extraArgs,
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

    const commands = JSON.parse(output);
    if (!Array.isArray(commands) || commands.length !== 1 || !Array.isArray(commands[0].results)) {
      throw new Error('Wrangler returned an unexpected D1 schema result.');
    }

    return commands[0].results.map((row) => row.name);
  }

  static assertSafe(tables) {
    const productTables = tables.filter((name) =>
      name !== 'd1_migrations' && name !== '_cf_METADATA' && name !== '_cf_KV',
    );
    if (productTables.length === 0) {
      console.log('D1 schema cutover: empty target database; safe for new schema migration.');

      return;
    }

    const expected = new Set([...this.CORE_TABLES, ...this.OFFICE_TABLES]);
    const missing = this.CORE_TABLES.filter((table) => !productTables.includes(table));
    const incompatible = productTables.filter((table) => !expected.has(table));

    if (missing.length > 0 || incompatible.length > 0) {
      throw new Error(
        'D1 schema cutover refused: not a fresh or fully current identity database. ' +
        'Missing tables: ' + missing.join(', ') + '; incompatible tables: ' + incompatible.join(', ') +
        '. Select an isolated new D1 database. Never apply new migrations to the Host/Work database.',
      );
    }

    console.log('D1 schema cutover: current Agent/Session schema verified.');
  }

  static main(args) {
    const mode = this.getMode(args);
    const tables = this.readTables(mode, this.getPersistTo(args));

    this.assertSafe(tables);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  D1CutoverGuard.main(process.argv.slice(2));
}
