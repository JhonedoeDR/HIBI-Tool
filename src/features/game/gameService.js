const POINT_REWARDS = {
  main: 5,
  routine: 2,
  other: 3,
};

export const LOGIN_BONUS_REWARDS = [
  { type: "jewels", amount: 40 },
  { type: "attackPoints", amount: 1 },
  { type: "jewels", amount: 10 },
  { type: "attackPoints", amount: 1 },
  { type: "jewels", amount: 10 },
  { type: "attackPoints", amount: 3 },
  { type: "jewels", amount: 100 },
];

export function awardTodoCompletion(game, todo, completedAt) {
  const eventId = `todo:${todo.id}:${completedAt}`;
  if (game.rewardedEventIds.includes(eventId)) {
    return game;
  }

  const points = POINT_REWARDS[todo.category];
  if (points === undefined) {
    throw new Error(`Unknown Todo category: ${todo.category}`);
  }

  return {
    ...game,
    normalPoints: game.normalPoints + points,
    rewardedEventIds: [...game.rewardedEventIds, eventId],
  };
}

export function getLoginBonusStatus(loginBonus, now = new Date()) {
  const businessDate = getJstBusinessDate(now);
  const canClaim = loginBonus.lastClaimDate === null || loginBonus.lastClaimDate < businessDate;
  const rewardDay =
    !canClaim && loginBonus.lastClaimDate === businessDate && loginBonus.lastClaimedDay
      ? loginBonus.lastClaimedDay
      : loginBonus.nextDay;

  return {
    businessDate,
    canClaim,
    rewardDay,
    reward: LOGIN_BONUS_REWARDS[rewardDay - 1],
  };
}

export function claimLoginBonus(game, now = new Date()) {
  const status = getLoginBonusStatus(game.loginBonus, now);
  if (!status.canClaim) {
    return game;
  }

  const reward = status.reward;
  const nextDay = status.rewardDay === LOGIN_BONUS_REWARDS.length ? 1 : status.rewardDay + 1;
  return {
    ...game,
    jewels: game.jewels + (reward.type === "jewels" ? reward.amount : 0),
    attackPoints:
      game.attackPoints + (reward.type === "attackPoints" ? reward.amount : 0),
    loginBonus: {
      nextDay,
      lastClaimDate: status.businessDate,
      lastClaimedDay: status.rewardDay,
    },
  };
}

export function getMillisecondsUntilJstCutover(now = new Date()) {
  const nextCutover = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 19),
  );
  if (nextCutover <= now) {
    nextCutover.setUTCDate(nextCutover.getUTCDate() + 1);
  }
  return nextCutover.getTime() - now.getTime();
}

function getJstBusinessDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.valueOf())) {
    throw new TypeError("ログインボーナスの日付が正しくありません。");
  }
  const businessDate = new Date(date.getTime() + 5 * 60 * 60 * 1000);
  return [
    businessDate.getUTCFullYear(),
    String(businessDate.getUTCMonth() + 1).padStart(2, "0"),
    String(businessDate.getUTCDate()).padStart(2, "0"),
  ].join("-");
}
