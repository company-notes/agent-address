import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

class AuditReporter {
  static MAX_BUFFER = 32 * 1024 * 1024;

  static npmInvocation(nodeExecutable = process.execPath, npmCLIPath = process.env.npm_execpath) {
    if (!npmCLIPath || !npmCLIPath.trim()) {
      throw new Error('npm CLI entrypoint is unavailable. Run the audit through npm run audit:check.');
    }

    return {
      executable: nodeExecutable,
      arguments: [npmCLIPath, 'audit', '--json'],
    };
  }

  static readReport() {
    const invocation = this.npmInvocation();
    const result = spawnSync(invocation.executable, invocation.arguments, {
      encoding: 'utf8',
      maxBuffer: this.MAX_BUFFER,
    });

    if (result.error) {
      throw result.error;
    }

    try {
      return JSON.parse(result.stdout);
    } catch (error) {
      console.error('npm audit did not return valid JSON:', error);
      console.error((result.stderr || result.stdout).slice(0, 1200));

      throw error;
    }
  }

  static remediation(vulnerability) {
    const fix = vulnerability.fixAvailable;
    if (fix === false) {
      return 'No fix';
    }

    if (typeof fix === 'object') {
      return 'Requires ' + fix.name + '@' + fix.version + (fix.isSemVerMajor ? ' (major)' : '');
    }

    return 'Fix available';
  }

  static printReport(report) {
    if (report.error || !report.metadata?.vulnerabilities) {
      throw new Error('npm audit failed: ' +
        (report.error?.summary || report.error?.code || 'Invalid response'));
    }

    const counts = report.metadata.vulnerabilities;
    console.log('npm audit total: ' + counts.total +
      ' (critical ' + counts.critical +
      ', high ' + counts.high +
      ', moderate ' + counts.moderate +
      ', low ' + counts.low + ')');

    const entries = Object.entries(report.vulnerabilities || {})
      .sort(([left], [right]) => left.localeCompare(right));

    for (const [name, vulnerability] of entries) {
      console.log(
        vulnerability.severity.padEnd(8) + ' ' +
        name.padEnd(36) + ' ' +
        (vulnerability.isDirect ? 'direct' : 'transitive').padEnd(10) + ' ' +
        this.remediation(vulnerability),
      );
    }

    return counts;
  }

  static run(enforce) {
    const counts = this.printReport(this.readReport());
    if (enforce && (counts.high > 0 || counts.critical > 0)) {
      console.error('High/critical vulnerabilities remain. Resolve or explicitly review them.');
      process.exitCode = 1;
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    AuditReporter.run(process.argv.includes('--enforce'));
  } catch (error) {
    console.error('Unable to complete npm audit:', error);
    process.exitCode = 2;
  }
}

export { AuditReporter };
