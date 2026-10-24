// Throwaway dialect used to test feasibility before changing the public API.
import { DateTime, Schema } from "effect"
import type { Dialect } from "../src/ch/dialect"
import { QueryBuilderError } from "../src/ch/errors"
import { fail } from "../src/ch/failure"
import { custom } from "../src/ch/types"
export * from "../src/core"
export { table } from "../src/ch/table"
export const text = custom("text", Schema.String)

const quoteString = (value: string): string => {
	if (value.includes("__PARAM_") || value.includes("\0")) {
		const hex = Array.from(new TextEncoder().encode(value), (byte) => byte.toString(16).padStart(2, "0")).join("")
		return `CAST(X'${hex}' AS TEXT)`
	}
	return `'${value.replace(/'/g, "''")}'`
}
const literal = (value: unknown, context: string): string => {
	if (value === null) return "NULL"
	if (typeof value === "string") return quoteString(value)
	if (typeof value === "boolean") return value ? "1" : "0"
	if (typeof value === "number" && Number.isFinite(value)) return String(value)
	return fail(new QueryBuilderError({ code: "InvalidLiteral", message: `${context}: unsupported SQLite literal` }), "NULL")
}
export const d1Dialect: Dialect = {
	name: "d1",
	functions: "sqlite",
	quoteIdent: (name) => `"${name.replace(/"/g, '""')}"`,
	quoteString,
	literal,
	dateTimeLiteral: (value) => quoteString(DateTime.formatIso(value)),
	params: { _tag: "bind", placeholder: () => "?", reuse: false, maxParameters: 100 },
	clauses: {
		format: false,
		derivedTableAlias: true,
		groupByAlias: false,
		parenthesizeUnionBranches: false,
		returning: true,
		onConflict: true,
	},
}
