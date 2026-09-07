/**
 * Adds the per-thread advisor override. NULL means "follow the global setting",
 * which is what every existing thread wants: backfilling the current global
 * value instead would freeze it, so later flipping the default would silently
 * skip every thread that already existed.
 */
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const [column] = yield* sql<{ readonly exists: number }>`
    SELECT EXISTS(
      SELECT 1
      FROM pragma_table_info('projection_threads')
      WHERE name = 'advisor_enabled'
    ) AS "exists"
  `;
  if (column?.exists !== 1) {
    // Do not catch SqlError here. Only the explicit already-present case is
    // idempotent; locks, read-only databases, and I/O failures must leave the
    // migration pending so a later startup can retry instead of recording a
    // schema change that never happened.
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN advisor_enabled INTEGER
    `;
  }
});
