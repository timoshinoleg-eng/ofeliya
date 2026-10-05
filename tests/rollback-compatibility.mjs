import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const workflow = readFileSync('.github/workflows/deploy-cloudru.yml', 'utf8');
const deployScript = readFileSync('deploy/deploy-cloudru.sh', 'utf8');
const select = workflow.slice(workflow.indexOf('# Public SHA verification'), workflow.indexOf('echo "sha=$sha"'));
const capture = workflow.slice(workflow.indexOf('[[ "$previous" =~'), workflow.indexOf('echo "sha=$previous"'));
const guardStart = deployScript.indexOf('# Use the current trusted checkout\'s policy');
const guardEnd = deployScript.indexOf('if ! git merge-base --is-ancestor "${OFELIYA_RELEASE}" origin/main;', guardStart);
assert.notEqual(guardStart, -1, 'deploy must load the current compatibility policy');
assert.notEqual(guardEnd, -1, 'deploy compatibility policy block must precede release ancestry check');
const deployGuard = deployScript.slice(guardStart, guardEnd);
assert.ok(!deployScript.includes('SCRIPT_DIR'), 'deploy compatibility must not depend on the script extraction directory');
const bash = process.platform === 'win32'
  ? ['C:/Users/Имярек/Tools/PortableGit/bin/bash.exe', 'C:/Program Files/Git/bin/bash.exe'].find(existsSync)
  : 'bash';
assert.ok(bash, 'Git Bash required for actual workflow policy execution');
const old = 'e57b5e8';
const current = 'edb1b9a706f019e37a1ef148a55f07faaf2c1f59';
const git = (ref) => spawnSync('git', ['rev-parse', ref], { encoding: 'utf8' }).stdout.trim();
for (const [name, script, key] of [['selected release', select, 'sha'], ['captured rollback', capture, 'previous']]) {
  for (const [sha, allowed] of [[git(old), false], [current, true]]) {
    const child = spawnSync(bash, ['-c', 'set -Eeuo pipefail\n' + script], {
      env: { ...process.env, [key]: sha, release_url: 'https://example.test/release.json' }, encoding: 'utf8', timeout: 10000,
    });
    assert.equal(child.status === 0, allowed, `${name} must reject pre-webhook SHA before rollout: ${child.stderr}`);
  }
}

const guardPrefix = `set -Eeuo pipefail
git() {
  if [[ "$1" == show && "$2" == origin/main:deploy/check-compatible-release.sh ]]; then
    case "\${POLICY_MODE:-real}" in
      missing) return 1 ;;
      empty) return 0 ;;
      whitespace) printf ' \n\t'; return 0 ;;
    esac
  fi
  command git "$@"
}
`;
for (const [label, sha, mode, allowed] of [
  ['standalone current policy', current, 'real', true],
  ['standalone old SHA', git(old), 'real', false],
  ['standalone invalid SHA', 'not-a-sha', 'real', false],
  ['standalone missing helper', current, 'missing', false],
  ['standalone empty helper', current, 'empty', false],
  ['standalone whitespace helper', current, 'whitespace', false],
]) {
  const child = spawnSync(bash, ['-c', guardPrefix + deployGuard], {
    env: { ...process.env, OFELIYA_RELEASE: sha, SCRIPT_DIR: '/tmp/extracted-deploy-script', POLICY_MODE: mode },
    encoding: 'utf8', timeout: 10000,
  });
  assert.equal(child.status === 0, allowed, `${label} policy must ${allowed ? 'allow' : 'reject'}: ${child.stderr}`);
}
console.log('executed deployment/rollback compatibility policy: ok');
