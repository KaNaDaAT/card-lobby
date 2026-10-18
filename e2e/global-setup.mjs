// Zips the tutorial's example addon before the browser tests, the way `npm run zip-pack` does.
import { execFileSync } from 'node:child_process';

export default function globalSetup() {
  execFileSync(process.execPath, ['scripts/zip-pack.mjs', 'examples/my-first-addon'], { stdio: 'inherit' });
}
