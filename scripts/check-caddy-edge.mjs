import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const out = execFileSync('sh', [
  'deploy/render-caddy-dedicated.sh',
  'ofeliya.freeveol.dpdns.org',
  'deploy/Caddyfile.ofeliya',
], { encoding: 'utf8' });

assert.match(out, /^ofeliya\.freeveol\.dpdns\.org \{/);
assert.match(out, /redir \/ \/ofeliya\/ 308/);
assert.match(out, /handle_path \/ofeliya\/\*/);
assert.match(out, /https:\/\/st\.max\.ru/);
assert.match(out, /https:\/\/telegram\.org/);
assert.match(out, /https:\/\/web\.telegram\.org/);
assert.match(out, /Strict-Transport-Security/);

let failed = false;
try {
  execFileSync('sh', [
    'deploy/render-caddy-dedicated.sh',
    'https://invalid.example',
    'deploy/Caddyfile.ofeliya',
  ], { stdio: 'ignore' });
} catch {
  failed = true;
}
assert.equal(failed, true, 'renderer must reject a host containing a URL scheme');

const deploy = readFileSync('deploy/deploy-cloudru.sh', 'utf8');
assert.match(deploy, /sync_caddy_edge\(\)/);
assert.match(deploy, /caddy validate/);
assert.match(deploy, /caddy reload/);
assert.match(deploy, /restoring previous edge config/);
assert.match(deploy, /cat "\$\{backup\}" > "\$\{dedicated_file\}"/);

console.log('Caddy edge render/reload contract: ok');

[executed on device: chatgpt-ops-1 (ca22b74b-ed01-4519-b9df-03edbe57a1ba)]