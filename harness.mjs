// Backward-compatible entry point for the offline regression suite.
import { spawnSync } from 'node:child_process';
const result = spawnSync(process.execPath, ['--experimental-vm-modules', '--test', 'tests/regressions.test.mjs'], {
  cwd: new URL('.', import.meta.url), stdio: 'inherit',
});
process.exitCode = result.status ?? 1;
