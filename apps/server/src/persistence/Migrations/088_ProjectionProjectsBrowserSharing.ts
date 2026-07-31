/**
 * Adds durable browser-sharing state to projected projects so a project can
 * share one in-app browser across its threads instead of giving each thread its
 * own surface. Pre-existing rows default to the per-thread ("isolated") mode.
 */
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { columnExists } from "./schemaHelpers.ts";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  if (yield* columnExists(sql, "projection_projects", "browser_sharing")) {
    return;
  }

  yield* sql`
    ALTER TABLE projection_projects
    ADD COLUMN browser_sharing TEXT NOT NULL DEFAULT 'isolated'
  `;
});
