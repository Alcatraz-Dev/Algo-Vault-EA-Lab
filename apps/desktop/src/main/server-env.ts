const FIREBASE_ADMIN_ENV_KEYS = [
  'FIREBASE_PROJECT_ID',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_PRIVATE_KEY',
  'FIREBASE_DATABASE_URL',
] as const;

/**
 * Build the embedded Next.js process environment. Admin credentials are removed
 * by default and are passed only in explicit, operator-managed self-hosted mode.
 */
export function buildNextServerEnv(
  source: NodeJS.ProcessEnv = process.env,
  port = 3000,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PORT: String(port),
    HOSTNAME: '127.0.0.1',
    NODE_ENV: 'production',
    ELECTRON_RUN_AS_NODE: '1',
    NEXT_TELEMETRY_DISABLED: '1',
  };

  // Pass only OS process essentials, not the user's arbitrary environment
  // (which may contain unrelated credentials such as Stripe or cloud keys).
  for (const key of [
    'PATH', 'HOME', 'USER', 'USERPROFILE', 'TMPDIR', 'TEMP', 'TMP',
    'SYSTEMROOT', 'WINDIR', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA',
    'LANG', 'LC_ALL', 'LC_CTYPE', 'NODE_OPTIONS',
  ]) {
    if (source[key]) env[key] = source[key];
  }

  const selfHosted = source.ALGOVAULT_SELF_HOSTED === '1';
  if (!selfHosted) return env;

  env.ALGOVAULT_SELF_HOSTED = '1';
  for (const key of FIREBASE_ADMIN_ENV_KEYS) {
    if (source[key]) env[key] = source[key];
    else delete env[key];
  }

  return env;
}

