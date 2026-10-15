import assert from 'node:assert/strict';
import test from 'node:test';
import { buildNextServerEnv } from './server-env.js';

test('desktop child server receives no Firebase Admin credentials by default', () => {
  const env = buildNextServerEnv({
    PATH: '/bin',
    NEXT_PUBLIC_FIREBASE_API_KEY: 'public-key',
    FIREBASE_PROJECT_ID: 'project',
    FIREBASE_CLIENT_EMAIL: 'service@example.invalid',
    FIREBASE_PRIVATE_KEY: 'private-value-must-not-cross',
    FIREBASE_DATABASE_URL: 'https://project.example.invalid',
    STRIPE_SECRET_KEY: 'must-not-cross',
    OTHER_SECRET: 'must-not-cross',
  });

  assert.equal(env.NEXT_PUBLIC_FIREBASE_API_KEY, undefined);
  assert.equal(env.FIREBASE_PROJECT_ID, undefined);
  assert.equal(env.FIREBASE_CLIENT_EMAIL, undefined);
  assert.equal(env.FIREBASE_PRIVATE_KEY, undefined);
  assert.equal(env.FIREBASE_DATABASE_URL, undefined);
  assert.equal(env.STRIPE_SECRET_KEY, undefined);
  assert.equal(env.OTHER_SECRET, undefined);
});

test('self-hosted mode forwards only Firebase Admin values explicitly allowlisted', () => {
  const env = buildNextServerEnv({
    PATH: '/bin',
    ALGOVAULT_SELF_HOSTED: '1',
    FIREBASE_PROJECT_ID: 'project',
    FIREBASE_CLIENT_EMAIL: 'service@example.invalid',
    FIREBASE_PRIVATE_KEY: 'private-value-must-not-be-logged',
    FIREBASE_DATABASE_URL: 'https://project.example.invalid',
    STRIPE_SECRET_KEY: 'must-not-cross',
  }, 43123);

  assert.equal(env.PORT, '43123');
  assert.equal(env.ALGOVAULT_SELF_HOSTED, '1');
  assert.equal(env.FIREBASE_PROJECT_ID, 'project');
  assert.equal(env.FIREBASE_CLIENT_EMAIL, 'service@example.invalid');
  assert.equal(env.FIREBASE_PRIVATE_KEY, 'private-value-must-not-be-logged');
  assert.equal(env.FIREBASE_DATABASE_URL, 'https://project.example.invalid');
  assert.equal(env.STRIPE_SECRET_KEY, undefined);
});
