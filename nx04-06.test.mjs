import assert from "node:assert/strict";
import { rootReadLimitNotice, applyRootReadCeiling, ROOT_READ_CEILING_LINES } from "./index.ts";

// C10 removed with the WRC P0-B floors verdict: the exploration-probe
// machinery was dead on the structured path and is deleted (nx-followups 02
// is wontfix — its fixture objects no longer exist).



// C15: explicit oversized reads are rejected; omitted reads are normalized by
// the adapter to the stable 200-line ceiling (one named constant), and inputs
// that already name a limit or line range pass through untouched.
{
  assert.match(rootReadLimitNotice({ startLine: 1, endLine: 201 }) ?? "", /200/);
  assert.equal(rootReadLimitNotice({ startLine: 1, endLine: 200 }), undefined);
  assert.deepEqual(applyRootReadCeiling({ path: "a.ts" }), { path: "a.ts", limit: ROOT_READ_CEILING_LINES });
  assert.deepEqual(applyRootReadCeiling({ path: "a.ts", limit: 5 }), { path: "a.ts", limit: 5 });
}



console.log("planner-only NX-04/NX-05/NX-06: PASS");
