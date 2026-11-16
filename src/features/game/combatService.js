export class CombatValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "CombatValidationError";
  }
}

export function resolveAttack({ attackPoints, normalPoints, weapons, enemyHp }) {
  validateBalance(attackPoints, "攻撃専用ポイント");
  validateBalance(normalPoints, "通常ポイント");
  if (!Number.isFinite(enemyHp) || enemyHp < 0) {
    throw new CombatValidationError("敵HPが正しくありません。");
  }
  if (enemyHp === 0) {
    throw new CombatValidationError("撃破済みの敵には攻撃できません。");
  }
  if (!Array.isArray(weapons) || weapons.length === 0 || weapons.length > 3) {
    throw new CombatValidationError("装備中の武器を1〜3個にしてください。");
  }

  const attackPower = weapons.reduce((total, weapon) => {
    if (
      !weapon ||
      !Number.isFinite(weapon.attackPower) ||
      weapon.attackPower < 0 ||
      !Number.isFinite(total + weapon.attackPower)
    ) {
      throw new CombatValidationError("武器の攻撃力が正しくありません。");
    }
    return total + weapon.attackPower;
  }, 0);

  if (attackPoints === 0 && normalPoints === 0) {
    throw new CombatValidationError("攻撃に使えるポイントがありません。");
  }

  const usedAttackPoint = attackPoints > 0;
  const remainingAttackPoints = attackPoints - Number(usedAttackPoint);
  const remainingNormalPoints = normalPoints - Number(!usedAttackPoint);
  const remainingEnemyHp = Math.max(0, enemyHp - attackPower);

  return {
    attackPower,
    remainingEnemyHp,
    enemyDefeated: remainingEnemyHp === 0,
    points: {
      attackPoints: remainingAttackPoints,
      normalPoints: remainingNormalPoints,
    },
    spentPointType: usedAttackPoint ? "attack" : "normal",
  };
}

function validateBalance(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CombatValidationError(`${label}が正しくありません。`);
  }
}
