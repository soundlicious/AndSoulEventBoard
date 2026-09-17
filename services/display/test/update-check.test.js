import test from "node:test";
import assert from "node:assert/strict";
import { createUpdateCheck } from "../src/update-check.js";

test("reloads only after two consecutive ready observations of a different build", async () => {
  let result = { version: "old", ready: true };
  let reloads = 0;
  const tick = createUpdateCheck({ version: "old", reload: () => reloads++, fetchImpl: async (url, options) => {
    assert.equal(url, "/version");
    assert.equal(options.cache, "no-store");
    return Response.json(result);
  } });
  await tick();
  result = { version: "new", ready: false };
  await tick(); await tick();
  assert.equal(reloads, 0);
  result.ready = true;
  await tick();
  assert.equal(reloads, 0);
  await tick(); await tick();
  assert.equal(reloads, 1);
});

test("outages and rollback cancel a pending reload; manual builds do not poll", async () => {
  let result = { version: "new", ready: true };
  let fail = false;
  let reloads = 0;
  const fetchImpl = async () => { if (fail) throw new Error("offline"); return Response.json(result); };
  const tick = createUpdateCheck({ version: "old", fetchImpl, reload: () => reloads++ });
  await tick(); fail = true; await tick(); fail = false; await tick();
  assert.equal(reloads, 0);
  result = { version: "old", ready: true }; await tick();
  result.version = "new"; await tick(); assert.equal(reloads, 0); await tick();
  assert.equal(reloads, 1);
  await createUpdateCheck({ version: "", fetchImpl: () => assert.fail("manual build must not poll") })();
});
