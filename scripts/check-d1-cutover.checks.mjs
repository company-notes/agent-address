import assert from 'node:assert/strict';
import test from 'node:test';
import { D1CutoverGuard } from './check-d1-cutover.mjs';

test('empty Cloudflare D1 includes provider-managed metadata but is safe', () => {
  assert.doesNotThrow(() => D1CutoverGuard.assertSafe(['_cf_KV']));
  assert.doesNotThrow(() => D1CutoverGuard.assertSafe(['_cf_KV', 'd1_migrations']));
});

test('complete Agent/Session V2 schema is safe with provider-managed metadata', () => {
  assert.doesNotThrow(() => D1CutoverGuard.assertSafe([
    '_cf_KV', '_cf_METADATA', 'd1_migrations', ...D1CutoverGuard.CURRENT_TABLES,
  ]));
});

test('legacy, mixed, partial or unknown schemas are always rejected', () => {
  const cases = [
    ['_cf_KV', 'addresses', 'enrollments'],
    ['_cf_KV', ...D1CutoverGuard.CURRENT_TABLES, 'paired_hosts'],
    ['_cf_KV', 'organizations', 'accounts'],
    ['_cf_UNRECOGNIZED'],
  ];

  for (const tables of cases) {
    assert.throws(() => D1CutoverGuard.assertSafe(tables), /cutover refused/i);
  }
});
