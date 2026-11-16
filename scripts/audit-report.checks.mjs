import assert from 'node:assert/strict';
import test from 'node:test';

import { AuditReporter } from './audit-report.mjs';

test('npm audit launches the npm JavaScript CLI with the running Node on Windows and Linux', () => {
  for (const [nodeExecutable, npmCLIPath] of [
    ['C:\\Program Files\\nodejs\\node.exe',
      'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js'],
    ['/usr/local/bin/node', '/usr/local/lib/node_modules/npm/bin/npm-cli.js'],
  ]) {
    const invocation = AuditReporter.npmInvocation(nodeExecutable, npmCLIPath);

    assert.deepEqual(invocation, {
      executable: nodeExecutable,
      arguments: [npmCLIPath, 'audit', '--json'],
    });
    assert.notEqual(invocation.executable, 'npm');
    assert.notEqual(invocation.executable, 'npm.cmd');
  }
  assert.throws(() => AuditReporter.npmInvocation(process.execPath, ''),
    /npm CLI entrypoint is unavailable/);
});
