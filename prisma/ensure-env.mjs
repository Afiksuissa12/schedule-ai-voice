#!/usr/bin/env node
/**
 * Makes a fresh clone runnable with a single command.
 *
 * The Prisma CLI reads DATABASE_URL from `.env`, which is git-ignored (and must
 * stay git-ignored). Without this step a fresh clone fails `prisma generate`
 * with "Environment variable not found: DATABASE_URL" before it can do anything
 * useful. So: if `.env` is absent, create it from `.env.example`.
 *
 * `.env.example` contains no secrets - only the SQLite file URL and an empty
 * OPENAI_API_KEY - so copying it is safe and never overwrites an existing file.
 */
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(repoRoot, '.env');
const examplePath = resolve(repoRoot, '.env.example');

if (existsSync(envPath)) {
  process.exit(0);
}

if (!existsSync(examplePath)) {
  console.error('[ensure-env] .env is missing and .env.example was not found.');
  process.exit(1);
}

copyFileSync(examplePath, envPath);
console.log('[ensure-env] created .env from .env.example (no secrets copied).');
