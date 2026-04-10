import { setTimeout as sleep } from "node:timers/promises";

import { expect, test } from "@playwright/test";

test("dev: open app, nickname, join — no crash", async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (err) => {
    pageErrors.push(err.message);
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "vibeme2" })).toBeVisible();
  await page.locator("#join-nickname").fill("smoke_test");
  await page.locator("#join-submit").click();

  await expect(page.locator("#join-panel")).toBeHidden({ timeout: 30_000 });
  await expect(page.locator("#join-error")).toBeHidden();

  await expect(page.locator("#game-canvas")).toBeVisible();
  await sleep(1500);

  expect(pageErrors, `Uncaught page errors: ${pageErrors.join(" | ")}`).toEqual([]);
  expect(consoleErrors, `Console errors: ${consoleErrors.join(" | ")}`).toEqual([]);
});
