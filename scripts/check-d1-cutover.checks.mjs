import assert from 'node:assert/strict';
import test from 'node:test';
import { D1CutoverGuard, WranglerD1Runner } from './check-d1-cutover.mjs';

test('D1 schema guard launches the local Wrangler JavaScript CLI with the running Node', () => {
  const invocation = WranglerD1Runner.invocation(
    ['d1', 'execute', 'DB'],
    'C:\\Program Files\\nodejs\\node.exe',
    'C:\\repo\\node_modules\\wrangler\\wrangler-dist\\cli.js',
  );

  assert.deepEqual(invocation, {
    executable: 'C:\\Program Files\\nodejs\\node.exe',
    arguments: [
      'C:\\repo\\node_modules\\wrangler\\wrangler-dist\\cli.js',
      'd1',
      'execute',
      'DB',
    ],
  });
  assert.notEqual(invocation.executable, 'npx');
  assert.notEqual(invocation.executable, 'npx.cmd');
});

test('empty Cloudflare D1 includes provider-managed metadata but is safe', () => {
  assert.doesNotThrow(() => D1CutoverGuard.assertSafe(['_cf_KV']));
  assert.doesNotThrow(() => D1CutoverGuard.assertSafe(['_cf_KV', 'd1_migrations']));
});

test('complete Agent/Session V2 schema is safe with provider-managed metadata', () => {
  assert.doesNotThrow(() => D1CutoverGuard.assertSafe([
    '_cf_KV', '_cf_METADATA', 'd1_migrations', ...D1CutoverGuard.CORE_TABLES,
  ]));
});

test('office Agent registration migration preserves the current identity database', () => {
  const schema = [...D1CutoverGuard.CORE_TABLES, ...D1CutoverGuard.OFFICE_TABLES];

  assert.doesNotThrow(() => D1CutoverGuard.assertSafe(schema));
  assert.doesNotThrow(() => D1CutoverGuard.assertSafe(schema, true));
  assert.throws(() => D1CutoverGuard.assertSafe(D1CutoverGuard.CORE_TABLES, true),
    /office Agent registration migration/);
  assert.throws(() => D1CutoverGuard.assertSafe([
    ...schema, 'unrelated_office_tokens',
  ]), /cutover refused/i);
});

test('legacy, mixed, partial or unknown schemas are always rejected', () => {
  const cases = [
    ['_cf_KV', 'addresses', 'enrollments'],
    ['_cf_KV', ...D1CutoverGuard.CORE_TABLES, 'paired_hosts'],
    ['_cf_KV', 'organizations', 'accounts'],
    ['_cf_UNRECOGNIZED'],
  ];

  for (const tables of cases) {
    assert.throws(() => D1CutoverGuard.assertSafe(tables), /cutover refused/i);
  }
});

test('address alias migration is accepted before deployment and required after migration', () => {
  const previous = [...D1CutoverGuard.CORE_TABLES, ...D1CutoverGuard.OFFICE_TABLES];
  assert.doesNotThrow(() => D1CutoverGuard.assertSafe(previous, true));
  assert.throws(() => D1CutoverGuard.assertSafe(previous, true, true), /address alias migration/);
  assert.doesNotThrow(() => D1CutoverGuard.assertSafe([...previous, ...D1CutoverGuard.ADDRESS_TABLES], true, true));
});

test('the post-migration guard requires the scoped work Session trigger', () => {
  assert.throws(() => D1CutoverGuard.assertWorkMigration([]), /work Session revision scope/);
  assert.doesNotThrow(() => D1CutoverGuard.assertWorkMigration(['work_session_revision_scope']));
});
