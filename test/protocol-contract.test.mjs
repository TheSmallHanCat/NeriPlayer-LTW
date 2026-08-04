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
expectSetContains('ALLOWED_EVENT_TYPES', 'SET_QUEUE');
expectSetContains('CONTROLLABLE_EVENT_TYPES', 'SET_QUEUE');
expectSetContains('ARBITRATED_CONTROL_TYPES', 'SET_QUEUE');
expectSetContains('ALLOWED_EVENT_TYPES', 'REQUEST_PLAYBACK_MODE');
expectSetContains('REQUEST_CONTROL_EVENT_TYPES', 'REQUEST_PLAYBACK_MODE');
expectSetContains('ALLOWED_EVENT_TYPES', 'REQUEST_SET_QUEUE');
expectSetContains('REQUEST_CONTROL_EVENT_TYPES', 'REQUEST_SET_QUEUE');
expectSourceContains(/const TRACK_BOUND_REQUEST_TYPES = new Set\(\[[\s\S]*'REQUEST_PLAYBACK_MODE'/, 'playback mode current-track binding');
expectSourceContains(/const TRACK_QUEUE_BOUND_REQUEST_TYPES = new Set\(\[[\s\S]*'REQUEST_SET_TRACK'/, 'set-track queue binding');
expectSourceContains(/member control target unavailable/, 'set-track existing queue validation');
expectSourceContains(/const requesterQueue = Array\.isArray\(event\.queue\) \? sanitizeQueue\(event\.queue\) : \[\];/, 'sanitized requester queue');
expectSourceContains(/\(effectiveType === 'SET_TRACK' \|\| effectiveType === 'SET_QUEUE'\) && requesterQueue\.length > 0;/, 'listener queue adoption');
expectSourceContains(/const nextQueue = shouldReplaceQueue\s*\? requesterQueue\s*:\s*shuffledQueue\?\.queue \|\| fallbackQueue;/, 'set-track queue fallback');
expectSourceContains(/function hasSameTrackStableKeyMultiset/, 'queue reorder membership comparison');
expectSourceContains(/validateQueueReorderEvent\(event\)/, 'queue reorder validation');
expectSourceContains(/queue reorder content mismatch/, 'queue reorder content rejection');
expectSourceContains(/queue reorder current track mismatch/, 'queue reorder current-track rejection');
expectSourceContains(/shuffleListenTogetherQueue\(fallbackQueue, fallbackIndex\)/, 'listener playback mode shared queue shuffle');
expectSourceContains(/isController \|\| type === 'REQUEST_PLAYBACK_MODE'/, 'playback mode queue commitment');
expectSourceContains(/requesterQueue\.some\(\(track\) => track\?\.stableKey === requestedStableKey\)/, 'requester queue target validation');
expectSourceContains(/clientInstanceId/, 'client instance ordering scope');
expectSourceContains(/clientSequence/, 'clientSequence ordering support');
expectSourceContains(/lastControlClientSequences/, 'per-client sequence tracking');
expectSourceContains(/shouldDropOutdatedControlEvent/, 'outdated control event gate');
expectSourceContains(/wrapSingleTrackRepeatPosition/, 'single-track repeat position wrapping');
expectSourceContains(/playback\?\.repeatMode !== REPEAT_MODE_ONE/, 'single-track repeat mode guard');
expectSourceContains(/shouldSkipMemberChangeAutoPause/, 'member-change auto-pause guard');
expectSourceContains(/memberChangeVersion/, 'member-change version barrier');
expectSourceContains(/msg\.type === 'np_ping'/, 'custom clock-sync ping handling');
expectSourceContains(/type: 'np_pong'/, 'custom clock-sync pong handling');
expectSourceContains(/async refreshControllerHeartbeatForSocket\(session\)/, 'socket heartbeat refresh helper');
expectSourceContains(/if \(msg\.type === 'np_ping'\) \{\s+await this\.refreshControllerHeartbeatForSocket\(session\);/, 'controller heartbeat refresh on custom ping');
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
expectSourceContains(/streamUrlCache/, 'durable room stream URL cache');
expectSourceContains(/const isNewMember = !existingMember;/, 'same identity rejoin classification');
expectSourceContains(/type: isNewMember \? 'MEMBER_JOINED' : 'MEMBER_REJOINED'/, 'rejoin event distinction');
expectSourceContains(/isNewMember\s*&&\s*!this\.room\.trackFinishBarrier\s*&&\s*this\.room\.settings\?\.autoPauseOnMemberChange === true/, 'new-member auto-pause only');
expectSourceContains(/async leaveMember\(auth\)/, 'explicit member leave handling');
expectSourceContains(/delete this\.room\.members\[auth\.userUuid\]/, 'explicit member removal');
expectSourceContains(/type: 'MEMBER_LEFT'/, 'member leave broadcast');
expectSourceContains(/path === '\/leave'/, 'authenticated leave endpoint');
expectSourceContains(/shouldIgnoreMemberChangeHeartbeat/, 'member-change heartbeat barrier');
expectSourceContains(/requested link does not match current track/, 'stale link request rejection');
expectSourceContains(/link target does not match current track/, 'stale link publication rejection');
expectSourceContains(/event\.forceRefresh/, 'forced cache bypass for a stalled listener');
expectSourceContains(/local tracks cannot be shared/, 'local track rejection');

const cleanupSocketSession = workerSource.match(
  /async cleanupSocketSession\(ws\) \{([\s\S]*?)\n  \}\n\n  async webSocketMessage/
);
if (!cleanupSocketSession) {
  throw new Error('worker must keep websocket cleanup handling');
}
if (/delete this\.room\.members/.test(cleanupSocketSession[1])) {
  throw new Error('websocket cleanup must not remove credential-bound room members');
}
