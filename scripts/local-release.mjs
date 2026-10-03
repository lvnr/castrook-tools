import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const action = process.argv[2];
const options = process.argv.slice(3);
if (!['check', 'prepare', 'verify'].includes(action) ||
    (options.length && (action !== 'prepare' || options.length !== 2 || options[0] !== '--artifacts' || !options[1] || options[1].startsWith('-')))) {
  console.error('Usage: npm run check | npm run release:prepare [-- --artifacts DIRECTORY] | npm run release:verify');
  process.exit(2);
}
const metadata = JSON.parse(readFileSync('package.json', 'utf8'));
assert.equal(metadata.name, 'castrook-tools', 'Run this only in the curated public distribution checkout.');
assert(metadata.private && existsSync('distribution-files.json'), 'Missing public export allowlist.');
const version = metadata.version;
assert(/^\d+\.\d+\.\d+$/.test(version), 'Expected a stable release version.');
const python = process.env.CASTROOK_RELEASE_PYTHON ?? join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const releaseDir = resolve('dist/releases', version);
const manifestPath = resolve('dist/release-manifest.json');
const hash = data => createHash('sha256').update(data).digest('hex');
const run = (label, command, args, cwd = root, capture = false) => {
  console.log(`\n${label}`);
  const env = command === python ? { ...process.env, PYTHONPATH: resolve('packages/castrook-python/src') } : process.env;
  return execFileSync(command, args, { cwd, env, stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit', encoding: 'utf8' });
};
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
function source() {
  const paths = JSON.parse(readFileSync('distribution-files.json', 'utf8')).files;
  const files = [...paths].sort().map(path => {
    assert(!path.startsWith('/') && !path.split('/').includes('..') && !path.includes('\\'), 'Invalid export path.');
    assert(lstatSync(path).isFile(), 'Export files must be regular files.');
    return { path, sha256: hash(readFileSync(path)) };
  });
  let commit = null;
  try { commit = git(['rev-parse', 'HEAD']); } catch { /* An exact staged export can precede its first commit. */ }
  return { commit, dirty: Boolean(git(['status', '--porcelain', '--untracked-files=no'])), sha256: hash(JSON.stringify(files)), files };
}
function verify() {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.version, version, 'Release version changed; prepare again.');
  assert.equal(manifest.source.sha256, source().sha256, 'Checked source changed; prepare again.');
  assert.equal(manifest.artifacts.length, 3, 'Expected npm, wheel and source archives.');
  for (const artifact of manifest.artifacts) {
    const path = join(releaseDir, artifact.name);
    assert(/^[a-zA-Z0-9_.-]+$/.test(artifact.name), 'Invalid artifact filename.');
    assert(lstatSync(path).isFile(), 'Release artifacts must be regular files.');
    assert.equal(hash(readFileSync(path)), artifact.sha256, `Artifact changed: ${artifact.name}`);
  }
  git(['check-ignore', relative(root, manifestPath)]);
  console.log(`Verified source and three immutable ${version} release archives.`);
}
if (action === 'verify') {
  verify();
  process.exit(0);
}
assert(existsSync(python), 'Create .venv and install the documented Python development tools first, or set CASTROOK_RELEASE_PYTHON to that interpreter path.');
const before = source();
const stage = mkdtempSync(join(tmpdir(), 'castrook-local-release-'));
const built = join(stage, 'built');
mkdirSync(built);
try {
  run('Public export allowlist', process.execPath, ['scripts/check-export.mjs']);
  run('Package/API/guide version contract', process.execPath, ['scripts/check-contract.mjs']);
  run('SDK and CLI build', 'npm', ['run', 'build']);
  run('SDK and CLI tests', 'npm', ['test']);
  run('Installable skills', python, ['scripts/check-skills.py']);
  run('Release payload guard regressions', python, ['scripts/test-release-artifacts.py']);
  run('Verify Python tests use this checkout', python, ['-c', 'from pathlib import Path; import castrook; assert Path(castrook.__file__).resolve().is_relative_to((Path.cwd() / "src").resolve()), "Python source came from another checkout"'], resolve('packages/castrook-python'));
  run('Python tests', python, ['-m', 'pytest'], resolve('packages/castrook-python'));
  run('Python strict types', python, ['-m', 'mypy'], resolve('packages/castrook-python'));
  run('Python lint', python, ['-m', 'ruff', 'check', 'src', 'tests'], resolve('packages/castrook-python'));
  run('Build npm archive in isolation', 'npm', ['pack', '--workspace', 'castrook', '--ignore-scripts', '--pack-destination', built]);
  run('Build Python source archive and its wheel in isolation', python, ['-m', 'build', '--outdir', built], resolve('packages/castrook-python'));
  const candidate = options.length ? resolve(options[1]) : built;
  const artifacts = JSON.parse(run('Compare checked source with release archive payloads', python, ['scripts/check-artifacts.py', version, candidate, built], root, true));
  run('Validate Python release metadata and README', python, ['-m', 'twine', 'check', '--strict', ...artifacts.filter(item => !item.name.endsWith('.tgz')).map(item => join(candidate, item.name))]);
  run('Cold-installed npm consumer: imports, types and CLI', process.execPath, ['scripts/package-smoke.mjs', join(candidate, `castrook-${version}.tgz`)]);
  const consumer = join(stage, 'python-consumer');
  run('Create isolated Python wheel consumer', python, ['-m', 'venv', consumer]);
  const consumerPython = join(consumer, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  run('Install exact Python wheel', consumerPython, ['-m', 'pip', 'install', '--disable-pip-version-check', join(candidate, `castrook-${version}-py3-none-any.whl`)]);
  run('Cold-installed Python consumer: sync, async, typing and uploads', consumerPython, ['-I', resolve('packages/castrook-python/tests/wheel_smoke.py')], stage);
  assert.equal(source().sha256, before.sha256, 'Public source changed during checks; rerun.');
  if (action === 'prepare') {
    mkdirSync(releaseDir, { recursive: true });
    // A local ignore file keeps generated archives and the non-secret manifest out of Git.
    const ignore = resolve('dist/.gitignore');
    if (!existsSync(ignore)) writeFileSync(ignore, '*\n');
    git(['check-ignore', relative(root, manifestPath)]);
    for (const artifact of artifacts) {
      const destination = join(releaseDir, artifact.name);
      if (existsSync(destination)) {
        assert(lstatSync(destination).isFile(), 'Existing artifact must be a regular file.');
        assert.equal(hash(readFileSync(destination)), artifact.sha256, `Refusing to replace ${artifact.name}. Use the checked immutable archives with --artifacts, or a new version.`);
      } else {
        copyFileSync(join(candidate, artifact.name), destination);
      }
    }
    const manifest = {
      format: 1, version, prepared_at: new Date().toISOString(), source: before,
      tools: { node: process.version, npm: run('npm version', 'npm', ['--version'], root, true).trim(), python: run('Python version', python, ['--version'], root, true).trim() },
      checks: ['export', 'contract', 'sdk-build', 'sdk-cli-tests', 'skills', 'artifact-guard-tests', 'python-tests', 'python-types', 'python-lint', 'npm-pack', 'python-build', 'source-payload-match', 'twine-strict', 'installed-npm', 'installed-wheel'],
      artifacts,
    };
    writeFileSync(`${manifestPath}.tmp`, JSON.stringify(manifest, null, 2) + '\n');
    renameSync(`${manifestPath}.tmp`, manifestPath);
    verify();
    console.log('Prepared dist/release-manifest.json and dist/releases/' + version + '/. No registry upload was performed.');
  } else {
    console.log(`\nAll ${version} local distribution checks passed. No release archives were retained or uploaded.`);
  }
} finally {
  rmSync(stage, { recursive: true, force: true });
}
