import { APP_NAV } from "../../../../components/layout/app-nav";
import { ADMIN_NAV } from "../../../../components/layout/admin-nav";
describe("Navigation Integration", () => {
  it("AI Scalping Terminal in AppNav", () => {
    const items = APP_NAV.flatMap((g) => g.items || []);
    expect(items.some((i) => i.href === "/market-intelligence/scalping")).toBe(true);
  });
  it("Advanced Analysis in AppNav", () => {
    const items = APP_NAV.flatMap((g) => g.items || []);
    expect(items.some((i) => i.href === "/market-intelligence/advanced")).toBe(true);
  });
  it("Admin nav includes both", () => {
    const items = ADMIN_NAV.flatMap((g) => g.items || []);
    expect(items.some((i) => i.href === "/market-intelligence/scalping")).toBe(true);
    expect(items.some((i) => i.href === "/market-intelligence/advanced")).toBe(true);
  });
});
