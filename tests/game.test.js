import assert from "node:assert/strict";
import test from "node:test";
import { awardTodoCompletion } from "../src/features/game/gameService.js";
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
