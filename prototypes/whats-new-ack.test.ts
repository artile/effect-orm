// Throwaway pilot: run with `mise exec -- bun x --no-install vitest run prototypes`.
import * as D1Client from "@effect/sql-d1/D1Client"
import { asc, eq, gt } from "drizzle-orm"
import * as Drizzle from "drizzle-orm/effect-d1"
import { sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Cause, Effect, Exit, Schema } from "effect"
import * as SqlClient from "effect/sql/SqlClient"
import { Miniflare } from "miniflare"
import { expect, it } from "vitest"
import * as Db from "../src/database"
import * as SQL from "./sqlite"
import { custom } from "../src/ch/types"

const ormTable = SQL.table("orm_ack", {
	id: SQL.text,
	entry_id: SQL.text,
	user_id: SQL.text,
	org_id: SQL.text,
	acked_at: SQL.text,
}, { tenantColumn: "org_id" })
const drizzleTable = sqliteTable("drizzle_ack", {
	id: text().primaryKey(),
	entry_id: text().notNull(),
	user_id: text().notNull(),
	org_id: text().notNull(),
	acked_at: text().notNull(),
})
const fixture = [
	{ id: "ack_1", entry_id: "release_1", user_id: "user_1", org_id: "org_1", acked_at: "2026-10-01T09:00:00.000Z" },
	{ id: "ack_2", entry_id: "release_2", user_id: "user_1", org_id: "org_1", acked_at: "2026-10-02T09:00:00.000Z" },
	{ id: "ack_3", entry_id: "release_1", user_id: "user_2", org_id: "org_2", acked_at: "2026-10-03T09:00:00.000Z" },
]

it("matches Drizzle on a real local D1 binding: copy, first-write-wins, by-user reads and paging", async () => {
	const mf = new Miniflare({
		modules: true,
		script: "export default { fetch() { return new Response('pilot') } }",
		compatibilityDate: "2026-07-01",
		d1Databases: ["DB"],
	})
	try {
		const binding = await mf.getD1Database("DB")
		const result = await Effect.runPromise(Effect.gen(function* () {
			const client = yield* SqlClient.SqlClient
			const db = Db.fromSqlClient(client, { dialect: SQL.d1Dialect, requireTenantScope: true })
			const drizzle = yield* Drizzle.makeWithDefaults({})
			for (const name of ["orm_ack", "drizzle_ack"]) {
				yield* db.execute({ sql: `CREATE TABLE ${name} (id TEXT PRIMARY KEY, entry_id TEXT NOT NULL, user_id TEXT NOT NULL, org_id TEXT NOT NULL, acked_at TEXT NOT NULL, UNIQUE(entry_id, user_id))` })
			}
			const repeated = { ...fixture[0]!, id: "ack_9", acked_at: "2026-10-09T09:00:00.000Z" }
			for (const rows of [fixture, [repeated]]) {
				yield* db.run(SQL.insertInto(ormTable).values(rows).onConflictDoNothing().crossTenant())
				yield* drizzle.insert(drizzleTable).values(rows).onConflictDoNothing()
			}
			const ormUser = yield* db.run(SQL.from(ormTable).select("entry_id")
				.where(($) => [$.user_id.eq("user_1")]).orderBy(["entry_id", "asc"]).crossTenant())
			const drizzleUser = yield* drizzle.select({ entry_id: drizzleTable.entry_id }).from(drizzleTable)
				.where(eq(drizzleTable.user_id, "user_1")).orderBy(asc(drizzleTable.entry_id))
			const ormPage = yield* db.run(SQL.from(ormTable).select()
				.where(($) => [$.id.gt("ack_1")]).orderBy(["id", "asc"]).limit(2).crossTenant())
			const drizzlePage = yield* drizzle.select().from(drizzleTable)
				.where(gt(drizzleTable.id, "ack_1")).orderBy(asc(drizzleTable.id)).limit(2)
			const unscoped = yield* Effect.exit(db.run(SQL.from(ormTable).select()))
			const wrongSchema = SQL.table("orm_ack", { id: custom("integer", Schema.Int) })
			const invalidRow = yield* Effect.exit(db.run(SQL.from(wrongSchema).select()))
			const transaction = yield* Effect.exit(db.transaction(db.execute({ sql: "DELETE FROM orm_ack" })))
			return { ormUser, drizzleUser, ormPage, drizzlePage, unscoped, invalidRow, transaction }
		}).pipe(Effect.provide(D1Client.layer({ db: binding }))))
		expect(result.ormUser).toEqual(result.drizzleUser)
		expect(result.ormUser).toEqual([{ entry_id: "release_1" }, { entry_id: "release_2" }])
		expect(result.ormPage).toEqual(result.drizzlePage)
		expect(result.ormPage).toEqual(fixture.slice(1))
		if (!Exit.isFailure(result.unscoped) || !Exit.isFailure(result.invalidRow) || !Exit.isFailure(result.transaction)) {
			throw new Error("a safety check accepted an unsafe operation")
		}
		expect(Cause.findDefect(result.unscoped.cause)).toMatchObject({ _tag: "Success", success: { _tag: "@maple-dev/effect-orm/TenantScopeViolation" } })
		expect(Cause.findError(result.invalidRow.cause)).toMatchObject({ _tag: "Success", success: { _tag: "@maple-dev/effect-orm/CompiledQueryDecodeError" } })
		expect(Cause.findError(result.transaction.cause)).toMatchObject({ _tag: "Success", success: { _tag: "@maple-dev/effect-orm/TransactionUnsupported" } })
	} finally {
		await mf.dispose()
	}
}, 30_000)
