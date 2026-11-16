const POINT_REWARDS = {
  main: 5,
  routine: 2,
  other: 3,
};

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
