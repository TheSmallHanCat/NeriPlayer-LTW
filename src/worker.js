import { DurableObject } from 'cloudflare:workers';

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type,authorization',
      ...extraHeaders,
    },
  });
}

function randomId(len = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function nowMs() {
  return Date.now();
}

const CONTROLLER_OFFLINE_GRACE_PERIOD_MS = 10 * 60 * 1000;
const CONTROLLER_HEARTBEAT_TIMEOUT_MS = 35 * 1000;
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_PROCESSED_EVENT_IDS = 256;
const MAX_QUEUE_SIZE = 500;
const LINK_REQUEST_COOLDOWN_MS = 1500;
const CONTROL_ARBITRATION_WINDOW_MS = 1500;
const HEARTBEAT_SUPPRESSION_AFTER_MEMBER_CONTROL_MS = 4000;
const ROOM_ID_LENGTH = 6;
const NICKNAME_MIN_LENGTH = 1;
const NICKNAME_MAX_LENGTH = 24;
const ROOM_ID_REGEX = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
const USER_UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NICKNAME_REGEX = /^[\p{Script=Han}A-Za-z0-9]{1,24}$/u;
const textEncoder = new TextEncoder();
const ALLOWED_EVENT_TYPES = new Set([
  'PLAY',
  'PAUSE',
  'SEEK',
  'SET_TRACK',
  'SET_QUEUE',
  'REQUEST_PLAY',
  'REQUEST_PAUSE',
  'REQUEST_SEEK',
  'REQUEST_SET_TRACK',
  'HEARTBEAT',
  'REQUEST_LINK',
  'LINK_READY',
  'UPDATE_SETTINGS',
]);
const CONTROLLABLE_EVENT_TYPES = new Set([
  'PLAY',
  'PAUSE',
  'SEEK',
  'SET_TRACK',
  'SET_QUEUE',
  'HEARTBEAT',
  'LINK_READY',
]);
const REQUEST_CONTROL_EVENT_TYPES = new Set([
  'REQUEST_PLAY',
  'REQUEST_PAUSE',
  'REQUEST_SEEK',
  'REQUEST_SET_TRACK',
]);
const ARBITRATED_CONTROL_TYPES = new Set([
  'PLAY',
  'PAUSE',
  'SEEK',
  'SET_TRACK',
  'SET_QUEUE',
  'HEARTBEAT',
]);

function toBase64Url(bytes) {
  const binary = String.fromCharCode(...bytes);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(input) {
  const base64 = String(input || '').replace(/-/g, '+').replace(/_/g, '/');
  const normalized = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const binary = atob(normalized);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function normalizeRoomId(roomId) {
  return String(roomId || '').trim().toUpperCase();
}

function normalizeUserUuid(userUuid) {
  return String(userUuid || '').trim().toLowerCase();
}

function normalizeNickname(nickname) {
  return String(nickname || '').trim();
}

function validateRoomId(roomId) {
  const normalized = normalizeRoomId(roomId);
  if (normalized.length !== ROOM_ID_LENGTH) {
    return `roomId must be ${ROOM_ID_LENGTH} characters`;
  }
  if (!ROOM_ID_REGEX.test(normalized)) {
    return 'roomId contains invalid characters';
  }
  return null;
}

function validateUserUuid(userUuid) {
  const normalized = normalizeUserUuid(userUuid);
  if (!normalized) {
    return 'userUuid is required';
  }
  if (!USER_UUID_REGEX.test(normalized)) {
    return 'userUuid format is invalid';
  }
  return null;
}

function validateNickname(nickname) {
  const normalized = normalizeNickname(nickname);
  if (normalized.length < NICKNAME_MIN_LENGTH || normalized.length > NICKNAME_MAX_LENGTH) {
    return `nickname length must be ${NICKNAME_MIN_LENGTH}-${NICKNAME_MAX_LENGTH}`;
  }
  if (!NICKNAME_REGEX.test(normalized)) {
    return 'nickname contains invalid characters';
  }
  return null;
}

function sanitizeNicknameOrNull(nickname) {
  const normalized = normalizeNickname(nickname);
  if (!normalized) return null;
  return validateNickname(normalized) == null ? normalized : null;
}

function buildDefaultNickname() {
  return `Neri${randomId(4)}`;
}

function buildMember({ userUuid, nickname, role, joinedAt }) {
  const normalizedUserUuid = normalizeUserUuid(userUuid);
  return {
    userUuid: normalizedUserUuid,
    userId: normalizedUserUuid,
    nickname: sanitizeNicknameOrNull(nickname) || buildDefaultNickname(),
    role,
    joinedAt: Number(joinedAt) || nowMs(),
  };
}

function normalizeStoredMember(member, fallbackUserUuid = null) {
  const userUuid = normalizeUserUuid(member?.userUuid || member?.userId || fallbackUserUuid);
  if (!userUuid) return null;
  return buildMember({
    userUuid,
    nickname: sanitizeNicknameOrNull(member?.nickname) || sanitizeNicknameOrNull(member?.userId) || fallbackUserUuid,
    role: normalizeOptionalString(member?.role) || 'listener',
    joinedAt: member?.joinedAt,
  });
}

function extractIdentity(body = {}) {
  const userUuid = normalizeUserUuid(body.userUuid || body.userId);
  const preferredNickname = sanitizeNicknameOrNull(body.nickname);
  const legacyNickname = sanitizeNicknameOrNull(body.userId);
  const nickname =
    preferredNickname ||
    legacyNickname ||
    buildDefaultNickname();
  return {
    userUuid,
    nickname,
  };
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function normalizePlaybackState(value, fallback = 'paused') {
  if (value === 'playing' || value === 'paused') return value;
  return fallback;
}

function normalizeIndex(index, queueLength, fallback = 0) {
  const safeFallback = Number.isInteger(fallback) ? fallback : 0;
  if (queueLength <= 0) return 0;
  if (!Number.isInteger(index)) return Math.min(Math.max(safeFallback, 0), queueLength - 1);
  return Math.min(Math.max(index, 0), queueLength - 1);
}

function normalizeOptionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeHttpUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return url.toString();
    }
  } catch {}
  return null;
}

function sanitizeTrack(track) {
  if (!isPlainObject(track)) return null;
  const stableKey = normalizeOptionalString(track.stableKey);
  const channelId = normalizeOptionalString(track.channelId);
  const audioId = normalizeOptionalString(track.audioId);
  const name = normalizeOptionalString(track.name);
  const artist = normalizeOptionalString(track.artist);
  if (!stableKey || !channelId || !audioId || !name || !artist) return null;
  const durationMs = Number.isFinite(Number(track.durationMs)) ? Math.max(0, Math.floor(Number(track.durationMs))) : 0;
  return {
    stableKey,
    channelId,
    audioId,
    subAudioId: normalizeOptionalString(track.subAudioId),
    playlistContextId: normalizeOptionalString(track.playlistContextId),
    mediaUri: normalizeOptionalString(track.mediaUri),
    streamUrl: normalizeHttpUrl(track.streamUrl),
    name,
    artist,
    album: normalizeOptionalString(track.album),
    durationMs,
    coverUrl: normalizeHttpUrl(track.coverUrl),
  };
}

function sanitizeQueue(queue) {
  if (!Array.isArray(queue)) return [];
  const next = [];
  for (const item of queue) {
    const sanitized = sanitizeTrack(item);
    if (sanitized) next.push(sanitized);
    if (next.length >= MAX_QUEUE_SIZE) break;
  }
  return next;
}

function sanitizeRoomSettings(settings) {
  return {
    allowMemberControl: settings?.allowMemberControl !== false,
    autoPauseOnMemberChange: settings?.autoPauseOnMemberChange !== false,
    shareAudioLinks: settings?.shareAudioLinks !== false,
  };
}

function buildWsUrl(requestUrl, roomId, token) {
  const url = new URL(requestUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `/api/rooms/${roomId}/ws`;
  url.search = `token=${encodeURIComponent(token)}`;
  return url.toString();
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET,POST,OPTIONS',
          'access-control-allow-headers': 'content-type,authorization',
        },
      });
    }

    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === 'POST' && pathname === '/api/rooms') {
      const body = await request.json().catch(() => ({}));
      const roomId = randomId(6);
      const identity = extractIdentity(body);
      const userUuidError = validateUserUuid(identity.userUuid);
      if (userUuidError) return json({ ok: false, error: userUuidError }, 400);
      const nicknameError = validateNickname(identity.nickname);
      if (nicknameError) return json({ ok: false, error: nicknameError }, 400);
      const initialSnapshot = body.initialSnapshot || {};
      const roomStub = env.ROOMS.get(env.ROOMS.idFromName(roomId));
      const doResp = await roomStub.fetch('https://room.internal/bootstrap', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ roomId, userUuid: identity.userUuid, nickname: identity.nickname, initialSnapshot }),
      });
      const payload = await doResp.json();
      payload.wsUrl = buildWsUrl(request.url, roomId, payload.token);
      return json(payload, doResp.status);
    }

    const joinMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/join$/);
    if (request.method === 'POST' && joinMatch) {
      const [, roomId] = joinMatch;
      const normalizedRoomId = normalizeRoomId(roomId);
      const roomIdError = validateRoomId(normalizedRoomId);
      if (roomIdError) return json({ ok: false, error: roomIdError }, 400);
      const roomStub = env.ROOMS.get(env.ROOMS.idFromName(normalizedRoomId));
      const doResp = await roomStub.fetch('https://room.internal/join', request);
      const payload = await doResp.json();
      if (payload?.token) {
        payload.wsUrl = buildWsUrl(request.url, normalizedRoomId, payload.token);
      }
      return json(payload, doResp.status);
    }

    const match = pathname.match(/^\/api\/rooms\/([^/]+)\/(join|state|control|ws)$/);
    if (match) {
      const [, roomId, action] = match;
      const normalizedRoomId = normalizeRoomId(roomId);
      const roomIdError = validateRoomId(normalizedRoomId);
      if (roomIdError) return json({ ok: false, error: roomIdError }, 400);
      const roomStub = env.ROOMS.get(env.ROOMS.idFromName(normalizedRoomId));

      let targetPath = `/${action}`;
      if (action === 'ws') {
        targetPath += url.search || '';
      }

      return roomStub.fetch(`https://room.internal${targetPath}`, request);
    }

    if (pathname === '/' || pathname === '/healthz') {
      return json({ ok: true, service: 'neriplayer-listen-together-worker' });
    }

    return json({ ok: false, error: 'Not found' }, 404);
  },
};

export class ListeningRoomDO extends DurableObject {
  constructor(state, env) {
    super(state, env);
    this.state = state;
    this.env = env;
    this.sessions = new Map();
    this.linkRequestCooldowns = new Map();
    this.room = this.createEmptyRoom();
    this.tokenKeyPromise = null;
    this.initialized = this.state.blockConcurrencyWhile(async () => {
      this.restoreSocketSessions();
      if (typeof this.state.setWebSocketAutoResponse === 'function') {
        try {
          this.state.setWebSocketAutoResponse(
            new WebSocketRequestResponsePair('{"type":"ping"}', '{"type":"pong"}')
          );
        } catch {}
      }
      await this.load();
    });
  }

  createEmptyRoom() {
    return {
      roomId: null,
      version: 0,
      schemaVersion: 1,
      controllerUserUuid: null,
      controllerUserId: null,
      controllerHeartbeatAt: null,
      settings: {
        allowMemberControl: true,
        autoPauseOnMemberChange: true,
        shareAudioLinks: true,
      },
      members: {},
      queue: [],
      currentIndex: 0,
      track: null,
      playback: {
        state: 'paused',
        basePositionMs: 0,
        baseTimestampMs: nowMs(),
        playbackRate: 1,
      },
      controllerOfflineSince: null,
      roomStatus: 'active',
      closedReason: null,
      processedEventIds: [],
      lastControlCommittedAt: 0,
      lastControlCommittedBy: null,
      lastControlCommittedRole: null,
      lastControlCommittedType: null,
      lastMemberControlRequestSequence: 0,
      updatedAt: nowMs(),
    };
  }

  async load() {
    const saved = await this.state.storage.get('room');
    if (saved) {
      const rawMembers = saved?.members && typeof saved.members === 'object' ? saved.members : {};
      const members = {};
      for (const [memberKey, memberValue] of Object.entries(rawMembers)) {
        const normalizedMember = normalizeStoredMember(memberValue, memberKey);
        if (normalizedMember) {
          members[normalizedMember.userUuid] = normalizedMember;
        }
      }
      const controllerUserUuid = normalizeUserUuid(saved?.controllerUserUuid || saved?.controllerUserId);
      this.room = {
        ...this.createEmptyRoom(),
        ...saved,
        controllerUserUuid,
        controllerUserId: controllerUserUuid,
        members,
        processedEventIds: Array.isArray(saved.processedEventIds) ? saved.processedEventIds : [],
        lastControlCommittedAt: Number(saved?.lastControlCommittedAt) || 0,
        lastControlCommittedBy: normalizeOptionalString(saved?.lastControlCommittedBy),
        lastControlCommittedRole: normalizeOptionalString(saved?.lastControlCommittedRole),
        lastControlCommittedType: normalizeOptionalString(saved?.lastControlCommittedType),
        lastMemberControlRequestSequence: Number(saved?.lastMemberControlRequestSequence) || 0,
      };
    }
  }

  makeSessionId(userUuid) {
    return `${userUuid}:${Math.random().toString(36).slice(2)}`;
  }

  buildSocketAttachment(sessionId, auth) {
    return {
      sessionId,
      auth: {
        roomId: normalizeRoomId(auth.roomId),
        userUuid: normalizeUserUuid(auth.userUuid || auth.userId),
        userId: normalizeUserUuid(auth.userUuid || auth.userId),
        nickname: sanitizeNicknameOrNull(auth.nickname) || buildDefaultNickname(),
        role: auth.role,
      },
    };
  }

  getSocketAttachment(ws) {
    try {
      return ws.deserializeAttachment();
    } catch {
      return null;
    }
  }

  restoreSocketSessions() {
    this.sessions.clear();
    if (typeof this.state.getWebSockets !== 'function') return;
    for (const ws of this.state.getWebSockets()) {
      const attachment = this.getSocketAttachment(ws);
      const sessionId = attachment?.sessionId;
      const auth = attachment?.auth;
      if (!sessionId || !auth?.userUuid) continue;
      this.sessions.set(sessionId, { ws, auth });
    }
  }

  rememberSocketSession(ws, auth) {
    const sessionId = this.makeSessionId(auth.userUuid);
    const attachment = this.buildSocketAttachment(sessionId, auth);
    if (typeof ws.serializeAttachment === 'function') {
      ws.serializeAttachment(attachment);
    }
    this.sessions.set(sessionId, { ws, auth: attachment.auth });
    return { sessionId, auth: attachment.auth };
  }

  ensureSessionForSocket(ws) {
    const attachment = this.getSocketAttachment(ws);
    const sessionId = attachment?.sessionId;
    const auth = attachment?.auth;
    if (!sessionId || !auth?.userUuid) return null;
    const cached = this.sessions.get(sessionId);
    if (!cached) {
      this.sessions.set(sessionId, { ws, auth });
      return { sessionId, ws, auth };
    }
    if (cached.ws !== ws) {
      this.sessions.set(sessionId, { ws, auth: cached.auth || auth });
    }
    return this.sessions.get(sessionId)
      ? { sessionId, ...this.sessions.get(sessionId) }
      : null;
  }

  sanitizeRoomState() {
    return {
      roomId: this.room.roomId,
      version: this.room.version,
      schemaVersion: this.room.schemaVersion,
      controllerUserUuid: this.room.controllerUserUuid,
      controllerUserId: this.room.controllerUserId,
      controllerHeartbeatAt: this.room.controllerHeartbeatAt ?? null,
      settings: this.room.settings || {
        allowMemberControl: true,
        autoPauseOnMemberChange: true,
        shareAudioLinks: true,
      },
      members: Object.values(this.room.members).map((member) => normalizeStoredMember(member)).filter(Boolean),
      queue: this.room.queue,
      currentIndex: this.room.currentIndex,
      track: this.room.track,
      playback: this.room.playback,
      controllerOfflineSince: this.room.controllerOfflineSince ?? null,
      roomStatus: this.room.roomStatus || 'active',
      closedReason: this.room.closedReason ?? null,
      updatedAt: this.room.updatedAt,
    };
  }

  expectedPosition(atMs = nowMs()) {
    const p = this.room.playback;
    if (p.state !== 'playing') return p.basePositionMs;
    return Math.max(0, Math.floor(p.basePositionMs + (atMs - p.baseTimestampMs) * (p.playbackRate || 1)));
  }

  async persist() {
    this.room.updatedAt = nowMs();
    await this.state.storage.put('room', this.room);
  }

  hasProcessedEvent(eventId) {
    if (!eventId) return false;
    return this.room.processedEventIds.includes(eventId);
  }

  markProcessedEvent(eventId) {
    if (!eventId) return;
    const next = Array.isArray(this.room.processedEventIds)
      ? this.room.processedEventIds.filter((id) => id !== eventId)
      : [];
    next.push(eventId);
    if (next.length > MAX_PROCESSED_EVENT_IDS) {
      next.splice(0, next.length - MAX_PROCESSED_EVENT_IDS);
    }
    this.room.processedEventIds = next;
  }

  hasActiveControllerSession() {
    for (const { auth } of this.sessions.values()) {
      if (auth.userUuid === this.room.controllerUserUuid) {
        return true;
      }
    }
    return false;
  }

  controllerSessions() {
    const results = [];
    for (const session of this.sessions.values()) {
      if (session.auth.userUuid === this.room.controllerUserUuid) {
        results.push(session);
      }
    }
    return results;
  }

  sendToController(payload) {
    for (const { ws } of this.controllerSessions()) {
      try {
        ws.send(JSON.stringify(payload));
      } catch {}
    }
  }

  async clearControllerOfflineTimeout() {
    if (typeof this.state.storage.deleteAlarm === 'function') {
      await this.state.storage.deleteAlarm();
    }
  }

  refreshControllerHeartbeat() {
    this.room.controllerHeartbeatAt = nowMs();
  }

  controllerHeartbeatDeadline() {
    if (!this.room.controllerUserUuid) return null;
    const lastHeartbeatAt = this.room.controllerHeartbeatAt ?? this.room.updatedAt ?? nowMs();
    return lastHeartbeatAt + CONTROLLER_HEARTBEAT_TIMEOUT_MS;
  }

  controllerOfflineDeadline() {
    if (!this.room.controllerOfflineSince) return null;
    return this.room.controllerOfflineSince + CONTROLLER_OFFLINE_GRACE_PERIOD_MS;
  }

  async scheduleLifecycleAlarm() {
    if (typeof this.state.storage.setAlarm !== 'function') return;
    const deadlines = [];
    if (this.room.roomStatus === 'active') {
      const heartbeatDeadline = this.controllerHeartbeatDeadline();
      if (heartbeatDeadline) deadlines.push(heartbeatDeadline);
    }
    if (this.room.roomStatus === 'controller_offline') {
      const offlineDeadline = this.controllerOfflineDeadline();
      if (offlineDeadline) deadlines.push(offlineDeadline);
    }
    if (deadlines.length === 0) {
      await this.clearControllerOfflineTimeout();
      return;
    }
    await this.state.storage.setAlarm(Math.min(...deadlines));
  }

  async markControllerOffline() {
    if (!this.room.roomId || this.room.roomStatus === 'closed') return;
    if (this.room.controllerOfflineSince) return;
    this.room.controllerOfflineSince = nowMs();
    this.room.roomStatus = 'controller_offline';
    this.room.closedReason = null;
    this.room.version += 1;
    await this.persist();
    await this.scheduleLifecycleAlarm();
    this.broadcast({
      type: 'room_suspended',
      roomId: this.room.roomId,
      version: this.room.version,
      state: this.sanitizeRoomState(),
      expectedPositionMs: this.expectedPosition(),
      message: 'controller_offline',
    });
  }

  async markControllerOnline() {
    if (!this.room.roomId || this.room.roomStatus === 'closed') return;
    if (this.room.roomStatus !== 'controller_offline') return;
    this.room.controllerOfflineSince = null;
    this.room.roomStatus = 'active';
    this.room.closedReason = null;
    this.room.version += 1;
    await this.persist();
    await this.scheduleLifecycleAlarm();
    this.broadcast({
      type: 'room_resumed',
      roomId: this.room.roomId,
      version: this.room.version,
      state: this.sanitizeRoomState(),
      expectedPositionMs: this.expectedPosition(),
      message: 'controller_reconnected',
    });
  }

  broadcast(payload) {
    for (const { ws } of this.sessions.values()) {
      try {
        ws.send(JSON.stringify(payload));
      } catch {}
    }
  }

  async broadcastRoomState(type = 'room_state_updated', causedBy = null, message = null) {
    if (!this.room.roomId || this.room.roomStatus === 'closed') return;
    const payload = {
      type,
      roomId: this.room.roomId,
      version: this.room.version,
      state: this.sanitizeRoomState(),
      expectedPositionMs: this.expectedPosition(),
      causedBy,
      message,
    };
    this.broadcast(payload);
  }

  normalizeSettings(settings) {
    return sanitizeRoomSettings(settings);
  }

  sanitizeInitialSnapshot(snapshot) {
    const queue = sanitizeQueue(snapshot?.queue);
    const currentIndex = normalizeIndex(snapshot?.currentIndex, queue.length, 0);
    const track = sanitizeTrack(snapshot?.track) || queue[currentIndex] || null;
    return {
      settings: this.normalizeSettings(snapshot?.settings),
      queue,
      currentIndex,
      track,
      isPlaying: snapshot?.isPlaying === true,
      positionMs: Number.isFinite(Number(snapshot?.positionMs)) ? Math.max(0, Math.floor(Number(snapshot.positionMs))) : 0,
    };
  }

  currentTrack() {
    return this.room.track || this.room.queue[this.room.currentIndex] || null;
  }

  trackCommittedControl(type, senderId, role, committedAt = nowMs()) {
    this.room.lastControlCommittedAt = committedAt;
    this.room.lastControlCommittedBy = normalizeOptionalString(senderId);
    this.room.lastControlCommittedRole = normalizeOptionalString(role);
    this.room.lastControlCommittedType = normalizeOptionalString(type);
  }

  buildAppliedPayload(type, senderId, eventId, senderNickname = null) {
    return {
      type,
      roomId: this.room.roomId,
      version: this.room.version,
      state: this.sanitizeRoomState(),
      expectedPositionMs: this.expectedPosition(),
      causedBy: {
        userUuid: senderId,
        userId: senderId,
        nickname: normalizeNickname(senderNickname),
        eventId,
        type,
      },
    };
  }

  nextMemberControlRequestSequence() {
    const next = (Number(this.room.lastMemberControlRequestSequence) || 0) + 1;
    this.room.lastMemberControlRequestSequence = next;
    return next;
  }

  sanitizeForwardedControlPayload(event, effectiveType) {
    const fallbackQueue = Array.isArray(this.room.queue) ? this.room.queue : [];
    const fallbackIndex = normalizeIndex(this.room.currentIndex, fallbackQueue.length, 0);
    const nextQueue = Array.isArray(event.queue) ? sanitizeQueue(event.queue) : fallbackQueue;
    const nextIndex = normalizeIndex(
      event.currentIndex,
      nextQueue.length,
      normalizeIndex(event.currentIndex, fallbackQueue.length, fallbackIndex)
    );
    const nextTrack = sanitizeTrack(event.track) || nextQueue[nextIndex] || this.currentTrack();
    const nextPositionMs = Math.max(0, Number(event.positionMs ?? this.expectedPosition()));
    const nextState =
      effectiveType === 'PLAY'
        ? 'playing'
        : effectiveType === 'PAUSE'
          ? 'paused'
          : normalizePlaybackState(event.state, this.room.playback.state);
    const shouldPlay =
      typeof event.shouldPlay === 'boolean'
        ? event.shouldPlay
        : nextState === 'playing';
    return {
      queue: nextQueue,
      currentIndex: nextIndex,
      track: nextTrack || null,
      positionMs: nextPositionMs,
      shouldPlay,
      stateName: nextState,
      clientTimeMs: Number(event.clientTimeMs) || nowMs(),
      requestTrackStableKey: normalizeOptionalString(event.requestTrackStableKey) || nextTrack?.stableKey || null,
    };
  }

  shouldAcceptRequestedControl() {
    if (this.room.settings?.allowMemberControl === false) {
      return { ok: false, error: 'member control disabled' };
    }
    if (!this.controllerSessions().length) {
      return { ok: false, error: 'controller offline' };
    }
    return { ok: true };
  }

  shouldApplyControllerHeartbeat(now) {
    const lastAt = Number(this.room.lastControlCommittedAt) || 0;
    const lastRole = this.room.lastControlCommittedRole;
    if (
      lastRole === 'listener' &&
      now - lastAt < HEARTBEAT_SUPPRESSION_AFTER_MEMBER_CONTROL_MS
    ) {
      return false;
    }
    return true;
  }

  async commitControlEvent({ event, type, effectiveType, senderId, senderNickname, role, eventId, isController, commitAt }) {
    const committedAt = commitAt || nowMs();
    if (effectiveType === 'PLAY') {
      const nextQueue = Array.isArray(event.queue) ? sanitizeQueue(event.queue) : this.room.queue;
      const nextIndex = normalizeIndex(event.currentIndex, nextQueue.length, this.room.currentIndex);
      this.room.playback = {
        ...this.room.playback,
        state: 'playing',
        basePositionMs: Math.max(0, Number(event.positionMs ?? this.expectedPosition())),
        baseTimestampMs: committedAt,
      };
      this.room.queue = nextQueue;
      this.room.currentIndex = nextIndex;
      this.room.track = sanitizeTrack(event.track) || nextQueue[nextIndex] || this.room.track;
    } else if (effectiveType === 'PAUSE') {
      const nextQueue = Array.isArray(event.queue) ? sanitizeQueue(event.queue) : this.room.queue;
      const nextIndex = normalizeIndex(event.currentIndex, nextQueue.length, this.room.currentIndex);
      this.room.playback = {
        ...this.room.playback,
        state: 'paused',
        basePositionMs: Math.max(0, Number(event.positionMs ?? this.expectedPosition())),
        baseTimestampMs: committedAt,
      };
      this.room.queue = nextQueue;
      this.room.currentIndex = nextIndex;
      this.room.track = sanitizeTrack(event.track) || nextQueue[nextIndex] || this.room.track;
    } else if (effectiveType === 'SEEK') {
      const nextQueue = Array.isArray(event.queue) ? sanitizeQueue(event.queue) : this.room.queue;
      const nextIndex = normalizeIndex(event.currentIndex, nextQueue.length, this.room.currentIndex);
      const currentTrack = sanitizeTrack(event.track) || nextQueue[nextIndex] || this.currentTrack();
      this.room.playback = {
        ...this.room.playback,
        basePositionMs: Math.max(0, Number(event.positionMs ?? 0)),
        baseTimestampMs: committedAt,
      };
      this.room.queue = nextQueue;
      this.room.currentIndex = nextIndex;
      this.room.track = currentTrack;
    } else if (effectiveType === 'HEARTBEAT') {
      const nextQueue = Array.isArray(event.queue) ? sanitizeQueue(event.queue) : this.room.queue;
      const nextIndex = normalizeIndex(event.currentIndex, nextQueue.length, this.room.currentIndex);
      this.room.playback = {
        ...this.room.playback,
        state: normalizePlaybackState(event.state, this.room.playback.state),
        basePositionMs: Math.max(0, Number(event.positionMs ?? this.expectedPosition())),
        baseTimestampMs: committedAt,
      };
      this.room.queue = nextQueue;
      this.room.currentIndex = nextIndex;
      this.room.track = sanitizeTrack(event.track) || nextQueue[nextIndex] || this.room.track;
    } else if (effectiveType === 'LINK_READY') {
      if (!isController) {
        return { ok: false, error: 'only controller can publish link' };
      }
      if (this.room.settings?.shareAudioLinks === false) {
        return { ok: false, error: 'audio link sharing disabled' };
      }
      const sanitizedEventTrack = sanitizeTrack(event.track);
      const targetStableKey =
        normalizeOptionalString(event.requestTrackStableKey) ||
        sanitizedEventTrack?.stableKey ||
        this.currentTrack()?.stableKey ||
        null;
      if (!targetStableKey) {
        return { ok: false, error: 'missing requestTrackStableKey' };
      }
      const mergeTrack = (track) => {
        if (!track || track.stableKey !== targetStableKey) return track;
        const nextUrl = sanitizedEventTrack?.streamUrl || track.streamUrl || null;
        return nextUrl ? { ...track, streamUrl: nextUrl } : track;
      };
      if (Array.isArray(event.queue)) {
        this.room.queue = sanitizeQueue(event.queue).map(mergeTrack);
      } else {
        this.room.queue = this.room.queue.map(mergeTrack);
      }
      this.room.currentIndex = normalizeIndex(event.currentIndex, this.room.queue.length, this.room.currentIndex);
      this.room.track = mergeTrack(sanitizedEventTrack || this.currentTrack());
      this.room.playback = {
        ...this.room.playback,
        state: event.state === 'paused' ? 'paused' : this.room.playback.state,
        basePositionMs: Math.max(0, Number(event.positionMs ?? this.expectedPosition())),
        baseTimestampMs: committedAt,
      };
    } else if (effectiveType === 'SET_TRACK') {
      const nextQueue = Array.isArray(event.queue) ? sanitizeQueue(event.queue) : this.room.queue;
      const nextIndex = normalizeIndex(event.currentIndex, nextQueue.length, this.room.currentIndex);
      this.room.queue = nextQueue;
      this.room.currentIndex = nextIndex;
      this.room.track = sanitizeTrack(event.track) || nextQueue[nextIndex] || null;
      this.room.playback = {
        ...this.room.playback,
        state: event.shouldPlay ? 'playing' : 'paused',
        basePositionMs: Math.max(0, Number(event.positionMs ?? 0)),
        baseTimestampMs: committedAt,
      };
    } else if (effectiveType === 'SET_QUEUE') {
      this.room.queue = Array.isArray(event.queue) ? sanitizeQueue(event.queue) : this.room.queue;
      this.room.currentIndex = normalizeIndex(event.currentIndex, this.room.queue.length, this.room.currentIndex);
      this.room.track = this.room.queue[this.room.currentIndex] || this.room.track;
    } else if (effectiveType === 'UPDATE_SETTINGS') {
      this.room.settings = this.normalizeSettings(event.roomSettings);
    }

    if (isController) {
      this.refreshControllerHeartbeat();
    }
    if (ARBITRATED_CONTROL_TYPES.has(effectiveType) || REQUEST_CONTROL_EVENT_TYPES.has(type)) {
      this.trackCommittedControl(effectiveType, senderId, isController ? 'controller' : 'listener', committedAt);
    }
    this.markProcessedEvent(eventId);

    this.room.roomStatus = 'active';
    this.room.controllerOfflineSince = null;
    this.room.closedReason = null;
    this.room.version += 1;
    await this.persist();
    await this.scheduleLifecycleAlarm();

    const payload = this.buildAppliedPayload(type, senderId, eventId, senderNickname);
    this.broadcast({
      type: 'room_state_updated',
      roomId: payload.roomId,
      version: payload.version,
      state: payload.state,
      expectedPositionMs: payload.expectedPositionMs,
      causedBy: payload.causedBy,
    });
    return { ok: true, applied: payload };
  }

  consumeLinkRequestBudget(userUuid, stableKey) {
    const key = `${userUuid}:${stableKey}`;
    const now = nowMs();
    const lastAt = this.linkRequestCooldowns.get(key) || 0;
    if (now - lastAt < LINK_REQUEST_COOLDOWN_MS) {
      return false;
    }
    this.linkRequestCooldowns.set(key, now);
    return true;
  }

  hasActiveUserSession(userUuid, excludeSessionId = null) {
    for (const [sessionId, session] of this.sessions.entries()) {
      if (sessionId === excludeSessionId) continue;
      if (session.auth.userUuid === userUuid) {
        return true;
      }
    }
    return false;
  }

  async pauseForMemberChange(message, userUuid, nickname, causedByType) {
    if (this.room.settings?.autoPauseOnMemberChange !== true) return;
    this.room.playback = {
      ...this.room.playback,
      state: 'paused',
      basePositionMs: Number(this.expectedPosition()),
      baseTimestampMs: nowMs(),
    };
    this.room.version += 1;
    await this.persist();
    await this.broadcastRoomState(
      'room_state_updated',
      {
        userUuid,
        userId: userUuid,
        nickname,
        eventId: null,
        type: causedByType,
      },
      message
    );
  }

  async closeRoom(reason = 'controller_timeout') {
    if (!this.room.roomId || this.room.roomStatus === 'closed') return;
    this.room.roomStatus = 'closed';
    this.room.closedReason = reason;
    this.room.controllerOfflineSince = this.room.controllerOfflineSince ?? nowMs();
    this.room.version += 1;
    const payload = {
      type: 'room_closed',
      roomId: this.room.roomId,
      version: this.room.version,
      state: this.sanitizeRoomState(),
      expectedPositionMs: this.expectedPosition(),
      message: reason,
    };
    this.broadcast(payload);
    await this.clearControllerOfflineTimeout();
    for (const { ws } of this.sessions.values()) {
      try {
        ws.close(4001, reason);
      } catch {}
    }
    this.sessions.clear();
    if (typeof this.state.storage.deleteAll === 'function') {
      await this.state.storage.deleteAll();
    }
    this.room = this.createEmptyRoom();
  }

  async tokenKey() {
    if (!this.tokenKeyPromise) {
      const secret = this.env.LISTEN_TOGETHER_TOKEN_SECRET || '';
      if (!secret) {
        throw new Error('LISTEN_TOGETHER_TOKEN_SECRET missing');
      }
      this.tokenKeyPromise = crypto.subtle.importKey(
        'raw',
        textEncoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign', 'verify']
      );
    }
    return this.tokenKeyPromise;
  }

  async signTokenPayload(payloadJson) {
    const signature = await crypto.subtle.sign('HMAC', await this.tokenKey(), textEncoder.encode(payloadJson));
    return toBase64Url(new Uint8Array(signature));
  }

  async makeToken({ roomId, userUuid, nickname, role }) {
    const payload = {
      roomId: normalizeRoomId(roomId),
      userUuid: normalizeUserUuid(userUuid),
      userId: normalizeUserUuid(userUuid),
      nickname: normalizeNickname(nickname),
      role,
      issuedAt: nowMs(),
      expiresAt: nowMs() + TOKEN_TTL_MS,
    };
    const payloadJson = JSON.stringify(payload);
    const payloadEncoded = toBase64Url(textEncoder.encode(payloadJson));
    const signature = await this.signTokenPayload(payloadJson);
    return `${payloadEncoded}.${signature}`;
  }

  async parseToken(token) {
    try {
      const [payloadEncoded, signature] = String(token || '').split('.');
      if (!payloadEncoded || !signature) return null;
      const payloadBytes = fromBase64Url(payloadEncoded);
      const payloadJson = new TextDecoder().decode(payloadBytes);
      const verified = await crypto.subtle.verify(
        'HMAC',
        await this.tokenKey(),
        fromBase64Url(signature),
        textEncoder.encode(payloadJson)
      );
      if (!verified) return null;
      const parsed = JSON.parse(payloadJson);
      const roomId = normalizeRoomId(parsed.roomId);
      const userUuid = normalizeUserUuid(parsed.userUuid || parsed.userId);
      const nickname = sanitizeNicknameOrNull(parsed.nickname);
      if (validateRoomId(roomId) || validateUserUuid(userUuid)) return null;
      if (parsed.expiresAt && Number(parsed.expiresAt) < nowMs()) return null;
      return { ...parsed, roomId, userUuid, userId: userUuid, nickname };
    } catch {
      return null;
    }
  }

  async fetch(request) {
    await this.initialized;
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'POST' && path === '/bootstrap') {
      const { roomId, userUuid, nickname, initialSnapshot } = await request.json();
      const normalizedRoomId = normalizeRoomId(roomId);
      const normalizedUserUuid = normalizeUserUuid(userUuid);
      const normalizedNickname = normalizeNickname(nickname) || buildDefaultNickname();
      const roomIdError = validateRoomId(normalizedRoomId);
      if (roomIdError) return json({ ok: false, error: roomIdError }, 400);
      const userUuidError = validateUserUuid(normalizedUserUuid);
      if (userUuidError) return json({ ok: false, error: userUuidError }, 400);
      const nicknameError = validateNickname(normalizedNickname);
      if (nicknameError) return json({ ok: false, error: nicknameError }, 400);
      if (!this.room.roomId) {
        const snapshot = this.sanitizeInitialSnapshot(initialSnapshot);
        this.room.roomId = normalizedRoomId;
        this.room.controllerUserUuid = normalizedUserUuid;
        this.room.controllerUserId = normalizedUserUuid;
        this.room.schemaVersion = 1;
        this.room.settings = snapshot.settings;
        this.room.members[normalizedUserUuid] = buildMember({ userUuid: normalizedUserUuid, nickname: normalizedNickname, role: 'controller', joinedAt: nowMs() });
        this.refreshControllerHeartbeat();
        this.room.queue = snapshot.queue;
        this.room.currentIndex = snapshot.currentIndex;
        this.room.track = snapshot.track;
        this.room.playback = {
          state: snapshot.isPlaying ? 'playing' : 'paused',
          basePositionMs: snapshot.positionMs,
          baseTimestampMs: nowMs(),
          playbackRate: 1,
        };
        this.room.version = 1;
        await this.persist();
        await this.scheduleLifecycleAlarm();
      }
      const token = await this.makeToken({ roomId: normalizedRoomId, userUuid: normalizedUserUuid, nickname: normalizedNickname, role: 'controller' });
      return json({ ok: true, roomId: normalizedRoomId, userUuid: normalizedUserUuid, userId: normalizedUserUuid, nickname: normalizedNickname, role: 'controller', token, state: this.sanitizeRoomState() });
    }

    if (request.method === 'POST' && path === '/join') {
      const body = await request.json().catch(() => ({}));
      const identity = extractIdentity(body);
      const userUuidError = validateUserUuid(identity.userUuid);
      if (userUuidError) return json({ ok: false, error: userUuidError }, 400);
      const nicknameError = validateNickname(identity.nickname);
      if (nicknameError) return json({ ok: false, error: nicknameError }, 400);
      if (!this.room.roomId) return json({ ok: false, error: 'room not initialized' }, 404);
      if (this.room.roomStatus === 'closed') return json({ ok: false, error: 'room closed' }, 410);
      const role = identity.userUuid === this.room.controllerUserUuid ? 'controller' : 'listener';
      this.room.members[identity.userUuid] = buildMember({ userUuid: identity.userUuid, nickname: identity.nickname, role, joinedAt: nowMs() });
      this.room.version += 1;
      await this.persist();
      await this.broadcastRoomState(
        'room_state_updated',
        {
          userUuid: identity.userUuid,
          userId: identity.userUuid,
          nickname: identity.nickname,
          eventId: null,
          type: 'MEMBER_JOINED',
        },
        `member_joined:${identity.nickname}`
      );
      await this.pauseForMemberChange(`member_joined:${identity.nickname}`, identity.userUuid, identity.nickname, 'MEMBER_JOINED');
      const token = await this.makeToken({ roomId: this.room.roomId, userUuid: identity.userUuid, nickname: identity.nickname, role });
      return json({
        ok: true,
        roomId: this.room.roomId,
        userUuid: identity.userUuid,
        userId: identity.userUuid,
        nickname: identity.nickname,
        role,
        autoPauseOnJoin: this.room.settings?.autoPauseOnMemberChange === true,
        token,
        state: this.sanitizeRoomState(),
        wsUrl: buildWsUrl(request.url, this.room.roomId, token),
      });
    }

    if (request.method === 'GET' && path === '/state') {
      if (!this.room.roomId) return json({ ok: false, error: 'room not initialized' }, 404);
      return json({
        ok: true,
        state: this.sanitizeRoomState(),
        expectedPositionMs: this.expectedPosition(),
        autoPauseOnJoin: this.room.settings?.autoPauseOnMemberChange === true,
      });
    }

    if (request.method === 'POST' && path === '/control') {
      const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
      const auth = await this.parseToken(token);
      if (!auth || auth.roomId !== this.room.roomId) return json({ ok: false, error: 'unauthorized' }, 401);
      if (this.room.roomStatus === 'closed') return json({ ok: false, error: 'room closed' }, 410);

      const event = await request.json().catch(() => ({}));
      const result = await this.applyEvent({ ...event, senderId: auth.userUuid, senderNickname: auth.nickname, role: auth.role });
      return json(result, result.ok ? 200 : 400);
    }

    if (path === '/ws') {
      const token = url.searchParams.get('token') || '';
      const auth = await this.parseToken(token);
      if (!auth || auth.roomId !== this.room.roomId) return json({ ok: false, error: 'unauthorized' }, 401);
      if (this.room.roomStatus === 'closed') return json({ ok: false, error: 'room closed' }, 410);
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      await this.handleWsSession(server, auth);
      return new Response(null, { status: 101, webSocket: client });
    }

    return json({ ok: false, error: 'not found in DO' }, 404);
  }

  async handleWsSession(ws, auth) {
    this.state.acceptWebSocket(ws);
    const session = this.rememberSocketSession(ws, auth);
    if (session.auth.userUuid === this.room.controllerUserUuid) {
      this.refreshControllerHeartbeat();
      await this.markControllerOnline();
    }

    ws.send(JSON.stringify({
      type: 'welcome',
      sessionId: session.sessionId,
      userUuid: session.auth.userUuid,
      userId: session.auth.userUuid,
      nickname: session.auth.nickname,
      role: session.auth.role,
      autoPauseOnJoin: this.room.settings?.autoPauseOnMemberChange === true,
      state: this.sanitizeRoomState(),
      expectedPositionMs: this.expectedPosition(),
    }));
  }

  async cleanupSocketSession(ws) {
    const session = this.ensureSessionForSocket(ws);
    if (!session) return;
    this.sessions.delete(session.sessionId);
    const auth = session.auth;
    if (auth.userUuid === this.room.controllerUserUuid && !this.hasActiveControllerSession()) {
      await this.markControllerOffline();
      return;
    }
    if (this.room.members[auth.userUuid] && !this.hasActiveUserSession(auth.userUuid, session.sessionId)) {
      const nickname = this.room.members[auth.userUuid]?.nickname || auth.nickname || auth.userUuid;
      delete this.room.members[auth.userUuid];
      this.room.version += 1;
      await this.persist();
      await this.broadcastRoomState(
        'room_state_updated',
        {
          userUuid: auth.userUuid,
          userId: auth.userUuid,
          nickname,
          eventId: null,
          type: 'MEMBER_LEFT',
        },
        `member_left:${nickname}`
      );
      await this.pauseForMemberChange(`member_left:${nickname}`, auth.userUuid, nickname, 'MEMBER_LEFT');
    }
  }

  async webSocketMessage(ws, message) {
    await this.initialized;
    const session = this.ensureSessionForSocket(ws);
    if (!session) {
      try {
        ws.send(JSON.stringify({ type: 'error', message: 'session_not_found' }));
      } catch {}
      return;
    }
    try {
      const text = typeof message === 'string' ? message : new TextDecoder().decode(message);
      const msg = JSON.parse(text);
      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', nowMs: nowMs() }));
        return;
      }
      const result = await this.applyEvent({ ...msg, senderId: session.auth.userUuid, senderNickname: session.auth.nickname, role: session.auth.role });
      ws.send(JSON.stringify({
        type: 'control_result',
        ok: result.ok,
        result,
        message: result.error || null,
      }));
    } catch (err) {
      try {
        ws.send(JSON.stringify({ type: 'error', message: String(err) }));
      } catch {}
    }
  }

  async webSocketClose(ws) {
    await this.initialized;
    await this.cleanupSocketSession(ws);
  }

  async webSocketError(ws) {
    await this.initialized;
    await this.cleanupSocketSession(ws);
  }

  async applyEvent(event) {
    const type = event.type;
    const senderId = event.senderId;
    const senderNickname = event.senderNickname || this.room.members[senderId]?.nickname || null;
    const role = event.role;
    const eventId = event.eventId || null;
    const isController = role === 'controller' && senderId === this.room.controllerUserUuid;
    const normalizedRequestType = REQUEST_CONTROL_EVENT_TYPES.has(type)
      ? type.replace(/^REQUEST_/, '')
      : null;
    const effectiveType = normalizedRequestType || type;
    const committedAt = nowMs();
    if (!ALLOWED_EVENT_TYPES.has(type)) {
      return { ok: false, error: `unsupported event type: ${type}` };
    }
    if (this.room.roomStatus === 'closed') {
      return { ok: false, error: 'room closed' };
    }
    if (senderId && !this.room.members[senderId]) {
      return { ok: false, error: 'member not in room' };
    }
    if ((CONTROLLABLE_EVENT_TYPES.has(type) || REQUEST_CONTROL_EVENT_TYPES.has(type)) && this.room.roomStatus === 'controller_offline' && !isController) {
      return { ok: false, error: 'controller offline' };
    }
    if (type === 'UPDATE_SETTINGS' && !isController) {
      return { ok: false, error: 'only controller can update settings' };
    }
    if (CONTROLLABLE_EVENT_TYPES.has(type) && !isController) {
      return { ok: false, error: 'only controller can control playback' };
    }
    if (this.hasProcessedEvent(eventId)) {
      return {
        ok: true,
        applied: {
          type: effectiveType,
          roomId: this.room.roomId,
          version: this.room.version,
          state: this.sanitizeRoomState(),
          expectedPositionMs: this.expectedPosition(),
          causedBy: {
            userUuid: senderId,
            userId: senderId,
            nickname: senderNickname,
            eventId,
            type,
          },
        },
      };
    }

    if (type === 'REQUEST_LINK') {
      if (this.room.settings?.shareAudioLinks === false) {
        return { ok: false, error: 'audio link sharing disabled' };
      }
      if (this.room.roomStatus === 'controller_offline' && !isController) {
        return { ok: false, error: 'controller offline' };
      }
      const targetTrack = sanitizeTrack(event.track) || this.currentTrack();
      const requestTrackStableKey = normalizeOptionalString(event.requestTrackStableKey) || targetTrack?.stableKey || null;
      if (!requestTrackStableKey) {
        return { ok: false, error: 'missing requestTrackStableKey' };
      }
      if (!isController && !this.controllerSessions().length) {
        return { ok: false, error: 'controller offline' };
      }
      if (!isController && !this.consumeLinkRequestBudget(senderId, requestTrackStableKey)) {
        return { ok: false, error: 'link request throttled' };
      }
      this.sendToController({
        type: 'link_requested',
        roomId: this.room.roomId,
        causedBy: {
          userUuid: senderId,
          userId: senderId,
          nickname: senderNickname,
          eventId: event.eventId || null,
          type,
        },
        track: targetTrack,
        currentIndex: normalizeIndex(event.currentIndex, this.room.queue.length, this.room.currentIndex),
        requestTrackStableKey,
      });
      return {
        ok: true,
        applied: {
          type,
          roomId: this.room.roomId,
          causedBy: {
            userUuid: senderId,
            userId: senderId,
            nickname: senderNickname,
            eventId: event.eventId || null,
            type,
          },
        },
      };
    }
    if (REQUEST_CONTROL_EVENT_TYPES.has(type)) {
      if (isController) {
        return this.commitControlEvent({
          event,
          type,
          effectiveType,
          senderId,
          senderNickname,
          role,
          eventId,
          isController,
          commitAt: committedAt,
        });
      }
      const arbitration = this.shouldAcceptRequestedControl();
      if (!arbitration.ok) {
        return { ok: false, error: arbitration.error };
      }
      const forwardedPayload = this.sanitizeForwardedControlPayload(event, effectiveType);
      const requestSequence = this.nextMemberControlRequestSequence();
      this.markProcessedEvent(eventId);
      await this.persist();
      this.sendToController({
        type: 'member_control_requested',
        roomId: this.room.roomId,
        requestSequence,
        causedBy: {
          userUuid: senderId,
          userId: senderId,
          nickname: senderNickname,
          eventId,
          type,
        },
        queue: forwardedPayload.queue,
        currentIndex: forwardedPayload.currentIndex,
        track: forwardedPayload.track,
        positionMs: forwardedPayload.positionMs,
        shouldPlay: forwardedPayload.shouldPlay,
        stateName: forwardedPayload.stateName,
        clientTimeMs: forwardedPayload.clientTimeMs,
        requestTrackStableKey: forwardedPayload.requestTrackStableKey,
      });
      return {
        ok: true,
        applied: {
          type,
          roomId: this.room.roomId,
          causedBy: {
            userUuid: senderId,
            userId: senderId,
            nickname: senderNickname,
            eventId,
            type,
          },
        },
      };
    }
    if (effectiveType === 'HEARTBEAT' && !this.shouldApplyControllerHeartbeat(committedAt)) {
      this.markProcessedEvent(eventId);
      return {
        ok: true,
        applied: this.buildAppliedPayload(type, senderId, eventId, senderNickname),
      };
    }

    return this.commitControlEvent({
      event,
      type,
      effectiveType,
      senderId,
      senderNickname,
      role,
      eventId,
      isController,
      commitAt: committedAt,
    });
  }

  async alarm() {
    await this.initialized;
    if (!this.room.roomId) return;
    if (this.room.roomStatus === 'active') {
      const heartbeatDeadline = this.controllerHeartbeatDeadline();
      if (heartbeatDeadline && nowMs() >= heartbeatDeadline) {
        await this.markControllerOffline();
        return;
      }
      await this.scheduleLifecycleAlarm();
      return;
    }
    if (this.room.roomStatus !== 'controller_offline') return;
    const offlineSince = this.room.controllerOfflineSince ?? 0;
    if (nowMs() - offlineSince < CONTROLLER_OFFLINE_GRACE_PERIOD_MS) {
      await this.scheduleLifecycleAlarm();
      return;
    }
    await this.closeRoom('controller_timeout');
  }
}
