import assert from 'node:assert/strict';
import test from 'node:test';
import { getFirebaseAdminConfig } from '../../../../lib/firebase-admin-config.js';
import { buildNextServerEnv } from './server-env.js';

const adminCredentials = {
  FIREBASE_PROJECT_ID: 'dummy-project',
  FIREBASE_CLIENT_EMAIL: 'dummy-service@example.invalid',
  FIREBASE_PRIVATE_KEY: 'dummy-private-key-for-tests-only',
  FIREBASE_DATABASE_URL: 'https://dummy-project.example.invalid',
};
const adminKeys = Object.keys(adminCredentials);

function assertNoAdminCredentials(env: NodeJS.ProcessEnv): void {
  for (const key of adminKeys) assert.equal(env[key], undefined, `${key} must not cross the child boundary`);
}

test('default desktop mode never forwards Firebase Admin credentials', () => {
  const env = buildNextServerEnv({
    source: {
      PATH: '/bin',
      NEXT_PUBLIC_FIREBASE_API_KEY: 'public-key',
      ALGOVAULT_DEV: '1',
      ...adminCredentials,
      STRIPE_SECRET_KEY: 'must-not-cross',
      OTHER_SECRET: 'must-not-cross',
      NODE_OPTIONS: '--require=/tmp/untrusted-preload.js',
    },
    isPackaged: false,
  });

  assertNoAdminCredentials(env);
  assert.equal(env.NEXT_PUBLIC_FIREBASE_API_KEY, undefined);
  assert.equal(env.ALGOVAULT_DEV, undefined);
  assert.equal(env.STRIPE_SECRET_KEY, undefined);
  assert.equal(env.OTHER_SECRET, undefined);
  assert.equal(env.NODE_OPTIONS, undefined);
});

test('missing packaged-mode attestation fails closed despite inherited self-host and Admin values', () => {
  const env = buildNextServerEnv({
    source: { ALGOVAULT_SELF_HOSTED: '1', ...adminCredentials },
  });
  assert.equal(env.ALGOVAULT_SELF_HOSTED, undefined);
  assertNoAdminCredentials(env);
});

test('packaged mode ignores inherited ALGOVAULT_SELF_HOSTED and strips all Admin values', () => {
  const env = buildNextServerEnv({
    source: {
      PATH: '/bin',
      ALGOVAULT_SELF_HOSTED: '1',
      ...adminCredentials,
      STRIPE_SECRET_KEY: 'must-not-cross',
    },
    isPackaged: true,
    port: 43123,
  });

  assert.equal(env.PORT, '43123');
  assert.equal(env.ALGOVAULT_SELF_HOSTED, undefined);
  assertNoAdminCredentials(env);
  assert.equal(env.STRIPE_SECRET_KEY, undefined);
});

test('packaged mode remains protected when Admin variables and override-like values are present', () => {
  const env = buildNextServerEnv({
    source: {
      ALGOVAULT_SELF_HOSTED: '1',
      ...adminCredentials,
      FIREBASE_ADMIN_ALLOW_PACKAGED: '1',
      ALGOVAULT_ALLOW_ADMIN_CREDENTIALS: '1',
      NEXT_PUBLIC_FIREBASE_PRIVATE_KEY: 'must-not-cross',
      NODE_OPTIONS: '--require=/tmp/untrusted-preload.js',
    },
    isPackaged: true,
  });

  assertNoAdminCredentials(env);
  assert.equal(env.ALGOVAULT_SELF_HOSTED, undefined);
  assert.equal(env.FIREBASE_ADMIN_ALLOW_PACKAGED, undefined);
  assert.equal(env.ALGOVAULT_ALLOW_ADMIN_CREDENTIALS, undefined);
  assert.equal(env.NEXT_PUBLIC_FIREBASE_PRIVATE_KEY, undefined);
  assert.equal(env.NODE_OPTIONS, undefined);
});

test('untrusted environment settings cannot opt in outside packaged mode', () => {
  for (const selfHosted of ['true', 'yes', '0', '']) {
    const env = buildNextServerEnv({
      source: { ALGOVAULT_SELF_HOSTED: selfHosted, ...adminCredentials },
      isPackaged: false,
    });
    assertNoAdminCredentials(env);
    assert.equal(env.ALGOVAULT_SELF_HOSTED, undefined);
  }

  const devMode = buildNextServerEnv({
    source: { ALGOVAULT_DEV: '1', ...adminCredentials },
    isPackaged: false,
  });
  assertNoAdminCredentials(devMode);
  assert.equal(devMode.ALGOVAULT_DEV, undefined);
});

test('trusted unpackaged operator mode explicitly forwards only allowlisted Admin values', () => {
  const env = buildNextServerEnv({
    source: {
      PATH: '/bin',
      ALGOVAULT_SELF_HOSTED: '1',
      ...adminCredentials,
      STRIPE_SECRET_KEY: 'must-not-cross',
    },
    isPackaged: false,
    port: 43123,
  });

  assert.equal(env.PORT, '43123');
  assert.equal(env.ALGOVAULT_SELF_HOSTED, '1');
  for (const key of adminKeys) assert.equal(env[key], adminCredentials[key as keyof typeof adminCredentials]);
  assert.equal(env.STRIPE_SECRET_KEY, undefined);
});

test('missing Admin configuration keeps the explicit server-side error', () => {
  assert.throws(
    () => getFirebaseAdminConfig({}),
    /Missing Firebase Admin environment variables: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY, NEXT_PUBLIC_FIREBASE_DATABASE_URL\. Please configure them in your server environment\./,
  );
});
