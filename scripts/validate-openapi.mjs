#!/usr/bin/env node
import { readFileSync } from 'fs';
import { join } from 'path';

const openapiPath = join(process.cwd(), 'docs/api/openapi.yaml');
try {
  const content = readFileSync(openapiPath, 'utf8');
  // Basic validation
  if (!content.includes('openapi:')) {
    console.error('Missing openapi version');
    process.exit(1);
  }
  if (!content.includes('/api/v1/')) {
    console.error('Missing API paths');
    process.exit(1);
  }
  console.log('OpenAPI spec validation passed');
  process.exit(0);
} catch (error) {
  console.error('Error:', error.message);
  process.exit(1);
}
