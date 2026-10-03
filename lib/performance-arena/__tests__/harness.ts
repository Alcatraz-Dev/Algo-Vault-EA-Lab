// Shared harness for Performance Arena tests (repo jiti-runner convention).

export function createSuite(name: string) {
    let passed = true;
    let count = 0;

    const check = (cond: boolean, label: string) => {
        count += 1;
        if (cond) {
            console.log(`  PASS: ${label}`);
        } else {
            console.error(`  FAIL: ${label}`);
            passed = false;
        }
    };

    const section = (title: string) => {
        console.log(`\n--- ${title} ---`);
    };

    const finish = (): boolean => {
        console.log(`\n[${name}] ${count} checks`);
        return passed;
    };

    return { check, section, finish };
}

export function approxEqual(a: number, b: number, epsilon = 1e-9): boolean {
    return Math.abs(a - b) <= epsilon;
}
