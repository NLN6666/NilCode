import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

const projectionProjectsColumnNames = (sql: SqlClient.SqlClient) =>
  sql<{ readonly name: string }>`
    SELECT name FROM pragma_table_info('projection_projects')
  `.pipe(Effect.map((rows) => rows.map((row) => row.name)));

layer("088_ProjectionProjectsBrowserSharing", (it) => {
  it.effect("adds durable project browser-sharing state", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 87 });

      const beforeColumns = yield* projectionProjectsColumnNames(sql);
      assert.notInclude(beforeColumns, "browser_sharing");

      yield* runMigrations();

      const afterColumns = yield* projectionProjectsColumnNames(sql);
      assert.include(afterColumns, "browser_sharing");
    }),
  );

  it.effect("is a no-op when project browser-sharing state already exists", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations();
      yield* runMigrations();

      const columns = yield* projectionProjectsColumnNames(sql);
      assert.include(columns, "browser_sharing");
    }),
  );

  it.effect("defaults pre-existing project rows to isolated", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 87 });

      yield* sql`
        INSERT INTO projection_projects (
          project_id,
          kind,
          title,
          workspace_root,
          default_model_selection_json,
          scripts_json,
          is_pinned,
          space_id,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          'project-legacy',
          'project',
          'Legacy',
          '/tmp/legacy',
          NULL,
          '[]',
          0,
          NULL,
          '2026-01-01T00:00:00.000Z',
          '2026-01-01T00:00:00.000Z',
          NULL
        )
      `;

      yield* runMigrations();

      const rows = yield* sql<{
        readonly browser_sharing: string;
      }>`
        SELECT browser_sharing FROM projection_projects WHERE project_id = 'project-legacy'
      `;
      assert.deepStrictEqual(
        rows.map((row) => row.browser_sharing),
        ["isolated"],
      );
    }),
  );
});
