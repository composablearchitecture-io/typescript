const hasOwn = Object.prototype.hasOwnProperty;

const isObjectLike = (value: unknown): value is Record<PropertyKey, unknown> =>
    typeof value === 'object' && value !== null;

const isArrayBufferView = (
    value: unknown,
): value is ArrayLike<unknown> & ArrayBufferView =>
    typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(value);

/**
 * Structural equality used as the default `isEqual` for the React bindings.
 *
 * Recursively compares two values, with built-in support for arrays, plain
 * objects, `Map`, `Set`, typed array views, and `RegExp`. Falls back to
 * reference equality for primitives and class instances that override
 * `valueOf`/`toString`. Treats `NaN` as equal to itself, matching the
 * behaviour expected by React state comparators.
 *
 * The `_owner` field present on React elements is intentionally skipped so
 * that comparing JSX trees does not produce spurious inequalities driven by
 * React-internal bookkeeping.
 *
 * @returns `true` when [a] and [b] are structurally equivalent.
 *
 * @example
 * ```ts
 * deepEqual({ a: 1, b: [1, 2] }, { a: 1, b: [1, 2] }); // true
 * deepEqual(new Map([["x", 1]]), new Map([["x", 1]]));  // true
 * ```
 */
export function deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) {
        return true;
    }

    if (isObjectLike(a) && isObjectLike(b)) {
        if (a.constructor !== b.constructor) {
            return false;
        }

        if (Array.isArray(a)) {
            if (!Array.isArray(b) || a.length !== b.length) {
                return false;
            }
            for (let i = 0; i < a.length; i += 1) {
                if (!deepEqual(a[i], b[i])) {
                    return false;
                }
            }
            return true;
        }

        if (a instanceof Map && b instanceof Map) {
            if (a.size !== b.size) {
                return false;
            }
            for (const [key, value] of a) {
                if (!b.has(key) || !deepEqual(value, b.get(key))) {
                    return false;
                }
            }
            return true;
        }

        if (a instanceof Set && b instanceof Set) {
            if (a.size !== b.size) {
                return false;
            }
            for (const value of a) {
                if (!b.has(value)) {
                    return false;
                }
            }
            return true;
        }

        if (isArrayBufferView(a) && isArrayBufferView(b)) {
            const length = a.length;
            if (length !== b.length) {
                return false;
            }
            for (let i = 0; i < length; i += 1) {
                if (a[i] !== b[i]) {
                    return false;
                }
            }
            return true;
        }

        if (a instanceof RegExp && b instanceof RegExp) {
            return a.source === b.source && a.flags === b.flags;
        }

        const objA = a as Record<PropertyKey, unknown>;
        const objB = b as Record<PropertyKey, unknown>;

        const valueOfA = objA.valueOf;
        const valueOfB = objB.valueOf;
        if (
            typeof valueOfA === 'function' &&
            typeof valueOfB === 'function' &&
            (valueOfA !== Object.prototype.valueOf ||
                valueOfB !== Object.prototype.valueOf)
        ) {
            return valueOfA.call(objA) === valueOfB.call(objB);
        }

        const toStringA = objA.toString;
        const toStringB = objB.toString;
        if (
            typeof toStringA === 'function' &&
            typeof toStringB === 'function' &&
            (toStringA !== Object.prototype.toString ||
                toStringB !== Object.prototype.toString)
        ) {
            return toStringA.call(objA) === toStringB.call(objB);
        }

        const keysA = Object.keys(objA);
        if (keysA.length !== Object.keys(objB).length) {
            return false;
        }

        for (const key of keysA) {
            if (!hasOwn.call(objB, key)) {
                return false;
            }
        }

        for (const key of keysA) {
            // React elements carry an internal `_owner` field we never want to
            // factor into equality checks against rendered JSX.
            if (key === '_owner' && '$$typeof' in objA) {
                continue;
            }
            if (!deepEqual(objA[key], objB[key])) {
                return false;
            }
        }

        return true;
    }

    return a !== a && b !== b;
}

export default deepEqual;
