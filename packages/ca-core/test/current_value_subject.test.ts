import { CurrentValueSubject } from "@/reactivity/current_value_subject";
import { describe, expect, it } from "vitest";

describe("CurrentValueSubject cancel listen tests", () => {
    it("base test", () => {
        const valueSubject = CurrentValueSubject.create(0);
        var value: number | null = null;
        expect(valueSubject.value).toBe(0);
        expect(valueSubject.numberOfListeners).toBe(0);
        expect(value).toBeNull();
        const listenerId = valueSubject.listen((change) => {
            value = change.newValue;
        });
        expect(valueSubject.numberOfListeners).toBe(1);
        expect(value).toBe(0);
        valueSubject.cancel(listenerId); // Cancel the listener
        valueSubject.add(1); // This should not trigger the listener
        expect(valueSubject.value).toBe(1); // Value of valueSubject should be updated
        expect(value).toBe(0); // Variable `value` should remain unchanged
    });

    it("dispose test", () => {
        const parentSubject = CurrentValueSubject.create(10);
        {
            using _ = parentSubject.derive((v) => v * 2, { listenStrategy: "eager" });
            expect(parentSubject.numberOfListeners).toBe(1);
        }
        // If you exit the scope, the derived subject should be disposed only if `using` 
        // keyword is used
        expect(parentSubject.numberOfListeners).toBe(0);

        {
            parentSubject.derive((v) => v * 2, { listenStrategy: "lazy" });
            // Since it's lazy, it should not listen to parent until there is a listener
            expect(parentSubject.numberOfListeners).toBe(0);
        }

        {
            parentSubject.derive((v) => v * 2, { listenStrategy: "eager" });
            expect(parentSubject.numberOfListeners).toBe(1);
        }
        // If you exit the scope, the derived subject is never disposed because `listenStrategy` is eager
        // So be careful when using eager derived subjects
        expect(parentSubject.numberOfListeners).toBe(1);
    });

    it("derive test", () => {
        const parentSubject = CurrentValueSubject.create(5);
        const derivedSubject = parentSubject.derive((v) => v + 3);
        expect(derivedSubject.value).toBe(8);
        expect(parentSubject.numberOfListeners).toBe(0);

        parentSubject.add(10);
        expect(parentSubject.value).toBe(10);
        // Since derivedSubject is lazy, it should not listen to parent until there is a listener
        expect(derivedSubject.value).toBe(8);

        // Now, add a listener to derivedSubject
        derivedSubject.listen(() => { });
        expect(parentSubject.numberOfListeners).toBe(1);
        // Now, derivedSubject should reflect the updated value from parentSubject
        expect(derivedSubject.value).toBe(13);
    });

});