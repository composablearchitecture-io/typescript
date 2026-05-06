import { install } from "@sinonjs/fake-timers";
import { afterAll, beforeEach } from "vitest";

function useFakeTimers() {
  const clock = install();
  beforeEach(() => clock.reset());
  afterAll(() => clock.uninstall());
  return clock;
}
export const clock = useFakeTimers();
