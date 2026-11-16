import assert from "node:assert/strict";
import test from "node:test";
import {
  CombatValidationError,
  resolveAttack,
} from "../src/features/game/combatService.js";

test("one attack sums equipped weapon power and spends attack-only points first", () => {
  const result = resolveAttack({
    attackPoints: 2,
    normalPoints: 5,
    weapons: [{ attackPower: 4 }, { attackPower: 7 }, { attackPower: 3 }],
    enemyHp: 30,
  });

  assert.equal(result.attackPower, 14);
  assert.equal(result.remainingEnemyHp, 16);
  assert.equal(result.enemyDefeated, false);
  assert.deepEqual(result.points, { attackPoints: 1, normalPoints: 5 });
  assert.equal(result.spentPointType, "attack");
});

test("normal points cover the attack when no attack-only points remain", () => {
  const result = resolveAttack({
    attackPoints: 0,
    normalPoints: 1,
    weapons: [{ attackPower: 5 }],
    enemyHp: 4,
  });

  assert.equal(result.remainingEnemyHp, 0);
  assert.equal(result.enemyDefeated, true);
  assert.deepEqual(result.points, { attackPoints: 0, normalPoints: 0 });
  assert.equal(result.spentPointType, "normal");
});

test("attacks reject invalid balances, weapon sets, and defeated enemies", () => {
  const base = {
    attackPoints: 1,
    normalPoints: 1,
    weapons: [{ attackPower: 1 }],
    enemyHp: 10,
  };

  assert.throws(
    () => resolveAttack({ ...base, attackPoints: -1 }),
    CombatValidationError,
  );
  assert.throws(
    () => resolveAttack({ ...base, weapons: Array(4).fill({ attackPower: 1 }) }),
    CombatValidationError,
  );
  assert.throws(
    () => resolveAttack({ ...base, weapons: [{ attackPower: -1 }] }),
    CombatValidationError,
  );
  assert.throws(
    () => resolveAttack({ ...base, attackPoints: 0, normalPoints: 0 }),
    CombatValidationError,
  );
  assert.throws(
    () => resolveAttack({ ...base, enemyHp: 0 }),
    CombatValidationError,
  );
});
