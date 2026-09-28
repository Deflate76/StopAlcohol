// An in-memory Firestore-shaped store, including serialized transactional commits.
export function fakeFirestore() {
    const data = new Map(); let tail = Promise.resolve();
    const copy = value => value === undefined ? undefined : structuredClone(value);
    class Ref {
        constructor(path) { this.path = path; this.id = path.split('/').at(-1); }
        collection(name) { return new Query(`${this.path}/${name}`); }
        async get() { return {id: this.id, ref: this, exists: data.has(this.path), data: () => copy(data.get(this.path))}; }
        async set(value) { data.set(this.path, copy(value)); }
        async update(value) { if (!data.has(this.path)) throw new Error('Missing document'); data.set(this.path, {...data.get(this.path), ...copy(value)}); }
        async delete() { data.delete(this.path); }
    }
    class Query {
        constructor(path, filters = [], order = null, max = Infinity, cursor = null) { Object.assign(this, {path, filters, order, max, cursor}); }
        doc(id) { return new Ref(`${this.path}/${id}`); }
        where(field, op, value) { return new Query(this.path, [...this.filters, {field, op, value}], this.order, this.max, this.cursor); }
        orderBy(field, dir = 'asc') { return new Query(this.path, this.filters, {field, dir}, this.max, this.cursor); }
        limit(max) { return new Query(this.path, this.filters, this.order, max, this.cursor); }
        startAfter(cursor) { return new Query(this.path, this.filters, this.order, this.max, cursor); }
        async get() {
            const depth = this.path.split('/').length + 1;
            let entries = [...data.entries()].filter(([path, value]) => path.startsWith(`${this.path}/`) && path.split('/').length === depth && this.filters.every(f => f.op === '==' ? value[f.field] === f.value : f.op === '<' ? value[f.field] < f.value : value[f.field] <= f.value));
            const compare = ([pathA, a], [pathB, b]) => {
                const field = this.order?.field, dir = this.order?.dir === 'desc' ? -1 : 1;
                return ((field && (a[field] - b[field])) || pathA.localeCompare(pathB)) * dir;
            };
            entries.sort(compare);
            if (this.cursor) entries = entries.filter(entry => compare(entry, [this.cursor.ref.path, this.cursor.data()]) > 0);
            const docs = await Promise.all(entries.slice(0, this.max).map(([path]) => new Ref(path).get()));
            return {docs, size: docs.length, empty: docs.length === 0};
        }
    }
    return {data, collection: name => new Query(name),
        async runTransaction(callback) {
            const prior = tail; let release; tail = new Promise(resolve => { release = resolve; }); await prior;
            const writes = [];
            try {
                const result = await callback({get: ref => ref.get(), set: (ref, value) => writes.push(() => ref.set(value)), update: (ref, value) => writes.push(() => ref.update(value)), delete: ref => writes.push(() => ref.delete())});
                for (const write of writes) await write();
                return result;
            } finally { release(); }
        }
    };
}
