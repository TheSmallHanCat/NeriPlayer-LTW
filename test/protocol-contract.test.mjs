import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const workerSource = readFileSync(resolve(here, '../src/worker.js'), 'utf8');

function readStringSet(name) {
  const match = workerSource.match(new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\);`));
  if (!match) {
    throw new Error(`missing ${name}`);
  }
  return new Set(
    [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]),
  );
}

function expectSetContains(setName, eventType) {
  const values = readStringSet(setName);
  if (!values.has(eventType)) {
    throw new Error(`${setName} must include ${eventType}`);
  }
}

function expectSourceContains(pattern, description) {
  if (!pattern.test(workerSource)) {
    throw new Error(`worker must keep ${description}`);
  }
}

expectSetContains('ALLOWED_EVENT_TYPES', 'PLAYBACK_MODE');
expectSetContains('CONTROLLABLE_EVENT_TYPES', 'PLAYBACK_MODE');
expectSetContains('ARBITRATED_CONTROL_TYPES', 'PLAYBACK_MODE');
expectSetContains('ALLOWED_EVENT_TYPES', 'REQUEST_PLAYBACK_MODE');
expectSetContains('REQUEST_CONTROL_EVENT_TYPES', 'REQUEST_PLAYBACK_MODE');
expectSourceContains(/clientInstanceId/, 'client instance ordering scope');
expectSourceContains(/clientSequence/, 'clientSequence ordering support');
expectSourceContains(/lastControlClientSequences/, 'per-client sequence tracking');
expectSourceContains(/shouldDropOutdatedControlEvent/, 'outdated control event gate');
expectSourceContains(/shouldSkipMemberChangeAutoPause/, 'member-change auto-pause guard');
expectSourceContains(/memberChangeVersion/, 'member-change version barrier');
