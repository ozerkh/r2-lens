import { apiCallsFor, CAPABILITIES } from "../../shared/capabilities";
import { copyBlocker } from "../../shared/copy";
import type { Backend } from "../../shared/types";
import { api, deleteKeys, listAll, listAllObjects, type BucketRef } from "../api";
import type { Item } from "../components/types";
import { apiBudgetError } from "./apiBudget";
import { parentPrefix, plural } from "./format";

export async function renameItem(bucketRef: BucketRef, backend: Backend, item: Item, name: string) {
  const { keepsMetadata } = CAPABILITIES[backend];
  const source = item.key;
  if (item.type === "file") {
    const blocker = copyBlocker(item.object, keepsMetadata);
    if (blocker) throw new Error(blocker);
    await api.copyObject(bucketRef, source, `${parentPrefix(source)}${name}`, true);
    return;
  }
  const target = `${parentPrefix(source)}${name}/`;
  const clash = await api.listObjects(bucketRef, { prefix: target, recursive: true, perPage: 1 });
  if (clash.objects.length > 0) throw new Error(`${name} already exists`);
  const objects = await listAllObjects(bucketRef, source);
  const overBudget = apiBudgetError(apiCallsFor(backend, "move", objects.length), `Renaming ${objects.length} objects`);
  if (overBudget) throw new Error(overBudget);
  const blocked = objects.map((object) => copyBlocker(object, keepsMetadata)).filter(Boolean);
  if (blocked.length > 0) throw new Error(`${plural(blocked.length, "object")} cannot be moved safely. ${blocked[0]}`);
  for (const object of objects) {
    await api.copyObject(bucketRef, object.key, `${target}${object.key.slice(source.length)}`, true);
  }
}

export async function deleteItems(bucketRef: BucketRef, backend: Backend, items: Item[]) {
  const keys = new Set<string>();
  for (const item of items) {
    if (item.type === "file") keys.add(item.key);
    else for (const key of await listAll(bucketRef, item.key)) keys.add(key);
  }
  const overBudget = apiBudgetError(apiCallsFor(backend, "delete", keys.size), `Deleting ${keys.size} objects`);
  if (overBudget) throw new Error(overBudget);
  const failed = await deleteKeys(bucketRef, [...keys]);
  return { deleted: keys.size - failed.length, failed };
}
