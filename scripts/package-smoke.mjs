import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
const dir = mkdtempSync(join(tmpdir(), 'castrook-installed-'));
const version = JSON.parse(readFileSync('packages/castrook-sdk/package.json', 'utf8')).version;
const artifact = resolve(`dist/castrook-${version}.tgz`);
try {
  const inventory = execFileSync('tar', ['-tzf', artifact], {encoding: 'utf8'}).trim().split('\n');
  if (inventory.some(path => !/^package\/(?:dist\/|README\.md$|LICENSE$|package\.json$)/.test(path))) throw Error('Unexpected package file');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  execFileSync('npm', ['install', '--ignore-scripts', artifact], { cwd: dir, stdio: 'pipe' });
  const result = execFileSync('node', ['--input-type=module', '-e', `import { Castrook, SDK_VERSION } from 'castrook'; if(SDK_VERSION !== '${version}') throw Error('version'); const sdk=new Castrook({apiKey:'cr_test_example', fetch:async()=>Response.json({data:{mode:'test'}})}); console.log((await sdk.usage.get()).data.mode);`], { cwd: dir, encoding: 'utf8' });
  if (result.trim() !== 'test') throw Error('Installed SDK failed');
  const cliVersion = execFileSync('node', [join(dir, 'node_modules/castrook/dist/cli.js'), '--version'], { cwd: dir, encoding: 'utf8' });
  if (!cliVersion.includes(version)) throw Error('Installed CLI failed');
  writeFileSync(join(dir, 'client.ts'), `import { Castrook } from 'castrook'; const api=new Castrook({apiKey:'cr_test_example'}); void api.posts.create({text:'hello',account_ids:['acc_example']}, {idempotencyKey:'consumer-test-action'});`);
  execFileSync(resolve('node_modules/.bin/tsc'), ['--strict','--noEmit','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022',join(dir,'client.ts')], { cwd: dir, stdio: 'pipe' });
  console.log('Installed package import, declarations and CLI passed.');
} finally { rmSync(dir, { recursive: true, force: true }); }
