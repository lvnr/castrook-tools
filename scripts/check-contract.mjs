import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const sdk = JSON.parse(readFileSync('packages/castrook-sdk/package.json', 'utf8'));
const manifest = JSON.parse(readFileSync('agents.json', 'utf8'));
const api = JSON.parse(readFileSync('openapi.json', 'utf8'));
const python = readFileSync('packages/castrook-python/pyproject.toml', 'utf8');
const example = JSON.parse(readFileSync('examples/post.json', 'utf8'));
assert(Array.isArray(example.account_ids) && example.account_ids.length > 0);
assert.equal(sdk.version, manifest.distribution.version);
assert.equal(api['x-castrook-distribution'].package_version, sdk.version);
assert.match(python, new RegExp(`version = "${sdk.version.replaceAll('.', '\\.') }"`));
assert.equal(manifest.mcp.tools.length, 33);
const ids = new Set(Object.values(api.paths).flatMap(entries => Object.values(entries).map(op => op.operationId).filter(Boolean)));
for (const tool of manifest.mcp.tools) assert(ids.has(tool.operation_id));
for (const guide of manifest.documentation.guides) {
  const content = readFileSync(`guides/${guide.id}.md`, 'utf8');
  assert(content.includes(guide.url));
  assert.equal((content.match(/^```/gm) ?? []).length % 2, 0);
}
for (const {name: directory} of readdirSync('skills', {withFileTypes: true}).filter(item => item.isDirectory())) {
  const skill = readFileSync(`skills/${directory}/SKILL.md`, 'utf8');
  assert(skill.startsWith('---\n')); assert(skill.includes(`name: ${directory}`));
  assert(skill.includes('description:')); assert(skill.includes('https://castrook.com'));
  assert(readFileSync(`skills/${directory}/agents/openai.yaml`, 'utf8').includes('default_prompt:'));
}
console.log(`Validated version ${sdk.version}, 33 tools, ${ids.size} REST operations and four skills.`);
