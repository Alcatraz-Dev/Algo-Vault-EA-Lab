const FIREBASE_ADMIN_ENV_KEYS = [
  'FIREBASE_PROJECT_ID',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_PRIVATE_KEY',
  'FIREBASE_DATABASE_URL',
] as const;

export interface NextServerEnvOptions {
  /** Set only from Electron's trusted app.isPackaged runtime property. */
  isPackaged?: boolean;
  source?: NodeJS.ProcessEnv;
  port?: number;
}

/**
 * Build the embedded Next.js process environment. Packaged applications never
 * receive Firebase Admin credentials. Unpackaged operator runs must explicitly
 * opt in with ALGOVAULT_SELF_HOSTED=1; development mode alone grants nothing.
 */
export function buildNextServerEnv({
  source = process.env,
  port = 3000,
  isPackaged,
}: NextServerEnvOptions): NodeJS.ProcessEnv {
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
    'LANG', 'LC_ALL', 'LC_CTYPE',
  ]) {
    if (source[key]) env[key] = source[key];
  }

  // The embedded server is always loopback-only. Local AI is enabled for the
  // desktop shell on both packaged and unpackaged runs; the endpoint is a fixed
  // loopback constant, never copied from the user's environment.
  env.ALGOVAULT_LOCAL_AI = '1';
  env.OLLAMA_BASE_URL = 'http://127.0.0.1:11434';

  // app.isPackaged comes from Electron, not process.env. An inherited flag (or
  // any other ordinary environment variable) cannot override this boundary.
  const selfHosted = isPackaged === false && source.ALGOVAULT_SELF_HOSTED === '1';
  if (!selfHosted) return env;

  env.ALGOVAULT_SELF_HOSTED = '1';
  for (const key of FIREBASE_ADMIN_ENV_KEYS) {
    if (source[key]) env[key] = source[key];
    else delete env[key];
  }

  return env;
}

