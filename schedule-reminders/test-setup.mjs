import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, delimiter} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

// Exercise the real shell script against a stateful gcloud double. No Cloud access.
const gcloud = `#!/usr/bin/env node
const fs = require('node:fs');
const path = process.env.SCHEDULE_TEST_STATE;
const s = JSON.parse(fs.readFileSync(path));
const a = process.argv.slice(2), c = a.join(' ');
const option = name => a.find(x => x.startsWith(name + '='))?.slice(name.length + 1);
s.calls.push(a);
const done = (value = '', code = 0) => {
  fs.writeFileSync(path, JSON.stringify(s));
  if (value) process.stdout.write(typeof value === 'string' ? value : JSON.stringify(value));
  process.exit(code);
};
if (c.startsWith('projects describe ')) done(s.project);
if (c.startsWith('services enable ')) done('', s.failEnable ? 1 : 0);
if (c.startsWith('projects add-iam-policy-binding ')) done();
if (c.startsWith('iam service-accounts describe ')) done('', s.accounts.includes(a[3]) ? 0 : 1);
if (c.startsWith('iam service-accounts create ')) {
  s.accounts.push(a[3] + '@alcoholaway.iam.gserviceaccount.com'); done();
}
if (c.startsWith('iam service-accounts add-iam-policy-binding ')) done();
if (c.startsWith('beta services identity create ')) done();
if (c.startsWith('builds get-default-service-account ')) done(s.build);
if (c.startsWith('iam workload-identity-pools describe ')) done(s.pool || '', s.pool ? 0 : 1);
if (c.startsWith('iam workload-identity-pools create ')) { s.pool = {state: 'ACTIVE'}; done(); }
if (c.startsWith('iam workload-identity-pools providers describe ')) done(s.provider || '', s.provider ? 0 : 1);
if (c.startsWith('iam workload-identity-pools providers create-oidc ')) {
  s.provider = {state: 'ACTIVE', oidc: {issuerUri: option('--issuer-uri')},
    attributeCondition: option('--attribute-condition'),
    attributeMapping: Object.fromEntries(option('--attribute-mapping').split(',').map(x => x.split('=')))};
  done();
}
done('Unexpected gcloud command: ' + c, 99);
`;

function fixture(t, overrides = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'schedule-setup-'));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  const statePath = join(directory, 'state.json');
  writeFileSync(join(directory, 'gcloud'), gcloud, {mode: 0o755});
  writeFileSync(statePath, JSON.stringify({project: '1001199235857',
    accounts: ['alcoholaway@appspot.gserviceaccount.com'],
    build: 'projects/alcoholaway/serviceAccounts/1001199235857-compute@developer.gserviceaccount.com',
    calls: [], ...overrides}));
  return {
    read: () => JSON.parse(readFileSync(statePath, 'utf8')),
    write: state => writeFileSync(statePath, JSON.stringify(state)),
    run: () => spawnSync('bash', [fileURLToPath(new URL('./setup-github-deploy.sh', import.meta.url))], {
      env: {...process.env, PATH: directory + delimiter + process.env.PATH, SCHEDULE_TEST_STATE: statePath},
      encoding: 'utf8', timeout: 15000
    })
  };
}
function success(result) { assert.equal(result.status, 0, result.stderr || result.stdout); }
const grantsTrust = calls => calls.some(a => a.includes('--role=roles/iam.workloadIdentityUser'));

test('wrong project stops before any API or IAM mutation', t => {
  const f = fixture(t, {project: '999999'});
  assert.notEqual(f.run().status, 0);
  assert.equal(f.read().calls.length, 1);
});

for (const legacy of [false, true]) test(`setup is repeatable with ${legacy ? 'legacy' : 'Compute'} build identity`, t => {
  const build = legacy ? '1001199235857@cloudbuild.gserviceaccount.com' : '1001199235857-compute@developer.gserviceaccount.com';
  const f = fixture(t, {build});
  success(f.run());
  const first = f.read();
  assert.ok(grantsTrust(first.calls));
  for (const restriction of ["assertion.repository_id == '1207749530'", "assertion.repository_owner_id == '233573528'",
    "assertion.ref == 'refs/heads/Rollback-version2'", "assertion.event_name == 'push'", "assertion.event_name == 'workflow_dispatch'",
    "assertion.workflow_ref == 'Deflate76/StopAlcohol/.github/workflows/deploy-firebase-functions.yml@refs/heads/Rollback-version2'"]) {
    assert.ok(first.provider.attributeCondition.includes(restriction));
  }
  const actsAsBuild = first.calls.some(a => a[2] === 'add-iam-policy-binding' && a[3] === build);
  assert.equal(actsAsBuild, !legacy, 'Google-owned legacy account has no mutable IAM policy');
  success(f.run());
  const second = f.read();
  assert.deepEqual(second.provider, first.provider);
  assert.equal(second.calls.filter(a => a.includes('create-oidc')).length, 1);
  assert.equal(second.calls.filter(a => a[0] === 'iam' && a[1] === 'service-accounts' && a[2] === 'create').length, 2);
  assert.ok(second.calls.every(a => !a.includes('keys') && !a.includes('--role=roles/owner')));
});

test('existing different trust condition is not overwritten or authorized', t => {
  const f = fixture(t);
  success(f.run());
  const s = f.read();
  s.provider.attributeCondition = "assertion.repository_id == 'another-repo'";
  s.calls = [];
  f.write(s);
  assert.notEqual(f.run().status, 0);
  assert.equal(f.read().provider.attributeCondition, s.provider.attributeCondition);
  assert.equal(grantsTrust(f.read().calls), false);
  assert.ok(f.read().calls.every(a => !a.includes('create-oidc') && !a.includes('update')));
});

test('disabled trust pool stops before authorizing a workflow', t => {
  const f = fixture(t, {pool: {state: 'ACTIVE', disabled: true}});
  assert.notEqual(f.run().status, 0);
  assert.equal(grantsTrust(f.read().calls), false);
});

test('API permission failure stops without reporting success or granting trust', t => {
  const f = fixture(t, {failEnable: true});
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.equal(grantsTrust(f.read().calls), false);
  assert.doesNotMatch(result.stdout, /최초 연결 설정을 완료/);
});
