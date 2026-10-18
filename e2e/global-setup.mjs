// Zips the example addons before the browser tests, so they upload what `npm run zip-pack` makes.
import { execFileSync } from 'node:child_process';

export default function globalSetup() {
  for (const folder of ['examples/addons/off-the-scale', 'examples/addons/second-litter']) {
    execFileSync(process.execPath, ['scripts/zip-pack.mjs', folder], { stdio: 'inherit' });
  }
}
