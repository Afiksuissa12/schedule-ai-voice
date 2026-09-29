// Vercel build for the Schedule AI Voice web demo (branch hosted-demo).
//
// 1. Derive a PostgreSQL copy of prisma/schema.prisma. ONLY the datasource changes (provider and a
//    directUrl for schema pushes); every model is identical. The repository's own schema and all of
//    its tests stay on SQLite.
// 2. prisma generate against that copy, so the deployed Prisma client speaks PostgreSQL.
// 3. prisma db push, so the schema exists in the database. It runs HERE, inside Vercel's build, with
//    the database URLs Vercel provides - nobody has to handle the database password.
// 4. Bundle src/web/handler.ts with esbuild into dist/handler.mjs (inlines the committed business
//    profile JSON; keeps @prisma/client external) and copy the page assets next to it.
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const run = (cmd) => execSync(cmd, { cwd: ROOT, stdio: 'inherit', env: process.env });

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set (connect the Neon database to this Vercel project).');
const directEnv = process.env.DATABASE_URL_UNPOOLED ? 'DATABASE_URL_UNPOOLED' : 'DATABASE_URL';

// 1. PostgreSQL schema copy
const source = readFileSync(join(ROOT, 'prisma', 'schema.prisma'), 'utf8');
const datasource = /datasource db \{[^}]*\}/;
if (!datasource.test(source)) throw new Error('Could not find the datasource block in prisma/schema.prisma');
const pg = source.replace(
  datasource,
  `datasource db {\n  provider  = "postgresql"\n  url       = env("DATABASE_URL")\n  directUrl = env("${directEnv}")\n}`,
);
const genDir = join(ROOT, 'deploy', 'vercel', '.generated');
mkdirSync(genDir, { recursive: true });
const schemaPath = join(genDir, 'schema.prisma');
writeFileSync(schemaPath, pg);

// 2 + 3. Prisma client and schema
run(`npx prisma generate --schema "${schemaPath}"`);
run(`npx prisma db push --schema "${schemaPath}" --skip-generate`);

// 4. Bundle the handler
rmSync(join(ROOT, 'dist'), { recursive: true, force: true });
run(
  'npx esbuild src/web/handler.ts --bundle --platform=node --target=node20 --format=esm ' +
    '--outfile=dist/handler.mjs --external:@prisma/client --external:.prisma ' +
    `--banner:js="import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);"`,
);
cpSync(join(ROOT, 'src', 'web', 'public'), join(ROOT, 'dist', 'public'), { recursive: true });
console.log('[vercel-build] done');
