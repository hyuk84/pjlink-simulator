import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  POWER,
  createProjectorState,
  createSession,
  expectedDigest,
  finishPowerTransition,
  greeting,
  handleLine,
} from '../src/protocol.mjs';

const newSession = (options) => createSession(createProjectorState(options), { random: '498e4a67' });

test('without a password, greets with PJLINK 0 and accepts commands', () => {
  const session = newSession();
  assert.equal(greeting(session), 'PJLINK 0');
  assert.equal(handleLine(session, '%1POWR ?').reply, '%1POWR=0');
});

test('power on goes through warm-up; power commands during warm-up get ERR3', () => {
  const session = newSession();
  const result = handleLine(session, '%1POWR 1');
  assert.equal(result.reply, '%1POWR=OK');
  assert.equal(result.transition, POWER.ON);
  assert.equal(handleLine(session, '%1POWR ?').reply, '%1POWR=3');
  assert.equal(handleLine(session, '%1POWR 0').reply, '%1POWR=ERR3');

  assert.equal(finishPowerTransition(session.state, POWER.ON), true);
  assert.equal(handleLine(session, '%1POWR ?').reply, '%1POWR=1');
  assert.equal(handleLine(session, '%1LAMP ?').reply, '%1LAMP=1234 1');
});

test('ERR3 for input while off, ERR2 for bad params, ERR1 for unknown commands', () => {
  const session = newSession();
  assert.equal(handleLine(session, '%1INPT 31').reply, '%1INPT=ERR3');
  assert.equal(handleLine(session, '%1POWR 5').reply, '%1POWR=ERR2');
  assert.equal(handleLine(session, '%1ABCD ?').reply, '%1ABCD=ERR1');
  assert.equal(handleLine(session, '%2POWR ?').reply, '%2POWR=ERR1');
});

test('with a password, the first command needs md5(random + password)', () => {
  const session = newSession({ password: 'admin' });
  assert.equal(greeting(session), 'PJLINK 1 498e4a67');

  const digest = expectedDigest('498e4a67', 'admin');
  const ok = handleLine(session, `${digest}%1POWR ?`);
  assert.equal(ok.reply, '%1POWR=0');
  assert.ok(ok.events.includes('auth ok'));
  // After auth, commands are accepted with or without the digest.
  assert.equal(handleLine(session, '%1CLSS ?').reply, '%1CLSS=1');
  assert.equal(handleLine(session, `${digest}%1NAME ?`).reply, '%1NAME=PJLink Simulator');
});

test('wrong digest replies PJLINK ERRA and closes', () => {
  const session = newSession({ password: 'admin' });
  const result = handleLine(session, `${'0'.repeat(32)}%1POWR 1`);
  assert.equal(result.reply, 'PJLINK ERRA');
  assert.equal(result.close, true);
  assert.equal(session.state.power, POWER.OFF);
});
