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
expectSourceContains(/const TRACK_BOUND_REQUEST_TYPES = new Set\(\[[\s\S]*'REQUEST_PLAYBACK_MODE'/, 'playback mode current-track binding');
expectSourceContains(/const TRACK_QUEUE_BOUND_REQUEST_TYPES = new Set\(\[[\s\S]*'REQUEST_SET_TRACK'/, 'set-track queue binding');
expectSourceContains(/member control target unavailable/, 'set-track existing queue validation');
expectSourceContains(/const shouldSelectExistingTrack = effectiveType === 'SET_TRACK'/, 'server-owned set-track queue');
expectSourceContains(/fallbackQueue\.findIndex\(\(track\) => track\?\.stableKey === requestedStableKey\)/, 'stable-key based set-track selection');
expectSourceContains(/clientInstanceId/, 'client instance ordering scope');
expectSourceContains(/clientSequence/, 'clientSequence ordering support');
expectSourceContains(/lastControlClientSequences/, 'per-client sequence tracking');
expectSourceContains(/shouldDropOutdatedControlEvent/, 'outdated control event gate');
expectSourceContains(/shouldSkipMemberChangeAutoPause/, 'member-change auto-pause guard');
expectSourceContains(/memberChangeVersion/, 'member-change version barrier');
expectSourceContains(/msg\.type === 'np_ping'/, 'custom clock-sync ping handling');
expectSourceContains(/type: 'np_pong'/, 'custom clock-sync pong handling');
expectSourceContains(/serverNowMs: nowMs\(\)/, 'HTTP state server clock timestamp');
expectSourceContains(/nowMs: nowMs\(\)/, 'WebSocket server clock timestamp');
expectSourceContains(/CONTROLLER_HEARTBEAT_TIMEOUT_MS = 45 \* 1000/, '45 second controller heartbeat timeout');
expectSourceContains(/MEMBER_SECRET_BYTES = 32/, 'per-member secret entropy');
expectSourceContains(/memberSecretsMatch/, 'constant-time member secret comparison');
expectSourceContains(/member_secret_required/, 'member secret rejection');
expectSourceContains(/sanitizeMemberForState/, 'private member secret redaction');
expectSourceContains(/async authenticateMember\(request\)/, 'authenticated room state access');
expectSourceContains(/const auth = await this\.authenticateMember\(request\)/, 'state bearer token check');
expectSourceContains(/if \(!auth\) return json\(\{ ok: false, error: 'unauthorized' \}, 401\);\n      if \(this\.room\.roomStatus === 'closed'\)/, 'control bearer token check');
expectSourceContains(/room already initialized/, 'bootstrap replay rejection');
expectSourceContains(/expiresAt = Number\(parsed\.expiresAt\)/, 'mandatory token expiry validation');
expectSourceContains(/existingMember &&\n        bearerAuth\?\.roomId === this\.room\.roomId/, 'rejoin bearer membership binding');
expectSourceContains(/member not in room/, 'revoked WebSocket membership rejection');
expectSourceContains(/neriplayer-listen-together-worker/, 'public health endpoint probe');
expectSourceContains(/ROOM_JOIN_SECRET_BYTES = 32/, 'room invite secret entropy');
expectSourceContains(/join_secret_required/, 'invite secret rejection');
expectSourceContains(/crypto\.getRandomValues\(new Uint8Array\(len\)\)/, 'cryptographically random room identifiers');
