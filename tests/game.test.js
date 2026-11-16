import assert from "node:assert/strict";
import test from "node:test";
import {
  awardCalendarCompletion,
  awardTodoCompletion,
  claimLoginBonus,
  getLoginBonusStatus,
  getMillisecondsUntilJstCutover,
  LOGIN_BONUS_REWARDS,
} from "../src/features/game/gameService.js";
import {
  createInitialGameState,
  loadAppState,
  saveAppState,
} from "../src/features/todo/todoRepository.js";
import { setTodoCompletion } from "../src/features/todo/todoService.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

test("awards the specified normal points for each Todo category", () => {
  const rewards = [
    ["main", 5],
    ["routine", 2],
    ["other", 3],
  ];

  for (const [category, expectedPoints] of rewards) {
    const updated = awardTodoCompletion(
      createInitialGameState(),
      { id: category, category },
      "2026-11-16T08:00:00.000Z",
    );
    assert.equal(updated.normalPoints, expectedPoints);
  }
});

test("does not award the same completion event more than once", () => {
  const todo = { id: "task-1", category: "main" };
  const eventTime = "2026-11-16T08:00:00.000Z";
  const first = awardTodoCompletion(createInitialGameState(), todo, eventTime);
  const repeated = awardTodoCompletion(first, todo, eventTime);

  assert.equal(repeated.normalPoints, 5);
  assert.equal(repeated.rewardedEventIds.length, 1);
});

test("awards calendar completion once per event", () => {
  const game = createInitialGameState();
  const event = { id: "event-1" };
  const first = awardCalendarCompletion(game, event);

  assert.equal(first.normalPoints, 5);
  assert.deepEqual(awardCalendarCompletion(first, event), first);
});

test("persists Todo completion and its reward in the same application state", () => {
  const storage = memoryStorage();
  const todo = {
    id: "task-1",
    title: "Finish the task",
    category: "main",
    startDate: null,
    dueDate: null,
    checklist: [],
    links: [],
    completed: false,
    completedAt: null,
    createdAt: "2026-11-16T08:00:00.000Z",
    updatedAt: "2026-11-16T08:00:00.000Z",
  };
  const completedTodos = setTodoCompletion(
    [todo],
    todo.id,
    true,
    new Date("2026-11-16T08:30:00.000Z"),
  );
  const completedTodo = completedTodos[0];
  const game = awardTodoCompletion(
    createInitialGameState(),
    completedTodo,
    completedTodo.completedAt,
  );

  saveAppState({ todos: completedTodos, game }, storage);
  const storedState = loadAppState(storage, "2026-11-16");

  assert.equal(storedState.todos[0].completed, true);
  assert.equal(storedState.game.normalPoints, 5);
  assert.equal(storedState.game.rewardedEventIds.length, 1);
});

test("switches the login bonus business date at 04:00 JST", () => {
  const before = new Date("2026-11-16T18:59:59.000Z");
  const atCutover = new Date("2026-11-16T19:00:00.000Z");

  assert.equal(getLoginBonusStatus(createInitialGameState().loginBonus, before).businessDate, "2026-11-16");
  assert.equal(getLoginBonusStatus(createInitialGameState().loginBonus, atCutover).businessDate, "2026-11-17");
  assert.equal(getMillisecondsUntilJstCutover(new Date("2026-11-16T18:59:00.000Z")), 60_000);
});

test("awards each defined login bonus and prevents a second claim on the same JST day", () => {
  let game = createInitialGameState();
  const date = new Date("2026-11-16T19:00:00.000Z");

  for (const [index, reward] of LOGIN_BONUS_REWARDS.entries()) {
    const now = new Date(date.getTime() + index * 24 * 60 * 60 * 1000);
    game = claimLoginBonus(game, now);
    assert.equal(game.jewels, LOGIN_BONUS_REWARDS
      .slice(0, index + 1)
      .filter((entry) => entry.type === "jewels")
      .reduce((sum, entry) => sum + entry.amount, 0));
    assert.equal(game.attackPoints, LOGIN_BONUS_REWARDS
      .slice(0, index + 1)
      .filter((entry) => entry.type === "attackPoints")
      .reduce((sum, entry) => sum + entry.amount, 0));
    assert.equal(getLoginBonusStatus(game.loginBonus, now).canClaim, false);

    const repeated = claimLoginBonus(game, now);
    assert.equal(repeated, game);
    if (index === LOGIN_BONUS_REWARDS.length - 1) {
      assert.equal(getLoginBonusStatus(game.loginBonus, now).rewardDay, 7);
      assert.equal(game.loginBonus.nextDay, 1);
    }
  }
});

test("missed bonus days expire without resetting the next reward day", () => {
  const game = {
    ...createInitialGameState(),
    loginBonus: {
      nextDay: 3,
      lastClaimDate: "2026-11-14",
      lastClaimedDay: 2,
    },
  };
  const now = new Date("2026-11-16T03:00:00.000Z");
  const status = getLoginBonusStatus(game.loginBonus, now);

  assert.equal(status.businessDate, "2026-11-16");
  assert.equal(status.canClaim, true);
  assert.equal(status.rewardDay, 3);

  const claimed = claimLoginBonus(game, now);
  assert.equal(claimed.jewels, 10);
  assert.equal(claimed.loginBonus.nextDay, 4);
});

test("migrates existing application saves without resetting game balances", () => {
  const storage = memoryStorage();
  const oldGame = {
    normalPoints: 12,
    attackPoints: 2,
    jewels: 80,
    rewardedEventIds: ["todo:old:2026-11-15T08:00:00.000Z"],
    area: 2,
    position: 4,
  };
  storage.setItem(
    "daily-tool.state.v1",
    JSON.stringify({ schemaVersion: 1, todos: [], game: oldGame }),
  );

  const loaded = loadAppState(storage, "2026-11-16");
  const saved = JSON.parse(storage.getItem("daily-tool.state.v1"));

  assert.equal(loaded.game.normalPoints, 12);
  assert.equal(loaded.game.jewels, 80);
  assert.deepEqual(loaded.game.loginBonus, {
    nextDay: 1,
    lastClaimDate: null,
    lastClaimedDay: null,
  });
  assert.equal(saved.schemaVersion, 6);
  assert.deepEqual(loaded.calendarEvents, []);
});
