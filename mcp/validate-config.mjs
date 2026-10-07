#!/usr/bin/env node
/**
 * Validate that ~/.dsh/profiles/web/cordis.patch.yml still parses after edits.
 *
 * A syntax error in that file takes down every MCP server in the profile, so it
 * is worth checking explicitly rather than assuming.
 *
 * The `!!js` tags contain JavaScript expressions, not YAML values. They are
 * registered as a custom tag that returns the raw source string, because the
 * goal here is syntax validation, not evaluation.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';

/*
 * De DSH-configuratie staat in de thuismap van de gebruiker, niet op een vast
 * pad: die verschilt per machine en hoort niet in een publieke repo thuis.
 */
const DSH_DIR = process.env.DSH_HOME || path.join(homedir(), '.dsh');
const PROFILES = path.join(DSH_DIR, 'profiles');

const require = createRequire(path.join(PROFILES, 'node_modules', 'noop.js'));
const YAML = require('yaml');

const CONFIG = process.env.DSH_CONFIG || path.join(PROFILES, 'web', 'cordis.patch.yml');

/**
 * `!!js` is not a standard YAML tag, so it must be registered before parsing.
 * `js-yaml`/`yaml` resolve the shorthand `!!js` to the YAML-domain tag
 * `tag:yaml.org,2002:js`, which is the name a custom tag has to use — matching
 * on the literal string '!!js' silently fails and leaves a plain string.
 */
const jsTag = {
  tag: 'tag:yaml.org,2002:js',
  resolve(value) {
    return { __jsExpression: String(value).trim() };
  },
};

let doc;
try {
  doc = YAML.parse(readFileSync(CONFIG, 'utf8'), { customTags: [jsTag] });
} catch (error) {
  console.log(`YAML FOUT: ${error.message}`);
  process.exit(1);
}

console.log('YAML parse: OK');

const insert = Array.isArray(doc) ? doc.find((entry) => Array.isArray(entry.insert))?.insert : null;
if (!insert) {
  console.log('FOUT: geen `insert:` lijst gevonden op het hoogste niveau');
  process.exit(1);
}

console.log(`insert-entries: ${insert.length}`);
console.log('server-ids    : ' + insert.map((e) => e.id).join(', '));

const cavascp = insert.find((e) => e.id === 'mcp-cavascp');
if (!cavascp) {
  console.log('FOUT: mcp-cavascp niet gevonden');
  process.exit(1);
}

const config = cavascp.config ?? {};
console.log('');
console.log('mcp-cavascp:');
console.log(`  name       : ${cavascp.name}`);
console.log(`  serverName : ${config.serverName}`);
console.log(`  transport  : ${config.transport}`);
console.log(`  command    : ${config.command}`);
console.log(`  args       : ${JSON.stringify(config.args)}`);
const isJsExpression = (value) =>
  typeof value === 'string' ||
  (typeof value === 'object' && value !== null && '__jsExpression' in value);

console.log(`  cwd        : ${config.cwd}`);
console.log(`  env is !!js: ${isJsExpression(config.env) ? 'ja' : 'NEE'}`);
const github = insert.find((e) => e.id === 'mcp-github');
console.log(
  `  github hdr : ${isJsExpression(github?.config?.headers) ? '!!js (zoals verwacht)' : 'GEEN !!js'}`,
);

const problems = [];
if (cavascp.name !== '@deepseek-ai/dsh-mcp-client') problems.push('verkeerde client-plugin naam');
if (config.transport !== 'stdio') problems.push('transport moet stdio zijn');
if (config.command !== 'node') problems.push('command moet node zijn');
if (!Array.isArray(config.args) || !config.args[0]?.endsWith('server.mjs')) {
  problems.push('args moet naar server.mjs wijzen');
}
if (!isJsExpression(config.env)) problems.push('env moet een !!js-expressie zijn');

console.log('');
if (problems.length) {
  console.log(`PROBLEMEN: ${problems.join('; ')}`);
  process.exit(1);
}
console.log('CONFIG OK');
