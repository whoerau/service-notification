import { openDatabase } from '../src/db/database.js';
import { StateStore } from '../src/state/state-store.js';

export function createTestStateStore() {
  const database = openDatabase(':memory:');
  const state = new StateStore(database.db, database.sqlite);

  return {
    database,
    state
  };
}
