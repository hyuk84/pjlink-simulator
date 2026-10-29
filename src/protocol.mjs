// PJLink Class 1 protocol handling. Socket-free so it can be unit tested.
//
//   greeting  "PJLINK 0" (no auth) | "PJLINK 1 <random>" (auth)
//   auth      first command is prefixed with md5(random + password), else "PJLINK ERRA"
//   command   "%1CMND param" -> "%1CMND=OK|ERR1|ERR2|ERR3|<value>"

import { createHash, randomBytes } from 'node:crypto';

// POWR ? values
export const POWER = {
  OFF: '0',
  ON: '1',
  COOLING: '2',
  WARMING: '3',
};

const POWER_LABEL = {
  [POWER.OFF]: 'off',
  [POWER.ON]: 'on',
  [POWER.COOLING]: 'cooling down',
  [POWER.WARMING]: 'warming up',
};

export const powerLabel = (code) => POWER_LABEL[code] ?? code;

// 1x RGB, 2x VIDEO, 3x DIGITAL, 4x STORAGE, 5x NETWORK
const INPUTS = ['11', '12', '31', '32', '51'];
const AV_MUTE_VALUES = ['10', '11', '20', '21', '30', '31'];

export const createProjectorState = ({ name = 'PJLink Simulator', lampHours = 1234, password = '' } = {}) => ({
  name,
  password,
  power: POWER.OFF,
  input: '31',
  avMute: '30',
  lampHours,
  // fan, lamp, temp, cover, filter, other (0 ok / 1 warning / 2 error)
  errorStatus: '000000',
});

export const createSession = (state, { random = randomBytes(4).toString('hex') } = {}) => ({
  state,
  random,
  authenticated: !state.password,
});

export const greeting = (session) => (session.state.password ? `PJLINK 1 ${session.random}` : 'PJLINK 0');

export const expectedDigest = (random, password) => createHash('md5').update(random + password).digest('hex');

// Handles one line (without the trailing \r).
// Returns { reply, events, close?, transition? }:
//   reply       line to send without \r, or null for no reply
//   events      human-readable notes for the log
//   close       close the socket after replying (auth failure)
//   transition  target power state; caller calls finishPowerTransition after warm-up/cool-down
export function handleLine(session, rawLine) {
  let line = rawLine;
  const events = [];

  if (session.state.password && !session.authenticated) {
    const digest = line.slice(0, 32);
    if (line.length < 32 || digest.toLowerCase() !== expectedDigest(session.random, session.state.password)) {
      return { reply: 'PJLINK ERRA', events: ['auth failed (digest mismatch)'], close: true };
    }
    session.authenticated = true;
    events.push('auth ok');
    line = line.slice(32);
  } else if (session.state.password && /^[0-9a-fA-F]{32}%/.test(line)) {
    // Some clients keep sending the digest after auth.
    line = line.slice(32);
  }

  const match = /^%([12])([A-Za-z0-9]{4})(?: (.*))?$/.exec(line);
  if (!match) {
    // The spec defines no reply for malformed lines.
    return { reply: null, events: [...events, `malformed line: ${JSON.stringify(rawLine)}`] };
  }

  const [, pjClass, rawCommand, rawParam = ''] = match;
  const command = rawCommand.toUpperCase();
  const param = rawParam.trim();
  const respond = (result) => ({ reply: `%${pjClass}${command}=${result}`, events });

  // Class 1 only (CLSS ? -> 1).
  if (pjClass !== '1') {
    events.push(`class ${pjClass} not supported`);
    return respond('ERR1');
  }

  const { state } = session;
  const isQuery = param === '?';
  const transitioning = state.power === POWER.WARMING || state.power === POWER.COOLING;

  switch (command) {
    case 'POWR': {
      if (isQuery) return respond(state.power);
      if (param !== '0' && param !== '1') return respond('ERR2');
      if (transitioning) {
        events.push(`power ${param === '1' ? 'on' : 'off'} rejected: ${powerLabel(state.power)}`);
        return respond('ERR3');
      }
      if (param === '1' && state.power === POWER.OFF) {
        state.power = POWER.WARMING;
        events.push('power on -> warming up');
        return { ...respond('OK'), transition: POWER.ON };
      }
      if (param === '0' && state.power === POWER.ON) {
        state.power = POWER.COOLING;
        events.push('power off -> cooling down');
        return { ...respond('OK'), transition: POWER.OFF };
      }
      events.push(`power ${param === '1' ? 'on' : 'off'}: already ${powerLabel(state.power)}`);
      return respond('OK');
    }

    case 'INPT': {
      if (isQuery) return state.power === POWER.ON ? respond(state.input) : respond('ERR3');
      if (!INPUTS.includes(param)) return respond('ERR2');
      if (state.power !== POWER.ON) return respond('ERR3');
      state.input = param;
      events.push(`input -> ${param}`);
      return respond('OK');
    }

    case 'AVMT': {
      if (isQuery) return state.power === POWER.ON ? respond(state.avMute) : respond('ERR3');
      if (!AV_MUTE_VALUES.includes(param)) return respond('ERR2');
      if (state.power !== POWER.ON) return respond('ERR3');
      state.avMute = param;
      events.push(`av mute -> ${param}`);
      return respond('OK');
    }

    case 'ERST':
      return isQuery ? respond(state.errorStatus) : respond('ERR2');

    case 'LAMP':
      // "<hours> <on 1|0>", one pair per lamp
      return isQuery ? respond(`${state.lampHours} ${state.power === POWER.ON ? 1 : 0}`) : respond('ERR2');

    case 'INST':
      return isQuery ? respond(INPUTS.join(' ')) : respond('ERR2');

    case 'NAME':
      return isQuery ? respond(state.name) : respond('ERR2');

    case 'INF1':
      return isQuery ? respond('SIMULATOR') : respond('ERR2');

    case 'INF2':
      return isQuery ? respond('PJLINK-SIMULATOR') : respond('ERR2');

    case 'INFO':
      return isQuery ? respond('PJLink Class 1 simulator') : respond('ERR2');

    case 'CLSS':
      return isQuery ? respond('1') : respond('ERR2');

    default:
      events.push(`unsupported command: ${command}`);
      return respond('ERR1');
  }
}

// Completes a warm-up/cool-down. Returns false if the state changed in the meantime.
export function finishPowerTransition(state, target) {
  if (target === POWER.ON && state.power === POWER.WARMING) {
    state.power = POWER.ON;
    return true;
  }
  if (target === POWER.OFF && state.power === POWER.COOLING) {
    state.power = POWER.OFF;
    return true;
  }
  return false;
}
