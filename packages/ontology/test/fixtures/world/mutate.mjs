// Applies a mutation from mutations.json to a deep copy of a snapshot. Path segments are object keys, array
// indexes, or `{ key: value }` selectors that pick the first array element whose `key` equals `value`.
// Ops: `set` (assign the value), `push` (append to an array), `remove` (delete the element or key), `dup`
// (append a deep copy of the selected array element to its array).
export function applyMutation(snapshot, mutation) {
  const out = structuredClone(snapshot);
  for (const op of mutation.ops) {
    const path = op.path;
    let parent = out;
    const step = (container, seg) => {
      if (seg !== null && typeof seg === "object") {
        const [[k, v]] = Object.entries(seg);
        const i = container.findIndex((x) => x[k] === v);
        if (i < 0) throw new Error(`${mutation.name}: no element with ${k}=${v}`);
        return i;
      }
      return seg;
    };
    for (const seg of path.slice(0, -1)) parent = parent[step(parent, seg)];
    const last = step(parent, path[path.length - 1]);
    if (op.op === "set") parent[last] = structuredClone(op.value);
    else if (op.op === "push") parent[last].push(structuredClone(op.value));
    else if (op.op === "remove") Array.isArray(parent) ? parent.splice(last, 1) : delete parent[last];
    else if (op.op === "dup") parent.push(structuredClone(parent[last]));
    else throw new Error(`${mutation.name}: unknown op ${op.op}`);
  }
  return out;
}
