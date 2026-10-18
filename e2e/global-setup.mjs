// Zips the example pack before the browser tests, so they upload what `npm run zip-pack` makes.
import { execFileSync } from 'node:child_process';

export default function globalSetup() {
  execFileSync(process.execPath, ['scripts/zip-pack.mjs', 'examples/packs/power-hungry-pets-wild'], { stdio: 'inherit' });
}
